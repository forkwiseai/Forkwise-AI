// Reads a .pptx in the browser and turns it into plain slide models the viewer can draw and animate.
// It covers what decks made by python-pptx, pptxgenjs and PowerPoint itself use most: positioned shapes with
// fills and outlines, text with runs, pictures, groups, tables, backgrounds, theme colours, placeholder
// positions inherited from the layout and master, slide transitions and entrance animations.
import JSZip from "jszip"

const EMU_PER_PX = 9525
const P = "http://schemas.openxmlformats.org/presentationml/2006/main"
const A = "http://schemas.openxmlformats.org/drawingml/2006/main"
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"

function parseXml(text) {
  return new DOMParser().parseFromString(text, "application/xml")
}

function kids(node, ns, name) {
  const out = []
  if (!node) return out
  for (const child of node.children) if (child.localName === name && (!ns || child.namespaceURI === ns)) out.push(child)
  return out
}

function kid(node, ns, name) {
  return kids(node, ns, name)[0] || null
}

function path(node, steps) {
  let current = node
  for (const step of steps) {
    if (!current) return null
    current = kid(current, null, step)
  }
  return current
}

function num(value, fallback) {
  const parsed = parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function dirOf(target, base) {
  // resolve "../media/image1.png" against "ppt/slides/slide1.xml"
  const parts = base.split("/")
  parts.pop()
  for (const piece of target.split("/")) {
    if (piece === "..") parts.pop()
    else if (piece !== ".") parts.push(piece)
  }
  return parts.join("/")
}

async function rels(zip, partPath) {
  const parts = partPath.split("/")
  const name = parts.pop()
  const relPath = parts.join("/") + "/_rels/" + name + ".rels"
  const file = zip.file(relPath)
  const map = {}
  if (!file) return map
  const doc = parseXml(await file.async("text"))
  for (const rel of doc.getElementsByTagName("Relationship")) {
    const target = rel.getAttribute("Target")
    map[rel.getAttribute("Id")] = { target: rel.getAttribute("TargetMode") === "External" ? target : dirOf(target, partPath), type: rel.getAttribute("Type") || "", external: rel.getAttribute("TargetMode") === "External" }
  }
  return map
}

// ---- colours ---------------------------------------------------------------------------------------------
function clamp(value) {
  return Math.max(0, Math.min(255, Math.round(value)))
}

function hexToRgb(hex) {
  const clean = (hex || "000000").replace("#", "")
  return [parseInt(clean.slice(0, 2), 16), parseInt(clean.slice(2, 4), 16), parseInt(clean.slice(4, 6), 16)]
}

function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  let h = 0, s = 0
  const l = (max + min) / 2
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
    h /= 6
  }
  return [h, s, l]
}

function hslToRgb([h, s, l]) {
  if (s === 0) return [l * 255, l * 255, l * 255]
  const hue = (p, q, t) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  return [hue(p, q, h + 1 / 3) * 255, hue(p, q, h) * 255, hue(p, q, h - 1 / 3) * 255]
}

const PRESET_COLORS = { black: "000000", white: "FFFFFF", red: "FF0000", green: "008000", blue: "0000FF", yellow: "FFFF00", gray: "808080", grey: "808080", orange: "FFA500", purple: "800080" }

function colorFrom(node, theme) {
  // node: an element holding srgbClr / schemeClr / prstClr / sysClr
  if (!node) return null
  let base = null
  let modNode = null
  for (const child of node.children) {
    if (child.localName === "srgbClr") { base = child.getAttribute("val"); modNode = child }
    else if (child.localName === "schemeClr") {
      const key = child.getAttribute("val")
      const mapped = { tx1: "dk1", tx2: "dk2", bg1: "lt1", bg2: "lt2" }[key] || key
      base = theme.colors[mapped] || theme.colors[key] || "000000"
      modNode = child
    } else if (child.localName === "prstClr") { base = PRESET_COLORS[child.getAttribute("val")] || "000000"; modNode = child }
    else if (child.localName === "sysClr") { base = child.getAttribute("lastClr") || "000000"; modNode = child }
    if (base) break
  }
  if (!base) return null
  let rgb = hexToRgb(base)
  let alpha = 1
  for (const mod of modNode.children) {
    const value = num(mod.getAttribute("val"), 100000) / 100000
    if (mod.localName === "alpha") alpha = value
    else if (mod.localName === "lumMod" || mod.localName === "lumOff") {
      const hsl = rgbToHsl(rgb)
      hsl[2] = mod.localName === "lumMod" ? hsl[2] * value : Math.min(1, hsl[2] + value)
      rgb = hslToRgb(hsl)
    } else if (mod.localName === "tint") rgb = rgb.map((c) => c + (255 - c) * (1 - value))
    else if (mod.localName === "shade") rgb = rgb.map((c) => c * value)
  }
  return "rgba(" + clamp(rgb[0]) + "," + clamp(rgb[1]) + "," + clamp(rgb[2]) + "," + alpha + ")"
}

function fillFrom(spPr, theme, images) {
  if (!spPr) return undefined
  if (kid(spPr, A, "noFill")) return "transparent"
  const solid = kid(spPr, A, "solidFill")
  if (solid) return colorFrom(solid, theme)
  const grad = kid(spPr, A, "gradFill")
  if (grad) {
    const stops = kids(kid(grad, A, "gsLst"), A, "gs").map((gs) => (colorFrom(gs, theme) || "transparent") + " " + num(gs.getAttribute("pos"), 0) / 1000 + "%")
    const lin = kid(grad, A, "lin")
    const angle = lin ? num(lin.getAttribute("ang"), 0) / 60000 + 90 : 180
    return stops.length ? "linear-gradient(" + angle + "deg, " + stops.join(", ") + ")" : undefined
  }
  const blip = kid(spPr, A, "blipFill") || kid(spPr, P, "blipFill")
  if (blip) {
    const ref = kid(blip, A, "blip")
    const url = ref && images[ref.getAttributeNS(R, "embed")]
    if (url) return "url(" + url + ") center / cover no-repeat"
  }
  return undefined
}

function lineFrom(spPr, theme) {
  const ln = spPr && kid(spPr, A, "ln")
  if (!ln || kid(ln, A, "noFill")) return null
  const solid = kid(ln, A, "solidFill")
  const color = solid ? colorFrom(solid, theme) : null
  if (!color) return null
  return { color, width: Math.max(1, num(ln.getAttribute("w"), 12700) / EMU_PER_PX) }
}

function xfrmOf(node) {
  const xfrm = node && (kid(node, A, "xfrm") || kid(node, P, "xfrm"))
  if (!xfrm) return null
  const off = kid(xfrm, A, "off")
  const ext = kid(xfrm, A, "ext")
  if (!off || !ext) return null
  const box = {
    x: num(off.getAttribute("x"), 0) / EMU_PER_PX, y: num(off.getAttribute("y"), 0) / EMU_PER_PX,
    w: num(ext.getAttribute("cx"), 0) / EMU_PER_PX, h: num(ext.getAttribute("cy"), 0) / EMU_PER_PX,
    rot: num(xfrm.getAttribute("rot"), 0) / 60000, flipH: xfrm.getAttribute("flipH") === "1", flipV: xfrm.getAttribute("flipV") === "1",
  }
  const chOff = kid(xfrm, A, "chOff")
  const chExt = kid(xfrm, A, "chExt")
  if (chOff && chExt) {
    box.chX = num(chOff.getAttribute("x"), 0) / EMU_PER_PX
    box.chY = num(chOff.getAttribute("y"), 0) / EMU_PER_PX
    box.chW = num(chExt.getAttribute("cx"), 1) / EMU_PER_PX || 1
    box.chH = num(chExt.getAttribute("cy"), 1) / EMU_PER_PX || 1
  }
  return box
}

// ---- placeholders --------------------------------------------------------------------------------------
function placeholderOf(node) {
  const nv = node && (kid(node, P, "nvSpPr") || kid(node, P, "nvPicPr") || kid(node, P, "nvGraphicFramePr"))
  const ph = nv && path(nv, ["nvPr", "ph"])
  if (!ph) return null
  return { type: ph.getAttribute("type") || "body", idx: ph.getAttribute("idx") || "" }
}

function placeholderBoxes(doc) {
  const map = []
  if (!doc) return map
  for (const sp of doc.getElementsByTagNameNS(P, "sp")) {
    const ph = placeholderOf(sp)
    const box = xfrmOf(kid(sp, P, "spPr"))
    if (ph && box) map.push({ ...ph, box, node: sp })
  }
  return map
}

function findPlaceholder(list, ph) {
  if (!ph) return null
  const same = (a, b) => (a === "ctrTitle" ? "title" : a) === (b === "ctrTitle" ? "title" : b)
  return list.find((item) => ph.idx && item.idx === ph.idx) || list.find((item) => same(item.type, ph.type)) || null
}

// ---- text ----------------------------------------------------------------------------------------------
const DEFAULT_SIZE = { title: 40, ctrTitle: 44, subTitle: 24, body: 22 }

function textFrom(txBody, theme, ph, fontScale) {
  if (!txBody) return null
  const bodyPr = kid(txBody, A, "bodyPr")
  const anchor = (bodyPr && bodyPr.getAttribute("anchor")) || (ph && (ph.type === "title" || ph.type === "ctrTitle") ? "ctr" : "t")
  const inset = (name, fallback) => (bodyPr && bodyPr.getAttribute(name) !== null ? num(bodyPr.getAttribute(name), 0) / EMU_PER_PX : fallback)
  const auto = bodyPr && kid(bodyPr, A, "normAutofit")
  const scale = fontScale * (auto ? num(auto.getAttribute("fontScale"), 100000) / 100000 : 1)
  const fallbackSize = (ph && DEFAULT_SIZE[ph.type]) || 18
  const paragraphs = []
  for (const p of kids(txBody, A, "p")) {
    const pPr = kid(p, A, "pPr")
    const level = pPr ? num(pPr.getAttribute("lvl"), 0) : 0
    const runs = []
    for (const child of p.children) {
      if (child.localName === "r" || child.localName === "fld") {
        const rPr = kid(child, A, "rPr")
        const t = kid(child, A, "t")
        const fill = rPr && kid(rPr, A, "solidFill")
        const latin = rPr && (kid(rPr, A, "latin") || kid(rPr, A, "cs"))
        runs.push({
          text: t ? t.textContent : "",
          size: (rPr && rPr.getAttribute("sz") ? num(rPr.getAttribute("sz"), 1800) / 100 : fallbackSize - level * 2) * scale,
          bold: rPr ? rPr.getAttribute("b") === "1" : ph && (ph.type === "title" || ph.type === "ctrTitle"),
          italic: rPr ? rPr.getAttribute("i") === "1" : false,
          underline: rPr ? (rPr.getAttribute("u") || "none") !== "none" : false,
          color: fill ? colorFrom(fill, theme) : null,
          font: latin ? latin.getAttribute("typeface") : null,
        })
      } else if (child.localName === "br") runs.push({ text: "\n", size: fallbackSize * scale })
    }
    const endRpr = kid(p, A, "endParaRPr")
    const bullet = pPr && (kid(pPr, A, "buChar") || kid(pPr, A, "buAutoNum"))
    paragraphs.push({
      align: { l: "left", ctr: "center", r: "right", just: "justify", dist: "justify" }[(pPr && pPr.getAttribute("algn")) || ""] || null,
      rtl: pPr ? pPr.getAttribute("rtl") === "1" : false,
      level,
      bullet: bullet && !kid(pPr, A, "buNone") ? (bullet.getAttribute("char") || "•") : null,
      runs,
      empty: runs.length === 0,
      emptySize: (endRpr && endRpr.getAttribute("sz") ? num(endRpr.getAttribute("sz"), 1800) / 100 : fallbackSize) * scale,
    })
  }
  return {
    anchor, paragraphs,
    pad: [inset("tIns", 3.6), inset("rIns", 9.6), inset("bIns", 3.6), inset("lIns", 9.6)],
    wrap: !(bodyPr && bodyPr.getAttribute("wrap") === "none"),
    vertical: bodyPr && (bodyPr.getAttribute("vert") || "").startsWith("vert"),
  }
}

// ---- shapes --------------------------------------------------------------------------------------------
function readShapes(container, ctx, transform) {
  const items = []
  for (const node of container.children) {
    const name = node.localName
    if (name === "sp" || name === "cxnSp") items.push(...readShape(node, ctx, transform))
    else if (name === "pic") items.push(...readPicture(node, ctx, transform))
    else if (name === "grpSp") {
      const box = xfrmOf(kid(node, P, "grpSpPr"))
      if (!box) continue
      const inner = (child) => transform({ ...child, x: box.x + (child.x - (box.chX || 0)) * (box.w / (box.chW || box.w || 1)), y: box.y + (child.y - (box.chY || 0)) * (box.h / (box.chH || box.h || 1)), w: child.w * (box.w / (box.chW || box.w || 1)), h: child.h * (box.h / (box.chH || box.h || 1)) })
      items.push(...readShapes(node, ctx, inner))
    } else if (name === "graphicFrame") items.push(...readFrame(node, ctx, transform))
    else if (name === "AlternateContent") {
      const fallback = kid(node, null, "Fallback") || kid(node, null, "Choice")
      if (fallback) items.push(...readShapes(fallback, ctx, transform))
    }
  }
  return items
}

function shapeId(node) {
  const nv = kid(node, P, "nvSpPr") || kid(node, P, "nvPicPr") || kid(node, P, "nvCxnSpPr") || kid(node, P, "nvGraphicFramePr") || kid(node, P, "nvGrpSpPr")
  const c = nv && kid(nv, P, "cNvPr")
  return c ? c.getAttribute("id") : ""
}

function readShape(node, ctx, transform) {
  const spPr = kid(node, P, "spPr")
  const ph = placeholderOf(node)
  let box = xfrmOf(spPr)
  let inherited = null
  if (ph) {
    inherited = findPlaceholder(ctx.layoutPh, ph) || findPlaceholder(ctx.masterPh, ph)
    if (!box && inherited) box = inherited.box
  }
  if (!box) return []
  const geom = spPr && kid(spPr, A, "prstGeom")
  const preset = geom ? geom.getAttribute("prst") : "rect"
  let fill = fillFrom(spPr, ctx.theme, ctx.images)
  const style = kid(node, P, "style")
  if (fill === undefined && style && !ph) {
    const ref = kid(style, A, "fillRef")
    if (ref && num(ref.getAttribute("idx"), 0) > 0) fill = colorFrom(ref, ctx.theme)
  }
  let line = lineFrom(spPr, ctx.theme)
  if (!line && style && !ph && node.localName === "cxnSp") {
    const ref = kid(style, A, "lnRef")
    const color = ref && colorFrom(ref, ctx.theme)
    if (color) line = { color, width: 1.5 }
  }
  const text = textFrom(kid(node, P, "txBody"), ctx.theme, ph, 1)
  if (text && inherited) {
    const masterText = textFrom(kid(inherited.node, P, "txBody"), ctx.theme, ph, 1)
    if (masterText && !kid(kid(node, P, "txBody"), A, "bodyPr")?.getAttribute("anchor")) text.anchor = masterText.anchor || text.anchor
  }
  const hasText = text && text.paragraphs.some((p) => p.runs.some((r) => r.text.trim()))
  if (!hasText && (fill === undefined || fill === "transparent") && !line) return []
  return [{ kind: node.localName === "cxnSp" ? "line" : "shape", id: shapeId(node), box: transform(box), preset, fill: fill === undefined ? null : fill, line, text: hasText ? text : null, adj: geom ? kid(kid(geom, A, "avLst"), A, "gd") : null }]
}

function readPicture(node, ctx, transform) {
  const box = xfrmOf(kid(node, P, "spPr"))
  const blip = path(node, ["blipFill", "blip"])
  const url = blip && ctx.images[blip.getAttributeNS(R, "embed")]
  if (!box || !url) return []
  const geom = path(node, ["spPr", "prstGeom"])
  return [{ kind: "picture", id: shapeId(node), box: transform(box), url, preset: geom ? geom.getAttribute("prst") : "rect", line: lineFrom(kid(node, P, "spPr"), ctx.theme) }]
}

function readFrame(node, ctx, transform) {
  const box = xfrmOf(node)
  if (!box) return []
  const data = path(node, ["graphic", "graphicData"])
  const table = data && kid(data, A, "tbl")
  if (table) {
    const widths = kids(kid(table, A, "tblGrid"), A, "gridCol").map((col) => num(col.getAttribute("w"), 0) / EMU_PER_PX)
    const rows = kids(table, A, "tr").map((tr) => ({
      h: num(tr.getAttribute("h"), 0) / EMU_PER_PX,
      cells: kids(tr, A, "tc").map((tc) => ({ text: textFrom(kid(tc, A, "txBody"), ctx.theme, null, 1), fill: fillFrom(kid(tc, A, "tcPr"), ctx.theme, ctx.images), span: num(tc.getAttribute("gridSpan"), 1), merged: tc.getAttribute("hMerge") === "1" || tc.getAttribute("vMerge") === "1" })),
    }))
    return [{ kind: "table", id: shapeId(node), box: transform(box), widths, rows }]
  }
  return [{ kind: "placeholder", id: shapeId(node), box: transform(box), label: data && /chart/.test(data.getAttribute("uri") || "") ? "Chart" : "Embedded object" }]
}

// ---- backgrounds, transitions, animations ---------------------------------------------------------------
function backgroundOf(doc, ctx) {
  const bg = doc && path(doc.documentElement, ["cSld", "bg"])
  if (!bg) return null
  const pr = kid(bg, P, "bgPr")
  if (pr) return fillFrom(pr, ctx.theme, ctx.images) || null
  const ref = kid(bg, P, "bgRef")
  if (ref) return colorFrom(ref, ctx.theme)
  return null
}

const TRANSITION_NAMES = ["fade", "push", "wipe", "split", "zoom", "cover", "pull", "strips", "dissolve", "randomBar", "cut", "morph", "reveal", "fly", "vortex", "ripple", "glitter", "flash"]

function transitionOf(doc) {
  const node = doc.documentElement.getElementsByTagNameNS(P, "transition")[0]
  if (!node) return null
  let kind = "fade"
  let dir = ""
  for (const child of node.children) {
    if (TRANSITION_NAMES.includes(child.localName)) {
      kind = child.localName
      dir = child.getAttribute("dir") || ""
      break
    }
  }
  const speed = node.getAttribute("spd") || "med"
  const ms = num(node.getAttributeNS("http://schemas.microsoft.com/office/powerpoint/2010/main", "dur") || node.getAttribute("p14:dur"), 0) || { slow: 1000, med: 700, fast: 450 }[speed] || 700
  return { kind, dir, ms, advance: node.getAttribute("advTm") ? num(node.getAttribute("advTm"), 0) : null }
}

const EFFECT_BY_PRESET = { 1: "appear", 2: "fly", 10: "fade", 16: "split", 22: "wipe", 42: "rise", 47: "rise", 53: "zoom", 21: "wheel", 26: "zoom", 23: "zoom", 31: "spin", 37: "rise" }
const FLY_DIR = { 1: "top", 2: "right", 4: "bottom", 8: "left", 3: "right", 6: "bottom", 9: "left", 12: "bottom" }

function animationsOf(doc) {
  // Returns groups: [{ auto: bool, effects: [{ spid, effect, dir, delay, dur }] }]
  const root = doc.documentElement.getElementsByTagNameNS(P, "timing")[0]
  if (!root) return []
  const main = Array.from(root.getElementsByTagNameNS(P, "cTn")).find((n) => n.getAttribute("nodeType") === "mainSeq")
  if (!main) return []
  const groups = []
  const list = kid(main, P, "childTnLst")
  for (const par of kids(list, P, "par")) {
    const outer = kid(par, P, "cTn")
    const conds = kids(kid(outer, P, "stCondLst"), P, "cond")
    const auto = conds.some((c) => c.getAttribute("evt") === "onBegin") || (groups.length === 0 && conds.length > 0 && conds.every((c) => c.getAttribute("delay") !== "indefinite"))
    const effects = []
    for (const innerPar of kids(kid(outer, P, "childTnLst"), P, "par")) {
      const inner = kid(innerPar, P, "cTn")
      const begin = num((kid(kid(inner, P, "stCondLst"), P, "cond") || { getAttribute: () => "0" }).getAttribute("delay"), 0)
      for (const effectPar of kids(kid(inner, P, "childTnLst"), P, "par")) {
        const node = kid(effectPar, P, "cTn")
        if (!node || node.getAttribute("presetClass") !== "entr") continue
        const own = num((kid(kid(node, P, "stCondLst"), P, "cond") || { getAttribute: () => "0" }).getAttribute("delay"), 0)
        const target = node.getElementsByTagNameNS(P, "spTgt")[0]
        let dur = 500
        for (const tn of node.getElementsByTagNameNS(P, "cTn")) {
          const d = num(tn.getAttribute("dur"), 0)
          if (d > 1) dur = Math.max(d, dur === 500 ? 0 : dur)
        }
        const preset = num(node.getAttribute("presetID"), 10)
        const subtype = num(node.getAttribute("presetSubtype"), 0)
        let effect = EFFECT_BY_PRESET[preset] || "fade"
        const filter = (node.getElementsByTagNameNS(P, "animEffect")[0] || { getAttribute: () => "" }).getAttribute("filter") || ""
        if (!EFFECT_BY_PRESET[preset] && filter.startsWith("wipe")) effect = "wipe"
        if (target) effects.push({ spid: target.getAttribute("spid"), effect, dir: FLY_DIR[subtype] || "bottom", delay: begin + own, dur: dur || 500 })
      }
    }
    if (effects.length) groups.push({ auto, effects })
  }
  return groups
}

async function themeOf(zip, presRels) {
  const theme = { colors: { dk1: "000000", lt1: "FFFFFF", dk2: "1F497D", lt2: "EEECE1", accent1: "4F81BD", accent2: "C0504D", accent3: "9BBB59", accent4: "8064A2", accent5: "4BACC6", accent6: "F79646", hlink: "0000FF", folHlink: "800080" }, major: "", minor: "" }
  const ref = Object.values(presRels).find((rel) => rel.type.endsWith("/theme"))
  const file = ref && zip.file(ref.target)
  if (!file) return theme
  const doc = parseXml(await file.async("text"))
  const scheme = doc.getElementsByTagNameNS(A, "clrScheme")[0]
  if (scheme) {
    for (const entry of scheme.children) {
      const color = entry.children[0]
      if (!color) continue
      theme.colors[entry.localName] = color.getAttribute("val") && color.localName === "srgbClr" ? color.getAttribute("val") : color.getAttribute("lastClr") || theme.colors[entry.localName]
    }
  }
  const major = doc.getElementsByTagNameNS(A, "majorFont")[0]
  const minor = doc.getElementsByTagNameNS(A, "minorFont")[0]
  theme.major = (major && kid(major, A, "latin") && kid(major, A, "latin").getAttribute("typeface")) || ""
  theme.minor = (minor && kid(minor, A, "latin") && kid(minor, A, "latin").getAttribute("typeface")) || ""
  return theme
}

const MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", svg: "image/svg+xml", webp: "image/webp", bmp: "image/bmp", emf: "image/emf", wmf: "image/wmf" }

async function imagesFor(zip, relMap, cache) {
  const images = {}
  for (const [id, rel] of Object.entries(relMap)) {
    if (!rel.type.endsWith("/image") || rel.external) continue
    if (!cache[rel.target]) {
      const file = zip.file(rel.target)
      if (!file) continue
      const ext = rel.target.split(".").pop().toLowerCase()
      const blob = new Blob([await file.async("uint8array")], { type: MIME[ext] || "application/octet-stream" })
      cache[rel.target] = URL.createObjectURL(blob)
    }
    images[id] = cache[rel.target]
  }
  return images
}

export async function loadPptx(buffer) {
  const zip = await JSZip.loadAsync(buffer)
  const presFile = zip.file("ppt/presentation.xml")
  if (!presFile) throw new Error("This file is not a PowerPoint presentation.")
  const pres = parseXml(await presFile.async("text"))
  const presRels = await rels(zip, "ppt/presentation.xml")
  const size = pres.getElementsByTagNameNS(P, "sldSz")[0]
  const width = size ? num(size.getAttribute("cx"), 9144000) / EMU_PER_PX : 960
  const height = size ? num(size.getAttribute("cy"), 5143500) / EMU_PER_PX : 540
  const theme = await themeOf(zip, presRels)
  const cache = {}
  const slides = []
  const ids = Array.from(pres.getElementsByTagNameNS(P, "sldId"))
  for (const sldId of ids) {
    const rel = presRels[sldId.getAttributeNS(R, "id")]
    const file = rel && zip.file(rel.target)
    if (!file) continue
    const doc = parseXml(await file.async("text"))
    const slideRels = await rels(zip, rel.target)
    const layoutRel = Object.values(slideRels).find((item) => item.type.endsWith("/slideLayout"))
    const layoutDoc = layoutRel && zip.file(layoutRel.target) ? parseXml(await zip.file(layoutRel.target).async("text")) : null
    const layoutRels = layoutRel ? await rels(zip, layoutRel.target) : {}
    const masterRel = Object.values(layoutRels).find((item) => item.type.endsWith("/slideMaster"))
    const masterDoc = masterRel && zip.file(masterRel.target) ? parseXml(await zip.file(masterRel.target).async("text")) : null
    const masterRels = masterRel ? await rels(zip, masterRel.target) : {}
    const ctx = { theme, images: await imagesFor(zip, slideRels, cache), layoutPh: placeholderBoxes(layoutDoc), masterPh: placeholderBoxes(masterDoc) }
    const layoutCtx = { ...ctx, images: await imagesFor(zip, layoutRels, cache) }
    const masterCtx = { ...ctx, images: await imagesFor(zip, masterRels, cache) }
    const background = backgroundOf(doc, ctx) || backgroundOf(layoutDoc, layoutCtx) || backgroundOf(masterDoc, masterCtx) || "#ffffff"
    const tree = path(doc.documentElement, ["cSld", "spTree"])
    const same = (box) => box
    // Decorative shapes of the layout (not placeholders) sit behind the slide's own shapes.
    const layoutTree = layoutDoc && path(layoutDoc.documentElement, ["cSld", "spTree"])
    const showMaster = doc.documentElement.getAttribute("showMasterSp") !== "0"
    const under = showMaster && layoutTree ? readShapes(layoutTree, layoutCtx, same).filter((item) => !item.text || item.kind !== "shape") : []
    const shapes = tree ? readShapes(tree, ctx, same) : []
    const notesRel = Object.values(slideRels).find((item) => item.type.endsWith("/notesSlide"))
    let notes = ""
    if (notesRel && zip.file(notesRel.target)) {
      const notesDoc = parseXml(await zip.file(notesRel.target).async("text"))
      notes = Array.from(notesDoc.getElementsByTagNameNS(A, "t")).map((t) => t.textContent).join(" ").replace(/\s+/g, " ").trim()
    }
    slides.push({ number: slides.length + 1, background, shapes: [...under.map((item) => ({ ...item, id: "" })), ...shapes], transition: transitionOf(doc), animations: animationsOf(doc), notes, hidden: doc.documentElement.getAttribute("show") === "0" })
  }
  return { width, height, slides, fonts: { major: theme.major, minor: theme.minor }, release() { Object.values(cache).forEach((url) => URL.revokeObjectURL(url)) } }
}

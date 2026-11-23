/* Forkwise Motion characters: FW.character(parent, options) draws a rigged flat-vector
   character and gives it time-based actions (walk, talk with lip-sync, blink, wave, jump,
   poses, expressions, looking around). Everything is computed from the time.

   const sara = FW.character("#world", {
     kind: "girl",            // girl | boy | woman | man | grandma | grandpa
     skin: "#f2c6a0", hair: { style: "pigtails", color: "#3b2416" },
     top: "#ff7a90", bottom: { type: "skirt", color: "#5b6cff" }, shoes: "#33264a",
     x: 400, y: 900, height: 330, who: "sara", facing: 1
   })
   sara.walk(0.5, 3, { to: 1200 }).say().wave(4, 1.5).expression(4, "happy").look(5, 1, 0)
*/
(function () {
  const FW = window.FW
  const NS = "http://www.w3.org/2000/svg"
  const clamp = FW.clamp
  const lerp = FW.lerp

  function shade(hex, amount) {
    const m = String(hex).replace("#", "")
    const full = m.length === 3 ? m.split("").map((c) => c + c).join("") : m.slice(0, 6)
    const n = parseInt(full, 16)
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
    const f = (v) => Math.round(clamp(amount < 0 ? v * (1 + amount) : v + (255 - v) * amount, 0, 255))
    r = f(r); g = f(g); b = f(b)
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)
  }
  function node(tag, attrs, parent) {
    const el = document.createElementNS(NS, tag)
    for (const key in attrs) el.setAttribute(key, attrs[key])
    if (parent) parent.appendChild(el)
    return el
  }

  const BODIES = {
    child: { head: 50, neck: 9, torso: 62, torsoW: 66, hipW: 58, thigh: 46, shin: 44, upper: 36, lower: 34, limb: 19, arm: 15, hand: 10, foot: 16 },
    adult: { head: 42, neck: 14, torso: 112, torsoW: 78, hipW: 66, thigh: 76, shin: 72, upper: 60, lower: 54, limb: 22, arm: 17, hand: 10, foot: 19 },
    elder: { head: 42, neck: 12, torso: 104, torsoW: 80, hipW: 70, thigh: 70, shin: 66, upper: 56, lower: 50, limb: 22, arm: 17, hand: 10, foot: 19 },
  }
  const KINDS = {
    girl: { age: "child", hair: { style: "pigtails", color: "#3b2416" }, top: "#ff7a90", bottom: { type: "skirt", color: "#5b6cff" } },
    boy: { age: "child", hair: { style: "short", color: "#2b1d14" }, top: "#3fa7ff", bottom: { type: "shorts", color: "#34406b" } },
    woman: { age: "adult", hair: { style: "long", color: "#4a2c1d" }, top: "#8e6cff", bottom: { type: "pants", color: "#2d3350" } },
    man: { age: "adult", hair: { style: "short", color: "#22180f" }, top: "#2fb38a", bottom: { type: "pants", color: "#3a3f55" }, beard: false },
    grandma: { age: "elder", hair: { style: "bun", color: "#d9d6d2" }, top: "#b56576", bottom: { type: "skirt", color: "#6d597a" }, glasses: true },
    grandpa: { age: "elder", hair: { style: "bald", color: "#d9d6d2" }, top: "#6b8f71", bottom: { type: "pants", color: "#4a4e69" }, glasses: true, beard: true },
  }

  function mouthPath(width, open, smile) {
    const w = width / 2
    const corner = -smile * width * 0.18
    const top = -open * width * 0.12 + smile * width * 0.06
    const bottom = open * width * 0.62 + smile * width * 0.22
    if (open < 0.04) {
      return "M " + -w + " " + corner + " Q 0 " + (smile * width * 0.34) + " " + w + " " + corner
    }
    return "M " + -w + " " + corner + " Q 0 " + top + " " + w + " " + corner + " Q 0 " + bottom + " " + -w + " " + corner + " Z"
  }

  FW.character = function (parent, options = {}) {
    const preset = KINDS[options.kind || "girl"] || KINDS.girl
    const o = Object.assign({}, preset, options)
    o.hair = Object.assign({}, preset.hair, options.hair || {})
    o.bottom = Object.assign({}, preset.bottom, options.bottom || {})
    const age = o.age || preset.age
    const B = BODIES[age]
    const skin = o.skin || "#f1c3a1"
    const skinDark = shade(skin, -0.12)
    const topColor = o.top
    const topDark = shade(topColor, -0.18)
    const bottomColor = o.bottom.color
    const shoes = o.shoes || "#2f2840"
    const eyes = o.eyes || "#3a2a20"
    const sleeves = o.sleeves || (age === "child" ? "short" : "long")

    // body layout, feet at y = 0
    const legLen = B.thigh + B.shin
    const hipY = -legLen - B.foot * 0.35
    const shoulderY = hipY - B.torso
    const neckTop = shoulderY - B.neck
    const headY = neckTop - B.head * 0.82
    const total = -(headY - B.head * 1.05)
    const scale = (o.height || (age === "child" ? 330 : 470)) / total

    // host svg covering the parent
    const host = typeof parent === "string" ? document.querySelector(parent) : parent
    const svg = node("svg", { class: "fw-character", viewBox: "0 0 " + FW.width + " " + FW.height, width: "100%", height: "100%", style: "position:absolute;inset:0;overflow:visible;pointer-events:none" })
    host.appendChild(svg)
    const root = node("g", {}, svg)
    const shadow = node("ellipse", { cx: 0, cy: 2, rx: B.hipW * 0.75, ry: B.foot * 0.4, fill: "rgba(0,0,0,.18)" }, root)
    const body = node("g", {}, root)

    function limb(group, x, y, len1, len2, width, color1, color2, endColor, endR, isLeg) {
      const upper = node("g", {}, group)
      node("line", { x1: x, y1: y, x2: x, y2: y + len1, stroke: color1, "stroke-width": width, "stroke-linecap": "round" }, upper)
      const lower = node("g", {}, upper)
      node("line", { x1: x, y1: y + len1, x2: x, y2: y + len1 + len2, stroke: color2, "stroke-width": width * 0.92, "stroke-linecap": "round" }, lower)
      let end
      if (isLeg) end = node("ellipse", { cx: x + endR * 0.45, cy: y + len1 + len2 + endR * 0.15, rx: endR * 1.05, ry: endR * 0.58, fill: endColor }, lower)
      else end = node("circle", { cx: x, cy: y + len1 + len2 + endR * 0.4, r: endR, fill: endColor }, lower)
      return { upper, lower, end, x, y, len1 }
    }

    const legColor = o.bottom.type === "pants" ? bottomColor : skin
    const shinColor = o.bottom.type === "pants" ? bottomColor : o.socks || skin
    const legGroupBack = node("g", {}, body)
    const legGroupFront = node("g", {}, body)
    const legBack = limb(legGroupBack, -B.hipW * 0.22, hipY, B.thigh, B.shin, B.limb, shade(legColor, -0.1), shade(shinColor, -0.1), shade(shoes, -0.1), B.foot, true)
    const legFront = limb(legGroupFront, B.hipW * 0.22, hipY, B.thigh, B.shin, B.limb, legColor, shinColor, shoes, B.foot, true)

    const torso = node("g", {}, body)
    const armColorUpper = topColor
    const armColorLower = sleeves === "long" ? topColor : skin
    const armBack = limb(torso, -B.torsoW * 0.5 + B.arm * 0.2, shoulderY + B.arm * 0.4, B.upper, B.lower, B.arm, topDark, sleeves === "long" ? topDark : skinDark, skinDark, B.hand, false)
    // lower body clothes
    const hw = B.hipW / 2
    if (o.bottom.type === "skirt" || o.bottom.type === "dress") {
      const len = o.bottom.type === "dress" ? B.thigh * 0.95 : B.thigh * 0.75
      node("path", { d: "M " + -hw * 0.95 + " " + (hipY - 8) + " L " + hw * 0.95 + " " + (hipY - 8) + " L " + hw * 1.45 + " " + (hipY + len) + " Q 0 " + (hipY + len + 8) + " " + -hw * 1.45 + " " + (hipY + len) + " Z", fill: o.bottom.type === "dress" ? topColor : bottomColor }, torso)
    } else if (o.bottom.type === "shorts") {
      node("path", { d: "M " + -hw + " " + (hipY - 8) + " L " + hw + " " + (hipY - 8) + " L " + hw * 1.12 + " " + (hipY + B.thigh * 0.55) + " L " + -hw * 1.12 + " " + (hipY + B.thigh * 0.55) + " Z", fill: bottomColor }, torso)
    } else {
      node("path", { d: "M " + -hw + " " + (hipY - 8) + " L " + hw + " " + (hipY - 8) + " L " + hw * 1.04 + " " + (hipY + 14) + " L " + -hw * 1.04 + " " + (hipY + 14) + " Z", fill: bottomColor }, torso)
    }
    // shirt
    const tw = B.torsoW / 2
    node("path", { d: "M " + -tw * 0.86 + " " + shoulderY + " Q 0 " + (shoulderY - 6) + " " + tw * 0.86 + " " + shoulderY + " Q " + tw * 1.08 + " " + (shoulderY + 6) + " " + tw * 1.02 + " " + (shoulderY + 22) + " L " + hw * 1.02 + " " + (hipY + 2) + " Q 0 " + (hipY + 8) + " " + -hw * 1.02 + " " + (hipY + 2) + " L " + -tw * 1.02 + " " + (shoulderY + 22) + " Q " + -tw * 1.08 + " " + (shoulderY + 6) + " " + -tw * 0.86 + " " + shoulderY + " Z", fill: o.bottom.type === "dress" ? topColor : topColor }, torso)
    if (o.collar !== false) node("path", { d: "M " + -B.torsoW * 0.16 + " " + (shoulderY - 1) + " Q 0 " + (shoulderY + B.torsoW * 0.22) + " " + B.torsoW * 0.16 + " " + (shoulderY - 1), fill: "none", stroke: topDark, "stroke-width": 3, "stroke-linecap": "round" }, torso)
    if (o.pattern === "stripes") for (let i = 1; i < 4; i++) node("line", { x1: -tw * 0.95, x2: tw * 0.95, y1: shoulderY + (B.torso * i) / 4, y2: shoulderY + (B.torso * i) / 4, stroke: shade(topColor, 0.35), "stroke-width": B.torso * 0.07 }, torso)
    // neck
    node("rect", { x: -B.head * 0.18, y: neckTop - 4, width: B.head * 0.36, height: B.neck + 10, rx: 4, fill: skinDark }, torso)

    // head
    const head = node("g", {}, torso)
    const hr = B.head
    const hairColor = o.hair.color
    const hairDark = shade(hairColor, -0.2)
    const hairBack = node("g", {}, head)
    const style = o.hair.style
    const H = (d, fill, parentEl) => node("path", { d, fill: fill || hairColor }, parentEl || hairBack)
    let tail = null
    if (style === "hijab") {
      H("M " + -hr * 1.28 + " " + (headY - hr * 0.1) + " C " + -hr * 1.35 + " " + (headY - hr * 1.45) + " " + hr * 1.35 + " " + (headY - hr * 1.45) + " " + hr * 1.28 + " " + (headY - hr * 0.1) + " C " + hr * 1.4 + " " + (headY + hr * 1.1) + " " + hr * 1.2 + " " + (shoulderY + 20) + " 0 " + (shoulderY + 34) + " C " + -hr * 1.2 + " " + (shoulderY + 20) + " " + -hr * 1.4 + " " + (headY + hr * 1.1) + " " + -hr * 1.28 + " " + (headY - hr * 0.1) + " Z", hairColor)
    } else if (style === "long" || style === "curly-long") {
      H("M " + -hr * 1.05 + " " + (headY - hr * 0.2) + " C " + -hr * 1.3 + " " + (headY + hr * 0.9) + " " + -hr * 1.15 + " " + (headY + hr * 1.7) + " " + -hr * 0.85 + " " + (headY + hr * 2.0) + " L " + hr * 0.85 + " " + (headY + hr * 2.0) + " C " + hr * 1.15 + " " + (headY + hr * 1.7) + " " + hr * 1.3 + " " + (headY + hr * 0.9) + " " + hr * 1.05 + " " + (headY - hr * 0.2) + " Z", hairDark)
    } else if (style === "bob") {
      H("M " + -hr * 1.08 + " " + (headY - hr * 0.2) + " C " + -hr * 1.2 + " " + (headY + hr * 0.5) + " " + -hr * 1.1 + " " + (headY + hr * 0.85) + " " + -hr * 0.8 + " " + (headY + hr * 0.9) + " L " + hr * 0.8 + " " + (headY + hr * 0.9) + " C " + hr * 1.1 + " " + (headY + hr * 0.85) + " " + hr * 1.2 + " " + (headY + hr * 0.5) + " " + hr * 1.08 + " " + (headY - hr * 0.2) + " Z", hairDark)
    } else if (style === "ponytail") {
      tail = node("g", {}, hairBack)
      H("M " + hr * 0.7 + " " + (headY - hr * 0.75) + " C " + hr * 1.7 + " " + (headY - hr * 0.6) + " " + hr * 1.6 + " " + (headY + hr * 0.9) + " " + hr * 1.05 + " " + (headY + hr * 1.25) + " C " + hr * 1.3 + " " + (headY + hr * 0.4) + " " + hr * 1.05 + " " + (headY - hr * 0.3) + " " + hr * 0.6 + " " + (headY - hr * 0.45) + " Z", hairDark, tail)
      tail.__pivot = [hr * 0.8, headY - hr * 0.65]
    } else if (style === "pigtails") {
      tail = node("g", {}, hairBack)
      for (const side of [-1, 1]) {
        H("M " + side * hr * 0.85 + " " + (headY - hr * 0.35) + " C " + side * hr * 1.75 + " " + (headY - hr * 0.3) + " " + side * hr * 1.7 + " " + (headY + hr * 0.75) + " " + side * hr * 1.25 + " " + (headY + hr * 0.95) + " C " + side * hr * 1.35 + " " + (headY + hr * 0.4) + " " + side * hr * 1.1 + " " + (headY) + " " + side * hr * 0.85 + " " + (headY - hr * 0.05) + " Z", hairDark, tail)
        node("circle", { cx: side * hr * 0.98, cy: headY - hr * 0.22, r: hr * 0.1, fill: o.hair.ribbon || "#ff4d6d" }, tail)
      }
      tail.__pivot = [0, headY - hr * 0.3]
    } else if (style === "bun") {
      node("circle", { cx: 0, cy: headY - hr * 1.02, r: hr * 0.42, fill: hairDark }, hairBack)
    } else if (style === "curly") {
      for (let i = 0; i < 11; i++) {
        const a = Math.PI * (1.0 + (i / 10) * 1.0)
        node("circle", { cx: Math.cos(a) * hr * 1.0, cy: headY + Math.sin(a) * hr * 1.0, r: hr * 0.36, fill: hairDark }, hairBack)
      }
    }
    // ears and face
    node("circle", { cx: -hr * 0.98, cy: headY + hr * 0.1, r: hr * 0.2, fill: skinDark }, head)
    node("circle", { cx: hr * 0.98, cy: headY + hr * 0.1, r: hr * 0.2, fill: skinDark }, head)
    node("ellipse", { cx: 0, cy: headY, rx: hr, ry: hr * (age === "child" ? 0.98 : 1.06), fill: skin }, head)
    const face = node("g", {}, head)
    // cheeks
    node("ellipse", { cx: -hr * 0.55, cy: headY + hr * 0.32, rx: hr * 0.17, ry: hr * 0.1, fill: o.blush || "rgba(255,105,120,.35)" }, face)
    node("ellipse", { cx: hr * 0.55, cy: headY + hr * 0.32, rx: hr * 0.17, ry: hr * 0.1, fill: o.blush || "rgba(255,105,120,.35)" }, face)
    // eyes
    const eyeY = headY + hr * 0.04
    const eyeX = hr * 0.38
    const er = hr * (age === "child" ? 0.2 : 0.15)
    const eyeGroups = []
    const pupils = []
    for (const side of [-1, 1]) {
      const g = node("g", {}, face)
      node("ellipse", { cx: side * eyeX, cy: eyeY, rx: er * 0.88, ry: er, fill: "#ffffff" }, g)
      const pupil = node("g", {}, g)
      node("circle", { cx: side * eyeX, cy: eyeY + er * 0.08, r: er * 0.66, fill: eyes }, pupil)
      node("circle", { cx: side * eyeX, cy: eyeY + er * 0.08, r: er * 0.34, fill: "#120d0a" }, pupil)
      node("circle", { cx: side * eyeX + er * 0.25, cy: eyeY - er * 0.2, r: er * 0.2, fill: "#ffffff" }, pupil)
      if (o.lashes !== false && (o.kind === "girl" || o.kind === "woman" || o.kind === "grandma")) node("path", { d: "M " + (side * eyeX + side * er * 0.7) + " " + (eyeY - er * 0.7) + " l " + side * er * 0.4 + " " + -er * 0.35, stroke: "#1d1410", "stroke-width": 2.4, "stroke-linecap": "round" }, g)
      g.__center = [side * eyeX, eyeY]
      eyeGroups.push(g)
      pupils.push(pupil)
    }
    const brows = []
    for (const side of [-1, 1]) {
      const brow = node("path", { d: "M " + (side * eyeX - er) + " " + (eyeY - er * 1.55) + " Q " + side * eyeX + " " + (eyeY - er * 1.95) + " " + (side * eyeX + er) + " " + (eyeY - er * 1.55), fill: "none", stroke: hairDark === "#d9d6d2" ? "#9a948e" : shade(hairColor, -0.35), "stroke-width": hr * 0.075, "stroke-linecap": "round" }, face)
      brow.__center = [side * eyeX, eyeY - er * 1.7]
      brow.__side = side
      brows.push(brow)
    }
    // nose and mouth
    node("path", { d: "M " + -hr * 0.05 + " " + (headY + hr * 0.25) + " q " + hr * 0.07 + " " + hr * 0.08 + " " + hr * 0.12 + " 0", fill: "none", stroke: skinDark, "stroke-width": 3, "stroke-linecap": "round" }, face)
    const mouthG = node("g", { transform: "translate(0 " + (headY + hr * 0.5) + ")" }, face)
    const mouth = node("path", { d: "", fill: "#7a2236", stroke: "#5a1626", "stroke-width": 2.6, "stroke-linejoin": "round", "stroke-linecap": "round" }, mouthG)
    if (o.glasses) {
      for (const side of [-1, 1]) node("circle", { cx: side * eyeX, cy: eyeY, r: er * 1.35, fill: "none", stroke: "#3b3b46", "stroke-width": 3 }, face)
      node("line", { x1: -eyeX + er * 1.35, x2: eyeX - er * 1.35, y1: eyeY, y2: eyeY, stroke: "#3b3b46", "stroke-width": 3 }, face)
    }
    if (o.beard) node("path", { d: "M " + -hr * 0.85 + " " + (headY + hr * 0.15) + " Q " + -hr * 0.8 + " " + (headY + hr * 1.25) + " 0 " + (headY + hr * 1.3) + " Q " + hr * 0.8 + " " + (headY + hr * 1.25) + " " + hr * 0.85 + " " + (headY + hr * 0.15) + " Q " + hr * 0.4 + " " + (headY + hr * 0.62) + " 0 " + (headY + hr * 0.62) + " Q " + -hr * 0.4 + " " + (headY + hr * 0.62) + " " + -hr * 0.85 + " " + (headY + hr * 0.15) + " Z", fill: hairColor }, face)
    // front hair
    const hairFront = node("g", {}, head)
    const capTop = headY - hr * 1.12
    if (style === "hijab") {
      node("path", { d: "M " + -hr * 1.18 + " " + headY + " A " + hr * 1.18 + " " + hr * 1.22 + " 0 1 1 " + hr * 1.18 + " " + headY + " A " + hr * 1.18 + " " + hr * 1.22 + " 0 1 1 " + -hr * 1.18 + " " + headY + " Z M " + -hr * 0.98 + " " + (headY + hr * 0.05) + " A " + hr * 0.98 + " " + hr * 1.02 + " 0 1 0 " + hr * 0.98 + " " + (headY + hr * 0.05) + " A " + hr * 0.98 + " " + hr * 1.02 + " 0 1 0 " + -hr * 0.98 + " " + (headY + hr * 0.05) + " Z", fill: hairColor, "fill-rule": "evenodd" }, hairFront)
      node("path", { d: "M " + -hr * 0.98 + " " + (headY - hr * 0.35) + " Q 0 " + (headY - hr * 1.25) + " " + hr * 0.98 + " " + (headY - hr * 0.35) + " L " + hr * 1.1 + " " + (headY - hr * 1.0) + " Q 0 " + (headY - hr * 1.5) + " " + -hr * 1.1 + " " + (headY - hr * 1.0) + " Z", fill: hairColor }, hairFront)
    } else if (style === "bald") {
      node("path", { d: "M " + -hr * 1.02 + " " + (headY - hr * 0.05) + " Q " + -hr * 1.08 + " " + (headY + hr * 0.45) + " " + -hr * 0.85 + " " + (headY + hr * 0.5) + " L " + -hr * 0.85 + " " + (headY - hr * 0.1) + " Z M " + hr * 1.02 + " " + (headY - hr * 0.05) + " Q " + hr * 1.08 + " " + (headY + hr * 0.45) + " " + hr * 0.85 + " " + (headY + hr * 0.5) + " L " + hr * 0.85 + " " + (headY - hr * 0.1) + " Z", fill: hairColor }, hairFront)
    } else if (style === "short" || style === "spiky") {
      const edge = style === "spiky"
        ? " L " + hr * 0.7 + " " + (headY - hr * 0.62) + " L " + hr * 0.45 + " " + (headY - hr * 0.42) + " L " + hr * 0.2 + " " + (headY - hr * 0.62) + " L 0 " + (headY - hr * 0.42) + " L " + -hr * 0.25 + " " + (headY - hr * 0.62) + " L " + -hr * 0.5 + " " + (headY - hr * 0.42) + " L " + -hr * 0.75 + " " + (headY - hr * 0.6)
        : " C " + hr * 0.75 + " " + (headY - hr * 0.5) + " " + hr * 0.1 + " " + (headY - hr * 0.72) + " " + -hr * 0.3 + " " + (headY - hr * 0.5) + " C " + -hr * 0.55 + " " + (headY - hr * 0.68) + " " + -hr * 0.85 + " " + (headY - hr * 0.6) + " " + -hr * 0.95 + " " + (headY - hr * 0.3)
      node("path", { d: "M " + -hr * 1.04 + " " + (headY - hr * 0.05) + " C " + -hr * 1.22 + " " + (headY - hr * 1.48) + " " + hr * 1.22 + " " + (headY - hr * 1.48) + " " + hr * 1.04 + " " + (headY - hr * 0.05) + " L " + hr * 0.95 + " " + (headY - hr * 0.3) + edge + " Z", fill: hairColor }, hairFront)
    } else {
      // fringe with a side part for long, bob, ponytail, pigtails, bun, curly
      node("path", { d: "M " + -hr * 1.07 + " " + (headY + hr * 0.15) + " C " + -hr * 1.24 + " " + (headY - hr * 1.47) + " " + hr * 1.24 + " " + (headY - hr * 1.47) + " " + hr * 1.07 + " " + (headY + hr * 0.15) + " C " + hr * 0.95 + " " + (headY - hr * 0.3) + " " + hr * 0.55 + " " + (headY - hr * 0.5) + " " + hr * 0.15 + " " + (headY - hr * 0.48) + " C " + -hr * 0.25 + " " + (headY - hr * 0.62) + " " + -hr * 0.8 + " " + (headY - hr * 0.42) + " " + -hr * 1.07 + " " + (headY + hr * 0.15) + " Z", fill: hairColor }, hairFront)
      node("path", { d: "M " + -hr * 0.55 + " " + (capTop + hr * 0.3) + " Q " + -hr * 0.1 + " " + (capTop + hr * 0.12) + " " + hr * 0.35 + " " + (capTop + hr * 0.3), fill: "none", stroke: shade(hairColor, 0.25), "stroke-width": hr * 0.08, "stroke-linecap": "round", opacity: 0.6 }, hairFront)
    }
    // front arm last, over the shirt
    const armFront = limb(torso, B.torsoW * 0.5 - B.arm * 0.2, shoulderY + B.arm * 0.4, B.upper, B.lower, B.arm, armColorUpper, armColorLower, skin, B.hand, false)
    if (o.accessory === "backpack") node("rect", { x: -B.torsoW * 0.7, y: shoulderY + 6, width: B.torsoW * 0.25, height: B.torso * 0.75, rx: 8, fill: o.accessoryColor || "#f4a261" }, torso).parentNode.insertBefore(torso.lastChild, torso.firstChild)

    // ---------------------------------------------------------------- state over time
    const c = { root, svg, options: o, height: total * scale }
    const moves = [{ t: -1, x: o.x || FW.width / 2, y: o.y || FW.height * 0.9, scale: 1, dur: 0, ease: "linear" }]
    const faces = [{ t: -1, dir: o.facing === -1 ? -1 : 1 }]
    const poses = [{ t: -1, dur: 0, pose: {} }]
    const walks = []
    const talks = []
    const exprs = [{ t: -1, dur: 0, name: o.expression || "happy" }]
    const looks = [{ t: -1, dur: 0, x: 0, y: 0 }]
    const waves = []
    const jumps = []
    const blinks = []
    const who = o.who
    const EXPR = {
      neutral: { smile: 0.25, brow: 0, browTilt: 0, open: 0 },
      happy: { smile: 0.8, brow: -0.15, browTilt: 0, open: 0.05 },
      laugh: { smile: 1, brow: -0.3, browTilt: 0, open: 0.55 },
      sad: { smile: -0.7, brow: 0.1, browTilt: -0.7, open: 0 },
      surprised: { smile: 0, brow: -0.6, browTilt: 0, open: 0.65 },
      angry: { smile: -0.45, brow: 0.35, browTilt: 0.8, open: 0.05 },
      scared: { smile: -0.4, brow: -0.4, browTilt: -0.5, open: 0.35 },
      thinking: { smile: 0.1, brow: -0.1, browTilt: 0.35, open: 0 },
      sleepy: { smile: 0.2, brow: 0.2, browTilt: 0, open: 0, lids: 0.55 },
    }

    c.at = (t, x, y) => { moves.push({ t, x, y, dur: 0, ease: "linear" }); return c }
    c.move = (t, dur, to, ease = "inOut") => { moves.push(Object.assign({ t, dur, ease }, to)); return c }
    c.face = (t, dir) => { faces.push({ t, dir: dir < 0 ? -1 : 1 }); return c }
    /** pose: { armL: [shoulder, elbow], armR: [...], legL: [hip, knee], legR: [...], head, lean, crouch } degrees; L/R are screen sides */
    c.pose = (t, dur, pose, ease = "smooth") => { poses.push({ t, dur, pose, ease }); return c }
    c.walk = (t, dur, opts = {}) => { walks.push(Object.assign({ t, dur, speed: age === "child" ? 2.4 : 1.9 }, opts)); return c }
    c.run = (t, dur, opts = {}) => c.walk(t, dur, Object.assign({ run: true, speed: 3.6 }, opts))
    c.talk = (t, end, rate = 4.2) => { talks.push({ t, end, rate }); return c }
    c.say = (name = who) => {
      for (const line of FW.lines) if (!name || line.who === name) {
        const words = line.words && line.words.length ? line.words : [{ start: line.start, end: line.end }]
        for (const w of words) talks.push({ t: w.start, end: w.end, rate: 4.2 })
      }
      return c
    }
    c.expression = (t, name, dur = 0.35) => { exprs.push({ t, dur, name }); return c }
    c.look = (t, x, y = 0, dur = 0.25) => { looks.push({ t, dur, x, y }); return c }
    c.wave = (t, dur = 1.6, side = "R") => { waves.push({ t, dur, side }); return c }
    c.jump = (t, height = 70, dur = 0.7) => { jumps.push({ t, height, dur }); return c }
    c.blink = (t) => { blinks.push(t); return c }
    if (who) c.say(who)
    /** c.point("handR" | "handL" | "head" | "feet") -> { x, y } in scene pixels at the current frame (use inside FW.onFrame). */
    c.point = (name = "handR") => {
      const el = name === "handL" ? armBack.end : name === "handR" ? armFront.end : name === "head" ? head.querySelector("ellipse") : shadow
      const box = el.getBoundingClientRect()
      const p = svg.createSVGPoint()
      p.x = box.x + box.width / 2
      p.y = name === "head" ? box.y : box.y + box.height / 2
      const m = svg.getScreenCTM()
      return m ? p.matrixTransform(m.inverse()) : { x: 0, y: 0 }
    }

    function lastBefore(list, t) {
      let found = list[0]
      for (const item of list) if (item.t <= t) found = item
      return found
    }
    function position(t) {
      let state = { x: moves[0].x, y: moves[0].y, scale: moves[0].scale || 1 }
      for (const m of moves) {
        if (m.t > t) break
        const p = FW.progress(t, m.t, m.dur, m.ease)
        state = {
          x: m.x !== undefined ? lerp(state.x, m.x, p) : state.x,
          y: m.y !== undefined ? lerp(state.y, m.y, p) : state.y,
          scale: m.scale !== undefined ? lerp(state.scale, m.scale, p) : state.scale,
        }
      }
      // walks move x (and y) toward their target
      for (const w of walks) {
        if (w.t > t) break
        if (w.to === undefined && w.toY === undefined) continue
        const startX = w.__fromX !== undefined ? w.__fromX : (w.__fromX = state.x)
        const startY = w.__fromY !== undefined ? w.__fromY : (w.__fromY = state.y)
        const p = clamp((t - w.t) / w.dur)
        const eased = p < 0.08 ? (p * p) / 0.16 : p > 0.92 ? 1 - ((1 - p) * (1 - p)) / 0.16 : p
        if (w.to !== undefined) state.x = lerp(startX, w.to, clamp(eased))
        if (w.toY !== undefined) state.y = lerp(startY, w.toY, clamp(eased))
      }
      return state
    }
    function poseAt(t) {
      const keys = ["armL0", "armL1", "armR0", "armR1", "legL0", "legL1", "legR0", "legR1", "head", "lean", "crouch"]
      const zero = { armL0: 8, armL1: -6, armR0: -8, armR1: 6, legL0: 0, legL1: 0, legR0: 0, legR1: 0, head: 0, lean: 0, crouch: 0 }
      let state = Object.assign({}, zero)
      for (const item of poses) {
        if (item.t > t) break
        const target = Object.assign({}, state)
        const pose = item.pose
        if (pose.armL) { target.armL0 = pose.armL[0]; target.armL1 = pose.armL[1] || 0 }
        if (pose.armR) { target.armR0 = pose.armR[0]; target.armR1 = pose.armR[1] || 0 }
        if (pose.legL) { target.legL0 = pose.legL[0]; target.legL1 = pose.legL[1] || 0 }
        if (pose.legR) { target.legR0 = pose.legR[0]; target.legR1 = pose.legR[1] || 0 }
        for (const k of ["head", "lean", "crouch"]) if (pose[k] !== undefined) target[k] = pose[k]
        if (pose.reset) Object.assign(target, zero)
        const p = FW.progress(t, item.t, item.dur, item.ease)
        for (const k of keys) state[k] = lerp(state[k], target[k], p)
      }
      return state
    }
    function exprAt(t) {
      let state = Object.assign({ lids: 0 }, EXPR.happy)
      for (const item of exprs) {
        if (item.t > t) break
        const target = Object.assign({ lids: 0 }, EXPR[item.name] || EXPR.neutral)
        const p = FW.progress(t, item.t, item.dur, "smooth")
        for (const k in target) state[k] = lerp(state[k] || 0, target[k], p)
      }
      return state
    }
    function lookAt(t) {
      let state = { x: 0, y: 0 }
      for (const item of looks) {
        if (item.t > t) break
        const p = FW.progress(t, item.t, item.dur, "out")
        state = { x: lerp(state.x, item.x, p), y: lerp(state.y, item.y, p) }
      }
      return state
    }
    function blinkAmount(t) {
      // automatic blinks every 2.6 - 4.6 s, plus manual ones
      let amount = 0
      const seed = (o.seed || 7) + (o.x || 0) * 0.001
      let at = 0.8 + FW.random(0, seed) * 1.5
      let i = 1
      while (at < t + 1) {
        const d = t - at
        if (d >= 0 && d < 0.16) amount = Math.max(amount, Math.sin((d / 0.16) * Math.PI))
        at = at + 2.6 + FW.random(i, seed) * 2.0
        i++
      }
      for (const b of blinks) {
        const d = t - b
        if (d >= 0 && d < 0.16) amount = Math.max(amount, Math.sin((d / 0.16) * Math.PI))
      }
      return amount
    }
    function mouthOpen(t) {
      let open = 0
      for (const item of talks) {
        if (t >= item.t && t <= item.end + 0.05) {
          const local = t - item.t
          const syl = Math.abs(Math.sin(local * Math.PI * item.rate))
          const env = clamp(local / 0.05) * clamp((item.end + 0.05 - t) / 0.08)
          open = Math.max(open, (0.18 + 0.62 * syl) * env)
        }
      }
      return open
    }
    const rot = (g, deg, cx, cy, extra = "") => g.setAttribute("transform", extra + "rotate(" + deg.toFixed(2) + " " + cx + " " + cy + ")")

    FW.onFrame((t) => {
      const pos = position(t)
      const dir = lastBefore(faces, t).dir
      const pose = poseAt(t)
      // walk cycle weight and phase
      let w = 0, phase = 0, running = false
      for (const item of walks) {
        if (t < item.t - 0.2 || t > item.t + item.dur + 0.2) continue
        const fade = clamp((t - item.t + 0.2) / 0.25) * clamp((item.t + item.dur + 0.2 - t) / 0.25)
        if (fade > w) { w = fade; phase = (t - item.t) * item.speed * Math.PI; running = !!item.run }
      }
      const swing = running ? 42 : 26
      const s = Math.sin(phase)
      const legL0 = pose.legL0 + s * swing * w
      const legR0 = pose.legR0 - s * swing * w
      const legL1 = pose.legL1 + Math.max(0, -Math.cos(phase)) * (running ? 60 : 32) * w * (s < 0 ? 1 : 0.4)
      const legR1 = pose.legR1 + Math.max(0, Math.cos(phase)) * (running ? 60 : 32) * w * (s > 0 ? 1 : 0.4)
      let armL0 = pose.armL0 - s * (running ? 40 : 22) * w
      let armR0 = pose.armR0 + s * (running ? 40 : 22) * w
      let armL1 = pose.armL1 - (running ? 60 : 12) * w
      let armR1 = pose.armR1 + (running ? 60 : 12) * w
      // waving
      for (const item of waves) {
        if (t < item.t || t > item.t + item.dur) continue
        const k = clamp((t - item.t) / 0.25) * clamp((item.t + item.dur - t) / 0.25)
        const wob = Math.sin((t - item.t) * 14) * 22
        if (item.side === "L") { armL0 = lerp(armL0, 150, k); armL1 = lerp(armL1, 20 + wob, k) }
        else { armR0 = lerp(armR0, -150, k); armR1 = lerp(armR1, -20 - wob, k) }
      }
      // breathing, bob and jumps
      const breathe = Math.sin(t * 2.2) * 1.4
      const bob = -Math.abs(Math.cos(phase)) * (running ? 10 : 5) * w
      let lift = 0
      for (const j of jumps) {
        if (t >= j.t && t <= j.t + j.dur) {
          const p = (t - j.t) / j.dur
          lift = Math.max(lift, 4 * p * (1 - p) * j.height)
        }
      }
      const crouch = pose.crouch
      root.setAttribute("transform", "translate(" + pos.x.toFixed(1) + " " + pos.y.toFixed(1) + ") scale(" + (scale * pos.scale * dir).toFixed(4) + " " + (scale * pos.scale).toFixed(4) + ")")
      body.setAttribute("transform", "translate(0 " + (bob - lift / scale + crouch).toFixed(2) + ")")
      shadow.setAttribute("rx", (B.hipW * 0.75 * (1 - Math.min(0.5, lift / 300))).toFixed(1))
      rot(legBack.upper, legL0, legBack.x, legBack.y)
      rot(legBack.lower, legL1, legBack.x, legBack.y + legBack.len1)
      rot(legFront.upper, legR0, legFront.x, legFront.y)
      rot(legFront.lower, legR1, legFront.x, legFront.y + legFront.len1)
      rot(torso, pose.lean + (running ? 7 * w : 2 * w), 0, hipY, "translate(0 " + breathe.toFixed(2) * 0 + ") ")
      rot(armBack.upper, armL0 + breathe, armBack.x, armBack.y)
      rot(armBack.lower, armL1, armBack.x, armBack.y + armBack.len1)
      rot(armFront.upper, armR0 - breathe, armFront.x, armFront.y)
      rot(armFront.lower, armR1, armFront.x, armFront.y + armFront.len1)
      rot(head, pose.head + FW.wiggle(t, 0.35, 2.2, (o.seed || 3)), 0, neckTop)
      if (tail) rot(tail, Math.sin(phase * 1.0 + 0.6) * 10 * w + FW.wiggle(t, 0.5, 3, 9), tail.__pivot[0], tail.__pivot[1])
      // face
      const ex = exprAt(t)
      const look = lookAt(t)
      const blink = Math.max(blinkAmount(t), ex.lids || 0)
      for (const g of eyeGroups) {
        const [cx, cy] = g.__center
        g.setAttribute("transform", "translate(0 " + (cy * (1 - (1 - blink * 0.92))).toFixed(2) + ") scale(1 " + (1 - blink * 0.92).toFixed(3) + ")")
      }
      for (const p of pupils) p.setAttribute("transform", "translate(" + (look.x * er * 0.35).toFixed(2) + " " + (look.y * er * 0.3).toFixed(2) + ")")
      for (const b of brows) {
        const [cx, cy] = b.__center
        b.setAttribute("transform", "translate(0 " + (ex.brow * er * 0.8).toFixed(2) + ") rotate(" + (ex.browTilt * 14 * b.__side).toFixed(2) + " " + cx + " " + cy + ")")
      }
      const talking = mouthOpen(t)
      const open = Math.max(ex.open, talking)
      mouth.setAttribute("d", mouthPath(hr * (0.42 + ex.smile * 0.08), open, ex.smile * (1 - talking * 0.4)))
    })
    return c
  }
})()

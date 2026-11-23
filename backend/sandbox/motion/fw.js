/* Forkwise Motion helpers (global FW). Everything here is a pure function of time,
   so any frame can be rendered on its own and the result is the same every run.

   Core:      FW.tween, FW.set, FW.keys, FW.stagger, FW.onFrame, FW.ease, FW.camera
   Text:      FW.split, FW.typewriter, FW.count
   Drawing:   FW.draw (path draw-on), FW.particles, FW.wiggle, FW.noise
   Story:     FW.character (rigged vector characters), FW.scenery (sky, sun, clouds, hills, trees, house, stars)
   Sound:     FW.lines / FW.words (voice timings of this scene), FW.duration */
(function () {
  const FW = {}
  window.FW = FW
  const scene = window.FW_SCENE || { index: 0, duration: 5, lines: [], fps: 30, width: 1920, height: 1080, language: "en" }
  FW.scene = scene
  FW.width = scene.width
  FW.height = scene.height
  FW.lines = scene.lines || []
  FW.words = (who) => {
    const list = []
    for (const line of FW.lines) if (!who || line.who === who) for (const word of line.words || []) list.push(word)
    return list
  }
  Object.defineProperty(FW, "duration", {
    get: () => scene.duration,
    set: (value) => { scene.duration = Number(value) || scene.duration; scene.durationSet = true },
  })
  FW.t = 0

  // ------------------------------------------------------------ math & easing
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v))
  const lerp = (a, b, p) => a + (b - a) * p
  FW.clamp = clamp
  FW.lerp = lerp
  function bezier(x1, y1, x2, y2) {
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx
    const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by
    const sx = (t) => ((ax * t + bx) * t + cx) * t
    const sy = (t) => ((ay * t + by) * t + cy) * t
    const dx = (t) => (3 * ax * t + 2 * bx) * t + cx
    return (x) => {
      let t = x
      for (let i = 0; i < 8; i++) {
        const err = sx(t) - x
        if (Math.abs(err) < 1e-6) break
        const d = dx(t)
        if (Math.abs(d) < 1e-6) break
        t = t - err / d
      }
      return sy(clamp(t))
    }
  }
  function spring(stiffness = 170, damping = 26, mass = 1) {
    const w0 = Math.sqrt(stiffness / mass)
    const zeta = damping / (2 * Math.sqrt(stiffness * mass))
    return (p) => {
      const t = p * 1.6 // the spring settles over the tween length
      if (zeta < 1) {
        const wd = w0 * Math.sqrt(1 - zeta * zeta)
        return 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + (zeta * w0 / wd) * Math.sin(wd * t))
      }
      return 1 - Math.exp(-w0 * t) * (1 + w0 * t)
    }
  }
  const E = {
    linear: (p) => p,
    in: (p) => p * p * p,
    out: (p) => 1 - Math.pow(1 - p, 3),
    inOut: (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
    inQuad: (p) => p * p,
    outQuad: (p) => 1 - (1 - p) * (1 - p),
    inOutQuad: (p) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2),
    outQuart: (p) => 1 - Math.pow(1 - p, 4),
    inOutQuart: (p) => (p < 0.5 ? 8 * p ** 4 : 1 - Math.pow(-2 * p + 2, 4) / 2),
    outExpo: (p) => (p === 1 ? 1 : 1 - Math.pow(2, -10 * p)),
    inOutExpo: (p) => (p === 0 ? 0 : p === 1 ? 1 : p < 0.5 ? Math.pow(2, 20 * p - 10) / 2 : (2 - Math.pow(2, -20 * p + 10)) / 2),
    inOutSine: (p) => -(Math.cos(Math.PI * p) - 1) / 2,
    outSine: (p) => Math.sin((p * Math.PI) / 2),
    outBack: (p) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2) },
    inBack: (p) => { const c1 = 1.70158; return (c1 + 1) * p * p * p - c1 * p * p },
    inOutBack: (p) => { const c2 = 1.70158 * 1.525; return p < 0.5 ? (Math.pow(2 * p, 2) * ((c2 + 1) * 2 * p - c2)) / 2 : (Math.pow(2 * p - 2, 2) * ((c2 + 1) * (p * 2 - 2) + c2) + 2) / 2 },
    outElastic: (p) => (p === 0 ? 0 : p === 1 ? 1 : Math.pow(2, -10 * p) * Math.sin((p * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1),
    outBounce: (p) => {
      const n1 = 7.5625, d1 = 2.75
      if (p < 1 / d1) return n1 * p * p
      if (p < 2 / d1) return n1 * (p -= 1.5 / d1) * p + 0.75
      if (p < 2.5 / d1) return n1 * (p -= 2.25 / d1) * p + 0.9375
      return n1 * (p -= 2.625 / d1) * p + 0.984375
    },
    smooth: bezier(0.45, 0, 0.2, 1),
    snappy: bezier(0.2, 0.9, 0.1, 1),
    anticipate: bezier(0.6, -0.28, 0.3, 1.3),
    bezier,
    spring: (s, d, m) => spring(s, d, m),
  }
  E.springy = spring(180, 14)
  E.soft = spring(120, 20)
  FW.ease = E
  function easeOf(name) {
    if (typeof name === "function") return name
    if (Array.isArray(name)) return bezier(...name)
    return E[name || "smooth"] || E.smooth
  }
  FW.progress = (t, at, dur, ease) => easeOf(ease)(clamp(dur > 0 ? (t - at) / dur : t >= at ? 1 : 0))
  FW.map = (t, at, dur, from, to, ease) => lerp(from, to, FW.progress(t, at, dur, ease))

  // smooth deterministic noise
  function hash(n) {
    const s = Math.sin(n * 127.1 + 311.7) * 43758.5453
    return s - Math.floor(s)
  }
  FW.random = (i, seed = 1) => hash(i * 13.37 + seed * 7.13)
  FW.noise = (x, seed = 0) => {
    const i = Math.floor(x), f = x - i
    const u = f * f * (3 - 2 * f)
    return lerp(hash(i + seed * 101), hash(i + 1 + seed * 101), u) * 2 - 1
  }
  FW.wiggle = (t, freq = 1, amount = 10, seed = 0) => (FW.noise(t * freq, seed) + 0.5 * FW.noise(t * freq * 2.1, seed + 3)) * amount / 1.5

  // ------------------------------------------------------------ values
  const NUM = /-?\d*\.?\d+(?:e[-+]?\d+)?/gi
  function hexToRgb(text) {
    return String(text).replace(/#([0-9a-f]{3,8})\b/gi, (all, hex) => {
      if (hex.length === 3 || hex.length === 4) hex = hex.split("").map((c) => c + c).join("")
      const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16)
      const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1
      return "rgba(" + r + "," + g + "," + b + "," + a + ")"
    })
  }
  function mix(a, b, p) {
    if (typeof a === "number" && typeof b === "number") return lerp(a, b, p)
    if (a === undefined) return b
    if (b === undefined) return a
    const sa = hexToRgb(a), sb = hexToRgb(b)
    const na = sa.match(NUM) || [], nb = sb.match(NUM) || []
    if (na.length !== nb.length || sa.replace(NUM, "#") !== sb.replace(NUM, "#")) return p < 0.5 ? a : b
    let i = 0
    return sb.replace(NUM, () => {
      const v = lerp(parseFloat(na[i]), parseFloat(nb[i]), p)
      i++
      return String(Math.round(v * 1000) / 1000)
    })
  }
  FW.mix = mix

  // ------------------------------------------------------------ tweens
  const TRANSFORM = { x: 0, y: 0, z: 0, scale: 1, scaleX: 1, scaleY: 1, rotate: 0, rotateX: 0, rotateY: 0, skewX: 0, skewY: 0 }
  const FILTER = { blur: 0, brightness: 1, contrast: 1, saturate: 1, hue: 0, grayscale: 0, sepia: 0 }
  const tracks = new Map() // element -> { prop -> [segments] }
  const frameHooks = []
  function resolve(target) {
    if (!target) return []
    if (typeof target === "string") return Array.from(document.querySelectorAll(target))
    if (target.length !== undefined && !(target instanceof Element)) return Array.from(target)
    return [target]
  }
  function track(el, prop) {
    if (!tracks.has(el)) tracks.set(el, {})
    const all = tracks.get(el)
    if (!all[prop]) all[prop] = []
    return all[prop]
  }
  function baseValue(el, prop) {
    if (prop in TRANSFORM) return TRANSFORM[prop]
    if (prop in FILTER) return FILTER[prop]
    if (prop === "opacity") return 1
    if (prop === "draw") return 1
    return undefined
  }
  /** FW.tween(target, { from: {...}, to: {...} }, at, dur, ease)  or  FW.tween(target, toProps, at, dur, ease)
      Props: x y z scale scaleX scaleY rotate rotateX rotateY skewX skewY opacity blur brightness contrast saturate hue
      grayscale draw (0-1 path draw-on), any CSS property (color, width, clipPath, borderRadius...), "--var", or "attr:name" for SVG attributes. */
  FW.tween = function (target, props, at = 0, dur = 1, ease = "smooth", isSet = false) {
    const els = resolve(target)
    const from = props.from || null
    const to = props.to || (props.from ? {} : props)
    els.forEach((el) => {
      const keys = new Set([...Object.keys(to), ...Object.keys(from || {})])
      keys.forEach((prop) => {
        if (prop === "from" || prop === "to") return
        const list = track(el, prop)
        list.push({ at, dur, ease: easeOf(ease), from: from && prop in from ? from[prop] : undefined, to: prop in to ? to[prop] : undefined, order: list.length, isSet })
        list.sort((a, b) => a.at - b.at || a.order - b.order)
      })
    })
    return FW
  }
  FW.to = (target, props, at, dur, ease) => FW.tween(target, props, at, dur, ease)
  FW.from = (target, props, at, dur, ease) => {
    const to = {}
    for (const key in props) to[key] = undefined
    return FW.tween(target, { from: props, to }, at, dur, ease)
  }
  FW.fromTo = (target, from, to, at, dur, ease) => FW.tween(target, { from, to }, at, dur, ease)
  FW.set = (target, props, at = 0) => FW.tween(target, { from: props, to: props }, at, 0, "linear", at > 0)
  /** FW.keys(target, [{ t: 0, x: 0, opacity: 0 }, { t: 1, x: 200, ease: "outBack" }, ...]) */
  FW.keys = function (target, keyframes) {
    const list = keyframes.slice().sort((a, b) => a.t - b.t)
    for (let i = 0; i < list.length; i++) {
      const key = list[i]
      const props = Object.assign({}, key)
      delete props.t
      delete props.ease
      if (i === 0) FW.set(target, props, key.t)
      else {
        const prev = Object.assign({}, list[i - 1])
        delete prev.t
        delete prev.ease
        const from = {}
        for (const k in props) if (k in prev) from[k] = prev[k]
        FW.tween(target, { from, to: props }, list[i - 1].t, key.t - list[i - 1].t, key.ease || "smooth")
      }
    }
    return FW
  }
  /** FW.stagger(targets, at, gap, (el, at, index) => FW.tween(el, ..., at, ...)) */
  FW.stagger = function (target, at, gap, make) {
    resolve(target).forEach((el, index) => make(el, at + index * gap, index))
    return FW
  }
  FW.onFrame = (callback) => { frameHooks.push(callback); return FW }

  function valueAt(el, prop, list, t) {
    let value
    let started = false
    for (const seg of list) {
      if (seg.at > t) {
        if (!started) {
          value = seg.from !== undefined && !seg.isSet ? seg.from : value
          if (value === undefined) value = currentBase(el, prop)
        }
        break
      }
      started = true
      const start = seg.from !== undefined ? seg.from : value !== undefined ? value : currentBase(el, prop)
      const end = seg.to !== undefined ? seg.to : currentBase(el, prop)
      const p = seg.dur > 0 ? seg.ease(clamp((t - seg.at) / seg.dur)) : 1
      value = p >= 1 ? end : mix(start, end, p)
    }
    return value
  }
  function currentBase(el, prop) {
    if (!el.__fwBase) el.__fwBase = {}
    if (!(prop in el.__fwBase)) {
      let v = baseValue(el, prop)
      if (v === undefined) {
        if (prop.startsWith("attr:")) v = el.getAttribute(prop.slice(5))
        else if (prop.startsWith("--")) v = getComputedStyle(el).getPropertyValue(prop).trim()
        else v = getComputedStyle(el)[prop]
        if (v !== undefined && v !== null && v !== "" && !isNaN(Number(v))) v = Number(v)
      }
      el.__fwBase[prop] = v
    }
    return el.__fwBase[prop]
  }
  const PX = new Set(["x", "y", "z", "width", "height", "left", "top", "right", "bottom", "borderRadius", "fontSize", "letterSpacing", "blur", "strokeWidth"])
  function apply(el, values) {
    let transform = ""
    const has = (k) => values[k] !== undefined
    if (["x", "y", "z", "scale", "scaleX", "scaleY", "rotate", "rotateX", "rotateY", "skewX", "skewY"].some(has)) {
      const v = (k) => (has(k) ? values[k] : TRANSFORM[k])
      transform = "translate3d(" + v("x") + "px," + v("y") + "px," + v("z") + "px)"
      if (has("rotateX") || has("rotateY")) transform = "perspective(1200px) " + transform + " rotateX(" + v("rotateX") + "deg) rotateY(" + v("rotateY") + "deg)"
      transform += " rotate(" + v("rotate") + "deg) skew(" + v("skewX") + "deg," + v("skewY") + "deg) scale(" + v("scale") * v("scaleX") + "," + v("scale") * v("scaleY") + ")"
      el.style.transform = transform
    }
    if (Object.keys(FILTER).some(has)) {
      const v = (k) => (has(k) ? values[k] : FILTER[k])
      el.style.filter = "blur(" + v("blur") + "px) brightness(" + v("brightness") + ") contrast(" + v("contrast") + ") saturate(" + v("saturate") + ") hue-rotate(" + v("hue") + "deg) grayscale(" + v("grayscale") + ") sepia(" + v("sepia") + ")"
    }
    for (const prop in values) {
      if (prop in TRANSFORM || prop in FILTER) continue
      const value = values[prop]
      if (value === undefined) continue
      if (prop === "draw") drawValue(el, value)
      else if (prop === "text") el.textContent = value
      else if (prop.startsWith("attr:")) el.setAttribute(prop.slice(5), value)
      else if (prop.startsWith("--")) el.style.setProperty(prop, typeof value === "number" ? String(value) : value)
      else el.style[prop] = typeof value === "number" && PX.has(prop) ? value + "px" : value
    }
  }
  function drawValue(el, p) {
    if (!el.__fwLength) {
      try { el.__fwLength = el.getTotalLength() } catch (problem) { el.__fwLength = 1000 }
    }
    el.style.strokeDasharray = el.__fwLength
    el.style.strokeDashoffset = el.__fwLength * (1 - clamp(p))
  }
  /** FW.draw(pathOrSvgChildren, at, dur, ease): draws strokes on, like a pen. */
  FW.draw = (target, at = 0, dur = 1, ease = "inOut") => FW.fromTo(target, { draw: 0 }, { draw: 1 }, at, dur, ease)

  // ------------------------------------------------------------ camera
  /** FW.camera(stage, [{ t: 0, x: 0, y: 0, zoom: 1, rotate: 0 }, ...]).  Children with data-depth="0.3" move less (parallax).
      Depth 1 = moves with the camera; 0 = fixed (sky); >1 = foreground that moves faster. */
  FW.camera = function (stage, keys) {
    const root = resolve(stage)[0]
    if (!root) return FW
    const cam = { x: 0, y: 0, zoom: 1, rotate: 0, shake: 0 }
    const list = keys.slice().sort((a, b) => a.t - b.t)
    frameHooks.push((t) => {
      let k = list[0] || { t: 0 }
      const now = Object.assign({}, cam)
      for (let i = 0; i < list.length; i++) {
        const key = list[i]
        if (i === 0) { Object.assign(now, key); continue }
        const prev = list[i - 1]
        if (t <= prev.t) break
        const p = easeOf(key.ease || "inOut")(clamp((t - prev.t) / (key.t - prev.t || 1)))
        for (const name of ["x", "y", "zoom", "rotate", "shake"]) {
          const a = prev[name] !== undefined ? prev[name] : now[name]
          const b = key[name] !== undefined ? key[name] : a
          now[name] = lerp(a, b, p)
        }
        k = key
      }
      const sx = now.shake ? FW.wiggle(t, 9, now.shake, 1) : 0
      const sy = now.shake ? FW.wiggle(t, 9, now.shake, 2) : 0
      const layers = root.querySelectorAll(":scope > [data-depth]")
      const targets = layers.length ? layers : [root]
      for (const layer of targets) {
        const depth = layer === root ? 1 : parseFloat(layer.getAttribute("data-depth"))
        const zoom = 1 + (now.zoom - 1) * depth
        const x = (-now.x + sx) * depth, y = (-now.y + sy) * depth
        layer.style.transformOrigin = "50% 50%"
        layer.style.transform = "translate(" + x + "px," + y + "px) scale(" + zoom + ") rotate(" + now.rotate * depth + "deg)"
      }
    })
    return FW
  }

  // ------------------------------------------------------------ text
  /** FW.split(el, "words" | "chars" | "lines") -> array of spans. Use "words" for Persian/Arabic (letters must stay joined). */
  FW.split = function (target, by = "words") {
    const el = resolve(target)[0]
    if (!el) return []
    const text = el.textContent
    el.textContent = ""
    const rtl = /[֐-ࣿ]/.test(text)
    if (by === "chars" && rtl) by = "words"
    const parts = by === "chars" ? Array.from(text) : text.split(/(\s+)/)
    const spans = []
    for (const part of parts) {
      if (/^\s+$/.test(part)) { el.appendChild(document.createTextNode(part)); continue }
      if (!part) continue
      const span = document.createElement("span")
      span.textContent = part
      span.style.display = "inline-block"
      span.style.whiteSpace = "pre"
      el.appendChild(span)
      spans.push(span)
    }
    return spans
  }
  FW.typewriter = function (target, at = 0, perSecond = 18, caret = true) {
    const el = resolve(target)[0]
    if (!el) return FW
    const full = el.textContent
    const chars = Array.from(full)
    frameHooks.push((t) => {
      const n = Math.floor(clamp((t - at) * perSecond, 0, chars.length))
      const blink = caret && (n < chars.length || Math.floor(t * 2) % 2 === 0)
      el.textContent = chars.slice(0, n).join("") + (caret && blink && t >= at ? "▍" : "")
    })
    return FW
  }
  const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹"
  FW.persianDigits = (text) => String(text).replace(/\d/g, (d) => FA_DIGITS[+d])
  /** FW.count(el, from, to, at, dur, { decimals, prefix, suffix, persian, ease, separator }) */
  FW.count = function (target, from, to, at = 0, dur = 1.5, options = {}) {
    const el = resolve(target)[0]
    if (!el) return FW
    const persian = options.persian !== undefined ? options.persian : scene.language === "fa"
    frameHooks.push((t) => {
      const v = lerp(from, to, FW.progress(t, at, dur, options.ease || "out"))
      let text = v.toFixed(options.decimals || 0)
      if (options.separator !== false) text = text.replace(/\B(?=(\d{3})+(?!\d))/g, persian ? "٬" : ",")
      text = (options.prefix || "") + text + (options.suffix || "")
      el.textContent = persian ? FW.persianDigits(text) : text
    })
    return FW
  }

  // ------------------------------------------------------------ particles
  /** FW.particles(canvas, { kind: "snow"|"confetti"|"sparkle"|"dust"|"bubbles"|"rain"|"leaves"|"stars", count, color, colors, size, speed, wind, seed, from, to })
      Drawn on a <canvas> that fills its box. Positions are computed from time, so frames are exact. */
  FW.particles = function (target, options = {}) {
    const canvas = resolve(target)[0]
    if (!canvas) return FW
    const kind = options.kind || "dust"
    const count = options.count || 80
    const colors = options.colors || [options.color || (kind === "rain" ? "rgba(180,200,255,.6)" : "#ffffff")]
    const size = options.size || (kind === "confetti" ? 10 : kind === "rain" ? 2 : kind === "leaves" ? 14 : 4)
    const speed = options.speed || 1
    const wind = options.wind || 0
    const seed = options.seed || 1
    const from = options.from || 0
    const to = options.to === undefined ? 1e9 : options.to
    frameHooks.push((t) => {
      const w = canvas.clientWidth || canvas.width, h = canvas.clientHeight || canvas.height
      if (canvas.width !== w * devicePixelRatio) { canvas.width = w * devicePixelRatio; canvas.height = h * devicePixelRatio }
      const ctx = canvas.getContext("2d")
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)
      ctx.clearRect(0, 0, w, h)
      if (t < from || t > to) return
      const life = t - from
      const fadeIn = clamp(life / 0.6)
      for (let i = 0; i < count; i++) {
        const r1 = FW.random(i, seed), r2 = FW.random(i + 500, seed), r3 = FW.random(i + 1000, seed), r4 = FW.random(i + 1500, seed)
        const s = size * (0.5 + r3)
        const color = colors[i % colors.length]
        ctx.globalAlpha = fadeIn
        let x, y
        if (kind === "snow" || kind === "confetti" || kind === "leaves" || kind === "rain") {
          const fall = (kind === "rain" ? 900 : kind === "snow" ? 70 : 160) * speed * (0.6 + r2)
          y = ((r1 * (h + 100) + life * fall) % (h + 100)) - 50
          x = r4 * w + Math.sin(life * (1 + r2) + i) * (kind === "rain" ? 0 : 30) + wind * life * 40
          x = ((x % (w + 60)) + w + 60) % (w + 60) - 30
          ctx.fillStyle = color
          ctx.strokeStyle = color
          if (kind === "rain") { ctx.lineWidth = s * 0.6; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + wind * 4, y + s * 12); ctx.stroke() }
          else if (kind === "snow") { ctx.beginPath(); ctx.arc(x, y, s / 2, 0, Math.PI * 2); ctx.fill() }
          else {
            ctx.save(); ctx.translate(x, y); ctx.rotate(life * (2 + r3 * 4) + i)
            if (kind === "leaves") { ctx.beginPath(); ctx.ellipse(0, 0, s, s * 0.45, 0, 0, Math.PI * 2); ctx.fill() }
            else { ctx.scale(1, Math.cos(life * 6 + i)); ctx.fillRect(-s / 2, -s / 4, s, s / 2) }
            ctx.restore()
          }
        } else if (kind === "bubbles") {
          const rise = 60 * speed * (0.5 + r2)
          y = h + 40 - ((r1 * (h + 80) + life * rise) % (h + 80))
          x = r4 * w + Math.sin(life * 1.5 + i) * 20
          ctx.strokeStyle = color; ctx.lineWidth = 1.5
          ctx.beginPath(); ctx.arc(x, y, s * 2, 0, Math.PI * 2); ctx.stroke()
        } else {
          // dust, sparkle, stars: float and twinkle in place
          x = r4 * w + FW.wiggle(life * 0.2 * speed, 1, 40, i)
          y = r1 * h + FW.wiggle(life * 0.2 * speed, 1, 40, i + 99)
          const tw = kind === "dust" ? 0.5 + 0.5 * r2 : 0.5 + 0.5 * Math.sin(life * (2 + r2 * 4) + i)
          ctx.globalAlpha = fadeIn * tw
          ctx.fillStyle = color
          if (kind === "sparkle") {
            ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 4)
            ctx.fillRect(-s * 1.5, -s * 0.2, s * 3, s * 0.4); ctx.fillRect(-s * 0.2, -s * 1.5, s * 0.4, s * 3)
            ctx.restore()
          } else { ctx.beginPath(); ctx.arc(x, y, s / 2, 0, Math.PI * 2); ctx.fill() }
        }
      }
      ctx.globalAlpha = 1
    })
    return FW
  }

  // ------------------------------------------------------------ frame loop (called by the clock)
  FW.__frame = function (t) {
    FW.t = t
    for (const [el, props] of tracks) {
      const values = {}
      for (const prop in props) values[prop] = valueAt(el, prop, props[prop], t)
      apply(el, values)
    }
    for (const hook of frameHooks) {
      try { hook(t) } catch (problem) { console.error(problem); throw problem }
    }
  }

  // ------------------------------------------------------------ video clips (editing real footage)
  FW.__audio = []
  const LOOKS = {
    none: "",
    natural: "contrast(1.04) saturate(1.06)",
    warm: "sepia(.12) saturate(1.18) contrast(1.06) brightness(1.03)",
    cool: "saturate(1.05) contrast(1.06) hue-rotate(-6deg) brightness(1.02)",
    film: "contrast(1.12) saturate(.88) sepia(.08) brightness(.98)",
    cinematic: "contrast(1.18) saturate(1.1) brightness(.95)",
    vivid: "saturate(1.4) contrast(1.1)",
    moody: "contrast(1.2) saturate(.75) brightness(.9)",
    bw: "grayscale(1) contrast(1.2)",
    vintage: "sepia(.35) contrast(1.05) saturate(.9) brightness(1.05)",
  }
  /** FW.clip(parent, { src, from, to, at, speed, fit: "cover"|"contain", focus: [x, y] (0-1), look, volume, audio, clean, captions })
      Places a piece of a real video in the scene, exactly in sync. Returns the <video> element: tween it like anything else
      (punch-in zooms with scale, moves, masks with clipPath, picture-in-picture with width/height/borderRadius).
      Its sound (from-to, speed) is mixed into the final video; "clean" removes noise and evens the voice;
      captions come from the transcript of that file when there is one. */
  FW.clip = function (parent, o = {}) {
    const host = resolve(parent)[0]
    const video = document.createElement("video")
    video.src = o.src
    video.muted = true
    video.playsInline = true
    video.preload = "auto"
    const from = Number(o.from || 0), at = Number(o.at || 0), speed = Number(o.speed || 1)
    video.setAttribute("data-at", String(at))
    video.setAttribute("data-from", String(from))
    if (o.to !== undefined) video.setAttribute("data-to", String(o.to))
    video.playbackRate = speed
    const focus = o.focus || [0.5, 0.5]
    video.style.cssText = "position:absolute;inset:0;width:100%;height:100%;object-fit:" + (o.fit || "cover") + ";object-position:" + focus[0] * 100 + "% " + focus[1] * 100 + "%;" + (o.style || "")
    const look = LOOKS[o.look || "natural"]
    if (look) video.style.filter = look
    host.appendChild(video)
    FW.wait(new Promise((done) => {
      if (video.readyState >= 1) return done()
      video.addEventListener("loadedmetadata", done, { once: true })
      video.addEventListener("error", () => { console.error("Cannot load video " + o.src); done() }, { once: true })
    }))
    if (o.audio !== false) FW.__audio.push({ src: o.src, from, to: o.to === undefined ? null : Number(o.to), at, speed, volume: o.volume === undefined ? 1 : o.volume, clean: !!o.clean, captions: o.captions !== false })
    const end = o.to !== undefined ? at + (Number(o.to) - from) / speed : null
    if (end !== null && o.hold !== true) FW.set(video, { opacity: 0 }, end)
    if (at > 0) FW.set(video, { opacity: 0 }, 0).set(video, { opacity: 1 }, at)
    video.__fw = { from, to: o.to, at, speed, end }
    return video
  }
  /** FW.sequence(parent, src, ranges, { at, look, clean, focus, punch }) — jump cuts: plays [{from, to}, ...] back to back.
      punch: alternate a slight zoom (e.g. 1.08) on every other cut, the classic talking-head edit. Returns { clips, end }. */
  FW.sequence = function (parent, src, ranges, o = {}) {
    let t = o.at || 0
    const clips = []
    ranges.forEach((r, i) => {
      const clip = FW.clip(parent, Object.assign({}, o, { src, from: r.from, to: r.to, at: t, speed: r.speed || o.speed || 1 }))
      if (o.punch && i % 2 === 1) FW.set(clip, { scale: o.punch }, t)
      else FW.set(clip, { scale: 1 }, t)
      clips.push(clip)
      t += (r.to - r.from) / (r.speed || o.speed || 1)
    })
    return { clips, end: t }
  }
  FW.looks = Object.keys(LOOKS)

  // ------------------------------------------------------------ puppets (rig any character you draw)
  /** FW.puppet(svgGroup) rigs a character YOU drew. Mark parts in your SVG:
        <g data-part="armR" data-pivot="210 160"> ... </g>   (pivot = joint, in the same coordinates as the drawing)
      Parts can be nested (forearm inside arm). Special parts: eyes/eyeL/eyeR blink by themselves, "mouth" talks
      (either scales open, or shows children data-mouth="closed|open|wide" by loudness).
      const cat = FW.puppet("#cat")
      cat.keys("tail", [{t:0, rotate:-10}, {t:1, rotate:15}])        // keyframes per part: rotate x y scale scaleX scaleY
      cat.swing("legL", 0, 3, 25, 2.2)                                 // from, to, degrees, cycles per second, phase
      cat.move(0, 3, { x: 900, y: 0 })  cat.bob(4, 2)  cat.talk("cat")  cat.blink()  */
  FW.puppet = function (target) {
    const root = resolve(target)[0]
    if (!root) throw new Error("FW.puppet: element not found")
    const parts = {}
    root.querySelectorAll("[data-part]").forEach((el) => {
      const pivot = (el.getAttribute("data-pivot") || "0 0").split(/[ ,]+/).map(Number)
      parts[el.getAttribute("data-part")] = { el, pivot, keys: [], swings: [], base: el.getAttribute("transform") || "" }
    })
    const moves = [{ t: -1, x: 0, y: 0, scale: 1, flip: 1, dur: 0 }]
    const bobs = []
    const talks = []
    let blinking = true
    const p = { root, parts }
    function part(name) {
      if (!parts[name]) throw new Error("FW.puppet: no part named " + name + " (add data-part=\"" + name + "\")")
      return parts[name]
    }
    p.keys = (name, keys) => { part(name).keys = part(name).keys.concat(keys).sort((a, b) => a.t - b.t); return p }
    p.rotate = (name, at, dur, deg, ease = "smooth") => { part(name).keys.push({ t: at, rotate: undefined, __from: true }, { t: at + dur, rotate: deg, ease }); part(name).keys.sort((a, b) => a.t - b.t); return p }
    p.swing = (name, from, to, degrees = 20, speed = 2, phase = 0, prop = "rotate") => { part(name).swings.push({ from, to, degrees, speed, phase, prop }); return p }
    p.move = (at, dur, to, ease = "inOut") => { moves.push(Object.assign({ t: at, dur, ease }, to)); return p }
    p.bob = (amount = 4, speed = 1.8, from = 0, to = 1e9) => { bobs.push({ amount, speed, from, to }); return p }
    p.talk = (who) => {
      for (const line of FW.lines) if (!who || line.who === who) for (const w of (line.words && line.words.length ? line.words : [line])) talks.push({ t: w.start, end: w.end })
      return p
    }
    p.speak = (start, end) => { talks.push({ t: start, end }); return p }
    p.blink = (on = true) => { blinking = on; return p }
    function keyValue(keys, prop, t, fallback) {
      let value = fallback, prev = null
      for (const k of keys) {
        if (k[prop] === undefined && !k.__from) continue
        if (k.t <= t) { if (k[prop] !== undefined) value = k[prop]; prev = k; continue }
        if (k[prop] === undefined) break
        const start = prev ? prev.t : k.t
        const p0 = prev && prev[prop] !== undefined ? prev[prop] : value
        return lerp(p0, k[prop], easeOf(k.ease || "smooth")(clamp((t - start) / ((k.t - start) || 1))))
      }
      return value
    }
    FW.onFrame((t) => {
      let pos = { x: 0, y: 0, scale: 1, flip: 1 }
      for (const m of moves) {
        if (m.t > t) break
        const k = FW.progress(t, m.t, m.dur, m.ease)
        for (const key of ["x", "y", "scale"]) if (m[key] !== undefined) pos[key] = lerp(pos[key], m[key], k)
        if (m.flip !== undefined && t >= m.t) pos.flip = m.flip < 0 ? -1 : 1
      }
      let bob = 0
      for (const b of bobs) if (t >= b.from && t <= b.to) bob += Math.sin(t * b.speed * Math.PI * 2) * b.amount
      root.setAttribute("transform", "translate(" + pos.x.toFixed(2) + " " + (pos.y + bob).toFixed(2) + ") scale(" + (pos.scale * pos.flip).toFixed(4) + " " + pos.scale.toFixed(4) + ")")
      let open = 0
      for (const item of talks) if (t >= item.t && t <= item.end + 0.05) open = Math.max(open, (0.2 + 0.8 * Math.abs(Math.sin((t - item.t) * Math.PI * 4.2))) * clamp((t - item.t) / 0.05) * clamp((item.end + 0.05 - t) / 0.08))
      let lid = 0
      if (blinking) {
        let at = 0.9 + FW.random(0, 11) * 1.4, i = 1
        while (at < t + 1) { const d = t - at; if (d >= 0 && d < 0.16) lid = Math.sin((d / 0.16) * Math.PI); at += 2.6 + FW.random(i++, 11) * 2 }
      }
      for (const name in parts) {
        const item = parts[name]
        const [px, py] = item.pivot
        let rotate = keyValue(item.keys, "rotate", t, 0)
        let x = keyValue(item.keys, "x", t, 0), y = keyValue(item.keys, "y", t, 0)
        let sx = keyValue(item.keys, "scale", t, 1), sy = sx
        sx *= keyValue(item.keys, "scaleX", t, 1)
        sy *= keyValue(item.keys, "scaleY", t, 1)
        for (const sw of item.swings) if (t >= sw.from && t <= sw.to) {
          const fade = clamp((t - sw.from) / 0.2) * clamp((sw.to - t) / 0.2)
          const v = Math.sin((t - sw.from) * sw.speed * Math.PI * 2 + sw.phase) * sw.degrees * fade
          if (sw.prop === "rotate") rotate += v
          else if (sw.prop === "y") y += v
          else if (sw.prop === "x") x += v
          else if (sw.prop === "scale") { sx *= 1 + v / 100; sy *= 1 + v / 100 }
        }
        if (/^eye/i.test(name) && lid) sy *= 1 - lid * 0.92
        if (name === "mouth") {
          const shapes = item.el.querySelectorAll("[data-mouth]")
          if (shapes.length) {
            const want = open > 0.62 ? "wide" : open > 0.15 ? "open" : "closed"
            shapes.forEach((shape) => { shape.style.display = shape.getAttribute("data-mouth") === want || (want === "wide" && !item.el.querySelector('[data-mouth="wide"]') && shape.getAttribute("data-mouth") === "open") ? "" : "none" })
          } else sy *= 1 + open * 1.4
        }
        item.el.setAttribute("transform", (item.base ? item.base + " " : "") + "translate(" + (px + x).toFixed(2) + " " + (py + y).toFixed(2) + ") rotate(" + rotate.toFixed(2) + ") scale(" + sx.toFixed(4) + " " + sy.toFixed(4) + ") translate(" + -px + " " + -py + ")")
      }
    })
    return p
  }

  // ------------------------------------------------------------ loading
  const waits = []
  FW.wait = (promise) => { waits.push(Promise.resolve(promise)); return promise }
  FW.__ready = () => Promise.all(waits)

  // ------------------------------------------------------------ helpers for building scenes
  FW.el = function (tag, attrs = {}, parent) {
    const svgTags = ["svg", "g", "path", "circle", "ellipse", "rect", "line", "polygon", "polyline", "defs", "linearGradient", "radialGradient", "stop", "clipPath", "mask", "text", "use", "filter", "feGaussianBlur"]
    const el = svgTags.includes(tag) ? document.createElementNS("http://www.w3.org/2000/svg", tag) : document.createElement(tag)
    for (const key in attrs) {
      if (key === "text") el.textContent = attrs[key]
      else if (key === "html") el.innerHTML = attrs[key]
      else if (key === "style" && typeof attrs[key] === "object") Object.assign(el.style, attrs[key])
      else el.setAttribute(key, attrs[key])
    }
    if (parent) resolve(parent)[0].appendChild(el)
    return el
  }
})()

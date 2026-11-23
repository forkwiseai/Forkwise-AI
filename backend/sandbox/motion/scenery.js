/* Forkwise Motion scenery: quick, good-looking building blocks for story scenes.
   They are starting points, not templates: change colours, combine them, or draw your own SVG.
   All take a parent element (usually a camera layer with data-depth) and return the created element.

   FW.sky(layer, { time: "day" | "sunset" | "night" | "dawn" | colors: [top, bottom] })
   FW.sun(layer, { x, y, r, color, glow })          FW.moon(layer, { x, y, r })
   FW.clouds(layer, { count, top, bottom, speed, color, seed, scale })
   FW.hills(layer, { y, color, height, seed, bumps })  (stack several with different colours for depth)
   FW.ground(layer, { y, color })
   FW.tree(layer, { x, y, size, kind: "round" | "pine" | "palm", color, trunk, sway })
   FW.house(layer, { x, y, size, wall, roof, door, lit })
   FW.room(layer, { wall, floor, window: true, sky: "day" })
   FW.stars(layer, { count })   FW.grass(layer, { y, color, count }) */
(function () {
  const FW = window.FW
  const NS = "http://www.w3.org/2000/svg"
  const W = () => FW.width
  const Hh = () => FW.height
  function host(parent) {
    return typeof parent === "string" ? document.querySelector(parent) : parent
  }
  function svgLayer(parent, extra = "") {
    const svg = document.createElementNS(NS, "svg")
    svg.setAttribute("viewBox", "0 0 " + W() + " " + Hh())
    svg.setAttribute("width", "100%")
    svg.setAttribute("height", "100%")
    svg.setAttribute("preserveAspectRatio", "none")
    svg.setAttribute("style", "position:absolute;inset:0;overflow:visible;" + extra)
    host(parent).appendChild(svg)
    return svg
  }
  function node(tag, attrs, parent) {
    const el = document.createElementNS(NS, tag)
    for (const key in attrs) el.setAttribute(key, attrs[key])
    parent.appendChild(el)
    return el
  }
  let gradientId = 0
  function gradient(svg, stops, vertical = true) {
    const defs = svg.querySelector("defs") || node("defs", {}, svg)
    const id = "fwg" + ++gradientId
    const g = node("linearGradient", { id, x1: 0, y1: 0, x2: vertical ? 0 : 1, y2: vertical ? 1 : 0 }, defs)
    stops.forEach((color, i) => node("stop", { offset: i / (stops.length - 1), "stop-color": color }, g))
    return "url(#" + id + ")"
  }
  const SKIES = {
    day: ["#5fb4ff", "#bfe6ff"],
    dawn: ["#7c8cd6", "#ffc6a8"],
    sunset: ["#3b2a6b", "#ff7b6b", "#ffc36b"],
    night: ["#070b24", "#1b2350"],
    storm: ["#3a4255", "#7b8597"],
  }

  FW.sky = function (parent, o = {}) {
    const div = document.createElement("div")
    const colors = o.colors || SKIES[o.time || "day"] || SKIES.day
    div.style.cssText = "position:absolute;inset:0;background:linear-gradient(180deg," + colors.join(",") + ")"
    host(parent).appendChild(div)
    return div
  }
  FW.sun = function (parent, o = {}) {
    const svg = svgLayer(parent)
    const x = o.x || W() * 0.78, y = o.y || Hh() * 0.22, r = o.r || Hh() * 0.07
    const color = o.color || "#ffd54a"
    if (o.glow !== false) {
      const defs = node("defs", {}, svg)
      const id = "fwsun" + ++gradientId
      const rg = node("radialGradient", { id }, defs)
      node("stop", { offset: 0, "stop-color": color, "stop-opacity": 0.55 }, rg)
      node("stop", { offset: 1, "stop-color": color, "stop-opacity": 0 }, rg)
      node("circle", { cx: x, cy: y, r: r * 3.2, fill: "url(#" + id + ")" }, svg)
    }
    node("circle", { cx: x, cy: y, r, fill: color }, svg)
    return svg
  }
  FW.moon = function (parent, o = {}) {
    const svg = svgLayer(parent)
    const x = o.x || W() * 0.8, y = o.y || Hh() * 0.2, r = o.r || Hh() * 0.06
    node("circle", { cx: x, cy: y, r: r * 2.6, fill: "rgba(255,248,214,.08)" }, svg)
    node("circle", { cx: x, cy: y, r, fill: o.color || "#fff6d6" }, svg)
    node("circle", { cx: x - r * 0.3, cy: y - r * 0.2, r: r * 0.18, fill: "rgba(0,0,0,.07)" }, svg)
    node("circle", { cx: x + r * 0.35, cy: y + r * 0.3, r: r * 0.12, fill: "rgba(0,0,0,.07)" }, svg)
    return svg
  }
  function cloudPath(cx, cy, s) {
    return "M " + (cx - 110 * s) + " " + (cy + 20 * s) +
      " a " + 40 * s + " " + 40 * s + " 0 0 1 " + 40 * s + " " + -48 * s +
      " a " + 55 * s + " " + 55 * s + " 0 0 1 " + 100 * s + " " + -20 * s +
      " a " + 45 * s + " " + 45 * s + " 0 0 1 " + 75 * s + " " + 30 * s +
      " a " + 32 * s + " " + 32 * s + " 0 0 1 " + 5 * s + " " + 58 * s + " Z"
  }
  FW.clouds = function (parent, o = {}) {
    const svg = svgLayer(parent)
    const count = o.count || 5
    const items = []
    for (let i = 0; i < count; i++) {
      const s = (o.scale || 1) * (0.6 + FW.random(i, o.seed || 2) * 0.9)
      const y = (o.top || Hh() * 0.08) + FW.random(i + 20, o.seed || 2) * ((o.bottom || Hh() * 0.4) - (o.top || Hh() * 0.08))
      const g = node("g", {}, svg)
      node("path", { d: cloudPath(0, 0, s), fill: o.color || "#ffffff", opacity: o.opacity || 0.95 }, g)
      node("path", { d: cloudPath(0, 0, s), fill: "rgba(0,0,0,.05)", transform: "translate(0 " + 10 * s + ") scale(1 .5)" }, g)
      items.push({ g, x0: FW.random(i + 40, o.seed || 2) * (W() + 400) - 200, y, speed: (o.speed === undefined ? 14 : o.speed) * (0.6 + s * 0.5) })
    }
    FW.onFrame((t) => {
      for (const c of items) {
        const x = ((c.x0 + c.speed * t) % (W() + 500) + W() + 500) % (W() + 500) - 250
        c.g.setAttribute("transform", "translate(" + x.toFixed(1) + " " + c.y.toFixed(1) + ")")
      }
    })
    return svg
  }
  FW.hills = function (parent, o = {}) {
    const svg = svgLayer(parent)
    const y = o.y || Hh() * 0.7
    const h = o.height || Hh() * 0.12
    const bumps = o.bumps || 3
    const seed = o.seed || 5
    let d = "M -50 " + Hh() + " L -50 " + y
    const step = (W() + 100) / bumps
    for (let i = 0; i < bumps; i++) {
      const x1 = -50 + step * i + step * 0.5
      const peak = y - h * (0.5 + FW.random(i, seed) * 0.8)
      d += " Q " + x1 + " " + peak + " " + (-50 + step * (i + 1)) + " " + (y + (FW.random(i + 9, seed) - 0.5) * h * 0.3)
    }
    d += " L " + (W() + 50) + " " + Hh() + " Z"
    node("path", { d, fill: o.color || "#6cc46c" }, svg)
    return svg
  }
  FW.ground = function (parent, o = {}) {
    const svg = svgLayer(parent)
    const y = o.y || Hh() * 0.8
    node("rect", { x: -200, y, width: W() + 400, height: Hh() - y + 200, fill: o.color || "#5aa85a" }, svg)
    node("rect", { x: -200, y, width: W() + 400, height: 8, fill: "rgba(255,255,255,.12)" }, svg)
    return svg
  }
  FW.grass = function (parent, o = {}) {
    const svg = svgLayer(parent)
    const y = o.y || Hh() * 0.8
    const count = o.count || 70
    const blades = []
    for (let i = 0; i < count; i++) {
      const x = FW.random(i, 31) * W()
      const h = 14 + FW.random(i + 3, 31) * 22
      const p = node("path", { d: "M " + (x - 4) + " " + y + " Q " + x + " " + (y - h) + " " + (x + 2) + " " + (y - h - 2) + " Q " + (x + 2) + " " + (y - h * 0.4) + " " + (x + 5) + " " + y + " Z", fill: o.color || "#3f8f45" }, svg)
      blades.push({ p, x, y, i })
    }
    FW.onFrame((t) => {
      for (const b of blades) b.p.setAttribute("transform", "rotate(" + (Math.sin(t * 1.8 + b.i) * 4).toFixed(2) + " " + b.x + " " + b.y + ")")
    })
    return svg
  }
  FW.tree = function (parent, o = {}) {
    const svg = svgLayer(parent)
    const x = o.x || W() * 0.2, y = o.y || Hh() * 0.8, s = (o.size || 1) * Hh() / 1080
    const g = node("g", {}, svg)
    const trunk = o.trunk || "#7a4f2c"
    const leaf = o.color || "#3f9e4d"
    if (o.kind === "pine") {
      node("rect", { x: x - 10 * s, y: y - 50 * s, width: 20 * s, height: 50 * s, fill: trunk }, g)
      for (let i = 0; i < 3; i++) node("path", { d: "M " + (x - (110 - i * 25) * s) + " " + (y - (40 + i * 70) * s) + " L " + x + " " + (y - (190 + i * 70) * s) + " L " + (x + (110 - i * 25) * s) + " " + (y - (40 + i * 70) * s) + " Z", fill: i % 2 ? leaf : FW.mix(leaf, "#ffffff", 0.08) }, g)
    } else if (o.kind === "palm") {
      node("path", { d: "M " + x + " " + y + " Q " + (x + 30 * s) + " " + (y - 150 * s) + " " + (x + 10 * s) + " " + (y - 300 * s), stroke: trunk, "stroke-width": 22 * s, fill: "none", "stroke-linecap": "round" }, g)
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2
        node("path", { d: "M " + (x + 10 * s) + " " + (y - 300 * s) + " q " + Math.cos(a) * 90 * s + " " + (-60 * s) + " " + Math.cos(a) * 160 * s + " " + (Math.sin(a) * 40 + 40) * s, stroke: leaf, "stroke-width": 20 * s, fill: "none", "stroke-linecap": "round" }, g)
      }
    } else {
      node("path", { d: "M " + (x - 14 * s) + " " + y + " L " + (x - 9 * s) + " " + (y - 150 * s) + " L " + (x + 9 * s) + " " + (y - 150 * s) + " L " + (x + 14 * s) + " " + y + " Z", fill: trunk }, g)
      const blobs = [[0, -230, 95], [-70, -185, 70], [70, -185, 70], [-35, -290, 65], [40, -280, 70]]
      blobs.forEach(([dx, dy, r], i) => node("circle", { cx: x + dx * s, cy: y + dy * s, r: r * s, fill: i % 2 ? leaf : FW.mix(leaf, "#ffffff", 0.1) }, g))
      node("circle", { cx: x - 30 * s, cy: y - 250 * s, r: 20 * s, fill: "rgba(255,255,255,.12)" }, g)
    }
    const sway = o.sway === undefined ? 1.5 : o.sway
    if (sway) FW.onFrame((t) => g.setAttribute("transform", "rotate(" + (Math.sin(t * 1.1 + x) * sway).toFixed(2) + " " + x + " " + y + ")"))
    return svg
  }
  FW.house = function (parent, o = {}) {
    const svg = svgLayer(parent)
    const x = o.x || W() * 0.65, y = o.y || Hh() * 0.8, s = (o.size || 1) * Hh() / 1080
    const wall = o.wall || "#f4e1c1", roof = o.roof || "#c8553d", door = o.door || "#7b4b2a"
    const w = 340 * s, h = 230 * s
    node("rect", { x: x - w / 2, y: y - h, width: w, height: h, fill: wall }, svg)
    node("rect", { x: x - w / 2, y: y - h, width: w * 0.12, height: h, fill: "rgba(0,0,0,.06)" }, svg)
    node("path", { d: "M " + (x - w / 2 - 30 * s) + " " + (y - h) + " L " + x + " " + (y - h - 170 * s) + " L " + (x + w / 2 + 30 * s) + " " + (y - h) + " Z", fill: roof }, svg)
    node("rect", { x: x + w * 0.22, y: y - h - 150 * s, width: 34 * s, height: 70 * s, fill: FW.mix(roof, "#000000", 0.2) }, svg)
    node("rect", { x: x - 35 * s, y: y - 120 * s, width: 70 * s, height: 120 * s, rx: 6 * s, fill: door }, svg)
    node("circle", { cx: x + 22 * s, cy: y - 60 * s, r: 5 * s, fill: "#f1c453" }, svg)
    const lit = o.lit ? "#ffd86b" : "#9fd3ff"
    for (const dx of [-0.32, 0.32]) {
      node("rect", { x: x + dx * w - 40 * s, y: y - h + 50 * s, width: 80 * s, height: 70 * s, rx: 4 * s, fill: lit, stroke: "#ffffff", "stroke-width": 6 * s }, svg)
      node("line", { x1: x + dx * w, x2: x + dx * w, y1: y - h + 50 * s, y2: y - h + 120 * s, stroke: "#ffffff", "stroke-width": 5 * s }, svg)
    }
    return svg
  }
  FW.room = function (parent, o = {}) {
    const svg = svgLayer(parent)
    const wall = o.wall || "#f6d7b0", floor = o.floor || "#b07a52"
    const fy = Hh() * 0.74
    node("rect", { x: 0, y: 0, width: W(), height: fy, fill: gradient(svg, [FW.mix(wall, "#ffffff", 0.1), wall]) }, svg)
    node("rect", { x: 0, y: fy, width: W(), height: Hh() - fy, fill: floor }, svg)
    node("rect", { x: 0, y: fy - 14, width: W(), height: 14, fill: FW.mix(floor, "#000000", 0.25) }, svg)
    for (let i = 0; i < 9; i++) node("line", { x1: (W() / 8) * i, x2: (W() / 8) * i - 120, y1: fy, y2: Hh(), stroke: "rgba(0,0,0,.08)", "stroke-width": 3 }, svg)
    if (o.window !== false) {
      const wx = W() * 0.62, wy = Hh() * 0.16, ww = W() * 0.22, wh = Hh() * 0.32
      const sky = SKIES[o.sky || "day"] || SKIES.day
      node("rect", { x: wx, y: wy, width: ww, height: wh, fill: gradient(svg, sky), stroke: "#ffffff", "stroke-width": 14 }, svg)
      node("line", { x1: wx + ww / 2, x2: wx + ww / 2, y1: wy, y2: wy + wh, stroke: "#ffffff", "stroke-width": 10 }, svg)
      node("line", { x1: wx, x2: wx + ww, y1: wy + wh / 2, y2: wy + wh / 2, stroke: "#ffffff", "stroke-width": 10 }, svg)
      node("path", { d: "M " + (wx - 40) + " " + (wy - 30) + " L " + (wx + ww * 0.3) + " " + (wy - 30) + " Q " + (wx + ww * 0.15) + " " + (wy + wh * 0.6) + " " + (wx - 30) + " " + (wy + wh + 30) + " Z", fill: o.curtain || "#e76f51" }, svg)
      node("path", { d: "M " + (wx + ww + 40) + " " + (wy - 30) + " L " + (wx + ww * 0.7) + " " + (wy - 30) + " Q " + (wx + ww * 0.85) + " " + (wy + wh * 0.6) + " " + (wx + ww + 30) + " " + (wy + wh + 30) + " Z", fill: o.curtain || "#e76f51" }, svg)
    }
    if (o.rug !== false) node("ellipse", { cx: W() * 0.4, cy: Hh() * 0.88, rx: W() * 0.22, ry: Hh() * 0.06, fill: o.rugColor || "#5e60ce", opacity: 0.85 }, svg)
    if (o.picture !== false) {
      node("rect", { x: W() * 0.18, y: Hh() * 0.2, width: W() * 0.12, height: Hh() * 0.18, fill: "#fff7e8", stroke: "#8d5a3b", "stroke-width": 10 }, svg)
      node("path", { d: "M " + W() * 0.19 + " " + Hh() * 0.36 + " L " + W() * 0.23 + " " + Hh() * 0.27 + " L " + W() * 0.26 + " " + Hh() * 0.32 + " L " + W() * 0.29 + " " + Hh() * 0.25 + " L " + W() * 0.29 + " " + Hh() * 0.36 + " Z", fill: "#7fb069" }, svg)
    }
    return svg
  }
  FW.stars = function (parent, o = {}) {
    const canvas = document.createElement("canvas")
    canvas.style.cssText = "position:absolute;inset:0;width:100%;height:" + (o.height || "70%")
    host(parent).appendChild(canvas)
    FW.particles(canvas, { kind: "stars", count: o.count || 140, size: o.size || 3, color: o.color || "#ffffff", speed: 0.2 })
    return canvas
  }
})()

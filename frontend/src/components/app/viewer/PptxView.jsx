import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { ChevronLeft, ChevronRight, Maximize2, Minimize2, Pause, Play, RotateCcw, StickyNote } from "lucide-react"
import { loadPptx } from "../../../lib/pptx"

const PT = 96 / 72
const EASE = "cubic-bezier(0.22, 0.8, 0.24, 1)"
const CLIP = {
  triangle: "polygon(50% 0, 100% 100%, 0 100%)",
  rtTriangle: "polygon(0 0, 100% 100%, 0 100%)",
  diamond: "polygon(50% 0, 100% 50%, 50% 100%, 0 50%)",
  hexagon: "polygon(25% 0, 75% 0, 100% 50%, 75% 100%, 25% 100%, 0 50%)",
  octagon: "polygon(29% 0, 71% 0, 100% 29%, 100% 71%, 71% 100%, 29% 100%, 0 71%, 0 29%)",
  pentagon: "polygon(50% 0, 100% 38%, 82% 100%, 18% 100%, 0 38%)",
  homePlate: "polygon(0 0, 80% 0, 100% 50%, 80% 100%, 0 100%)",
  chevron: "polygon(0 0, 75% 0, 100% 50%, 75% 100%, 0 100%, 25% 50%)",
  parallelogram: "polygon(25% 0, 100% 0, 75% 100%, 0 100%)",
  trapezoid: "polygon(25% 0, 75% 0, 100% 100%, 0 100%)",
  rightArrow: "polygon(0 30%, 60% 30%, 60% 0, 100% 50%, 60% 100%, 60% 70%, 0 70%)",
  leftArrow: "polygon(100% 30%, 40% 30%, 40% 0, 0 50%, 40% 100%, 40% 70%, 100% 70%)",
  star5: "polygon(50% 0, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)",
}

function fontStack(name, fonts) {
  let font = name || fonts.minor || ""
  if (font === "+mj-lt" || font === "+mj-cs") font = fonts.major
  if (font === "+mn-lt" || font === "+mn-cs") font = fonts.minor
  return (font ? "\"" + font + "\", " : "") + "Vazirmatn, \"Segoe UI\", Arial, sans-serif"
}

function radiusOf(shape) {
  if (shape.preset === "ellipse" || shape.preset === "flowChartConnector") return "50%"
  if (shape.preset === "roundRect" || shape.preset === "round2SameRect" || shape.preset === "flowChartAlternateProcess") return Math.min(shape.box.w, shape.box.h) * 0.1667 + "px"
  return 0
}

function Text({ text, fonts }) {
  const justify = { t: "flex-start", ctr: "center", b: "flex-end" }[text.anchor] || "flex-start"
  return (
    <div className="pv-text" style={{ justifyContent: justify, padding: text.pad.map((v) => v + "px").join(" "), whiteSpace: text.wrap ? "pre-wrap" : "pre", writingMode: text.vertical ? "vertical-rl" : undefined }}>
      {text.paragraphs.map((p, index) => {
        const rtl = p.rtl || p.runs.some((r) => /[؀-ۿ֐-׿]/.test(r.text))
        return (
          <div key={index} dir={rtl ? "rtl" : "auto"} style={{ textAlign: p.align || (rtl ? "right" : undefined), paddingInlineStart: p.level * 24 + (p.bullet ? 22 : 0) + "px", fontSize: p.empty ? p.emptySize * PT + "px" : undefined, position: "relative" }}>
            {p.bullet && <span className="pv-bullet" style={{ fontSize: ((p.runs[0] && p.runs[0].size) || 18) * PT + "px", color: p.runs[0] && p.runs[0].color, insetInlineStart: p.level * 24 + "px" }}>{p.bullet}</span>}
            {p.empty ? "​" : p.runs.map((run, i) => (
              <span key={i} style={{ fontSize: run.size * PT + "px", fontWeight: run.bold ? 700 : 400, fontStyle: run.italic ? "italic" : undefined, textDecoration: run.underline ? "underline" : undefined, color: run.color || undefined, fontFamily: fontStack(run.font, fonts) }}>{run.text}</span>
            ))}
          </div>
        )
      })}
    </div>
  )
}

function Shape({ shape, fonts, hidden }) {
  const box = shape.box
  const outer = { left: box.x + "px", top: box.y + "px", width: Math.max(1, box.w) + "px", height: Math.max(1, box.h) + "px", visibility: hidden ? "hidden" : undefined }
  const turn = [box.rot ? "rotate(" + box.rot + "deg)" : "", box.flipH ? "scaleX(-1)" : "", box.flipV ? "scaleY(-1)" : ""].join(" ").trim()
  if (shape.kind === "line") {
    const length = Math.hypot(box.w, box.h)
    const angle = Math.atan2(box.flipV ? -box.h : box.h, box.flipH ? -box.w : box.w) * 180 / Math.PI
    return (
      <div className="pv-anim" data-spid={shape.id || undefined} style={outer}>
        <div style={{ position: "absolute", left: box.flipH ? box.w + "px" : 0, top: box.flipV ? box.h + "px" : 0, width: length + "px", height: 0, borderTop: (shape.line ? shape.line.width : 1.5) + "px solid " + (shape.line ? shape.line.color : "#888"), transform: "rotate(" + angle + "deg)", transformOrigin: "0 0" }} />
      </div>
    )
  }
  const inner = { transform: turn || undefined, borderRadius: radiusOf(shape), clipPath: CLIP[shape.preset], background: shape.fill || undefined, border: shape.line && !CLIP[shape.preset] ? shape.line.width + "px solid " + shape.line.color : undefined }
  return (
    <div className="pv-anim" data-spid={shape.id || undefined} style={outer}>
      <div className="pv-shape" style={inner}>
        {shape.kind === "picture" && <img src={shape.url} alt="" draggable={false} style={{ borderRadius: radiusOf(shape) }} />}
        {shape.kind === "table" && (
          <table className="pv-table">
            <colgroup>{shape.widths.map((w, i) => <col key={i} style={{ width: w + "px" }} />)}</colgroup>
            <tbody>
              {shape.rows.map((row, r) => (
                <tr key={r} style={{ height: row.h + "px" }}>
                  {row.cells.filter((cell) => !cell.merged).map((cell, c) => (
                    <td key={c} colSpan={cell.span} style={{ background: cell.fill || undefined }}>{cell.text && <Text text={cell.text} fonts={fonts} />}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {shape.kind === "placeholder" && <div className="pv-object">{shape.label}</div>}
        {shape.text && <Text text={shape.text} fonts={fonts} />}
      </div>
    </div>
  )
}

function animatedIds(slide) {
  const ids = new Set()
  for (const group of slide.animations) for (const effect of group.effects) ids.add(effect.spid)
  return ids
}

export function SlideCanvas({ deck, slide, width, played, stageRef, onSurfaceClick }) {
  const scale = width / deck.width
  const hiddenIds = useMemo(() => {
    const ids = animatedIds(slide)
    if (played === Infinity) return new Set()
    const shown = new Set()
    slide.animations.slice(0, played).forEach((group) => group.effects.forEach((effect) => shown.add(effect.spid)))
    return new Set([...ids].filter((id) => !shown.has(id)))
  }, [slide, played])
  return (
    <div className="pv-frame" style={{ width: width + "px", height: deck.height * scale + "px" }} onClick={onSurfaceClick}>
      <div ref={stageRef} className="pv-slide" style={{ width: deck.width + "px", height: deck.height + "px", transform: "scale(" + scale + ")", background: slide.background }}>
        {slide.shapes.map((shape, index) => <Shape key={index} shape={shape} fonts={deck.fonts} hidden={shape.id && hiddenIds.has(shape.id)} />)}
      </div>
    </div>
  )
}

function keyframes(effect, deck) {
  const box = effect.box
  if (effect.effect === "appear") return [{ opacity: 0 }, { opacity: 1 }]
  if (effect.effect === "fly") {
    const from = {
      bottom: "translateY(" + (deck.height - box.y + 20) + "px)",
      top: "translateY(" + -(box.y + box.h + 20) + "px)",
      left: "translateX(" + -(box.x + box.w + 20) + "px)",
      right: "translateX(" + (deck.width - box.x + 20) + "px)",
    }[effect.dir] || "translateY(" + (deck.height - box.y) + "px)"
    return [{ transform: from }, { transform: "none" }]
  }
  if (effect.effect === "rise") return [{ opacity: 0, transform: "translateY(" + deck.height * 0.1 + "px)" }, { opacity: 1, transform: "none" }]
  if (effect.effect === "zoom") return [{ opacity: 0, transform: "scale(0.3)" }, { opacity: 1, transform: "none" }]
  if (effect.effect === "wheel" || effect.effect === "spin") return [{ opacity: 0, transform: "rotate(-120deg) scale(0.5)" }, { opacity: 1, transform: "none" }]
  if (effect.effect === "wipe") {
    const start = { bottom: "inset(100% 0 0 0)", top: "inset(0 0 100% 0)", left: "inset(0 100% 0 0)", right: "inset(0 0 0 100%)" }[effect.dir] || "inset(100% 0 0 0)"
    return [{ clipPath: start }, { clipPath: "inset(0 0 0 0)" }]
  }
  if (effect.effect === "split") return [{ clipPath: "inset(0 50% 0 50%)" }, { clipPath: "inset(0 0 0 0)" }]
  return [{ opacity: 0 }, { opacity: 1 }]
}

function playGroup(stage, deck, slide, group) {
  if (!stage) return 0
  let end = 0
  for (const effect of group.effects) {
    const element = stage.querySelector('[data-spid="' + effect.spid + '"]')
    if (!element) continue
    const shape = slide.shapes.find((item) => item.id === effect.spid)
    element.style.visibility = "visible"
    element.animate(keyframes({ ...effect, box: shape ? shape.box : { x: 0, y: 0, w: 0, h: 0 } }, deck), { duration: Math.max(1, effect.dur), delay: effect.delay, easing: EASE, fill: "both" })
    end = Math.max(end, effect.delay + effect.dur)
  }
  return end
}

function enterSlide(element, transition, back) {
  if (!element || !transition || transition.kind === "cut") return
  const ms = Math.min(1400, transition.ms || 700)
  const sign = back ? -1 : 1
  const frames = {
    push: [{ transform: "translateY(" + sign * 100 + "%)" }, { transform: "none" }],
    cover: [{ transform: "translateX(" + sign * 100 + "%)" }, { transform: "none" }],
    pull: [{ transform: "translateX(" + sign * 100 + "%)" }, { transform: "none" }],
    fly: [{ transform: "translateX(" + sign * 100 + "%)", opacity: 0 }, { transform: "none", opacity: 1 }],
    wipe: [{ clipPath: back ? "inset(0 0 0 100%)" : "inset(0 100% 0 0)" }, { clipPath: "inset(0 0 0 0)" }],
    split: [{ clipPath: "inset(0 50% 0 50%)" }, { clipPath: "inset(0 0 0 0)" }],
    strips: [{ clipPath: "polygon(0 0, 0 0, 0 0)" }, { clipPath: "polygon(0 0, 200% 0, 0 200%)" }],
    reveal: [{ opacity: 0, transform: "scale(1.04)" }, { opacity: 1, transform: "none" }],
    zoom: [{ opacity: 0, transform: "scale(0.86)" }, { opacity: 1, transform: "none" }],
    vortex: [{ opacity: 0, transform: "rotate(-8deg) scale(0.8)" }, { opacity: 1, transform: "none" }],
  }[transition.kind] || [{ opacity: 0 }, { opacity: 1 }]
  element.animate(frames, { duration: ms, easing: EASE })
}

export default function PptxView({ url, name, onError }) {
  const [deck, setDeck] = useState(null)
  const [failed, setFailed] = useState("")
  const [index, setIndex] = useState(0)
  const [played, setPlayed] = useState(0)
  const [auto, setAuto] = useState(false)
  const [notes, setNotes] = useState(false)
  const [full, setFull] = useState(false)
  const [replays, setReplays] = useState(0)
  const [stageWidth, setStageWidth] = useState(800)
  const shell = useRef(null)
  const area = useRef(null)
  const stage = useRef(null)
  const frame = useRef(null)
  const direction = useRef(1)
  const timer = useRef(null)
  const advanceRef = useRef(() => {})

  useEffect(() => {
    let alive = true
    let loaded = null
    setDeck(null)
    setFailed("")
    fetch(url, { credentials: "include" })
      .then((response) => {
        if (!response.ok) throw new Error("Could not download the file (" + response.status + ").")
        return response.arrayBuffer()
      })
      .then((buffer) => loadPptx(buffer))
      .then((result) => {
        loaded = result
        if (alive) setDeck(result)
        else result.release()
      })
      .catch((problem) => {
        if (!alive) return
        setFailed(problem.message || "This presentation could not be opened.")
        if (onError) onError(problem)
      })
    return () => {
      alive = false
      if (loaded) loaded.release()
    }
  }, [url])

  useLayoutEffect(() => {
    if (!area.current || !deck) return undefined
    const measure = () => {
      const el = area.current
      const style = getComputedStyle(el)
      const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
      const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
      const width = el.clientWidth - padX
      const height = el.clientHeight - padY
      setStageWidth(Math.max(160, Math.floor(Math.min(width, height * (deck.width / deck.height)))))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(area.current)
    return () => observer.disconnect()
  }, [deck, full])

  const slide = deck && deck.slides[index]

  // Entering a slide: play its transition, then every group that starts by itself.
  useLayoutEffect(() => {
    if (!slide) return undefined
    clearTimeout(timer.current)
    stage.current && stage.current.querySelectorAll(".pv-anim").forEach((element) => element.getAnimations().forEach((animation) => animation.cancel()))
    enterSlide(frame.current, slide.transition, direction.current < 0)
    setPlayed(0)
    const wait = slide.transition ? Math.min(1400, slide.transition.ms || 700) * 0.6 : 0
    const autoGroups = []
    for (const group of slide.animations) {
      if (!group.auto) break
      autoGroups.push(group)
    }
    const handle = setTimeout(() => {
      let end = 0
      for (const group of autoGroups) end = Math.max(end, playGroup(stage.current, deck, slide, group))
      setPlayed(autoGroups.length)
      if (auto) timer.current = setTimeout(() => advanceRef.current(), end + (slide.transition && slide.transition.advance !== null ? slide.transition.advance : 2600))
    }, wait)
    return () => clearTimeout(handle)
  }, [index, deck, auto, replays])

  const advance = useCallback(() => {
    if (!deck) return
    const current = deck.slides[index]
    if (played < current.animations.length) {
      const end = playGroup(stage.current, deck, current, current.animations[played])
      setPlayed(played + 1)
      if (auto) {
        clearTimeout(timer.current)
        timer.current = setTimeout(() => advanceRef.current(), end + 1200)
      }
      return
    }
    if (index < deck.slides.length - 1) {
      direction.current = 1
      setIndex(index + 1)
    } else setAuto(false)
  }, [deck, index, played, auto])
  advanceRef.current = advance

  function back() {
    if (index > 0) {
      direction.current = -1
      setIndex(index - 1)
    }
  }

  function go(target) {
    direction.current = target >= index ? 1 : -1
    setIndex(target)
  }

  useEffect(() => {
    function key(event) {
      if (event.target && /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return
      if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"].includes(event.key)) { event.preventDefault(); advance() }
      if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(event.key)) { event.preventDefault(); back() }
      if (event.key === "Home") go(0)
      if (event.key === "End" && deck) go(deck.slides.length - 1)
      if (event.key === "f" || event.key === "F") toggleFull()
    }
    window.addEventListener("keydown", key)
    return () => window.removeEventListener("keydown", key)
  })

  useEffect(() => {
    function change() {
      setFull(Boolean(document.fullscreenElement))
    }
    document.addEventListener("fullscreenchange", change)
    return () => document.removeEventListener("fullscreenchange", change)
  }, [])

  useEffect(() => () => clearTimeout(timer.current), [])

  function toggleFull() {
    if (document.fullscreenElement) document.exitFullscreen()
    else if (shell.current && shell.current.requestFullscreen) shell.current.requestFullscreen()
  }

  function replay() {
    direction.current = 1
    setReplays((value) => value + 1)
  }

  if (failed) return <div className="pv-empty">{failed}</div>
  if (!deck) return <div className="pv-empty"><span className="pv-loader" />Opening {name || "the presentation"}…</div>

  const total = deck.slides.length
  const pending = slide.animations.length - played
  const thumbWidth = 132
  return (
    <div ref={shell} className={"pv" + (full ? " pv-full" : "")}>
      <div className="pv-stage" ref={area}>
        <div ref={frame} className="pv-frame-wrap" key={index}>
          <SlideCanvas deck={deck} slide={slide} width={stageWidth} played={played} stageRef={stage} onSurfaceClick={advance} />
        </div>
      </div>
      {notes && slide.notes && <div className="pv-notes" dir="auto">{slide.notes}</div>}
      <div className="pv-bar">
        <button type="button" className="pv-btn" onClick={back} disabled={index === 0} aria-label="Previous slide"><ChevronLeft size={16} /></button>
        <span className="pv-count">{index + 1} / {total}</span>
        <button type="button" className="pv-btn" onClick={advance} disabled={index === total - 1 && pending <= 0} aria-label="Next">{pending > 0 ? <span className="pv-next-anim">Next animation</span> : <ChevronRight size={16} />}</button>
        <span className="pv-grow" />
        {slide.animations.length > 0 && <span className="pv-tag">{slide.animations.reduce((n, g) => n + g.effects.length, 0)} animations</span>}
        {slide.transition && <span className="pv-tag">{slide.transition.kind} transition</span>}
        <button type="button" className="pv-btn" onClick={replay} title="Play this slide again" aria-label="Replay slide"><RotateCcw size={15} /></button>
        <button type="button" className={"pv-btn" + (auto ? " pv-on" : "")} onClick={() => setAuto(!auto)} title={auto ? "Stop the slideshow" : "Play as a slideshow"} aria-label="Slideshow">{auto ? <Pause size={15} /> : <Play size={15} />}</button>
        {deck.slides.some((item) => item.notes) && <button type="button" className={"pv-btn" + (notes ? " pv-on" : "")} onClick={() => setNotes(!notes)} title="Speaker notes" aria-label="Speaker notes"><StickyNote size={15} /></button>}
        <button type="button" className="pv-btn" onClick={toggleFull} title="Full screen (F)" aria-label="Full screen">{full ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</button>
      </div>
      {!full && (
        <div className="pv-thumbs">
          {deck.slides.map((item, i) => (
            <button key={i} type="button" className={"pv-thumb" + (i === index ? " pv-on" : "")} onClick={() => go(i)} aria-label={"Slide " + (i + 1)}>
              <SlideCanvas deck={deck} slide={item} width={thumbWidth} played={Infinity} />
              <span>{i + 1}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

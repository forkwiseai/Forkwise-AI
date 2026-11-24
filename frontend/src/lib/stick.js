import { useCallback, useEffect, useRef, useState } from "react"

// Keeps a scrolling chat glued to its newest line while an answer streams, the way Claude, Grok and opencode do:
// the view glides down instead of jumping, and lets go the moment the person scrolls up to read.
//
// Motion: each frame closes a fixed share of the remaining distance, d(n+1) = d(n) * (1 - k), with k = 0.2 at
// 60 fps. That is an exponential approach with time constant tau = -1/(60 * ln(1 - k)) ~ 75 ms: a 400 px jump
// is 95% done in about 0.22 s and never overshoots, and new text arriving mid-glide only extends the target.
//
// Following only happens while it should: when the person is at the bottom AND something is live (an answer is
// running, or a message was just sent). Opening or closing a step while reading never yanks the page, which was
// the old bug: collapsing a block clamped the scroll position to the bottom, the code read that as "at the
// bottom" and then jumped there.
const K = 0.2
const NEAR = 64

export function useStickToBottom({ live }) {
  // Callback refs: the chat first renders a loading skeleton, so the elements appear later than the hook.
  const boxRef = useRef(null)
  const contentRef = useRef(null)
  const [boxEl, setBoxEl] = useState(null)
  const [contentEl, setContentEl] = useState(null)
  const box = useCallback((el) => { boxRef.current = el; setBoxEl(el) }, [])
  const content = useCallback((el) => { contentRef.current = el; setContentEl(el) }, [])
  const stuck = useRef(true)
  const frame = useRef(0)
  const userMoving = useRef(0)
  const liveRef = useRef(live)
  const justSent = useRef(0)
  const [atBottom, setAtBottom] = useState(true)
  liveRef.current = live

  const distance = () => {
    const el = boxRef.current
    return el ? el.scrollHeight - el.scrollTop - el.clientHeight : 0
  }

  const glide = useCallback(() => {
    cancelAnimationFrame(frame.current)
    const step = () => {
      const el = boxRef.current
      if (!el || !stuck.current) return
      const left = distance()
      if (left <= 0.5) return
      el.scrollTop += Math.max(1, left * K)
      frame.current = requestAnimationFrame(step)
    }
    frame.current = requestAnimationFrame(step)
  }, [])

  const following = () => stuck.current && (liveRef.current || Date.now() - justSent.current < 1500)

  // Content grows (streaming text, a new step, a picture loading): glide to the new bottom.
  useEffect(() => {
    if (!contentEl || typeof ResizeObserver === "undefined") return undefined
    const observer = new ResizeObserver(() => {
      if (following()) glide()
      else setAtBottom(distance() < NEAR)
    })
    observer.observe(contentEl)
    return () => observer.disconnect()
  }, [glide, contentEl])

  // The person scrolls: wheel, touch, keys or dragging the scrollbar. Only these may unstick.
  useEffect(() => {
    const el = boxEl
    if (!el) return undefined
    const intent = () => { userMoving.current = Date.now() }
    const onWheel = (event) => {
      intent()
      if (event.deltaY < 0) stuck.current = false
    }
    const onKey = (event) => {
      if (["ArrowUp", "PageUp", "Home"].includes(event.key)) { intent(); stuck.current = false }
    }
    let pressed = false
    const down = () => { pressed = true; intent() }
    const up = () => { pressed = false }
    const onScroll = () => {
      const near = distance() < NEAR
      setAtBottom(near)
      if (pressed || Date.now() - userMoving.current < 400) stuck.current = near
    }
    el.addEventListener("wheel", onWheel, { passive: true })
    el.addEventListener("touchmove", intent, { passive: true })
    el.addEventListener("pointerdown", down)
    window.addEventListener("pointerup", up)
    el.addEventListener("keydown", onKey)
    el.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      el.removeEventListener("wheel", onWheel)
      el.removeEventListener("touchmove", intent)
      el.removeEventListener("pointerdown", down)
      window.removeEventListener("pointerup", up)
      el.removeEventListener("keydown", onKey)
      el.removeEventListener("scroll", onScroll)
    }
  }, [boxEl])

  useEffect(() => () => cancelAnimationFrame(frame.current), [])

  const toBottom = useCallback((instant) => {
    stuck.current = true
    justSent.current = Date.now()
    setAtBottom(true)
    const el = boxRef.current
    if (!el) return
    if (instant) el.scrollTop = el.scrollHeight
    else glide()
  }, [glide])

  // Called when the person sends a message: follow the answer from the start.
  const onSend = useCallback(() => toBottom(false), [toBottom])

  return { box, content, atBottom, toBottom, onSend }
}

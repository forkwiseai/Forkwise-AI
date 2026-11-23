import { useEffect, useRef, useState } from "react"

// Reveals streamed text at a steady, readable pace instead of in network-sized bursts.
// The pace speeds up when a lot of text is waiting, so it never falls far behind the model.
export function useSmoothText(target) {
  const [shown, setShown] = useState(target)
  const position = useRef(target.length)
  const goal = useRef(target)
  const frame = useRef(0)
  const last = useRef(0)

  useEffect(() => {
    const previous = goal.current
    goal.current = target
    if (target.length < position.current || !target.startsWith(previous.slice(0, position.current))) {
      position.current = 0
    }
    if (frame.current) return
    last.current = performance.now()
    const step = (now) => {
      const text = goal.current
      const waiting = text.length - position.current
      if (waiting <= 0) {
        frame.current = 0
        return
      }
      const elapsed = Math.min(64, now - last.current)
      last.current = now
      // About 90 characters a second when calm, catching up within a third of a second when behind.
      const speed = Math.max(90, waiting * 3)
      let next = position.current + Math.max(1, Math.round((speed * elapsed) / 1000))
      if (next > text.length) next = text.length
      // Finish the current word so text does not flicker mid-word.
      const space = text.slice(next, next + 12).search(/[\s.,!?؟،]/)
      if (space > 0 && next + space <= text.length) next = next + space
      position.current = next
      setShown(text.slice(0, next))
      frame.current = requestAnimationFrame(step)
    }
    frame.current = requestAnimationFrame(step)
  }, [target])

  useEffect(() => () => cancelAnimationFrame(frame.current), [])
  return position.current >= target.length ? target : shown
}

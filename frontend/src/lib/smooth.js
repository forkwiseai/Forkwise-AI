import { useEffect, useRef, useState } from "react"

// Reveals streamed text word by word at a calm, even pace instead of in network-sized bursts.
// The pace rises gently when a lot of text is waiting, so it never falls far behind the model,
// and when the finished message replaces the live one, the reveal carries on from the same spot.

const CALM = 55 // characters a second when the model is keeping up
const CATCH_UP = 1.4 // extra speed per waiting character, so a backlog clears in under a second
const LIMIT = 900 // never faster than this, even for a huge backlog
const BOUNDARY = /[\s.,!?؟،;:)\]»"'\n]/

let handoff = null

function wordEnd(text, from) {
  // Whole words only: a half-shown Persian or Arabic word reshapes its letters as it grows.
  if (from >= text.length) return text.length
  const rest = text.slice(from + 1)
  const found = rest.search(BOUNDARY)
  if (found < 0) return text.length
  return from + 1 + found + 1
}

function useReveal(target, startAt) {
  const [, setTick] = useState(0)
  const position = useRef(startAt)
  const goal = useRef(target)
  const budget = useRef(0)
  const frame = useRef(0)
  const last = useRef(0)

  useEffect(() => {
    const previous = goal.current
    goal.current = target
    if (target.length < position.current || !target.startsWith(previous.slice(0, position.current))) {
      // The text was replaced (for example a new model took over), so start again from the top.
      position.current = 0
      budget.current = 0
    }
    if (frame.current || position.current >= target.length) return
    last.current = performance.now()
    const step = (now) => {
      const text = goal.current
      const waiting = text.length - position.current
      if (waiting <= 0) {
        frame.current = 0
        return
      }
      const elapsed = Math.min(50, now - last.current)
      last.current = now
      const speed = Math.min(LIMIT, CALM + waiting * CATCH_UP)
      budget.current = budget.current + (speed * elapsed) / 1000
      let next = position.current
      while (next < text.length) {
        const end = wordEnd(text, next)
        if (end - position.current > budget.current) break
        next = end
      }
      if (next > position.current) {
        budget.current = Math.max(0, budget.current - (next - position.current))
        position.current = next
        setTick((value) => value + 1)
      }
      frame.current = requestAnimationFrame(step)
    }
    frame.current = requestAnimationFrame(step)
  }, [target])

  useEffect(() => () => {
    cancelAnimationFrame(frame.current)
    frame.current = 0
  }, [])

  const shown = target.slice(0, Math.min(position.current, target.length))
  return { shown, position: position.current, done: position.current >= target.length }
}

// For the live, still-streaming answer.
export function useSmoothText(target) {
  const reveal = useReveal(target, 0)
  useEffect(() => {
    handoff = { text: target, shown: reveal.position, at: Date.now() }
  })
  return reveal.done ? target : reveal.shown
}

// For a finished message: if it is the answer that was just streaming, keep revealing it from
// where the live view stopped. Older messages show at once.
export function useSettledText(text) {
  const start = useRef(null)
  if (start.current === null) {
    start.current = text.length
    const from = handoff
    if (from && Date.now() - from.at < 4000 && from.shown < text.length && text.startsWith(from.text.slice(0, from.shown))) {
      start.current = from.shown
      handoff = null
    }
  }
  const reveal = useReveal(text, start.current)
  return reveal.done ? text : reveal.shown
}

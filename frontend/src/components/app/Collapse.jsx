import { useEffect, useRef, useState } from "react"

// Opens and closes its content with a height animation (grid rows 0fr -> 1fr), and keeps the content mounted
// until the closing animation ends, so nothing pops in or out. The content is unmounted while closed.
export default function Collapse({ open, children, className, duration = 260 }) {
  const [mounted, setMounted] = useState(open)
  const [shown, setShown] = useState(open)
  const timer = useRef(null)
  useEffect(() => {
    clearTimeout(timer.current)
    if (open) {
      setMounted(true)
      const frame = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)))
      return () => cancelAnimationFrame(frame)
    }
    setShown(false)
    timer.current = setTimeout(() => setMounted(false), duration)
    return () => clearTimeout(timer.current)
  }, [open, duration])
  if (!mounted) return null
  return (
    <div className={"fw-collapse" + (shown ? " is-open" : "") + (className ? " " + className : "")} style={{ "--collapse-ms": duration + "ms" }}>
      <div className="fw-collapse-inner">{children}</div>
    </div>
  )
}

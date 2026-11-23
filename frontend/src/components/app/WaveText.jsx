// Text that lights up letter by letter while the step it names is running.
// Persian and Arabic letters join, so splitting them would break the word: those get one soft
// light that sweeps across the whole word instead.
const JOINED = /[֐-ࣿיִ-﷿ﹰ-﻿]/

export default function WaveText({ text, active = true, className = "" }) {
  const value = String(text || "")
  if (!active) return <span className={className} dir="auto">{value}</span>
  if (JOINED.test(value)) return <span className={"fw-wave-sweep " + className} dir="auto">{value}</span>
  const letters = Array.from(value)
  const span = Math.max(1400, letters.length * 55 + 900)
  return (
    <span className={"fw-wave " + className} dir="auto" aria-label={value}>
      {letters.map((letter, index) => (
        <span key={index} aria-hidden="true" style={{ "--wave-delay": index * 55 + "ms", "--wave-time": span + "ms" }}>{letter === " " ? " " : letter}</span>
      ))}
    </span>
  )
}

import { useEffect, useState } from "react"
import { FileDiff, Square } from "lucide-react"

function parse(raw) {
  if (!raw) return {}
  if (typeof raw === "object") return raw
  try {
    return JSON.parse(raw)
  } catch (problem) {
    return {}
  }
}

function clock(seconds) {
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return minutes + ":" + String(rest).padStart(2, "0")
}

function lastTurnCalls(messages) {
  let start = 0
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === "user") {
      start = i + 1
      break
    }
  }
  const calls = []
  for (let i = start; i < messages.length; i += 1) {
    if (messages[i].role === "assistant") for (const call of messages[i].tool_calls || []) calls.push(call)
  }
  return calls
}

export default function RunBar({ state, onStop, onOpenChanges }) {
  const live = state.live
  const [seconds, setSeconds] = useState(0)

  useEffect(() => {
    if (!live.running) {
      setSeconds(0)
      return undefined
    }
    const began = Date.now()
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - began) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [live.running, live.runId])

  if (!live.running) return null

  const calls = lastTurnCalls(state.messages)
  const waiting = Object.keys(live.waiting)
  let label = live.compacting ? "Summarizing earlier messages" : "Working"
  if (waiting.length > 0) label = live.waiting[waiting[0]].kind === "approval" ? "Waiting for your approval" : "Waiting for your answer"

  const percent = live.context && live.context.limit ? Math.min(100, Math.round((live.context.tokens / live.context.limit) * 100)) : null
  const changed = state.changes ? state.changes.length : 0

  return (
    <div className={"fw-run-bar" + (waiting.length > 0 ? " fw-waiting" : "")} role="status">
      <span className="fw-run-state"><span className={"fw-run-led" + (waiting.length > 0 ? " fw-waiting" : "")} /></span>
      <span className="fw-run-label" dir="auto">{label}</span>
      <span className="fw-run-meta">{calls.length} {calls.length === 1 ? "step" : "steps"}</span>
      <span className="fw-run-meta fw-mono">{clock(seconds)}</span>
      {changed > 0 && <button type="button" className="fw-run-meta fw-run-link" onClick={onOpenChanges}><FileDiff size={12} />{changed} {changed === 1 ? "file" : "files"}</button>}
      {percent !== null && (
        <span className="fw-run-meta fw-run-context" title={"Context used: " + percent + "%"}>
          <span className="fw-run-meter"><span style={{ width: percent + "%" }} className={percent > 85 ? "fw-hot" : ""} /></span>{percent}%
        </span>
      )}
      <span className="fw-tool-spacer" />
      <button type="button" className="fw-btn fw-btn-ghost fw-btn-sm" onClick={onStop}><Square size={11} />Stop</button>
    </div>
  )
}

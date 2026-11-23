import { useEffect, useRef, useState } from "react"
import { Brain, Check, ChevronDown, Copy, FileText, History, Info, AlertTriangle, Sparkles, ThumbsUp, ThumbsDown } from "lucide-react"
import Markdown from "./Markdown"
import { DraftCall, liveLabel, partialField } from "./ToolCall"
import Flow, { buildFlow } from "./Flow"
import { rawUrl } from "../../lib/api"
import { useSmoothText } from "../../lib/smooth"

function Reasoning({ text, live }) {
  const [open, setOpen] = useState(false)
  const box = useRef(null)
  useEffect(() => {
    // While thinking, the newest thoughts slide up from the bottom instead of the box jumping.
    if (live && !open && box.current) box.current.scrollTop = box.current.scrollHeight
  }, [text, live, open])
  if (!text || !text.trim()) return null
  return (
    <div className={"fw-reasoning" + (open ? " fw-open" : "") + (live && !open ? " fw-thinking" : "")}>
      <button type="button" onClick={() => setOpen(!open)}>
        <Brain size={14} />
        <span>{live ? "Thinking…" : "Thought process"}</span>
        <ChevronDown size={14} />
      </button>
      {(open || live) && <div className="fw-reasoning-text" dir="auto" ref={box}>{live && !open ? text.slice(-1500) : text}</div>}
    </div>
  )
}

const SKILL_NOTE = /\n*\[The user attached these skills to this message[^\]]*\]\s*$/

function CopyButton({ text }) {
  const [done, setDone] = useState(false)
  return (
    <button type="button" className={"fw-iconbtn fw-iconbtn-sm fw-copy-btn" + (done ? " fw-done" : "")} title={done ? "Copied" : "Copy"} aria-label="Copy" onClick={() => { navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1400) }}>
      {done ? <Check size={14} /> : <Copy size={14} />}
    </button>
  )
}

function RateButtons() {
  const [rate, setRate] = useState("")
  return (
    <>
      <span className="fw-msg-sep" />
      <button type="button" className={"fw-iconbtn fw-iconbtn-sm" + (rate === "up" ? " fw-on" : "")} title="Good answer" aria-label="Good answer" onClick={() => setRate(rate === "up" ? "" : "up")}><ThumbsUp size={14} /></button>
      <button type="button" className={"fw-iconbtn fw-iconbtn-sm" + (rate === "down" ? " fw-on" : "")} title="Bad answer" aria-label="Bad answer" onClick={() => setRate(rate === "down" ? "" : "down")}><ThumbsDown size={14} /></button>
    </>
  )
}

function UserMessage({ message, wid, onRewind, canRewind }) {
  const attachments = (message.meta && message.meta.attachments) || []
  const skills = (message.meta && message.meta.skills) || []
  const content = String(message.content || "").replace(SKILL_NOTE, "")
  return (
    <div className="fw-msg-user">
      <div className="fw-msg-user-bubble">
        {attachments.length > 0 && (
          <div className="fw-msg-attachments">
            {attachments.map((item) => (
              item.kind === "image"
                ? <img key={item.path} src={rawUrl(wid, item.path)} alt={item.name} />
                : <span key={item.path} className="fw-chip"><FileText size={13} />{item.name || item.path}</span>
            ))}
          </div>
        )}
        {skills.length > 0 && (
          <div className="fw-msg-attachments">
            {skills.map((name) => <span key={name} className="fw-chip fw-skill-chip"><Sparkles size={12} />{name}</span>)}
          </div>
        )}
        {content && <div className="fw-msg-user-text" dir="auto">{content}</div>}
      </div>
      <div className="fw-msg-actions">
        <CopyButton text={content} />
        {canRewind && !message.temp && (
          <button type="button" className="fw-iconbtn fw-iconbtn-sm" title="Go back to this message and undo the changes after it" onClick={() => onRewind(message)}>
            <History size={14} />
          </button>
        )}
      </div>
    </div>
  )
}

function buildTurns(messages) {
  const turns = []
  let current = null
  for (const message of messages) {
    if (message.role === "user") {
      current = { user: message, items: [] }
      turns.push(current)
    } else {
      if (!current) {
        current = { user: null, items: [] }
        turns.push(current)
      }
      current.items.push(message)
    }
  }
  return turns
}

function parseArgs(raw) {
  if (!raw) return {}
  if (typeof raw === "object") return raw
  try {
    return JSON.parse(raw)
  } catch (problem) {
    return {}
  }
}

function LiveText({ text }) {
  const shown = useSmoothText(text)
  return <Markdown text={shown} />
}

// Keeps each status on screen for a moment, so quick changes read as calm steps, not flicker.
function useSteadyLabel(label) {
  const [shown, setShown] = useState(label)
  const since = useRef(Date.now())
  const latest = useRef(label)
  latest.current = label
  useEffect(() => {
    if (label.text === shown.text) return
    const wait = Math.max(0, 900 - (Date.now() - since.current))
    const timer = setTimeout(() => {
      since.current = Date.now()
      setShown(latest.current)
    }, wait)
    return () => clearTimeout(timer)
  }, [label.text, shown.text])
  return shown
}

function ProcessLine({ state, drafts, results }) {
  const live = state.live
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    const began = Date.now()
    setSeconds(0)
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - began) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [live.runId])
  let label = { icon: Sparkles, text: live.text ? "Writing the answer" : live.reasoning ? "Thinking" : "Working" }
  if (live.compacting) label = { icon: Brain, text: "Summarizing earlier messages" }
  const calls = []
  for (const message of state.messages) if (message.role === "assistant") for (const call of message.tool_calls || []) calls.push(call)
  const runningIds = Object.keys(live.tools).filter((id) => live.tools[id].status === "running" && !results[id])
  if (runningIds.length > 0) {
    const call = calls.find((item) => item.id === runningIds[runningIds.length - 1])
    if (call) label = liveLabel(call.function.name, parseArgs(call.function.arguments))
  } else if (drafts.length > 0) {
    const draft = drafts[drafts.length - 1]
    label = liveLabel(draft.name || "", { path: partialField(draft.args, "path"), command: partialField(draft.args, "command"), description: partialField(draft.args, "description"), query: partialField(draft.args, "query"), url: partialField(draft.args, "url") })
  }
  const steady = useSteadyLabel(label)
  const Icon = steady.icon || Sparkles
  return (
    <div className="fw-process" role="status" aria-live="polite">
      <span className="fw-process-icon" key={"i" + steady.text}><Icon size={14} /></span>
      <span className="fw-process-text" dir="auto" key={steady.text}>{steady.text}</span>
      <span className="fw-process-time">{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</span>
    </div>
  )
}

export default function MessageList({ state, wid, respond, onPreview, onRewind, onApprovePlan, onRevisePlan }) {
  const { messages, live } = state
  const results = {}
  let lastPlanId = null
  for (const message of messages) {
    if (message.role === "tool") results[message.tool_call_id] = message
    if (message.role === "assistant") {
      for (const call of message.tool_calls || []) if (call.function.name === "exit_plan_mode") lastPlanId = call.id
    }
  }
  const turns = buildTurns(messages)
  const drafts = Object.keys(live.drafts).sort().map((key) => live.drafts[key])

  return (
    <div className="fw-messages">
      {turns.map((turn, index) => {
        const lastTurn = index === turns.length - 1
        return (
          <div className="fw-turn" key={turn.user ? turn.user.id : "t" + index}>
            {turn.user && <UserMessage message={turn.user} wid={wid} onRewind={onRewind} canRewind={!live.running} />}
            <div className="fw-msg-assistant">
              <Flow nodes={buildFlow(turn.items)} results={results} ctx={{ live, wid, respond, onPreview, lastPlanId, chat: state.chat, onApprovePlan, onRevisePlan }} />
              {lastTurn && live.running && (
                <div className="fw-assistant-step fw-live">
                  <Reasoning text={live.reasoning} live />
                  {live.text && <LiveText text={live.text} />}
                  {drafts.map((draft, i) => <DraftCall key={i} draft={draft} />)}
                </div>
              )}
              {lastTurn && live.running && Object.keys(live.waiting).length === 0 && <ProcessLine state={state} drafts={drafts} results={results} />}
              {lastTurn && !live.running && lastText(turn.items) && (
                <div className="fw-msg-actions fw-left">
                  <CopyButton text={lastText(turn.items)} />
                  <RateButtons />
                </div>
              )}
            </div>
          </div>
        )
      })}
      {live.notices.map((text, index) => (
        <div key={index} className="fw-notice"><Info size={14} /><span>{text}</span></div>
      ))}
      {live.error && (
        <div className="fw-notice fw-error"><AlertTriangle size={14} /><span>{live.error}</span></div>
      )}
      {live.queued.map((text, index) => (
        <div key={"q" + index} className="fw-msg-user fw-queued"><div className="fw-msg-user-bubble"><div className="fw-msg-user-text" dir="auto">{text}</div><span className="fw-muted fw-small">Queued — Forkwise reads it at the next step</span></div></div>
      ))}
    </div>
  )
}

function anyRunning(tools, results) {
  for (const id of Object.keys(tools)) {
    if (tools[id].status === "running" && !results[id]) return true
  }
  return false
}

function lastText(items) {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    if (items[i].role === "assistant" && items[i].content && items[i].content.trim()) return items[i].content
  }
  return ""
}

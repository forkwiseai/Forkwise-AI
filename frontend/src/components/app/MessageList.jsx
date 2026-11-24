import { useEffect, useRef, useState } from "react"
import { lazy, Suspense } from "react"
import { Brain, Check, ChevronDown, Copy, FileText, GitBranch, History, Info, AlertTriangle, Pencil, RefreshCw, Sparkles, ThumbsUp, ThumbsDown } from "lucide-react"
import Markdown from "./Markdown"
import { DraftCall, liveLabel, partialField } from "./ToolCall"
import Flow, { buildFlow } from "./Flow"
import { rawUrl } from "../../lib/api"
import { useSmoothText } from "../../lib/smooth"
import ForkMark, { markMode } from "./ForkMark"
import WaveText from "./WaveText"

const DocViewer = lazy(() => import("./viewer/DocViewer"))

function Reasoning({ text, live }) {
  const [open, setOpen] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const box = useRef(null)
  const began = useRef(Date.now())
  useEffect(() => {
    if (!live) return undefined
    const timer = setInterval(() => setSeconds(Math.round((Date.now() - began.current) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [live])
  useEffect(() => {
    // A new step starts with empty thoughts: its timer starts again.
    if (!text) {
      began.current = Date.now()
      setSeconds(0)
    }
  }, [Boolean(text)])
  useEffect(() => {
    // The closed preview shows the newest thoughts, sliding up from the bottom.
    if (!open && box.current) box.current.scrollTop = box.current.scrollHeight
  }, [text, open])
  if (!text || !text.trim()) return null
  return (
    <div className={"rs" + (open ? " is-open" : "") + (live ? " is-live" : "")}>
      <button type="button" className="rs-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Brain size={14} />
        <span>{live ? <WaveText text="Thinking" /> : "Thought process"}</span>
        {live && seconds > 0 && <span className="rs-time">{seconds}s</span>}
        <ChevronDown size={13} className={"rs-chev" + (open ? " is-open" : "")} />
      </button>
      <div className={"rs-body" + (open ? " is-open" : "")} ref={box} dir="auto">{text}</div>
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

function UserMessage({ message, wid, onRewind, onEdit, onFork, canRewind }) {
  const attachments = (message.meta && message.meta.attachments) || []
  const skills = (message.meta && message.meta.skills) || []
  const content = String(message.content || "").replace(SKILL_NOTE, "")
  return (
    <div className={"fw-msg-user" + (message.clientKey ? " is-new" : "")}>
      <div className="fw-msg-user-bubble">
        {attachments.length > 0 && (
          <div className="fw-msg-attachments">
            {attachments.map((item) => (
              item.kind === "image"
                ? <Zoomable key={item.path} src={rawUrl(wid, item.path)} alt={item.name} />
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
        {canRewind && !message.temp && onEdit && (
          <button type="button" className="fw-iconbtn fw-iconbtn-sm" title="Edit and resend (later messages and their file changes are undone)" aria-label="Edit message" onClick={() => onEdit(message)}>
            <Pencil size={14} />
          </button>
        )}
        {canRewind && !message.temp && onFork && (
          <button type="button" className="fw-iconbtn fw-iconbtn-sm" title="Branch: continue from here in a new chat" aria-label="Branch from here" onClick={() => onFork(message)}>
            <GitBranch size={14} />
          </button>
        )}
        {canRewind && !message.temp && onRewind && (
          <button type="button" className="fw-iconbtn fw-iconbtn-sm" title="Go back to this message and undo the changes after it" aria-label="Go back to here" onClick={() => onRewind(message)}>
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
  let label = { icon: Sparkles, mode: live.text ? "write" : live.reasoning ? "think" : "work", text: live.text ? "Writing" : live.reasoning ? "Thinking" : "Working" }
  if (live.compacting) label = { icon: Brain, text: "Summarizing earlier messages" }
  const calls = []
  for (const message of state.messages) if (message.role === "assistant") for (const call of message.tool_calls || []) calls.push(call)
  const runningIds = Object.keys(live.tools).filter((id) => live.tools[id].status === "running" && !results[id])
  if (runningIds.length > 0) {
    const call = calls.find((item) => item.id === runningIds[runningIds.length - 1])
    if (call) label = { ...liveLabel(call.function.name, parseArgs(call.function.arguments)), mode: markMode(call.function.name) }
  } else if (drafts.length > 0) {
    const draft = drafts[drafts.length - 1]
    label = { mode: markMode(draft.name || ""), ...liveLabel(draft.name || "", { path: partialField(draft.args, "path"), command: partialField(draft.args, "command"), description: partialField(draft.args, "description"), query: partialField(draft.args, "query"), url: partialField(draft.args, "url") }) }
  }
  const steady = useSteadyLabel(label)
  return (
    <div className="pl" role="status" aria-live="polite">
      <span className="pl-mark"><ForkMark size={16} active mode={steady.mode || "work"} /></span>
      <span className="pl-text" key={steady.text}><WaveText text={steady.text} /></span>
      <span className="pl-time">{seconds < 60 ? seconds + "s" : Math.floor(seconds / 60) + "m " + String(seconds % 60).padStart(2, "0") + "s"}</span>
    </div>
  )
}

function Zoomable({ src, alt }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="fw-zoomable" onClick={() => setOpen(true)} aria-label={"Open " + (alt || "picture")}><img src={src} alt={alt} loading="lazy" /></button>
      {open && <DocViewerLazy url={src} name={alt || "Picture"} kind="image" onClose={() => setOpen(false)} />}
    </>
  )
}

function DocViewerLazy(props) {
  return <Suspense fallback={null}><DocViewer {...props} /></Suspense>
}

export default function MessageList({ state, wid, respond, onPreview, onRewind, onEdit, onFork, onRegenerate, onApprovePlan, onRevisePlan, readOnly }) {
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
          <div className="fw-turn" key={"turn" + index}>
            {turn.user && <UserMessage message={turn.user} wid={wid} onRewind={onRewind} onEdit={onEdit} onFork={onFork} canRewind={!live.running && !readOnly} />}
            <div className="fw-msg-assistant">
              <Flow nodes={buildFlow(turn.items)} results={results} ctx={{ live, wid, respond, onPreview, lastPlanId, chat: state.chat, onApprovePlan, onRevisePlan, lastTurn }} />
              {lastTurn && live.running && (
                <div className="fw-assistant-step fw-live">
                  <Reasoning text={live.reasoning} live />
                  {live.text && <LiveText text={live.text} />}
                  {drafts.map((draft, i) => <DraftCall key={i} draft={draft} />)}
                </div>
              )}
              {lastTurn && live.running && Object.keys(live.waiting).length === 0 && !(live.reasoning && !live.text && drafts.length === 0 && !anyRunning(live.tools, results)) && <ProcessLine state={state} drafts={drafts} results={results} />}
              {!live.running && lastText(turn.items) && (lastTurn || !readOnly) && (
                <div className={"fw-msg-actions fw-left" + (lastTurn ? "" : " fw-hover-only")}>
                  {lastTurn && <span className="fw-done-mark" title="Forkwise"><ForkMark size={18} /></span>}
                  <CopyButton text={lastText(turn.items)} />
                  {!readOnly && lastTurn && onRegenerate && turn.user && (
                    <button type="button" className="fw-iconbtn fw-iconbtn-sm" title="Try again: answer this message again" aria-label="Retry" onClick={() => onRegenerate(turn.user)}><RefreshCw size={14} /></button>
                  )}
                  {!readOnly && <RateButtons />}
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

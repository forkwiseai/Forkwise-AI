import { useState } from "react"
import { AlertTriangle, Bot, Brain, Check, ChevronDown, ChevronRight, FilePen, Github, Globe, Laptop, Loader2, Mail, Plug, Search, Sparkles, TerminalSquare, Wrench, X } from "lucide-react"

const CAT_ICON = { explore: Search, edit: FilePen, run: TerminalSquare, browse: Globe, computer: Laptop, github: Github, gmail: Mail, google: Globe, connector: Plug, ability: Sparkles, agent: Bot, other: Wrench }
import Markdown from "./Markdown"
import Collapse from "./Collapse"
import ForkMark, { markMode } from "./ForkMark"
import WaveText from "./WaveText"
import { useSettledText } from "../../lib/smooth"
import ToolCall, { describe } from "./ToolCall"

export const CATEGORY = {
  read_file: "explore", list_dir: "explore", glob: "explore", grep: "explore", web_search: "explore", web_fetch: "explore",
  use_skill: "explore", memory: "explore", job_output: "explore", monitor: "run", advisor: "explore",
  write_file: "edit", edit_file: "edit", multi_edit: "edit", create_tool: "edit", save_skill: "edit",
  bash: "run", kill_job: "run", preview: "run",
  browser: "browse", screenshot: "browse",
  computer: "computer",
  github: "github", gmail: "gmail", google_api: "google",
  task: "agent",
}

const STANDALONE = ["exit_plan_mode", "ask_user", "show_file", "generate_image", "todo_write"]

export function categoryOf(name) {
  if (CATEGORY[name]) return CATEGORY[name]
  if (name && name.startsWith("mcp__")) return "connector"
  if (name && name.startsWith("my_")) return "ability"
  return "other"
}

function parse(raw) {
  if (!raw) return {}
  if (typeof raw === "object") return raw
  try {
    return JSON.parse(raw)
  } catch (problem) {
    return {}
  }
}

function plural(count, one, many) {
  return count + " " + (count === 1 ? one : many)
}

function groupTitle(group, results) {
  const calls = group.calls
  const n = calls.length
  if (group.category === "explore") return "Explored " + plural(n, "item", "items")
  if (group.category === "edit") {
    const files = {}
    for (const call of calls) files[parse(call.function.arguments).path || call.id] = true
    return "Edited " + plural(Object.keys(files).length, "file", "files")
  }
  if (group.category === "run") return "Ran " + plural(n, "command", "commands")
  if (group.category === "browse") return "Browsed " + plural(n, "page", "pages")
  if (group.category === "computer") return "Used your computer, " + plural(n, "action", "actions")
  if (group.category === "github") return "GitHub, " + plural(n, "step", "steps")
  if (group.category === "gmail") return "Gmail, " + plural(n, "step", "steps")
  if (group.category === "google") return "Google, " + plural(n, "request", "requests")
  if (group.category === "connector") return "Connected apps, " + plural(n, "call", "calls")
  if (group.category === "ability") return "Used " + plural(n, "ability", "abilities")
  return "Used " + plural(n, "tool", "tools")
}

function groupHint(group) {
  const names = []
  for (const call of group.calls) {
    const info = describe(call.function.name, parse(call.function.arguments), {})
    if (info.target && names.indexOf(info.target) === -1) names.push(info.target)
    if (names.length >= 3) break
  }
  const more = group.calls.length - names.length
  const text = names.join(", ")
  return more > 0 && names.length >= 3 ? text + " +" + more : text
}

export function buildFlow(items, results) {
  const nodes = []
  let pendingThought = ""
  let key = 0

  function flushThought() {
    if (pendingThought.trim()) nodes.push({ type: "thought", text: pendingThought, key: "th" + key++ })
    pendingThought = ""
  }

  for (const item of items) {
    if (item.role === "summary") {
      flushThought()
      nodes.push({ type: "note", key: "n" + item.id })
      continue
    }
    if (item.role !== "assistant") continue
    if (item.reasoning && item.reasoning.trim()) pendingThought = pendingThought ? pendingThought + "\n\n" + item.reasoning : item.reasoning
    if (item.content && item.content.trim()) {
      const previous = nodes[nodes.length - 1]
      if (item.meta && item.meta.continues && previous && previous.type === "say") {
        // The rest of an answer that was cut off: show it as one piece, not two paragraphs.
        previous.text = previous.text + item.content
      } else {
        flushThought()
        nodes.push({ type: "say", text: item.content, key: "s" + item.id })
      }
    }
    // A call that only fetched a tool's full definition (it was not run) is plumbing, not a step.
    const calls = (item.tool_calls || []).filter((call) => !(results && results[call.id] && results[call.id].meta && results[call.id].meta.schema))
    const regular = calls.filter((call) => STANDALONE.indexOf(call.function.name) === -1 && call.function.name !== "task")
    const parallel = regular.length > 1
    for (const call of calls) {
      const name = call.function.name
      if (STANDALONE.indexOf(name) !== -1) {
        flushThought()
        nodes.push({ type: "block", call, key: "b" + call.id })
        continue
      }
      if (name === "task") {
        const thought = pendingThought
        pendingThought = ""
        nodes.push({ type: "agent", call, thought, key: "a" + call.id })
        continue
      }
      const category = categoryOf(name)
      const last = nodes[nodes.length - 1]
      if (last && last.type === "group" && last.category === category) {
        last.calls.push(call)
        if (parallel) last.parallel = true
        if (pendingThought) {
          last.thoughts.push(pendingThought)
          pendingThought = ""
        }
      } else {
        const group = { type: "group", category, calls: [call], thoughts: [], parallel, key: "g" + call.id }
        if (pendingThought) {
          group.thoughts.push(pendingThought)
          pendingThought = ""
        }
        nodes.push(group)
      }
    }
  }
  flushThought()
  return nodes
}

function Dot({ status }) {
  if (status === "running") return <span className="fw-flow-dot fw-running"><ForkMark size={13} active /></span>
  if (status === "failed") return <span className="fw-flow-dot fw-failed"><X size={10} /></span>
  if (status === "waiting") return <span className="fw-flow-dot fw-waiting">!</span>
  if (status === "done") return <span className="fw-flow-dot fw-done"><Check size={10} /></span>
  return <span className="fw-flow-dot" />
}

function Thought({ text }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="fw-flow-node fw-thought">
      <Dot status="idle" />
      <div className="fw-flow-body">
        <button type="button" className="fw-flow-head fw-quiet" onClick={() => setOpen(!open)}>
          <span className="fw-flow-icon"><Brain size={14} /></span><span>Thought process</span>
          <ChevronRight size={13} className={"fw-flow-chev" + (open ? " fw-open" : "")} />
        </button>
        {open && <div className="fw-flow-thought-text" dir="auto">{text}</div>}
      </div>
    </div>
  )
}

function statusOf(calls, results, live, waiting) {
  let running = false
  let failed = false
  let waits = false
  for (const call of calls) {
    const result = results[call.id]
    if (waiting[call.id]) waits = true
    if (!result && live.tools[call.id] && live.tools[call.id].status === "running") running = true
    if (result && result.meta && result.meta.ok === false) failed = true
  }
  if (waits) return "waiting"
  if (running) return "running"
  if (failed) return "failed"
  return "done"
}

function diffTotals(calls, results) {
  let added = 0
  let removed = 0
  let any = false
  for (const call of calls) {
    const result = results[call.id]
    if (result && result.meta && result.meta.added !== undefined) {
      added += result.meta.added
      removed += result.meta.removed || 0
      any = true
    }
  }
  return any ? { added, removed } : null
}

function Group({ group, results, ctx }) {
  const status = statusOf(group.calls, results, ctx.live, ctx.live.waiting)
  const forceOpen = status === "running" || status === "waiting" || status === "failed"
  const [open, setOpen] = useState(false)
  const expanded = open || forceOpen
  const totals = diffTotals(group.calls, results)
  const single = group.calls.length === 1
  return (
    <div className={"fw-flow-node fw-flow-group fw-cat-" + group.category + " fw-" + status}>
      <Dot status={status} />
      <div className="fw-flow-body">
        {single && !group.thoughts.length ? (
          <FlowCall call={group.calls[0]} results={results} ctx={ctx} />
        ) : (
          <>
            <button type="button" className="fw-flow-head" onClick={() => setOpen(!expanded)}>
              <span className="fw-flow-icon">{status === "running" ? <ForkMark size={15} active mode={markMode(group.category)} /> : (() => { const Icon = CAT_ICON[group.category] || Wrench; return <Icon size={14} /> })()}</span>
              <span className={"fw-flow-title"}>{status === "running" ? <WaveText text={groupTitle(group, results)} /> : groupTitle(group, results)}</span>
              {!expanded && <span className="fw-flow-hint" dir="auto">{groupHint(group)}</span>}
              {totals && <span className="fw-tool-diffstat"><span className="fw-add">+{totals.added}</span><span className="fw-del">−{totals.removed}</span></span>}
              <ChevronRight size={13} className={"fw-flow-chev" + (expanded ? " fw-open" : "")} />
            </button>
            {expanded && (
              <div className={"fw-flow-children" + (group.parallel ? " fw-branches" : "")}>
                {group.thoughts.map((text, index) => <div key={index} className="fw-flow-thought-text" dir="auto">{text}</div>)}
                {group.calls.map((call) => (
                  <div className="fw-flow-branch" key={call.id}><FlowCall call={call} results={results} ctx={ctx} /></div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function FlowCall({ call, results, ctx }) {
  const live = ctx.live
  return (
    <ToolCall
      call={call}
      result={results[call.id]}
      live={live.tools[call.id]}
      waiting={live.waiting[call.id]}
      subs={live.subs[call.id]}
      wid={ctx.wid}
      respond={ctx.respond}
      onPreview={ctx.onPreview}
      planActive={call.id === ctx.lastPlanId && !live.running && ctx.chat && ctx.chat.mode === "plan"}
      onApprovePlan={ctx.onApprovePlan}
      onRevisePlan={ctx.onRevisePlan}
    />
  )
}

function summarize(nodes) {
  const counts = {}
  const order = []
  for (const node of nodes) {
    if (node.type !== "group") continue
    if (!counts[node.category]) {
      counts[node.category] = []
      order.push(node.category)
    }
    counts[node.category].push(...node.calls)
  }
  const parts = order.map((category) => groupTitle({ category, calls: counts[category] }))
  const agents = nodes.filter((node) => node.type === "agent").length
  if (agents) parts.push("ran " + plural(agents, "helper", "helpers"))
  if (parts.length === 0) return "Thought process"
  const text = parts.slice(0, 3).join(", ")
  return text.charAt(0).toUpperCase() + text.slice(1).replace(/, ([A-Z])/g, (match, letter) => ", " + letter.toLowerCase())
}

function StepThought({ text }) {
  const [open, setOpen] = useState(false)
  const clean = String(text || "").trim()
  const long = clean.length > 320 || clean.split("\n").length > 4
  return (
    <div className="tl-item tl-thought">
      <span className="tl-dot"><Brain size={11} /></span>
      <div className="tl-main">
        <div className="tl-label">Thought</div>
        <div className={"tl-thought-text" + (long && !open ? " is-clamped" : "")} dir="auto">{clean}</div>
        {long && <button type="button" className="tl-more" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? "Show less" : "Show more"}</button>}
      </div>
    </div>
  )
}

function StepCall({ call, results, ctx }) {
  const status = statusOf([call], results, ctx.live, ctx.live.waiting)
  const info = describe(call.function.name, parse(call.function.arguments), (results[call.id] && results[call.id].meta) || {})
  const Icon = info.icon || Wrench
  return (
    <div className={"tl-item tl-call is-" + status}>
      <span className="tl-dot">
        {status === "running" ? <ForkMark size={12} active mode={markMode(call.function.name)} /> : status === "failed" ? <X size={11} /> : status === "waiting" ? <span className="tl-bang">!</span> : <Icon size={11} />}
      </span>
      <div className="tl-main"><FlowCall call={call} results={results} ctx={ctx} /></div>
    </div>
  )
}

function Steps({ nodes, results, ctx, last }) {
  const calls = []
  for (const node of nodes) {
    if (node.type === "group") calls.push(...node.calls)
    if (node.type === "agent") calls.push(node.call)
  }
  const status = calls.length ? statusOf(calls, results, ctx.live, ctx.live.waiting) : (ctx.live.running && ctx.lastTurn ? "running" : "done")
  const busy = status === "running" || status === "waiting"
  const [open, setOpen] = useState(null)
  // While the answer is live, its newest block of steps stays open, so it doesn't fold and unfold between steps.
  const expanded = open === null ? busy || status === "failed" || Boolean(last && ctx.lastTurn && ctx.live.running) : open
  const totals = diffTotals(calls, results)
  const text = summarize(nodes)
  return (
    <div className={"tl is-" + status + (expanded ? " is-open" : "")}>
      <button type="button" className="tl-head" onClick={() => setOpen(!expanded)} aria-expanded={expanded}>
        <span className="tl-head-icon">
          {busy ? <ForkMark size={15} active /> : status === "failed" ? <AlertTriangle size={14} /> : <Check size={14} />}
        </span>
        <span className="tl-head-text">{busy ? <WaveText text={text} /> : text}</span>
        {totals && <span className="fw-tool-diffstat"><span className="fw-add">+{totals.added}</span><span className="fw-del">−{totals.removed}</span></span>}
        {calls.length > 1 && <span className="tl-count">{calls.length} steps</span>}
        <ChevronDown size={14} className={"tl-chev" + (expanded ? " is-open" : "")} />
      </button>
      <Collapse open={expanded}>
        <div className="tl-list">
          {nodes.map((node) => {
            if (node.type === "thought") return <StepThought key={node.key} text={node.text} />
            if (node.type === "agent") return <StepCall key={node.key} call={node.call} results={results} ctx={ctx} />
            return (
              <div key={node.key} className="tl-group">
                {node.thoughts.map((thought, index) => <StepThought key={index} text={thought} />)}
                {node.calls.map((call) => <StepCall key={call.id} call={call} results={results} ctx={ctx} />)}
              </div>
            )
          })}
        </div>
      </Collapse>
    </div>
  )
}

export default function Flow({ nodes, results, ctx }) {
  const blocks = []
  let run = null
  for (const node of nodes) {
    if (node.type === "group" || node.type === "thought" || node.type === "agent") {
      if (!run) {
        run = { type: "steps", nodes: [], key: "st" + node.key }
        blocks.push(run)
      }
      run.nodes.push(node)
    } else {
      run = null
      blocks.push(node)
    }
  }
  if (blocks.length === 0) return null
  return (
    <div className="fw-flow">
      {blocks.map((node, index) => {
        if (node.type === "steps") return <Steps key={node.key} nodes={node.nodes} results={results} ctx={ctx} last={index === blocks.length - 1} />
        if (node.type === "note") return <div key={node.key} className="fw-flow-note">Earlier messages were summarized to save space.</div>
        if (node.type === "say") return <div key={node.key} className="fw-flow-say"><SayText text={node.text} /></div>
        return <div key={node.key} className="fw-flow-block"><FlowCall call={node.call} results={results} ctx={ctx} /></div>
      })}
    </div>
  )
}

function SayText({ text }) {
  return <Markdown text={useSettledText(text)} />
}

export function FlowError({ text }) {
  return <div className="fw-notice fw-error"><AlertTriangle size={14} /><span>{text}</span></div>
}

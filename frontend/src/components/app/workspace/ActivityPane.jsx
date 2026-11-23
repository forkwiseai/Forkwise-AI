import { useState } from "react"
import { Check, Loader2, X } from "lucide-react"
import { collectCalls } from "../../../lib/activity"

const FILTERS = [
  { key: "all", label: "All" },
  { key: "edit", label: "Edits" },
  { key: "run", label: "Commands" },
  { key: "explore", label: "Reading" },
  { key: "browse", label: "Browser" },
  { key: "computer", label: "Computer" },
  { key: "agent", label: "Agents" },
]

export default function ActivityPane({ messages, running, onOpenFile }) {
  const [filter, setFilter] = useState("all")
  const calls = collectCalls(messages)
  const counts = { all: calls.length }
  for (const item of calls) counts[item.category] = (counts[item.category] || 0) + 1
  const shown = calls.filter((item) => filter === "all" || item.category === filter)
  const files = {}
  for (const item of calls) if (item.category === "edit" && item.args.path) files[item.args.path] = true
  const failed = calls.filter((item) => item.failed).length

  return (
    <div className="fw-activity-pane">
      <div className="fw-activity-stats">
        <div><strong>{calls.length}</strong><span>actions</span></div>
        <div><strong>{Object.keys(files).length}</strong><span>files edited</span></div>
        <div><strong>{counts.run || 0}</strong><span>commands</span></div>
        <div><strong>{failed}</strong><span>failed</span></div>
      </div>
      <div className="fw-filter-row">
        {FILTERS.filter((item) => item.key === "all" || counts[item.key]).map((item) => (
          <button key={item.key} type="button" className={"fw-filter-chip" + (filter === item.key ? " fw-on" : "")} onClick={() => setFilter(item.key)}>{item.label}<small>{counts[item.key] || 0}</small></button>
        ))}
      </div>
      <div className="fw-activity-list">
        {shown.length === 0 && <div className="fw-empty-small">Nothing here yet. Actions appear as Forkwise works.</div>}
        {shown.map((item, index) => {
          const Icon = item.info.icon
          const openable = item.category === "edit" && item.args.path
          return (
            <button key={item.id} type="button" className={"fw-activity-row fw-cat-" + item.category + (item.failed ? " fw-failed" : "")} onClick={() => openable && onOpenFile(item.args.path)} disabled={!openable}>
              <span className="fw-activity-n">{index + 1}</span>
              <Icon size={13} />
              <span className="fw-action-verb">{item.info.verb}</span>
              <span className={"fw-action-target" + (item.info.code ? " fw-mono" : "")} dir="auto">{item.info.target}</span>
              <span className="fw-tool-spacer" />
              {item.info.diff && item.info.diff.added !== undefined && <span className="fw-tool-diffstat"><span className="fw-add">+{item.info.diff.added}</span><span className="fw-del">−{item.info.diff.removed}</span></span>}
              {item.failed ? <X size={12} /> : item.done ? <Check size={12} /> : running ? <Loader2 size={12} className="fw-spin" /> : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}

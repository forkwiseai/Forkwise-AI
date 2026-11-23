import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { Check, Laptop, X } from "lucide-react"
import { collectCalls } from "../../../lib/activity"
import { api, rawUrl } from "../../../lib/api"

export default function ComputerPane({ wid, messages }) {
  const calls = collectCalls(messages).filter((item) => item.name === "computer")
  const shots = calls.filter((item) => item.meta.image)
  const [devices, setDevices] = useState(null)

  useEffect(() => {
    let alive = true
    function load() {
      api.get("/api/desktop").then((data) => alive && setDevices(data.devices)).catch(() => alive && setDevices([]))
    }
    load()
    const timer = setInterval(load, 8000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])

  const online = devices ? devices.filter((item) => item.online) : []
  const current = shots[shots.length - 1]

  return (
    <div className="fw-shots-pane">
      <div className="fw-preview-bar">
        <Laptop size={14} className="fw-muted" />
        {devices === null && <span className="fw-muted fw-small">Checking…</span>}
        {devices && online.length > 0 && <span className="fw-small"><span className="fw-dot fw-ok" /> {online.map((item) => item.name).join(", ")} online</span>}
        {devices && online.length === 0 && <span className="fw-small fw-muted">No computer online</span>}
        <span className="fw-tool-spacer" />
        <Link to="/app/settings/computer" className="fw-btn fw-btn-ghost fw-btn-sm">Manage</Link>
      </div>
      {current ? (
        <div className="fw-shots-stage">
          <a href={rawUrl(wid, current.meta.image)} target="_blank" rel="noreferrer"><img src={rawUrl(wid, current.meta.image)} alt="Your screen" /></a>
        </div>
      ) : (
        <div className="fw-preview-empty fw-compact">
          <Laptop size={34} />
          <h3>Your computer</h3>
          <p className="fw-muted">{online.length > 0 ? "Ask Forkwise to do something on your computer, for example open VS Code or change the wallpaper. Its screenshots show up here." : "Link a computer with the Forkwise Desktop app and Forkwise can use your terminal, apps, mouse and keyboard."}</p>
          {online.length === 0 && <Link to="/app/settings/computer" className="fw-btn fw-btn-primary fw-btn-sm">Link a computer</Link>}
        </div>
      )}
      {calls.length > 0 && (
        <div className="fw-action-log">
          <div className="fw-pane-toolbar"><span className="fw-muted fw-small">Actions on your computer</span></div>
          {calls.slice().reverse().map((item) => {
            const Icon = item.info.icon
            return (
              <div className={"fw-action-row" + (item.failed ? " fw-failed" : "")} key={item.id}>
                <Icon size={13} />
                <span className="fw-action-verb">{item.info.verb}</span>
                <span className={"fw-action-target" + (item.info.code ? " fw-mono" : "")} dir="auto">{item.info.target}</span>
                <span className="fw-tool-spacer" />
                {item.failed ? <X size={12} /> : item.done ? <Check size={12} /> : <span className="fw-muted fw-small">…</span>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

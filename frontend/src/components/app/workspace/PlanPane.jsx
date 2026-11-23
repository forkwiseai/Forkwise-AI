import { useEffect, useState } from "react"
import { ChevronRight, Square } from "lucide-react"
import { TodoList } from "../ToolCall"
import { api } from "../../../lib/api"

function Job({ job, wid, onKill }) {
  const [open, setOpen] = useState(false)
  const [log, setLog] = useState("")

  useEffect(() => {
    if (!open) return undefined
    let alive = true
    function load() {
      api.get("/api/ws/" + wid + "/jobs/" + job.id).then((data) => alive && setLog(data.output || data.text || "")).catch(() => alive && setLog(""))
    }
    load()
    const timer = job.alive ? setInterval(load, 3000) : null
    return () => {
      alive = false
      if (timer) clearInterval(timer)
    }
  }, [open, job.id, job.alive])

  return (
    <div className="fw-job-block">
      <button type="button" className="fw-job-head" onClick={() => setOpen(!open)}>
        <span className={"fw-job-dot" + (job.alive ? "" : " fw-off")} />
        <span className="fw-mono fw-job-cmd">{job.command}</span>
        <span className="fw-tool-spacer" />
        <ChevronRight size={13} className={"fw-flow-chev" + (open ? " fw-open" : "")} />
      </button>
      {open && (
        <div className="fw-job-body">
          <pre className="fw-tool-pre" dir="ltr">{log || "No output yet."}</pre>
          {job.alive && <button className="fw-btn fw-btn-ghost fw-btn-sm" onClick={() => onKill(job.id)}><Square size={11} />Stop</button>}
        </div>
      )}
    </div>
  )
}

export default function PlanPane({ wid, todos, refreshKey }) {
  const [jobs, setJobs] = useState([])

  function load() {
    api.get("/api/ws/" + wid + "/jobs").then((data) => setJobs(data.jobs)).catch(() => setJobs([]))
  }

  useEffect(() => {
    load()
  }, [wid, refreshKey])

  useEffect(() => {
    const timer = setInterval(load, 8000)
    return () => clearInterval(timer)
  }, [wid])

  async function kill(id) {
    await api.post("/api/ws/" + wid + "/jobs/" + id + "/kill").catch(() => null)
    load()
  }

  const done = todos.filter((item) => item.status === "completed").length
  return (
    <div className="fw-plan-pane">
      <div className="fw-pane-toolbar"><span className="fw-muted fw-small">Plan</span><span className="fw-tool-spacer" />{todos.length > 0 && <span className="fw-muted fw-small">{done} of {todos.length} done</span>}</div>
      <div className="fw-plan-pane-body">
        {todos.length === 0 ? <div className="fw-empty-small">Forkwise writes a plan here when a task has several steps.</div> : <TodoList todos={todos} />}
      </div>
      <div className="fw-pane-toolbar"><span className="fw-muted fw-small">Background processes</span></div>
      <div className="fw-plan-pane-body">
        {jobs.length === 0 && <div className="fw-empty-small">No servers or long commands are running.</div>}
        {jobs.map((job) => <Job key={job.id} job={job} wid={wid} onKill={kill} />)}
      </div>
    </div>
  )
}

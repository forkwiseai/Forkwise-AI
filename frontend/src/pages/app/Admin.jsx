import { useEffect, useState } from "react"
import { Navigate } from "react-router-dom"
import { Activity, CircleDollarSign, Crown, Inbox, LogOut, Mail, MessageSquare, Search, Send, Server, Shield, Trash2, UserPlus, Users } from "lucide-react"
import { useStore } from "../../lib/store"
import { api } from "../../lib/api"
import Avatar from "../../dash/Avatar"
import { Badge, Button, Card, Dialog, Empty, Field, Input, Select, Skeleton, Tabs, Textarea, cx, useConfirm } from "../../dash/kit"

const TABS = [
  { value: "overview", label: "Overview" },
  { value: "users", label: "Users" },
  { value: "payments", label: "Payments" },
  { value: "messages", label: "Inbox" },
  { value: "announce", label: "Announcements" },
  { value: "system", label: "System" },
]

const AUDIENCE = [
  { value: "all", label: "Everyone who wants product emails" },
  { value: "paid", label: "Paying users" },
  { value: "free", label: "Free users" },
]

function number(value) {
  return Number(value || 0).toLocaleString("en-US")
}

function compact(value) {
  const n = Number(value || 0)
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M"
  if (n >= 10000) return Math.round(n / 1000) + "k"
  return number(n)
}

function money(value) {
  return "$" + Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 2 })
}

function date(seconds) {
  if (!seconds) return "-"
  return new Date(seconds * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
}

function Stat({ icon: Icon, label, value, note }) {
  return (
    <div className="fw-stat">
      <span className="fw-stat-label"><Icon size={14} />{label}</span>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
    </div>
  )
}

function Overview() {
  const [data, setData] = useState(null)
  const [hover, setHover] = useState(-1)
  useEffect(() => {
    api.get("/api/admin/overview").then(setData).catch(() => setData({ error: true }))
  }, [])
  if (!data) return <div className="fw-stats-row">{[0, 1, 2, 3].map((index) => <div key={index} className="fw-stat"><Skeleton lines={2} /></div>)}</div>
  if (data.error) return <Empty icon={Activity} title="Couldn't load the overview" text="Refresh the page to try again." />
  const peak = Math.max(1, ...data.days.map((day) => day.tokens))
  const shown = hover >= 0 ? data.days[hover] : data.days[data.days.length - 1]
  return (
    <div className="fw-admin-stack">
      <div className="fw-stats-row">
        <Stat icon={Users} label="Users" value={number(data.users)} note={number(data.new_week) + " new this week"} />
        <Stat icon={Activity} label="Active this week" value={number(data.active_week)} note={data.users ? Math.round((data.active_week / data.users) * 100) + "% of users" : ""} />
        <Stat icon={Crown} label="Paying" value={number(data.paid_users)} note={data.pending_delete ? data.pending_delete + " pending deletion" : "Active plans"} />
        <Stat icon={CircleDollarSign} label="Revenue, 30 days" value={money(data.revenue_month)} note={money(data.revenue) + " all time"} />
      </div>
      <div className="fw-admin-2col">
        <Card title="Token usage" description="Last 14 days" action={<div className="fw-chart-readout"><strong>{compact(shown.tokens)}</strong><span>{shown.day} · {shown.runs} tasks</span></div>}>
          <div className="fw-card-body">
            <div className="fw-bars" role="img" aria-label="Tokens per day for the last 14 days" onMouseLeave={() => setHover(-1)}>
              {data.days.map((day, index) => (
                <div key={day.day} className={cx("fw-bar-col", hover === index && "is-on")} onMouseEnter={() => setHover(index)}>
                  <span className="fw-bar" style={{ height: Math.max(2, (day.tokens / peak) * 100) + "%" }} />
                  <small>{day.day.slice(8)}</small>
                </div>
              ))}
            </div>
          </div>
        </Card>
        <Card title="Top plugins" description="Installs across all users">
          <div className="fw-card-body">
            {data.plugins.length === 0 && <p className="fw-muted fw-small-text">No plugins installed yet.</p>}
            {data.plugins.map((item) => {
              const top = data.plugins[0].installs || 1
              return (
                <div key={item.plugin_id} className="fw-hbar">
                  <span>{item.plugin_id}</span>
                  <div><i style={{ width: (item.installs / top) * 100 + "%" }} /></div>
                  <b>{item.installs}</b>
                </div>
              )
            })}
          </div>
        </Card>
      </div>
      <div className="fw-stats-row is-3">
        <Stat icon={MessageSquare} label="Chats" value={number(data.chats)} note="All time" />
        <Stat icon={Activity} label="Tasks today" value={number(data.tasks_today)} note={compact(data.tokens_today) + " tokens"} />
        <Stat icon={UserPlus} label="Sign-ups this week" value={number(data.new_week)} note="New accounts" />
      </div>
    </div>
  )
}

function UserDialog({ row, me, onClose, onChanged }) {
  const { toast } = useStore()
  const confirm = useConfirm()
  const [detail, setDetail] = useState(null)
  const [plan, setPlan] = useState("pro")
  const [days, setDays] = useState(30)
  const [busy, setBusy] = useState("")

  useEffect(() => {
    if (!row) return
    setDetail(null)
    setPlan(row.plan === "free" ? "pro" : row.plan)
    api.get("/api/admin/users/" + row.id + "/detail").then(setDetail).catch(() => setDetail({ events: [], plugins: [], payments: [] }))
  }, [row])

  async function send(body, message, key) {
    setBusy(key)
    try {
      await api.post("/api/admin/users/" + row.id, body)
      toast(message, "ok")
      onChanged()
    } catch (problem) {
      toast(problem.message, "error")
    }
    setBusy("")
  }

  async function endSessions() {
    const sure = await confirm({ title: "Sign " + row.email + " out everywhere?", text: "They have to sign in again on every device.", confirmLabel: "Sign out" })
    if (!sure) return
    try {
      await api.del("/api/admin/users/" + row.id + "/sessions")
      toast("Signed out everywhere", "ok")
      setDetail((current) => current && { ...current, sessions: 0 })
    } catch (problem) {
      toast(problem.message, "error")
    }
  }

  async function remove() {
    const sure = await confirm({ title: "Delete " + row.email + "?", text: "Their account and everything they made are removed right away. This can't be undone.", confirmLabel: "Delete user", danger: true })
    if (!sure) return
    try {
      await api.del("/api/admin/users/" + row.id)
      toast("User deleted", "ok")
      onClose()
      onChanged()
    } catch (problem) {
      toast(problem.message, "error")
    }
  }

  const self = row && row.id === me
  return (
    <Dialog open={Boolean(row)} onClose={onClose} size="lg" title={row && <span className="fw-dialog-titlerow"><Avatar user={{ name: row.name, email: row.email }} size={30} />{row.name || row.email}</span>} description={row && row.email}>
      {row && (
        <div className="fw-userdetail">
          <div className="fw-userdetail-meta">
            <div><span>Plan</span><strong>{row.plan.charAt(0).toUpperCase() + row.plan.slice(1)}{row.plan !== "free" && <small> until {date(row.plan_until)}</small>}</strong></div>
            <div><span>Joined</span><strong>{date(row.created_at)}</strong></div>
            <div><span>Tasks</span><strong>{number(row.runs)}</strong></div>
            <div><span>Tokens</span><strong>{compact(row.tokens)}</strong></div>
            <div><span>Chats</span><strong>{number(row.chats)}</strong></div>
            <div><span>Sessions</span><strong>{detail ? detail.sessions : "…"}</strong></div>
          </div>
          {row.profile && row.profile.account_type && (
            <p className="fw-muted fw-small-text">{row.profile.account_type === "organization" ? (row.profile.org_name || "Organization") + " · " + row.profile.team_size + " people" : "Personal"}{row.profile.industry ? " · " + row.profile.industry : ""}{row.profile.role ? " · " + row.profile.role : ""}</p>
          )}
          <section>
            <h4>Plan</h4>
            <div className="fw-inline-form">
              <Select value={plan} onChange={setPlan} width={140} options={[{ value: "pro", label: "Pro" }, { value: "premium", label: "Premium" }, { value: "free", label: "Free" }]} />
              {plan !== "free" && <Select value={days} onChange={setDays} width={120} options={[{ value: 30, label: "30 days" }, { value: 90, label: "90 days" }, { value: 365, label: "1 year" }]} />}
              <Button variant="primary" size="sm" loading={busy === "plan"} onClick={() => send({ plan, days }, "Plan updated", "plan")}>Apply</Button>
            </div>
          </section>
          <section>
            <h4>Plugins</h4>
            {!detail ? <Skeleton lines={1} /> : detail.plugins.length === 0 ? <p className="fw-muted fw-small-text">None installed</p> : <div className="fw-tagrow">{detail.plugins.map((item) => <Badge key={item}>{item}</Badge>)}</div>}
          </section>
          <section>
            <h4>Recent security activity</h4>
            {!detail ? <Skeleton lines={3} /> : detail.events.length === 0 ? <p className="fw-muted fw-small-text">No events</p> : (
              <div className="fw-mini-log">
                {detail.events.map((item) => <div key={item.id}><span>{item.label}</span><span>{item.device}{item.ip ? " · " + item.ip : ""}</span><span>{date(item.created_at)}</span></div>)}
              </div>
            )}
          </section>
          <section className="fw-userdetail-actions">
            <Button size="sm" icon={Shield} disabled={self} loading={busy === "admin"} onClick={() => send({ is_admin: row.is_admin ? 0 : 1 }, row.is_admin ? "Admin removed" : "Admin added", "admin")}>{row.is_admin ? "Remove admin" : "Make admin"}</Button>
            <Button size="sm" icon={LogOut} disabled={self} onClick={endSessions}>Sign out everywhere</Button>
            <span className="fw-grow" />
            <Button size="sm" variant="danger" icon={Trash2} disabled={self} onClick={remove}>Delete user</Button>
          </section>
        </div>
      )}
    </Dialog>
  )
}

function UsersTab({ me }) {
  const [rows, setRows] = useState(null)
  const [query, setQuery] = useState("")
  const [planFilter, setPlanFilter] = useState("all")
  const [open, setOpen] = useState(null)

  async function load(text) {
    try {
      const data = await api.get("/api/admin/users?q=" + encodeURIComponent(text))
      setRows(data.users)
      setOpen((current) => current && (data.users.find((item) => item.id === current.id) || null))
    } catch (problem) {
      setRows([])
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => load(query), 250)
    return () => clearTimeout(timer)
  }, [query])

  const shown = (rows || []).filter((row) => planFilter === "all" || (planFilter === "paid" ? row.plan !== "free" : planFilter === "admins" ? row.is_admin : row.plan === "free"))
  return (
    <>
      <div className="fw-toolbar">
        <Input icon={Search} size="sm" placeholder="Search name or email" value={query} onChange={(e) => setQuery(e.target.value)} className="fw-toolbar-search" />
        <Tabs value={planFilter} onChange={setPlanFilter} tabs={[{ value: "all", label: "All", count: rows ? rows.length : undefined }, { value: "paid", label: "Paying" }, { value: "free", label: "Free" }, { value: "admins", label: "Admins" }]} />
      </div>
      <div className="fw-table-wrap">
        <table className="fw-table">
          <thead><tr><th>User</th><th>Plan</th><th className="is-num">Tasks</th><th className="is-num">Tokens</th><th>Joined</th><th>Last active</th></tr></thead>
          <tbody>
            {rows === null && [0, 1, 2, 3].map((index) => <tr key={index}><td colSpan={6}><Skeleton lines={1} /></td></tr>)}
            {rows && shown.length === 0 && <tr><td colSpan={6}><Empty icon={Users} title="No users match" text="Try another search or filter." /></td></tr>}
            {shown.map((row) => (
              <tr key={row.id} className="is-link" onClick={() => setOpen(row)} tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") setOpen(row) }}>
                <td>
                  <div className="fw-who">
                    <Avatar user={{ name: row.name, email: row.email }} size={28} />
                    <div><strong>{row.name || "-"}</strong>{row.is_admin && <Badge tone="blue">Admin</Badge>}{row.delete_at > 0 && <Badge tone="red">Deleting</Badge>}<span>{row.email}</span></div>
                  </div>
                </td>
                <td><Badge tone={row.plan === "free" ? "neutral" : "violet"}>{row.plan.charAt(0).toUpperCase() + row.plan.slice(1)}</Badge></td>
                <td className="is-num">{number(row.runs)}</td>
                <td className="is-num">{compact(row.tokens)}</td>
                <td className="fw-muted">{date(row.created_at)}</td>
                <td className="fw-muted">{row.last_day || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <UserDialog row={open} me={me} onClose={() => setOpen(null)} onChanged={() => load(query)} />
    </>
  )
}

function PaymentsTab() {
  const [rows, setRows] = useState(null)
  useEffect(() => {
    api.get("/api/admin/payments").then((data) => setRows(data.payments)).catch(() => setRows([]))
  }, [])
  const paid = (rows || []).filter((row) => row.status === "paid")
  return (
    <>
      <div className="fw-stats-row is-3">
        <Stat icon={CircleDollarSign} label="Collected" value={money(paid.reduce((sum, row) => sum + row.amount, 0))} note={paid.length + " paid invoices"} />
        <Stat icon={Inbox} label="Open invoices" value={number((rows || []).filter((row) => row.status !== "paid").length)} note="Created, not paid yet" />
        <Stat icon={Crown} label="Yearly plans" value={number(paid.filter((row) => row.period === "year").length)} />
      </div>
      <div className="fw-table-wrap">
        <table className="fw-table">
          <thead><tr><th>Date</th><th>User</th><th>Plan</th><th className="is-num">Amount</th><th>Status</th></tr></thead>
          <tbody>
            {rows === null && <tr><td colSpan={5}><Skeleton lines={2} /></td></tr>}
            {rows && rows.length === 0 && <tr><td colSpan={5}><Empty icon={CircleDollarSign} title="No payments yet" text="Invoices show up here as soon as someone starts a checkout." /></td></tr>}
            {(rows || []).map((row) => (
              <tr key={row.id}>
                <td className="fw-muted">{date(row.created_at)}</td>
                <td>{row.email || <span className="fw-muted">Deleted user</span>}</td>
                <td>{row.plan.charAt(0).toUpperCase() + row.plan.slice(1)} · {row.period === "year" ? "yearly" : "monthly"}</td>
                <td className="is-num">{money(row.amount)}</td>
                <td><Badge tone={row.status === "paid" ? "blue" : row.status === "created" ? "neutral" : "amber"} dot>{row.status === "paid" ? "Paid" : row.status === "created" ? "Not paid" : row.status}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function MessagesTab() {
  const [messages, setMessages] = useState(null)
  const [showDone, setShowDone] = useState(false)

  async function load() {
    try {
      const box = await api.get("/api/admin/messages")
      setMessages(box.messages)
    } catch (problem) {
      setMessages([])
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function handled(id) {
    setMessages((list) => list.map((item) => (item.id === id ? { ...item, handled: 1 } : item)))
    await api.post("/api/admin/messages/" + id).catch(() => load())
  }

  const open = (messages || []).filter((item) => showDone || !item.handled)
  return (
    <>
      <div className="fw-toolbar">
        <Tabs value={showDone ? "all" : "open"} onChange={(value) => setShowDone(value === "all")} tabs={[{ value: "open", label: "Open", count: (messages || []).filter((item) => !item.handled).length }, { value: "all", label: "All" }]} />
      </div>
      {messages === null && <Skeleton lines={4} />}
      {messages && open.length === 0 && <Empty icon={Inbox} title="Inbox zero" text="New messages from the contact form appear here." />}
      <div className="fw-inbox">
        {open.map((item) => (
          <article key={item.id} className={cx("fw-inbox-item", item.handled && "is-done")}>
            <header>
              <Avatar user={{ name: item.name, email: item.email }} size={28} />
              <div><strong>{item.name}</strong><a href={"mailto:" + item.email}>{item.email}</a></div>
              {item.topic && <Badge>{item.topic}</Badge>}
              <span className="fw-grow" />
              <span className="fw-muted fw-small-text">{new Date(item.created_at * 1000).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
            </header>
            <p dir="auto">{item.message}</p>
            <footer>
              <Button size="sm" icon={Mail} onClick={() => { window.location.href = "mailto:" + item.email + "?subject=" + encodeURIComponent("Re: " + (item.topic || "your message")) }}>Reply</Button>
              {!item.handled && <Button size="sm" variant="ghost" onClick={() => handled(item.id)}>Mark done</Button>}
            </footer>
          </article>
        ))}
      </div>
    </>
  )
}

function AnnounceTab() {
  const { toast } = useStore()
  const confirm = useConfirm()
  const [subject, setSubject] = useState("")
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [buttonLabel, setButtonLabel] = useState("")
  const [buttonUrl, setButtonUrl] = useState("")
  const [audience, setAudience] = useState("all")
  const [count, setCount] = useState(null)
  const [ready, setReady] = useState(true)
  const [busy, setBusy] = useState("")

  useEffect(() => {
    api.get("/api/admin/announce/audience?kind=" + audience).then((data) => {
      setCount(data.count)
      setReady(data.email_ready)
    }).catch(() => setCount(null))
  }, [audience])

  async function send(test) {
    if (!test) {
      const ok = await confirm({ title: "Send to " + number(count) + (count === 1 ? " person?" : " people?"), text: "This email goes out now and can't be taken back.", confirmLabel: "Send email" })
      if (!ok) return
    }
    setBusy(test ? "test" : "all")
    try {
      const data = await api.post("/api/admin/announce", { subject, title, body, audience, button_label: buttonLabel, button_url: buttonUrl, test })
      toast(test ? "Test sent to your email" : "Sending to " + number(data.sending) + " people", "ok")
    } catch (problem) {
      toast(problem.message, "error")
    }
    setBusy("")
  }

  const filled = subject.trim().length >= 3 && body.trim().length >= 10
  const paragraphs = body.split(/\n\s*\n/).filter((item) => item.trim())
  return (
    <div className="fw-admin-2col is-even">
      <Card title="Compose" description="Product news goes only to people who opted in.">
        <div className="fw-card-body fw-form">
          {!ready && <p className="fw-note is-warn">Email isn't set up on the server yet. Fill in the SMTP settings in backend.env.</p>}
          <Field label="Subject"><Input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={150} placeholder="Forkwise 2.1: faster previews" /></Field>
          <Field label="Heading" hint="Same as the subject if empty"><Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={150} /></Field>
          <Field label="Message" hint="Leave an empty line between paragraphs."><Textarea rows={8} dir="auto" value={body} onChange={(e) => setBody(e.target.value)} /></Field>
          <div className="fw-form-2">
            <Field label="Button text"><Input value={buttonLabel} onChange={(e) => setButtonLabel(e.target.value)} maxLength={40} placeholder="See what changed" /></Field>
            <Field label="Button link"><Input value={buttonUrl} onChange={(e) => setButtonUrl(e.target.value)} placeholder="https://forkwiseai.com/changelog" /></Field>
          </div>
          <Field label="Send to" hint={count === null ? "Counting" : number(count) + (count === 1 ? " person" : " people")}><Select value={audience} onChange={setAudience} options={AUDIENCE} width="100%" /></Field>
          <div className="fw-form-actions">
            <Button variant="ghost" loading={busy === "test"} disabled={!filled || busy !== "" || !ready} onClick={() => send(true)}>Send me a test</Button>
            <Button variant="primary" icon={Send} loading={busy === "all"} disabled={!filled || busy !== "" || !ready || !count} onClick={() => send(false)}>{"Send to " + (count === null ? "…" : number(count))}</Button>
          </div>
        </div>
      </Card>
      <Card title="Preview">
        <div className="fw-card-body">
          <div className="fw-mail-preview">
            <span className="fw-mail-subject">{subject || "Subject"}</span>
            <h3>{title || subject || "Heading"}</h3>
            {(paragraphs.length ? paragraphs : ["Your message appears here."]).map((item, index) => <p key={index} dir="auto">{item}</p>)}
            {buttonLabel && <span className="fw-mail-button">{buttonLabel}</span>}
            <small>You get this because you turned on product emails. Unsubscribe</small>
          </div>
        </div>
      </Card>
    </div>
  )
}

function SystemTab() {
  const [stats, setStats] = useState(null)
  const [status, setStatus] = useState(null)
  useEffect(() => {
    api.get("/api/admin/stats").then(setStats).catch(() => setStats({ models: [] }))
    api.get("/api/status").then(setStatus).catch(() => setStatus({}))
  }, [])
  const rows = status ? [["API", status.api], ["Database", status.database], ["AI models", status.models], ["Sandbox image", status.sandbox], ["Email", status.email]] : []
  return (
    <div className="fw-admin-2col is-even">
      <Card title="Services">
        <div className="fw-card-body">
          {!status && <Skeleton lines={4} />}
          {rows.map((row) => (
            <div key={row[0]} className="fw-svc"><span className={cx("fw-svc-dot", row[1] ? "is-ok" : "is-bad")} /><span>{row[0]}</span><span className="fw-grow" /><Badge tone={row[1] ? "blue" : "amber"}>{row[1] ? "Running" : "Not set up"}</Badge></div>
          ))}
        </div>
      </Card>
      <Card title="Models">
        <div className="fw-card-body">
          {!stats && <Skeleton lines={3} />}
          {stats && stats.models.map((model) => <div key={model.key} className="fw-svc"><Server size={14} className="fw-muted" /><span className="fw-mono">{model.label}</span><span className="fw-grow" /><span className="fw-muted fw-small-text">{Math.round(model.context / 1000)}k context</span></div>)}
        </div>
      </Card>
    </div>
  )
}

export function Admin() {
  const { user } = useStore()
  const [tab, setTab] = useState("overview")
  if (!user.is_admin) return <Navigate to="/app" replace />
  return (
    <div className="fw-page fw-page-enter">
      <div className="fw-admin">
        <header className="fw-pagehead">
          <div>
            <h1>Admin</h1>
            <p>Users, revenue, messages and system health.</p>
          </div>
        </header>
        <div className="fw-admin-tabs"><Tabs value={tab} onChange={setTab} tabs={TABS} /></div>
        <div key={tab} className="fw-page-enter">
          {tab === "overview" && <Overview />}
          {tab === "users" && <UsersTab me={user.id} />}
          {tab === "payments" && <PaymentsTab />}
          {tab === "messages" && <MessagesTab />}
          {tab === "system" && <SystemTab />}
          {tab === "announce" && <AnnounceTab />}
        </div>
      </div>
    </div>
  )
}

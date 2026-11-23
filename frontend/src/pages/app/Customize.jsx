import { useEffect, useMemo, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { ArrowRight, BookOpen, Brain, Code2, MessageSquareText, Plug, Plus, Search, Sparkles, Trash2, Wrench } from "lucide-react"
import { api } from "../../lib/api"
import { useStore } from "../../lib/store"
import { Badge, Button, Empty, Field, Group, Input, PageHeader, Row, Skeleton, Switch, Textarea, useConfirm, cx } from "../../dash/kit"

const TABS = [
  { key: "", label: "Overview", icon: Sparkles },
  { key: "abilities", label: "Skills and tools", icon: Wrench, text: "Expert playbooks and the tools Forkwise built for itself." },
  { key: "memory", label: "Memory", icon: Brain, text: "Facts it remembers about you across chats." },
  { key: "connectors", label: "Connectors", icon: Plug, text: "Any MCP server: databases, Notion, your own APIs." },
  { key: "instructions", label: "Instructions", icon: MessageSquareText, text: "How you like answers. Forkwise reads this before every answer, in every chat." },
]

function Overview() {
  const [counts, setCounts] = useState(null)
  useEffect(() => {
    Promise.all([
      api.get("/api/tools").catch(() => ({ tools: [] })),
      api.get("/api/skills").catch(() => ({ skills: [], builtin: [] })),
      api.get("/api/memories").catch(() => ({ memories: [] })),
      api.get("/api/mcp").catch(() => ({ servers: [] })),
    ]).then(([tools, skills, memories, servers]) => setCounts({
      abilities: (tools.tools || []).length + (skills.skills || []).length + (skills.builtin || []).length,
      memory: (memories.memories || []).length,
      connectors: (servers.servers || []).length,
    }))
  }, [])
  return (
    <div className="fw-cust-grid">
      {TABS.slice(1).map((item) => {
        const Icon = item.icon
        const count = counts && counts[item.key]
        return (
          <Link key={item.key} to={"/app/customize/" + item.key} className="fw-cust-card">
            <span className="fw-cust-icon"><Icon size={18} /></span>
            <strong>{item.label}</strong>
            <p>{item.text}</p>
            <span className="fw-cust-foot">{count !== undefined && count !== null ? <Badge>{count} {count === 1 ? "item" : "items"}</Badge> : <span />}<ArrowRight size={15} /></span>
          </Link>
        )
      })}
    </div>
  )
}

function Abilities() {
  const confirm = useConfirm()
  const [data, setData] = useState(null)
  const [open, setOpen] = useState(null)
  const [query, setQuery] = useState("")

  async function load() {
    const [tools, skills] = await Promise.all([api.get("/api/tools"), api.get("/api/skills")])
    setData({ tools: tools.tools || [], skills: skills.skills || [], builtin: skills.builtin || [] })
  }
  useEffect(() => { load() }, [])

  async function toggle(kind, item) {
    await api.patch("/api/" + kind + "/" + item.id, { enabled: !item.enabled })
    load()
  }
  async function remove(kind, item) {
    const sure = await confirm({ title: "Delete " + (kind === "tools" ? "this tool" : "this skill") + "?", text: kind === "tools" ? "my_" + item.name : item.name, confirmLabel: "Delete", danger: true })
    if (!sure) return
    await api.del("/api/" + kind + "/" + item.id)
    load()
  }

  const builtin = useMemo(() => {
    if (!data) return []
    const needle = query.trim().toLowerCase()
    return data.builtin.filter((item) => !needle || (item.title + " " + item.name + " " + item.description + " " + item.category).toLowerCase().includes(needle))
  }, [data, query])

  if (!data) return <Skeleton lines={5} />
  return (
    <>
      <Group label="Tools Forkwise made" description="When it needs something again and again, it writes itself a tool. Ask for example: make yourself a tool that checks gold prices.">
        {data.tools.length === 0 && <div className="fw-pad fw-muted">No tools yet.</div>}
        {data.tools.map((item) => (
          <div key={item.id}>
            <Row icon={Code2} title={<button type="button" className="fw-linklike fw-mono" onClick={() => setOpen(open === "t" + item.id ? null : "t" + item.id)}>my_{item.name}</button>} description={item.description}>
              <span className="fw-muted fw-small">{item.uses} uses</span>
              <Switch checked={Boolean(item.enabled)} label="Enabled" onChange={() => toggle("tools", item)} />
              <Button size="sm" variant="ghost" icon={Trash2} aria-label="Delete" onClick={() => remove("tools", item)} />
            </Row>
            {open === "t" + item.id && <pre className="fw-codeview">{item.code}</pre>}
          </div>
        ))}
      </Group>
      <Group label="Skills Forkwise saved">
        {data.skills.length === 0 && <div className="fw-pad fw-muted">No saved skills yet.</div>}
        {data.skills.map((item) => (
          <div key={item.id}>
            <Row icon={BookOpen} title={<button type="button" className="fw-linklike" onClick={() => setOpen(open === "s" + item.id ? null : "s" + item.id)}>{item.name}</button>} description={item.description}>
              <Switch checked={Boolean(item.enabled)} label="Enabled" onChange={() => toggle("skills", item)} />
              <Button size="sm" variant="ghost" icon={Trash2} aria-label="Delete" onClick={() => remove("skills", item)} />
            </Row>
            {open === "s" + item.id && <pre className="fw-codeview">{item.body}</pre>}
          </div>
        ))}
      </Group>
      <Group label={"Built-in skills (" + data.builtin.length + ")"} description="Expert playbooks. Forkwise loads one by itself when a task fits, or add one to a message with + or by typing /.">
        <div className="fw-pad" style={{ paddingBottom: 0 }}><Input icon={Search} placeholder="Search skills" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
        <div className="fw-skill-grid">
          {builtin.map((item) => {
            return (
              <div key={item.name} className="fw-skill">
                <span className="fw-skill-cat">{item.category}</span>
                <strong>{item.title}</strong>
                <p>{item.description}</p>
                <code>/{item.name}</code>
              </div>
            )
          })}
          {builtin.length === 0 && <div className="fw-muted">No skill matches.</div>}
        </div>
      </Group>
    </>
  )
}

function Memory() {
  const { toast } = useStore()
  const [items, setItems] = useState(null)
  const [text, setText] = useState("")
  async function load() {
    const data = await api.get("/api/memories")
    setItems(data.memories || [])
  }
  useEffect(() => { load() }, [])
  async function add(event) {
    event.preventDefault()
    if (!text.trim()) return
    await api.post("/api/memories", { content: text })
    setText("")
    load()
  }
  async function remove(id) {
    await api.del("/api/memories/" + id)
    toast("Forgotten", "ok")
    load()
  }
  return (
    <>
      <form className="fw-inline-form" onSubmit={add}>
        <Input dir="auto" value={text} onChange={(e) => setText(e.target.value)} placeholder="Add something for Forkwise to remember" />
        <Button type="submit" variant="primary" icon={Plus} disabled={!text.trim()}>Add</Button>
      </form>
      <Group description="Forkwise saves facts here when you ask it to remember something. Tell it to forget, or remove them here.">
        {items === null && <div className="fw-pad"><Skeleton lines={3} /></div>}
        {items && items.length === 0 && <Empty icon={Brain} title="Nothing saved yet" text="Say “remember that I prefer TypeScript” in any chat." />}
        {(items || []).map((item) => (
          <Row key={item.id} icon={Brain} title={<span dir="auto">{item.content}</span>}>
            {item.project_id && <Badge>project</Badge>}
            <Button size="sm" variant="ghost" icon={Trash2} aria-label="Forget" onClick={() => remove(item.id)} />
          </Row>
        ))}
      </Group>
    </>
  )
}

function Connectors() {
  const { toast } = useStore()
  const [servers, setServers] = useState(null)
  const [name, setName] = useState("")
  const [url, setUrl] = useState("")
  const [token, setToken] = useState("")
  const [busy, setBusy] = useState(false)
  async function load() {
    const data = await api.get("/api/mcp")
    setServers(data.servers || [])
  }
  useEffect(() => { load() }, [])
  async function add(event) {
    event.preventDefault()
    setBusy(true)
    try {
      const data = await api.post("/api/mcp", { name, url, headers: token ? { Authorization: "Bearer " + token } : {} })
      toast("Connected with " + data.tools.length + " tools", "ok")
      setName("")
      setUrl("")
      setToken("")
      load()
    } catch (problem) {
      toast(problem.message, "error")
    }
    setBusy(false)
  }
  async function remove(id) {
    await api.del("/api/mcp/" + id)
    load()
  }
  return (
    <>
      <Group label="Add an MCP server" description="Its tools become available to Forkwise in every chat.">
        <form className="fw-pad fw-form" onSubmit={add}>
          <div className="fw-form-2">
            <Field label="Name" htmlFor="m-name"><Input id="m-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="notion" /></Field>
            <Field label="Access token" htmlFor="m-token" hint="Optional"><Input id="m-token" type="password" className="fw-mono" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Bearer token" /></Field>
          </div>
          <Field label="Server link" htmlFor="m-url"><Input id="m-url" className="fw-mono" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/mcp" /></Field>
          <div className="fw-form-actions"><Button type="submit" variant="primary" loading={busy} disabled={!name || !url}>Connect</Button></div>
        </form>
      </Group>
      <Group label="Connected servers">
        {servers === null && <div className="fw-pad"><Skeleton lines={2} /></div>}
        {servers && servers.length === 0 && <div className="fw-pad fw-muted">No servers yet.</div>}
        {(servers || []).map((server) => (
          <Row key={server.id} icon={Plug} title={server.name} description={<span className="fw-mono">{server.url}</span>}>
            <Button size="sm" variant="ghost" icon={Trash2} aria-label="Remove" onClick={() => remove(server.id)} />
          </Row>
        ))}
      </Group>
    </>
  )
}

function Instructions() {
  const { user, setUser, toast } = useStore()
  const settings = user.settings || {}
  const [text, setText] = useState(settings.instructions || "")
  const [busy, setBusy] = useState(false)
  async function save() {
    setBusy(true)
    try {
      const data = await api.post("/api/auth/settings", { settings: { instructions: text } })
      setUser(data.user)
      toast("Saved", "ok")
    } catch (problem) {
      toast(problem.message, "error")
    }
    setBusy(false)
  }
  return (
    <>
      <Textarea rows={12} dir="auto" value={text} onChange={(e) => setText(e.target.value)} placeholder="For example: keep code simple, explain steps briefly, always write tests." />
      <div className="fw-save-bar" style={{ marginTop: 12 }}><Button variant="primary" loading={busy} disabled={text === (settings.instructions || "")} onClick={save}>Save changes</Button></div>
    </>
  )
}

export default function Customize() {
  const { tab } = useParams()
  const current = tab || ""
  const info = TABS.find((item) => item.key === current) || TABS[0]
  return (
    <div className="fw-page">
      <PageHeader title="Customize" description="Teach Forkwise how you work. Everything here applies to all your chats." />
      <div className="fw-subnav">
        {TABS.map((item) => (
          <Link key={item.key || "overview"} to={"/app/customize" + (item.key ? "/" + item.key : "")} className={cx("fw-subnav-link", current === item.key && "is-active")}>{item.label}</Link>
        ))}
      </div>
      {info.text && current && <p className="fw-help" style={{ marginBottom: 18 }}>{info.text}</p>}
      {current === "" && <Overview />}
      {current === "abilities" && <Abilities />}
      {current === "memory" && <Memory />}
      {current === "connectors" && <Connectors />}
      {current === "instructions" && <Instructions />}
    </div>
  )
}

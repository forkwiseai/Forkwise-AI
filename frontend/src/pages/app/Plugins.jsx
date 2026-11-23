import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { BadgeCheck, BarChart3, BookOpen, Blocks, Bot, Check, Cloud, Github, Mail, ClipboardList, FileText, FlaskConical, GitPullRequest, Library, Palette, Plug, Presentation, Search, ShieldCheck, Sparkles, Telescope, Terminal, Upload } from "lucide-react"
import { api } from "../../lib/api"
import { useStore } from "../../lib/store"
import { loadSkills } from "../../components/app/Composer"
import { Button, Dialog, Empty, Input, Skeleton, Switch, Textarea, cx, useConfirm } from "../../dash/kit"

const ICONS = {
  "git-pull-request": GitPullRequest, "flask-conical": FlaskConical, "shield-check": ShieldCheck, "book-open": BookOpen, library: Library,
  palette: Palette, presentation: Presentation, "bar-chart-3": BarChart3, "file-text": FileText, "clipboard-list": ClipboardList,
  search: Search, telescope: Telescope, blocks: Blocks, cloud: Cloud, bot: Bot, github: Github, mail: Mail,
}

const EXAMPLE = `{
  "id": "team-conventions",
  "name": "Team conventions",
  "description": "How our team writes and ships code",
  "commands": [{ "name": "/ship", "description": "Prepare a release" }],
  "skills": [
    {
      "name": "our-style",
      "description": "Follow the team's code style",
      "body": "Use TypeScript strict mode. Name files in kebab-case..."
    }
  ],
  "connectors": [{ "name": "Docs", "url": "https://mcp.example.com/mcp" }]
}`

function PluginIcon({ plugin, size = 18 }) {
  const Icon = ICONS[plugin.icon] || Blocks
  return <span className="fw-plug-icon"><Icon size={size} /></span>
}

function Contents({ plugin }) {
  return (
    <div className="fw-plug-contents">
      {plugin.skills.length > 0 && (
        <div>
          <h4><Sparkles size={13} />Skills</h4>
          {plugin.skills.map((item) => <p key={item.name}><code>{item.name}</code><span>{item.description}</span></p>)}
        </div>
      )}
      {plugin.commands.length > 0 && (
        <div>
          <h4><Terminal size={13} />Commands</h4>
          {plugin.commands.map((item) => <p key={item.name}><code>{item.name}</code><span>{item.description}</span></p>)}
        </div>
      )}
      {plugin.connectors.length > 0 && (
        <div>
          <h4><Plug size={13} />Connectors</h4>
          {plugin.connectors.map((item) => <p key={item.url}><strong>{item.name}</strong><span className="fw-mono">{item.url}</span></p>)}
        </div>
      )}
    </div>
  )
}

function UploadDialog({ open, onClose, onDone }) {
  const { toast } = useStore()
  const [text, setText] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setText("")
      setError("")
    }
  }, [open])

  async function save() {
    let manifest
    try {
      manifest = JSON.parse(text)
    } catch (problem) {
      setError("That isn't valid JSON. Check commas and quotes.")
      return
    }
    setBusy(true)
    try {
      const data = await api.post("/api/plugins/custom", { manifest })
      onDone(data.plugin)
      toast(data.plugin.name + " installed", "ok")
      onClose()
    } catch (problem) {
      setError(problem.message)
    }
    setBusy(false)
  }

  return (
    <Dialog open={open} onClose={onClose} size="lg" title="Add your own plugin" description="Paste a plugin manifest. Its skills, commands and connectors install into your account."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Install</Button></>}>
      <Textarea data-autofocus className={cx("fw-mono", "fw-manifest", error && "is-invalid")} value={text} placeholder={EXAMPLE} onChange={(e) => { setText(e.target.value); setError("") }} rows={14} spellCheck={false} />
      {error && <p className="fw-field-error" style={{ marginTop: 8 }}>{error}</p>}
    </Dialog>
  )
}

function PluginCard({ plugin, onOpen }) {
  return (
    <button type="button" className={cx("fw-plug-card", plugin.installed && "is-installed")} onClick={() => onOpen(plugin)}>
      <PluginIcon plugin={plugin} />
      <span className="fw-plug-text">
        <span className="fw-plug-name">{plugin.name}{plugin.installed && <Check size={13} className="fw-plug-on" aria-label="Installed" />}</span>
        <span className="fw-plug-sum">{plugin.summary}</span>
        <span className="fw-plug-meta">{plugin.kind}<i />{plugin.custom ? "Your plugin" : "By " + plugin.publisher}{plugin.verified && <BadgeCheck size={11} />}</span>
      </span>
    </button>
  )
}

function Section({ title, items, onOpen, action }) {
  if (!items.length) return null
  return (
    <section className="fw-dir-section">
      <header><h2>{title}</h2>{action}</header>
      <div className="fw-plug-grid">{items.map((plugin) => <PluginCard key={plugin.id} plugin={plugin} onOpen={onOpen} />)}</div>
    </section>
  )
}

export default function Plugins() {
  const { toast } = useStore()
  const confirm = useConfirm()
  const navigate = useNavigate()
  const [items, setItems] = useState(null)
  const [meta, setMeta] = useState({ categories: [], featured: [], workflows: [] })
  const [category, setCategory] = useState("")
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState(null)
  const [busy, setBusy] = useState("")
  const [upload, setUpload] = useState(false)

  useEffect(() => {
    api.get("/api/plugins").then((data) => {
      setItems(data.plugins)
      setMeta({ categories: data.categories || [], featured: data.featured || [], workflows: data.workflows || [] })
    }).catch((problem) => {
      setItems([])
      toast(problem.message, "error")
    })
  }, [])

  function patch(id, values) {
    setItems((list) => list.map((item) => (item.id === id ? { ...item, ...values } : item)))
    setOpen((current) => (current && current.id === id ? { ...current, ...values } : current))
  }

  async function install(plugin) {
    if (plugin.builtin) {
      navigate("/app/settings/connections")
      return
    }
    setBusy(plugin.id)
    try {
      const data = await api.post("/api/plugins/" + plugin.id + "/install")
      patch(plugin.id, { ...data.plugin, installs: (plugin.installs || 0) + 1 })
      loadSkills(true)
      toast(plugin.name + " installed", "ok")
    } catch (problem) {
      toast(problem.message, "error")
    }
    setBusy("")
  }

  async function uninstall(plugin) {
    const sure = await confirm({ title: "Remove " + plugin.name + "?", text: "Its skills, commands and connectors are removed from your account. Chats that already used them are not affected.", confirmLabel: "Remove", danger: true })
    if (!sure) return
    setBusy(plugin.id)
    try {
      await api.del("/api/plugins/" + plugin.id)
      if (plugin.custom) {
        setItems((list) => list.filter((item) => item.id !== plugin.id))
        setOpen(null)
      } else {
        patch(plugin.id, { installed: false, enabled: false })
      }
      loadSkills(true)
      toast(plugin.name + " removed", "ok")
    } catch (problem) {
      toast(problem.message, "error")
    }
    setBusy("")
  }

  async function toggle(plugin, enabled) {
    patch(plugin.id, { enabled })
    try {
      await api.patch("/api/plugins/" + plugin.id, { enabled })
      loadSkills(true)
    } catch (problem) {
      patch(plugin.id, { enabled: !enabled })
      toast(problem.message, "error")
    }
  }

  const all = items || []
  const needle = query.trim().toLowerCase()
  const filtering = Boolean(needle || category)
  const results = useMemo(() => all.filter((item) => {
    if (category && item.category !== category) return false
    if (!needle) return true
    return (item.name + " " + item.summary + " " + item.publisher + " " + item.kind + " " + item.skills.map((entry) => entry.name).join(" ")).toLowerCase().includes(needle)
  }), [items, category, needle])
  const pick = (ids) => ids.map((id) => all.find((item) => item.id === id)).filter(Boolean)
  const mine = all.filter((item) => item.installed)
  const used = [...all].filter((item) => !item.builtin).sort((a, b) => b.installs - a.installs || a.name.localeCompare(b.name))
  const trending = [...all].filter((item) => item.recent > 0).sort((a, b) => b.recent - a.recent).slice(0, 6)
  const fresh = all.filter((item) => item.new)
  const counts = {}
  for (const item of all) counts[item.category] = (counts[item.category] || 0) + 1

  return (
    <div className="fw-page fw-page-enter">
      <div className="fw-plugins">
        <header className="fw-dir-head">
          <h1>Plugins</h1>
          <Input icon={Search} placeholder="Search plugins" value={query} onChange={(e) => setQuery(e.target.value)} className="fw-dir-search" />
        </header>

        {items === null && <div className="fw-plug-grid">{[0, 1, 2, 3, 4, 5].map((index) => <div key={index} className="fw-plug-card is-skel"><Skeleton lines={2} /></div>)}</div>}

        {items !== null && filtering && (
          <section className="fw-dir-section">
            <header>
              <h2>{category || "Results"}<span className="fw-dir-count">{results.length}</span></h2>
              <Button size="sm" variant="ghost" onClick={() => { setCategory(""); setQuery("") }}>Clear</Button>
            </header>
            {results.length === 0 ? <Empty icon={Search} title="Nothing matches" text="Try another word or category." /> : (
              <div className="fw-plug-grid">{results.map((plugin) => <PluginCard key={plugin.id} plugin={plugin} onOpen={setOpen} />)}</div>
            )}
          </section>
        )}

        {items !== null && !filtering && (
          <>
            <Section title="Your plugins" items={mine} onOpen={setOpen} />
            <Section title="Featured" items={pick(meta.featured)} onOpen={setOpen} />
            <Section title="Popular workflows" items={pick(meta.workflows)} onOpen={setOpen} />
            {trending.length > 0 ? <Section title="Trending" items={trending} onOpen={setOpen} /> : <Section title="Most used" items={used.slice(0, 6)} onOpen={setOpen} />}
            <Section title="New" items={fresh} onOpen={setOpen} />
          </>
        )}

        {items !== null && (
          <section className="fw-dir-section">
            <header><h2>Categories</h2></header>
            <div className="fw-cat-grid">
              {meta.categories.filter((item) => counts[item]).map((item) => (
                <button key={item} type="button" className={cx("fw-cat", category === item && "is-on")} onClick={() => { setCategory(category === item ? "" : item); window.scrollTo(0, 0); document.querySelector(".fw-page") && document.querySelector(".fw-page").scrollTo(0, 0) }}>
                  <span>{item}</span><span className="fw-cat-n">{counts[item]}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="fw-dir-build">
          <div>
            <strong>Build your own plugin</strong>
            <p>Bundle your team's skills, slash commands and MCP connectors into one plugin and install it in a click.</p>
          </div>
          <Button icon={Upload} onClick={() => setUpload(true)}>Add your own</Button>
        </section>
      </div>

      <Dialog open={Boolean(open)} onClose={() => setOpen(null)} size="lg"
        title={open && <span className="fw-dialog-titlerow"><PluginIcon plugin={open} size={16} />{open.name}</span>}
        description={open && <span className="fw-plug-pub">{open.kind} · {open.custom ? "Your plugin" : "By " + open.publisher}{open.verified && <><BadgeCheck size={12} />Verified</>}{open.installs > 0 && " · " + open.installs + (open.installs === 1 ? " install" : " installs")}</span>}
        footer={open && (open.builtin ? (
          <><Button variant="ghost" onClick={() => setOpen(null)}>Close</Button><Button variant="primary" onClick={() => install(open)}>{open.installed ? "Manage connection" : "Connect"}</Button></>
        ) : open.installed ? (
          <>
            <Button variant="danger" loading={busy === open.id} onClick={() => uninstall(open)}>Remove</Button>
            <span className="fw-grow" />
            <span className="fw-plug-switch"><span>{open.enabled ? "On" : "Off"}</span><Switch checked={open.enabled} label="Plugin on" onChange={(value) => toggle(open, value)} /></span>
          </>
        ) : (
          <><Button variant="ghost" onClick={() => setOpen(null)}>Close</Button><Button variant="primary" loading={busy === open.id} onClick={() => install(open)}>Install</Button></>
        ))}>
        {open && (
          <>
            <p className="fw-plug-desc">{open.description || open.summary}</p>
            <Contents plugin={open} />
          </>
        )}
      </Dialog>
      <UploadDialog open={upload} onClose={() => setUpload(false)} onDone={(plugin) => setItems((list) => [...list.filter((item) => item.id !== plugin.id), plugin])} />
    </div>
  )
}

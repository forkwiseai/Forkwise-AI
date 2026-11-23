import { useEffect, useMemo, useRef, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { Code2, LayoutTemplate, Palette, PenTool, Presentation, Search, Shapes } from "lucide-react"
import { useStore } from "../../lib/store"
import { api } from "../../lib/api"
import { Badge, Button, Dialog, Empty, Field, Input, Select, Skeleton, Tabs, Textarea, cx } from "../../dash/kit"

export const DESIGN_TYPES = [
  {
    key: "slides", label: "Slides", icon: Presentation, blurb: "Decks you can present and export to PDF",
    title: "New slide deck", namePlaceholder: "Quarterly update", aboutPlaceholder: "Audience, length, key points, the ask at the end",
    prompt: (name, about) => "Create a slide deck called \"" + name + "\"." + (about ? " It is about: " + about + "." : "") + " Outline it first, one idea per slide, then build it as a 16:9 HTML deck with keyboard navigation and a PDF export.",
  },
  {
    key: "design", label: "Design", icon: PenTool, blurb: "Screens, landing pages, posters and mockups",
    title: "New design", namePlaceholder: "Landing page for a coffee shop", aboutPlaceholder: "What it is for, the mood you want, anything it must include",
    prompt: (name, about) => "Design \"" + name + "\"." + (about ? " Brief: " + about + "." : "") + " Pick a clear visual direction, build it as a responsive page, and show me a live preview at desktop and mobile sizes.",
  },
  {
    key: "codebase", label: "Design in codebase", icon: Code2, blurb: "Change the UI of a real project, with previews",
    title: "Design in a codebase", namePlaceholder: "Redesign the settings page", aboutPlaceholder: "Which screens to change and what should feel different",
    prompt: (name, about) => "In the project's codebase, do this UI work: \"" + name + "\"." + (about ? " Details: " + about + "." : "") + " Read the existing components and styles first, keep to the project's conventions, and show before and after previews.",
  },
  {
    key: "system", label: "Design system", icon: Palette, blurb: "Colours, type, spacing and components",
    title: "New design system", namePlaceholder: "Acme design system", aboutPlaceholder: "Brand, tone, existing colours or a site to take them from",
    prompt: (name, about) => "Create a design system called \"" + name + "\"." + (about ? " Context: " + about + "." : "") + " Define colour, type, spacing, radius and shadow tokens as CSS variables, build the core components, and make a documentation page that shows every token and component in light and dark.",
  },
  {
    key: "whiteboard", label: "Whiteboard", icon: Shapes, blurb: "Diagrams, flows and boards to arrange", beta: true,
    title: "New whiteboard", namePlaceholder: "Checkout flow", aboutPlaceholder: "What the board should map out",
    prompt: (name, about) => "Make a whiteboard called \"" + name + "\"." + (about ? " It should map out: " + about + "." : "") + " Build it as an interactive page with draggable boxes, connecting arrows and sticky notes, laid out clearly to start with.",
  },
]

const TYPE_KEY = "fw-design-types"

function readTypes() {
  try {
    return JSON.parse(localStorage.getItem(TYPE_KEY) || "{}")
  } catch (problem) {
    return {}
  }
}

function rememberType(chatId, type) {
  const map = readTypes()
  map[chatId] = type
  try {
    localStorage.setItem(TYPE_KEY, JSON.stringify(map))
  } catch (problem) {
    // storage blocked
  }
}

function ago(seconds) {
  const diff = Math.max(0, Date.now() / 1000 - seconds)
  if (diff < 60) return "Just now"
  if (diff < 3600) return Math.floor(diff / 60) + "m ago"
  if (diff < 86400) return Math.floor(diff / 3600) + "h ago"
  if (diff < 86400 * 7) return Math.floor(diff / 86400) + "d ago"
  return new Date(seconds * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
}

function Art({ type }) {
  if (type === "slides") {
    return (
      <div className="fw-art fw-art-slides">
        <div className="fw-art-slide"><i className="w60" /><i className="w40" /><b /></div>
        <div className="fw-art-strip"><span /><span /><span /></div>
      </div>
    )
  }
  if (type === "codebase") {
    return (
      <div className="fw-art fw-art-code">
        <i className="w50 tone-a" /><i className="w70 in" /><i className="w40 in tone-b" /><i className="w60 in2" /><i className="w30 in" /><i className="w45" />
      </div>
    )
  }
  if (type === "system") {
    return (
      <div className="fw-art fw-art-system">
        <div className="fw-art-swatches"><span /><span /><span /><span /></div>
        <div className="fw-art-type"><strong>Aa</strong><i className="w60" /><i className="w40" /></div>
      </div>
    )
  }
  if (type === "whiteboard") {
    return (
      <div className="fw-art fw-art-board">
        <span className="n1" /><span className="n2" /><span className="n3" /><span className="note" />
        <svg viewBox="0 0 120 70" aria-hidden="true"><path d="M30 22 C 50 22, 50 46, 70 46" /><path d="M78 40 C 90 30, 92 22, 98 20" /></svg>
      </div>
    )
  }
  return (
    <div className="fw-art fw-art-design">
      <div className="fw-art-nav"><i /><i /><i /></div>
      <div className="fw-art-hero"><i className="w70" /><i className="w50" /><b /></div>
      <div className="fw-art-cards"><span /><span /><span /></div>
    </div>
  )
}

function CreateDialog({ type, open, onClose }) {
  const { addChat, toast, projects, models, user } = useStore()
  const navigate = useNavigate()
  const [name, setName] = useState("")
  const [about, setAbout] = useState("")
  const [project, setProject] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const info = DESIGN_TYPES.find((item) => item.key === type) || DESIGN_TYPES[1]
  const settings = (user && user.settings) || {}

  useEffect(() => {
    if (open) {
      setName("")
      setAbout("")
      setError("")
      setBusy(false)
    }
  }, [open])

  async function create(event) {
    if (event) event.preventDefault()
    const title = name.trim()
    if (!title) {
      setError("Give it a name")
      return
    }
    setBusy(true)
    try {
      const model = settings.model || (models[0] && models[0].key) || ""
      const data = await api.post("/api/chats", { project_id: project, model, mode: "auto", kind: "design" })
      const chat = data.chat
      await api.patch("/api/chats/" + chat.id, { title }).catch(() => {})
      addChat({ ...chat, title })
      rememberType(chat.id, info.key)
      onClose()
      navigate("/app/c/" + chat.id, { state: { first: { text: info.prompt(title, about.trim()), files: [], mode: "auto", model } } })
    } catch (problem) {
      toast(problem.message, "error")
      setBusy(false)
    }
  }

  const Icon = info.icon
  return (
    <Dialog open={open} onClose={onClose} size="md" title={<span className="fw-dialog-titlerow"><span className="fw-dialog-ico"><Icon size={15} /></span>{info.title}</span>}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={busy} onClick={create}>Create</Button>
      </>}>
      <form onSubmit={create}>
        <Field label="Name" error={error}>
          <Input data-autofocus value={name} placeholder={info.namePlaceholder} onChange={(e) => { setName(e.target.value); setError("") }} maxLength={120} className={error ? "is-invalid" : ""} />
        </Field>
        <Field label="What is it about?" hint="Optional. The more context, the better the first draft.">
          <Textarea value={about} placeholder={info.aboutPlaceholder} onChange={(e) => setAbout(e.target.value)} rows={4} onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) create() }} />
        </Field>
        {projects.length > 0 && (
          <Field label="Project" hint={info.key === "codebase" ? "Pick the project whose code should change." : "Optional"}>
            <Select value={project} onChange={setProject} width="100%" options={[{ value: "", label: "No project" }, ...projects.map((item) => ({ value: item.id, label: item.name }))]} />
          </Field>
        )}
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}

export default function Design() {
  const { chats, chatsReady } = useStore()
  const [creating, setCreating] = useState("")
  const [filter, setFilter] = useState("all")
  const [query, setQuery] = useState("")
  const types = useMemo(readTypes, [chats])
  const anchor = useRef(null)
  const lastType = useRef("design")
  if (creating) lastType.current = creating
  const designs = chats.filter((item) => item.kind === "design")
  const needle = query.trim().toLowerCase()
  const shown = designs.filter((item) => (filter === "all" || (types[item.id] || "design") === filter) && (!needle || item.title.toLowerCase().includes(needle)))

  return (
    <div className="fw-page fw-page-enter">
      <div className="fw-design">
        <header className="fw-design-head">
          <div>
            <h1>Design</h1>
            <p>Slides, screens, design systems and whiteboards. Forkwise builds each one as real files you can preview, edit and export.</p>
          </div>
        </header>

        <section>
          <h2 className="fw-section-label">Make something new</h2>
          <div className="fw-make-grid">
            {DESIGN_TYPES.map((item) => (
              <button key={item.key} type="button" className="fw-make" onClick={() => setCreating(item.key)}>
                <Art type={item.key} />
                <span className="fw-make-text">
                  <span className="fw-make-title">{item.label}{item.beta && <Badge tone="blue">Beta</Badge>}</span>
                  <span className="fw-make-blurb">{item.blurb}</span>
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="fw-design-recent">
          <div className="fw-design-bar" ref={anchor}>
            <h2 className="fw-section-label">Recent</h2>
            <div className="fw-design-tools">
              <Tabs value={filter} onChange={setFilter} tabs={[{ value: "all", label: "All" }, ...DESIGN_TYPES.map((item) => ({ value: item.key, label: item.label }))]} />
              <Input size="sm" icon={Search} placeholder="Search designs" value={query} onChange={(e) => setQuery(e.target.value)} className="fw-design-search" />
            </div>
          </div>
          {!chatsReady && <Skeleton lines={3} />}
          {chatsReady && designs.length === 0 && (
            <Empty icon={LayoutTemplate} title="Your designs will live here" text="Pick a format above to start your first one." />
          )}
          {chatsReady && designs.length > 0 && shown.length === 0 && <Empty icon={Search} title="Nothing matches" text="Try another name or filter." />}
          <div className="fw-recent-grid">
            {shown.map((item) => {
              const type = types[item.id] || "design"
              const info = DESIGN_TYPES.find((entry) => entry.key === type) || DESIGN_TYPES[1]
              const Icon = info.icon
              return (
                <Link key={item.id} to={"/app/c/" + item.id} className="fw-dthumb">
                  <span className={cx("fw-dthumb-art", item.running && "is-live")}><Art type={type} /></span>
                  <span className="fw-dthumb-meta">
                    <span className="fw-dthumb-title" dir="auto">{item.title}</span>
                    <span className="fw-dthumb-sub"><Icon size={12} />{info.label} · {item.running ? "Working" : ago(item.updated_at)}</span>
                  </span>
                </Link>
              )
            })}
          </div>
        </section>
      </div>
      <CreateDialog key={lastType.current} type={lastType.current} open={Boolean(creating)} onClose={() => setCreating("")} />
    </div>
  )
}

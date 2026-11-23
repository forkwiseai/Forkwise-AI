import { useEffect, useRef, useState } from "react"
import { Link, useNavigate, useSearchParams } from "react-router-dom"
import { ArrowUpRight, Bug, Cloud, Code2, FileSpreadsheet, FolderKanban, FolderOpen, Github, Globe, Laptop, LayoutTemplate, ListChecks, Mail, MessageSquare, Monitor, Palette, Plus, Rocket, Search, Server, Sparkles, Wand2, X } from "lucide-react"
import Composer from "../../components/app/Composer"
import { useStore } from "../../lib/store"
import { api } from "../../lib/api"
import { desktopApp, ensureLinked } from "../../lib/desktop"
import { TEMPLATES } from "../../content/catalog"
import { NewProjectDialog } from "./Projects"
import { Badge, Kbd, MenuItem, MenuLabel, MenuSep, Popover, Skeleton, cx } from "../../dash/kit"
import { KIND_ICON } from "../../dash/Sidebar"

const STARTERS = {
  chat: [
    { icon: Globe, title: "Research a topic", text: "Live web search with sources", prompt: "Research the current state of the electric scooter market in Europe: main brands, prices and regulation. Give me sources for every claim." },
    { icon: FileSpreadsheet, title: "Analyse a spreadsheet", text: "Clean, chart and explain your data", prompt: "I will attach a CSV. Clean it, find the main trends and build an interactive dashboard I can open." },
    { icon: LayoutTemplate, title: "Build a website", text: "Design, build and preview a site", prompt: "Build a modern landing page for a specialty coffee shop with a menu, a gallery and a contact form, then show me the live preview." },
    { icon: Sparkles, title: "Teach Forkwise a skill", text: "Save a reusable tool for later", prompt: "Make yourself a permanent tool that converts any currency with a free public API, test it, and tell me how to use it." },
  ],
  code: [
    { icon: Server, title: "Build a backend", text: "API, database and tests", prompt: "Build a REST API with FastAPI and SQLite for a todo list with users. Run it, test every endpoint and show me the results." },
    { icon: Rocket, title: "Deploy my prototype", text: "Put it on a live link", prompt: "Take the project in this workspace, make sure it builds, start it and give me a live preview link I can share." },
    { icon: ListChecks, title: "Start with a plan", text: "Agree on the approach before code", prompt: "/plan " },
    { icon: Bug, title: "Debug an issue", text: "Find the root cause and fix it", prompt: "I will paste an error and the code around it. Find the root cause, fix it, and run the code to prove it works." },
  ],
  design: [
    { icon: LayoutTemplate, title: "Landing page", text: "Hero, features, pricing, contact", prompt: "Design a modern landing page for a software product with a hero, features, pricing and a contact form. Ask me for the product name first." },
    { icon: Monitor, title: "Dashboard screen", text: "Sidebar, charts and tables", prompt: "Design an analytics dashboard with a sidebar, summary cards, a line chart and a recent activity table. Dark theme." },
    { icon: Wand2, title: "Redesign a page", text: "Attach a screenshot to improve", prompt: "I will attach a screenshot of a page. Rebuild it with a cleaner, more modern design and show me both versions." },
    { icon: Palette, title: "Portfolio", text: "Personal site with projects", prompt: "Design a personal portfolio with an about section, selected projects, skills and a contact section." },
  ],
}

const COPY = {
  chat: { title: null, placeholder: "Plan, build, or ask anything. / for commands and skills" },
  code: { title: "What are we building?", placeholder: "Plan, build, debug. / for skills" },
  design: { title: "What should we design?", placeholder: "Describe a page, screen or style. / for skills" },
}

function ago(seconds) {
  const diff = Math.max(0, Date.now() / 1000 - seconds)
  if (diff < 60) return "Just now"
  if (diff < 3600) return Math.floor(diff / 60) + "m ago"
  if (diff < 86400) return Math.floor(diff / 3600) + "h ago"
  if (diff < 86400 * 7) return Math.floor(diff / 86400) + "d ago"
  return new Date(seconds * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
}

function greeting(name) {
  const hour = new Date().getHours()
  const first = (name || "").split(" ")[0]
  const part = hour < 5 ? "Working late" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"
  return first ? part + ", " + first : part
}

function Picker({ icon: Icon, label, children, width = 240 }) {
  const [open, setOpen] = useState(false)
  const anchor = useRef(null)
  return (
    <>
      <button ref={anchor} type="button" className={cx("fw-ctx", open && "is-open")} onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open}>
        <Icon size={14} /><span dir="auto">{label}</span>
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchor} width={width}>
        <div onClick={() => setOpen(false)}>{children}</div>
      </Popover>
    </>
  )
}

export default function Home({ kind }) {
  const section = kind || "chat"
  const copy = COPY[section]
  const { user, models, addChat, toast, projects, chats, chatsReady } = useStore()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const projectId = params.get("project") || ""
  const project = projects.find((item) => item.id === projectId)
  const [mode, setMode] = useState("auto")
  const settings = (user && user.settings) || {}
  const [model, setModel] = useState(settings.model || (models[0] && models[0].key) || "")
  const [seed, setSeed] = useState(null)
  const pending = useRef(null)
  const [newProject, setNewProject] = useState(false)
  const desktop = desktopApp()
  const [folder, setFolder] = useState(null)
  const [recent, setRecent] = useState([])
  const [picking, setPicking] = useState(false)

  useEffect(() => {
    pending.current = null
  }, [projectId, section])

  useEffect(() => {
    if (desktop) desktop.recentFolders().then((list) => setRecent(list || [])).catch(() => {})
  }, [desktop])

  async function chooseFolder(item) {
    setPicking(true)
    try {
      const device = await ensureLinked()
      const chosen = item || (await desktop.pickFolder())
      if (chosen) {
        pending.current = null
        setFolder({ path: chosen.path, name: chosen.name, device: device.id })
        setMode("ask")
      }
    } catch (problem) {
      toast(problem.message, "error")
    }
    setPicking(false)
  }

  function useCloud() {
    pending.current = null
    setFolder(null)
    setMode("auto")
  }

  useEffect(() => {
    if (params.get("folder") && desktop) {
      navigate("/app", { replace: true })
      chooseFolder(null)
    }
  }, [params])

  useEffect(() => {
    const template = TEMPLATES.find((item) => item.slug === params.get("template"))
    if (template) setSeed({ value: template.prompt })
    else if (params.get("prompt")) setSeed({ value: params.get("prompt") })
    else {
      let saved = ""
      try {
        saved = localStorage.getItem("fw-pending-prompt") || ""
        localStorage.removeItem("fw-pending-prompt")
      } catch (problem) {
        saved = ""
      }
      if (saved) setSeed({ value: saved })
    }
  }, [params])

  async function ensureChat() {
    if (pending.current) return pending.current
    const body = { project_id: projectId, model, mode, kind: section }
    if (folder) {
      body.local_path = folder.path
      body.local_device = folder.device
    }
    pending.current = api.post("/api/chats", body).then((data) => {
      addChat(data.chat)
      return data.chat
    }).catch((problem) => {
      pending.current = null
      throw problem
    })
    return pending.current
  }

  async function getWorkspace() {
    const chat = await ensureChat()
    const data = await api.get("/api/chats/" + chat.id)
    return data.chat.workspace_id
  }

  async function send(text, files, extra) {
    try {
      const chat = await ensureChat()
      navigate("/app/c/" + chat.id, { state: { first: { text, files, mode, model, effort: extra && extra.effort, skills: extra && extra.skills } } })
    } catch (problem) {
      toast(problem.message, "error")
    }
  }

  async function startVoice() {
    try {
      const chat = await ensureChat()
      navigate("/app/c/" + chat.id, { state: { voice: true } })
    } catch (problem) {
      toast(problem.message, "error")
    }
  }

  function pickProject(id) {
    const next = new URLSearchParams(params)
    if (id) next.set("project", id)
    else next.delete("project")
    setParams(next, { replace: true })
  }

  function starter(item) {
    if (item.prompt === "/plan ") {
      setMode("plan")
      setSeed({ value: "" })
      return
    }
    setSeed({ value: item.prompt })
  }

  const mine = chats.filter((item) => section === "chat" || (item.kind || "chat") === section)
  const running = chats.filter((item) => item.running)
  const Kind = KIND_ICON[section] || MessageSquare

  return (
    <div className="fw-home fw-page-enter">
      <div className="fw-home-hero">
        <h1 className="fw-home-title">
          {section === "chat" ? <span dir="auto">{greeting(user && user.name)}</span> : <><span className="fw-home-kind"><Kind size={17} /></span><span>{copy.title}</span></>}
        </h1>
        <div className="fw-ctx-row">
          <Picker icon={FolderKanban} label={project ? project.name : "No project"}>
            <MenuLabel>Project</MenuLabel>
            <MenuItem active={!projectId} onClick={() => pickProject("")}>No project</MenuItem>
            {projects.slice(0, 8).map((item) => <MenuItem key={item.id} icon={FolderKanban} active={item.id === projectId} onClick={() => pickProject(item.id)}>{item.name}</MenuItem>)}
            <MenuSep />
            <MenuItem icon={Plus} onClick={() => setNewProject(true)}>New project</MenuItem>
          </Picker>
          <Picker icon={folder ? Laptop : Cloud} label={folder ? folder.name : "Cloud computer"} width={280}>
            <MenuLabel>Where Forkwise works</MenuLabel>
            <MenuItem icon={Cloud} active={!folder} hint="Private Linux machine" onClick={useCloud}>Cloud computer</MenuItem>
            {desktop ? (
              <>
                <MenuItem icon={FolderOpen} disabled={picking} hint="Pick a folder" onClick={() => chooseFolder(null)}>This computer</MenuItem>
                {recent.slice(0, 4).map((item) => <MenuItem key={item.path} icon={Laptop} active={folder && folder.path === item.path} onClick={() => chooseFolder(item)}>{item.name}</MenuItem>)}
              </>
            ) : (
              <MenuItem icon={Laptop} hint="Needs the desktop app" onClick={() => navigate("/download")}>This computer</MenuItem>
            )}
          </Picker>
          {folder && <button type="button" className="fw-ctx fw-ctx-x" aria-label="Back to cloud computer" onClick={useCloud}><X size={13} /></button>}
        </div>
        <Composer
          big
          placeholder={copy.placeholder}
          onSend={send}
          onVoiceMode={startVoice}
          running={false}
          mode={mode}
          onMode={setMode}
          model={model}
          onModel={setModel}
          models={models}
          getWorkspace={getWorkspace}
          initialText={seed}
          onCommand={(cmd) => {
            if (cmd === "/plan") setMode("plan")
            if (cmd === "/auto") setMode("auto")
            if (cmd === "/ask") setMode("ask")
            if (cmd === "/memory") navigate("/app/customize/memory")
            if (cmd === "/abilities") navigate("/app/customize/abilities")
          }}
        />
        {models.length === 0 && <div className="fw-alert">No AI model is set up on the server yet. Add LLM_API_KEY and LLM_MODELS to the server settings.</div>}
        <div className="fw-starters">
          {STARTERS[section].map((item) => {
            const Icon = item.icon
            return (
              <button key={item.title} type="button" className="fw-starter" title={item.text} onClick={() => starter(item)}>
                <Icon size={14} /><span>{item.title}</span>
              </button>
            )
          })}
        </div>
      </div>

      <section className="fw-recent">
        <header>
          <h3>{running.length > 0 ? "Working now" : "Recent"}</h3>
          <button type="button" className="fw-recent-link" onClick={() => window.dispatchEvent(new CustomEvent("fw-search", { detail: { tab: "chats" } }))}>View all<Kbd>Ctrl K</Kbd></button>
        </header>
        {!chatsReady && <Skeleton lines={4} />}
        {chatsReady && mine.length === 0 && <p className="fw-recent-empty">Your chats show up here after you send the first message.</p>}
        <div className="fw-recent-list">
          {[...running, ...mine.filter((item) => !item.running)].slice(0, 6).map((chat) => {
            const Icon = KIND_ICON[chat.kind] || MessageSquare
            const where = chat.project_id ? (projects.find((item) => item.id === chat.project_id) || {}).name : ""
            return (
              <Link key={chat.id} to={"/app/c/" + chat.id} className="fw-recent-item">
                <span className="fw-recent-icon">{chat.running ? <span className="fw-live-dot" /> : <Icon size={14} />}</span>
                <span className="fw-recent-title" dir="auto">{chat.title}</span>
                {where && <span className="fw-recent-tag"><FolderKanban size={11} />{where}</span>}
                {chat.running ? <Badge tone="blue">Working</Badge> : chat.mode === "plan" ? <Badge tone="amber">Plan</Badge> : null}
                <span className="fw-recent-meta">{ago(chat.updated_at)}</span>
              </Link>
            )
          })}
        </div>
      </section>
      <NewProjectDialog open={newProject} onClose={() => setNewProject(false)} />
    </div>
  )
}

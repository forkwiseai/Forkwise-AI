import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useNavigate } from "react-router-dom"
import { ArrowRight, BookOpen, CalendarClock, Code2, CornerDownLeft, FolderKanban, Gauge, KeyRound, Link2, MessageSquare, Moon, Palette, Plus, Search as SearchIcon, Settings, ShieldCheck, Sparkles, Sun, User } from "lucide-react"
import { useStore } from "../lib/store"
import { api } from "../lib/api"
import { Kbd, Spinner, cx } from "./kit"

export function openSearch(tab) {
  window.dispatchEvent(new CustomEvent("fw-search", { detail: { tab: tab || "all" } }))
}

const TABS = [
  { value: "all", label: "All" },
  { value: "chats", label: "Chats" },
  { value: "projects", label: "Projects" },
  { value: "actions", label: "Actions" },
]

const KIND = { code: Code2, design: Palette, chat: MessageSquare }

function ago(seconds) {
  const diff = Math.max(0, Date.now() / 1000 - seconds)
  if (diff < 60) return "now"
  if (diff < 3600) return Math.floor(diff / 60) + "m"
  if (diff < 86400) return Math.floor(diff / 3600) + "h"
  if (diff < 86400 * 30) return Math.floor(diff / 86400) + "d"
  return new Date(seconds * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
}

export default function Search() {
  const { chats, projects, user, theme, setTheme } = useStore()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState("all")
  const [query, setQuery] = useState("")
  const [index, setIndex] = useState(0)
  const [found, setFound] = useState(null)
  const [loading, setLoading] = useState(false)
  const input = useRef(null)
  const list = useRef(null)

  useEffect(() => {
    function show(event) {
      setTab((event.detail && event.detail.tab) || "all")
      setOpen(true)
    }
    function key(event) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        setTab("all")
        setOpen((value) => !value)
      }
    }
    window.addEventListener("fw-search", show)
    window.addEventListener("keydown", key)
    return () => {
      window.removeEventListener("fw-search", show)
      window.removeEventListener("keydown", key)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    setQuery("")
    setIndex(0)
    setFound(null)
    setTimeout(() => input.current && input.current.focus(), 20)
  }, [open])

  useEffect(() => {
    const text = query.trim()
    if (!open || text.length < 2) {
      setFound(null)
      setLoading(false)
      return undefined
    }
    setLoading(true)
    const timer = setTimeout(async () => {
      try {
        const data = await api.get("/api/search?q=" + encodeURIComponent(text))
        setFound(data.results || [])
      } catch (problem) {
        setFound(null)
      }
      setLoading(false)
    }, 200)
    return () => clearTimeout(timer)
  }, [query, open])

  const sections = useMemo(() => {
    const text = query.trim().toLowerCase()
    const match = (value) => !text || String(value).toLowerCase().includes(text)
    const actions = [
      { label: "New chat", icon: Plus, run: () => navigate("/app"), kbd: "" },
      { label: "New code session", icon: Code2, run: () => navigate("/app/code") },
      { label: "New design", icon: Palette, run: () => navigate("/app/design") },
      { label: "New project", icon: FolderKanban, run: () => navigate("/app/projects?new=1") },
      { label: "Automations", icon: CalendarClock, run: () => navigate("/app/automations") },
      { label: "Skills and memory", icon: Sparkles, run: () => navigate("/app/customize") },
      { label: "Connected accounts", icon: Link2, run: () => navigate("/app/settings/connections") },
      { label: "Secrets", icon: KeyRound, run: () => navigate("/app/settings/secrets") },
      { label: "Profile", icon: User, run: () => navigate("/app/settings") },
      { label: "Settings", icon: Settings, run: () => navigate("/app/settings"), kbd: "Ctrl ," },
      { label: "Plan and usage", icon: Gauge, run: () => navigate("/app/billing") },
      { label: theme === "dark" ? "Switch to light theme" : "Switch to dark theme", icon: theme === "dark" ? Sun : Moon, run: () => setTheme(theme === "dark" ? "light" : "dark") },
      { label: "Help and docs", icon: BookOpen, run: () => window.open("/docs", "_blank", "noreferrer") },
    ]
    if (user && user.is_admin) actions.push({ label: "Admin", icon: ShieldCheck, run: () => navigate("/app/admin") })
    const chatSource = found || chats
    const chatItems = chatSource.filter((chat) => found || match(chat.title)).slice(0, tab === "chats" ? 40 : 8).map((chat) => ({
      label: chat.title, icon: KIND[chat.kind] || MessageSquare, meta: ago(chat.updated_at), live: chat.running, run: () => navigate("/app/c/" + chat.id),
    }))
    const projectItems = projects.filter((item) => match(item.name)).slice(0, tab === "projects" ? 40 : 5).map((item) => ({
      label: item.name, icon: FolderKanban, meta: (item.chats || 0) + " chats", run: () => navigate("/app/projects/" + item.id),
    }))
    const actionItems = actions.filter((item) => match(item.label)).slice(0, tab === "actions" ? 40 : 6)
    const out = []
    if ((tab === "all" || tab === "chats") && chatItems.length) out.push({ title: text ? "Chats" : "Recent chats", items: chatItems })
    if ((tab === "all" || tab === "projects") && projectItems.length) out.push({ title: "Projects", items: projectItems })
    if ((tab === "all" || tab === "actions") && actionItems.length) out.push({ title: "Actions", items: actionItems })
    return out
  }, [query, chats, projects, found, user, tab, theme, navigate, setTheme])

  const flat = useMemo(() => sections.flatMap((section) => section.items), [sections])

  useEffect(() => setIndex(0), [query, tab])

  useEffect(() => {
    if (!list.current) return
    const node = list.current.querySelector(".is-kb")
    if (node) node.scrollIntoView({ block: "nearest" })
  }, [index])

  function choose(item) {
    setOpen(false)
    item.run()
  }

  function cycle(step) {
    const position = TABS.findIndex((item) => item.value === tab)
    setTab(TABS[(position + step + TABS.length) % TABS.length].value)
  }

  function onKey(event) {
    if (event.key === "Escape") { event.preventDefault(); setOpen(false) }
    else if (event.key === "ArrowDown") { event.preventDefault(); setIndex((index + 1) % Math.max(flat.length, 1)) }
    else if (event.key === "ArrowUp") { event.preventDefault(); setIndex((index - 1 + flat.length) % Math.max(flat.length, 1)) }
    else if (event.key === "Tab") { event.preventDefault(); cycle(event.shiftKey ? -1 : 1) }
    else if ((event.key === "ArrowRight" || event.key === "ArrowLeft") && !query) { event.preventDefault(); cycle(event.key === "ArrowRight" ? 1 : -1) }
    else if (event.key === "Enter" && flat[index]) { event.preventDefault(); choose(flat[index]) }
  }

  if (!open) return null
  let position = -1
  return createPortal(
    <div className="fw fw-portal">
      <div className="fw-overlay" onMouseDown={() => setOpen(false)} />
      <div className="fw-cmd" role="dialog" aria-modal="true" aria-label="Search" onKeyDown={onKey}>
        <div className="fw-cmd-input">
          <SearchIcon size={18} />
          <input ref={input} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search chats, projects and actions" dir="auto" aria-label="Search" />
          {loading && <Spinner size={15} />}
        </div>
        <div className="fw-cmd-tabs" role="tablist">
          {TABS.map((item) => (
            <button key={item.value} type="button" role="tab" aria-selected={tab === item.value} className={tab === item.value ? "is-on" : ""} onClick={() => { setTab(item.value); input.current && input.current.focus() }}>{item.label}</button>
          ))}
        </div>
        <div className="fw-cmd-list" ref={list}>
          {flat.length === 0 && (
            <div className="fw-cmd-empty">{loading ? "Searching" : query ? "Nothing matches “" + query + "”" : "Nothing here yet"}</div>
          )}
          {sections.map((section) => (
            <div key={section.title} className="fw-cmd-section">
              <div className="fw-cmd-label">{section.title}</div>
              {section.items.map((item) => {
                position += 1
                const me = position
                const Icon = item.icon
                return (
                  <button key={section.title + me} type="button" className={cx("fw-cmd-item", me === index && "is-kb")} onMouseMove={() => setIndex(me)} onClick={() => choose(item)}>
                    {item.live ? <span className="fw-cmd-icon"><span className="fw-live-dot" /></span> : <span className="fw-cmd-icon"><Icon size={16} /></span>}
                    <span className="fw-cmd-text" dir="auto">{item.label}</span>
                    {item.meta && <span className="fw-cmd-meta">{item.meta}</span>}
                    {item.kbd && <Kbd>{item.kbd}</Kbd>}
                    {me === index && <CornerDownLeft size={14} className="fw-cmd-enter" />}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
        <div className="fw-cmd-foot">
          <span><Kbd>Esc</Kbd>Close</span>
          <span><Kbd>Tab</Kbd>Change type</span>
          <span><Kbd>↑ ↓</Kbd>Move</span>
          <span className="fw-cmd-foot-end"><Kbd>↵</Kbd>Open<ArrowRight size={12} /></span>
        </div>
      </div>
    </div>,
    document.body
  )
}

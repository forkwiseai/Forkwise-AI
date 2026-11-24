import { useEffect, useMemo, useRef, useState } from "react"
import { Link, useLocation, useNavigate, useParams } from "react-router-dom"
import { Blocks, BookOpen, CalendarClock, Check, ChevronDown, ChevronLeft, ChevronRight, Code2, Download, ExternalLink, FolderInput, Link2, FolderKanban, Gauge, LogOut, MessageSquare, Moon, MoreHorizontal, PanelLeftClose, Palette, Pencil, Pin, PinOff, Plus, Search, Settings, ShieldCheck, Sparkles, SquarePen, Sun, Trash2, X, Zap } from "lucide-react"
import { useStore } from "../lib/store"
import { api } from "../lib/api"
import { LogoMark } from "../components/ui/Logo"
import Avatar from "./Avatar"
import { IconButton, Kbd, Meter, MenuItem, MenuLabel, MenuSep, Popover, Segmented, Spinner, cx, useConfirm } from "./kit"
import { openSearch } from "./Search"

const NAV = [
  { key: "code", label: "Code", icon: Code2, to: "/app/code" },
  { key: "design", label: "Design", icon: Palette, to: "/app/design" },
  { key: "projects", label: "Projects", icon: FolderKanban, to: "/app/projects" },
  { key: "plugins", label: "Plugins", icon: Blocks, to: "/app/plugins" },
  { key: "automations", label: "Automations", icon: CalendarClock, to: "/app/automations" },
  { key: "customize", label: "Customize", icon: Sparkles, to: "/app/customize" },
]

const FILTERS = [
  { value: "all", label: "All" },
  { value: "chat", label: "Chats" },
  { value: "code", label: "Code" },
  { value: "design", label: "Design" },
]

export const KIND_ICON = { chat: MessageSquare, code: Code2, design: Palette }

function groupChats(chats) {
  const now = Date.now() / 1000
  const groups = [
    { label: "Pinned", items: [] },
    { label: "Today", items: [] },
    { label: "Yesterday", items: [] },
    { label: "Previous 7 days", items: [] },
    { label: "Previous 30 days", items: [] },
    { label: "Older", items: [] },
  ]
  for (const chat of chats) {
    const age = now - chat.updated_at
    if (chat.pinned) groups[0].items.push(chat)
    else if (age < 86400) groups[1].items.push(chat)
    else if (age < 2 * 86400) groups[2].items.push(chat)
    else if (age < 7 * 86400) groups[3].items.push(chat)
    else if (age < 30 * 86400) groups[4].items.push(chat)
    else groups[5].items.push(chat)
  }
  return groups.filter((group) => group.items.length > 0)
}

export function useChatActions(chat) {
  const { patchChat, removeChat, toast } = useStore()
  const confirm = useConfirm()
  const navigate = useNavigate()
  const params = useParams()
  return {
    async rename(title) {
      const next = (title || "").trim()
      if (!next || next === chat.title) return
      try {
        await api.patch("/api/chats/" + chat.id, { title: next })
        patchChat(chat.id, { title: next })
      } catch (problem) {
        toast(problem.message, "error")
      }
    },
    async pin() {
      try {
        await api.patch("/api/chats/" + chat.id, { pinned: !chat.pinned })
        patchChat(chat.id, { pinned: !chat.pinned })
      } catch (problem) {
        toast(problem.message, "error")
      }
    },
    async move(projectId) {
      try {
        await api.patch("/api/chats/" + chat.id, { project_id: projectId || "" })
        patchChat(chat.id, { project_id: projectId || null })
        toast(projectId ? "Moved to project" : "Removed from project", "ok")
      } catch (problem) {
        toast(problem.message, "error")
      }
    },
    copyLink() {
      const link = window.location.origin + "/app/c/" + chat.id
      navigator.clipboard.writeText(link).then(() => toast("Link copied. Only you can open it.", "ok")).catch(() => toast("Couldn't copy the link", "error"))
    },
    async exportMarkdown() {
      try {
        const data = await api.get("/api/chats/" + chat.id)
        const lines = ["# " + chat.title, ""]
        for (const message of data.messages || []) {
          if ((message.role !== "user" && message.role !== "assistant") || !message.content) continue
          lines.push("## " + (message.role === "user" ? "You" : "Forkwise"), "", message.content, "")
        }
        const blob = new Blob([lines.join("\n")], { type: "text/markdown" })
        const url = URL.createObjectURL(blob)
        const link = document.createElement("a")
        link.href = url
        link.download = (chat.title || "chat").replace(/[^\w\u0600-\u06FF -]+/g, "").trim().slice(0, 60) + ".md"
        link.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      } catch (problem) {
        toast(problem.message, "error")
      }
    },
    async remove() {
      const sure = await confirm({ title: "Delete this chat?", text: "The conversation and the files it made are removed for good.", confirmLabel: "Delete", danger: true })
      if (!sure) return
      try {
        await api.del("/api/chats/" + chat.id)
        removeChat(chat.id)
        toast("Chat deleted", "ok")
        if (params.chatId === chat.id) navigate("/app")
      } catch (problem) {
        toast(problem.message, "error")
      }
    },
  }
}

function ChatRow({ chat, active, onNavigate }) {
  const [menu, setMenu] = useState(false)
  const [view, setView] = useState("main")
  const { projects } = useStore()
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(chat.title)
  const more = useRef(null)
  const actions = useChatActions(chat)
  const Icon = KIND_ICON[chat.kind] || MessageSquare

  useEffect(() => setTitle(chat.title), [chat.title])

  function save() {
    setEditing(false)
    actions.rename(title)
  }

  if (editing) {
    return (
      <div className="fw-sb-chat is-editing">
        <input autoFocus dir="auto" value={title} aria-label="Chat name" onChange={(e) => setTitle(e.target.value)} onBlur={save}
          onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") { setTitle(chat.title); setEditing(false) } }} />
      </div>
    )
  }

  return (
    <div className={cx("fw-sb-chat", active && "is-active", menu && "is-menu")}>
      <Link to={"/app/c/" + chat.id} onClick={onNavigate} title={chat.title} onDoubleClick={(e) => { e.preventDefault(); setEditing(true) }}>
        {chat.running ? <span className="fw-live-dot" aria-label="Working" /> : <Icon size={14} className="fw-sb-chat-icon" />}
        <span className="fw-sb-chat-title" dir="auto">{chat.title}</span>
      </Link>
      <button ref={more} type="button" className="fw-sb-chat-more" aria-label="Chat options" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
        <MoreHorizontal size={15} />
      </button>
      <Popover open={menu} onClose={() => { setMenu(false); setView("main") }} anchorRef={more} align="start" width={220}>
        {view === "main" ? (
          <>
            <MenuItem icon={chat.pinned ? PinOff : Pin} onClick={() => { setMenu(false); actions.pin() }}>{chat.pinned ? "Unpin" : "Pin to top"}</MenuItem>
            <MenuItem icon={Pencil} onClick={() => { setMenu(false); setEditing(true) }}>Rename</MenuItem>
            <MenuItem icon={FolderInput} right={<ChevronRight size={14} />} onClick={() => setView("move")}>Move to project</MenuItem>
            <MenuSep />
            <MenuItem icon={ExternalLink} onClick={() => { setMenu(false); window.open("/app/c/" + chat.id, "_blank", "noopener") }}>Open in new tab</MenuItem>
            <MenuItem icon={Link2} onClick={() => { setMenu(false); actions.copyLink() }}>Copy link</MenuItem>
            <MenuItem icon={Download} onClick={() => { setMenu(false); actions.exportMarkdown() }}>Export as Markdown</MenuItem>
            <MenuSep />
            <MenuItem icon={Trash2} danger onClick={() => { setMenu(false); actions.remove() }}>Delete</MenuItem>
          </>
        ) : (
          <>
            <MenuItem icon={ChevronLeft} onClick={() => setView("main")}>Back</MenuItem>
            <MenuSep />
            <div className="fw-pop-scroll" style={{ maxHeight: 240 }}>
              {chat.project_id && <MenuItem icon={X} onClick={() => { setMenu(false); setView("main"); actions.move("") }}>Remove from project</MenuItem>}
              {projects.length === 0 && <div className="fw-pop-empty">No projects yet</div>}
              {projects.map((item) => (
                <MenuItem key={item.id} icon={FolderKanban} active={item.id === chat.project_id} right={item.id === chat.project_id ? <Check size={14} className="fw-mi-check" /> : null} onClick={() => { setMenu(false); setView("main"); if (item.id !== chat.project_id) actions.move(item.id) }}>{item.name}</MenuItem>
              ))}
            </div>
            <MenuSep />
            <MenuItem icon={Plus} onClick={() => { setMenu(false); setView("main"); navigate("/app/projects?new=1") }}>New project</MenuItem>
          </>
        )}
      </Popover>
    </div>
  )
}

function planName(plan) {
  return (plan || "free").charAt(0).toUpperCase() + (plan || "free").slice(1)
}

function Account({ onNavigate }) {
  const { user, signOut, theme, setTheme, limits } = useStore()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [plan, setPlan] = useState("free")
  const anchor = useRef(null)

  useEffect(() => {
    api.get("/api/billing").then((data) => setPlan(data.plan || "free")).catch(() => setPlan("free"))
  }, [])

  async function logout() {
    try {
      await api.post("/api/auth/logout")
    } catch (problem) {
      // signed out locally either way
    }
    signOut()
    navigate("/")
  }

  function go(path) {
    setOpen(false)
    onNavigate()
    navigate(path)
  }

  const dayPct = limits && limits.day ? Math.min(100, limits.day.used_pct || 0) : 0
  const weekPct = limits && limits.week ? Math.min(100, limits.week.used_pct || 0) : 0
  const showUsage = limits && (plan === "free" || dayPct >= 50 || weekPct >= 50)
  return (
    <div className="fw-sb-foot">
      {showUsage && (
        <div className="fw-sb-usage">
          <div className="fw-sb-usage-top">
            <span>{"Today " + Math.round(dayPct) + "% · Week " + Math.round(weekPct) + "%"}</span>
            {plan !== "premium" && <button type="button" className="fw-link-btn" onClick={() => go("/app/billing")}><Zap size={12} />Upgrade</button>}
          </div>
          <Meter value={Math.max(dayPct, weekPct)} max={100} />
        </div>
      )}
      <div className="fw-sb-me-row">
        <button ref={anchor} type="button" className="fw-sb-me" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
          <Avatar user={user} size={28} />
          <span className="fw-sb-me-text">
            <span className="fw-sb-me-name" dir="auto">{user.name || user.email}</span>
            <span className="fw-sb-me-plan">{planName(plan)} plan</span>
          </span>
          <ChevronDown size={14} />
        </button>
        <IconButton icon={Settings} label="Settings" onClick={() => go("/app/settings")} />
      </div>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchor} placement="top" width={268}>
        <div className="fw-acct-head">
          <Avatar user={user} size={34} />
          <div>
            <strong dir="auto">{user.name || "Your account"}</strong>
            <span>{user.email}</span>
          </div>
        </div>
        <MenuSep />
        <MenuItem icon={Settings} kbd="Ctrl ," onClick={() => go("/app/settings")}>Settings</MenuItem>
        <MenuItem icon={Gauge} onClick={() => go("/app/billing")} right={<span className="fw-badge">{planName(plan)}</span>}>Plan and usage</MenuItem>
        <MenuItem icon={Blocks} onClick={() => go("/app/plugins")}>Plugins</MenuItem>
        <MenuItem icon={Sparkles} onClick={() => go("/app/customize")}>Skills and memory</MenuItem>
        {user.is_admin && <MenuItem icon={ShieldCheck} onClick={() => go("/app/admin")}>Admin</MenuItem>}
        <MenuSep />
        <MenuLabel>Theme</MenuLabel>
        <div className="fw-acct-theme">
          <Segmented size="sm" value={theme} onChange={setTheme} options={[{ value: "dark", label: "Dark", icon: Moon }, { value: "light", label: "Light", icon: Sun }]} />
        </div>
        <MenuSep />
        <MenuItem icon={BookOpen} as="a" href="/docs" target="_blank" rel="noreferrer">Help and docs</MenuItem>
        <MenuItem icon={LogOut} onClick={logout}>Sign out</MenuItem>
      </Popover>
    </div>
  )
}

export default function Sidebar({ onCollapse, mobileOpen, onMobileClose }) {
  const { chats, chatsReady } = useStore()
  const params = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const [filter, setFilter] = useState(() => {
    try { return localStorage.getItem("fw-sb-filter") || "all" } catch (e) { return "all" }
  })
  const [filterOpen, setFilterOpen] = useState(false)
  const [starting, setStarting] = useState(false)
  const filterRef = useRef(null)
  const shown = useMemo(() => chats.filter((chat) => filter === "all" || (chat.kind || "chat") === filter), [chats, filter])
  const groups = useMemo(() => groupChats(shown), [shown])
  const path = location.pathname
  const running = chats.filter((chat) => chat.running).length

  function newChat() {
    onMobileClose()
    setStarting(true)
    navigate("/app", { state: { fresh: Date.now() } })
    setTimeout(() => setStarting(false), 350)
  }

  useEffect(() => {
    function key(event) {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "o") {
        event.preventDefault()
        newChat()
      }
    }
    window.addEventListener("keydown", key)
    return () => window.removeEventListener("keydown", key)
  })

  function pickFilter(value) {
    setFilter(value)
    setFilterOpen(false)
    try { localStorage.setItem("fw-sb-filter", value) } catch (e) { /* storage blocked */ }
  }

  return (
    <>
      <div className={cx("fw-scrim", mobileOpen && "is-on")} onClick={onMobileClose} />
      <nav className={cx("fw-sb", mobileOpen && "is-open")} aria-label="Main">
        <div className="fw-sb-top">
          <Link to="/app" className="fw-brand" onClick={onMobileClose}><LogoMark size={22} /><span>Forkwise</span></Link>
          <div className="fw-sb-top-actions">
            <IconButton icon={Search} label="Search (Ctrl K)" size="sm" onClick={() => { onMobileClose(); openSearch() }} />
            <IconButton icon={mobileOpen ? X : PanelLeftClose} label="Hide sidebar (Ctrl B)" size="sm" onClick={() => { if (mobileOpen) onMobileClose(); else onCollapse() }} />
          </div>
        </div>
        <div className="fw-sb-new">
          <button type="button" className={cx("fw-sb-newbtn", starting && "is-busy")} onClick={newChat} title="New chat (Ctrl Shift O)">
            {starting ? <Spinner size={15} /> : <SquarePen size={15} />}<span>New chat</span><Kbd>Ctrl Shift O</Kbd>
          </button>
        </div>
        <div className="fw-sb-nav">
          {NAV.map((item) => {
            const Icon = item.icon
            const active = path.indexOf(item.to) === 0
            return (
              <Link key={item.key} to={item.to} className={cx("fw-sb-link", active && "is-active")} onClick={onMobileClose}>
                <Icon size={16} /><span>{item.label}</span>
              </Link>
            )
          })}
        </div>
        <div className="fw-sb-section">
          <span>Recents{running > 0 && <span className="fw-sb-running"><span className="fw-live-dot" />{running} working</span>}</span>
          <button ref={filterRef} type="button" className="fw-sb-filter" onClick={() => setFilterOpen(!filterOpen)} aria-haspopup="menu" aria-expanded={filterOpen}>
            {FILTERS.find((item) => item.value === filter).label}<ChevronDown size={12} />
          </button>
          <Popover open={filterOpen} onClose={() => setFilterOpen(false)} anchorRef={filterRef} align="end" width={150}>
            {FILTERS.map((item) => <MenuItem key={item.value} active={filter === item.value} onClick={() => pickFilter(item.value)}>{item.label}</MenuItem>)}
          </Popover>
        </div>
        <div className="fw-sb-list">
          {!chatsReady && <div className="fw-sb-skel"><span /><span /><span /><span /><span /></div>}
          {chatsReady && groups.length === 0 && (
            <div className="fw-sb-empty">{filter === "all" ? "Your chats will show up here." : "No " + FILTERS.find((item) => item.value === filter).label.toLowerCase() + " yet."}</div>
          )}
          {groups.map((group) => (
            <div key={group.label} className="fw-sb-group">
              <div className="fw-sb-group-label">{group.label}</div>
              {group.items.map((chat) => <ChatRow key={chat.id} chat={chat} active={params.chatId === chat.id} onNavigate={onMobileClose} />)}
            </div>
          ))}
        </div>
        <Account onNavigate={onMobileClose} />
      </nav>
    </>
  )
}


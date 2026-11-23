import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate } from "react-router-dom"
import { ArrowUp, AtSign, Blocks, Brain, Check, ChevronDown, ChevronLeft, ChevronRight, FileCode2, FileText, Github, Hand, Image as ImageIcon, ListChecks, Loader2, Mail, Mic, Monitor, Paperclip, Plug, Plus, Search, Settings2, Sparkles, Square, X, Zap } from "lucide-react"
import { api, upload, rawUrl } from "../../lib/api"
import { groupModels, readRecent, rememberModel, vendorInfo, vendorOf } from "../../lib/vendors"
import { MenuItem, MenuLabel, MenuSep, Popover, cx } from "../../dash/kit"

let skillCache = null

export function loadSkills(force) {
  if (force) loadPluginCommands(true)
  if (skillCache && !force) return Promise.resolve(skillCache)
  return api.get("/api/skills").then((data) => {
    const list = []
    for (const item of data.skills || []) {
      if (item.enabled) list.push({ name: item.name, title: item.name, description: item.description || "", category: "Your skills" })
    }
    for (const item of data.builtin || []) list.push(item)
    skillCache = list
    return list
  }).catch(() => [])
}

let pluginCache = null

export function loadPluginCommands(force) {
  if (pluginCache && !force) return Promise.resolve(pluginCache)
  return api.get("/api/plugins").then((data) => {
    const list = []
    for (const plugin of data.plugins || []) {
      if (!plugin.installed || !plugin.enabled) continue
      const skill = plugin.skills[0] ? plugin.skills[0].name : ""
      for (const command of plugin.commands || []) list.push({ cmd: command.name, desc: command.description + " · " + plugin.name, skill })
    }
    pluginCache = list
    return list
  }).catch(() => [])
}

export const MODES = [
  { key: "auto", label: "Agent", icon: Zap, hint: "Works on its own from start to finish", tone: "brand" },
  { key: "plan", label: "Plan", icon: ListChecks, hint: "Researches and writes a plan, builds after you approve", tone: "amber" },
  { key: "ask", label: "Ask first", icon: Hand, hint: "Asks before it changes files or runs commands", tone: "blue" },
]

export const EFFORTS = [
  { key: "", label: "Auto", hint: "The model decides how long to think" },
  { key: "low", label: "Low", hint: "Fast answers, little thinking" },
  { key: "medium", label: "Medium", hint: "Balanced for most work" },
  { key: "high", label: "High", hint: "Thinks longest, best for hard problems" },
]

const COMMANDS = [
  { cmd: "/plan", desc: "Switch to plan mode" },
  { cmd: "/auto", desc: "Switch to agent mode" },
  { cmd: "/ask", desc: "Ask before changes" },
  { cmd: "/init", desc: "Write FORKWISE.md notes for this project" },
  { cmd: "/compact", desc: "Summarize the chat to free up context" },
  { cmd: "/new", desc: "Start a new chat" },
  { cmd: "/memory", desc: "See what Forkwise remembers" },
  { cmd: "/abilities", desc: "Tools and skills Forkwise made" },
]

const PASTE_CHARS = 2500
const PASTE_LINES = 60
const CODE_EXT = /\.(js|jsx|ts|tsx|py|go|rs|java|c|cpp|h|cs|rb|php|sh|json|ya?ml|toml|html|css|sql|md)$/i

function readStored(key, fallback) {
  try {
    return localStorage.getItem(key) || fallback
  } catch (problem) {
    return fallback
  }
}

function store(key, value) {
  try {
    localStorage.setItem(key, value)
  } catch (problem) {
    // storage blocked
  }
}

function speechApi() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null
}

export function voiceLanguage() {
  return readStored("fw-voice", navigator.language || "en-US")
}

function sizeText(bytes) {
  if (!bytes && bytes !== 0) return ""
  if (bytes < 1024) return bytes + " B"
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + " KB"
  return (bytes / 1024 / 1024).toFixed(1) + " MB"
}

function extension(name) {
  const match = /\.([a-z0-9]{1,6})$/i.exec(name || "")
  return match ? match[1].toUpperCase() : "FILE"
}

function isImage(file) {
  return /^image\//.test(file.type || "")
}

function modelMeta(item) {
  const parts = []
  if (item.context) parts.push(item.context >= 1000000 ? Math.round(item.context / 100000) / 10 + "M" : Math.round(item.context / 1000) + "k")
  if (item.vision) parts.push("vision")
  return parts.join(" · ")
}

function Attachment({ item, wid, onRemove }) {
  const image = item.kind === "image"
  const src = item.preview || (item.file && image ? rawUrl(wid, item.file.path) : "")
  const Icon = image ? ImageIcon : CODE_EXT.test(item.name) ? FileCode2 : FileText
  return (
    <div className={cx("fw-att", image && src && "is-image", item.status === "error" && "is-error")} title={item.status === "error" ? item.error : item.name}>
      {image && src ? (
        <img src={src} alt={item.name} />
      ) : (
        <>
          <span className="fw-att-icon"><Icon size={17} /></span>
          <span className="fw-att-text">
            <span className="fw-att-name" dir="auto">{item.label || item.name}</span>
            <span className="fw-att-meta">{item.status === "error" ? "Upload failed" : extension(item.name) + (item.size ? " · " + sizeText(item.size) : "")}</span>
          </span>
        </>
      )}
      {item.status === "uploading" && <span className="fw-att-busy"><Loader2 size={16} className="fw-spin" /></span>}
      <button type="button" className="fw-att-x" aria-label={"Remove " + item.name} onClick={() => onRemove(item.id)}><X size={11} /></button>
    </div>
  )
}

function ContextRing({ context }) {
  if (!context || !context.limit || context.tokens / context.limit < 0.2) return null
  const share = Math.min(1, context.tokens / context.limit)
  const radius = 7
  const length = 2 * Math.PI * radius
  return (
    <span className="fw-ring" title={"Context used: " + Math.round(share * 100) + "% of " + Math.round(context.limit / 1000) + "k tokens"}>
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
        <circle cx="9" cy="9" r={radius} fill="none" stroke="var(--line-2)" strokeWidth="2" />
        <circle cx="9" cy="9" r={radius} fill="none" stroke={share > 0.75 ? "var(--amber)" : "var(--tx-2)"} strokeWidth="2" strokeDasharray={length} strokeDashoffset={length * (1 - share)} strokeLinecap="round" transform="rotate(-90 9 9)" />
      </svg>
      {Math.round(share * 100)}%
    </span>
  )
}

function PlusPanel({ mode, onMode, onAttach, skills, picked, onToggleSkill, onClose }) {
  const navigate = useNavigate()
  const [view, setView] = useState("main")
  const [query, setQuery] = useState("")
  const [index, setIndex] = useState(0)
  const needle = query.trim().toLowerCase()

  const items = useMemo(() => {
    const go = (to) => () => { onClose(); navigate(to) }
    const skillRow = (item, group) => ({
      key: "s-" + item.name, group: group || item.category, icon: Sparkles, label: item.title || item.name, hint: item.description, on: picked.includes(item.name), run: () => onToggleSkill(item.name),
    })
    const skillMatch = (item) => !needle || (item.name + " " + (item.title || "") + " " + item.description).toLowerCase().includes(needle)
    if (view === "skills") return skills.filter(skillMatch).map((item) => skillRow(item))
    if (view === "connect") {
      return [
        { key: "gh", group: "Accounts", icon: Github, label: "GitHub", hint: "Repos, branches, pull requests", run: go("/app/settings/connections") },
        { key: "gg", group: "Accounts", icon: Mail, label: "Google", hint: "Gmail, Calendar, Drive, Sheets", run: go("/app/settings/connections") },
        { key: "pc", group: "Accounts", icon: Monitor, label: "Your computer", hint: "Files, apps and your own browser", run: go("/app/settings/computer") },
        { key: "mcp", group: "Servers", icon: Plug, label: "MCP servers", hint: "Add any tool server", run: go("/app/customize/connectors") },
      ].filter((item) => !needle || (item.label + item.hint).toLowerCase().includes(needle))
    }
    const base = [
      ...MODES.map((item) => ({ key: "m-" + item.key, group: "Mode", icon: item.icon, tone: item.tone, label: item.label, hint: item.hint, on: mode === item.key, run: () => { onMode(item.key); onClose() } })),
      { key: "attach", group: "Add context", icon: Paperclip, label: "Attach files or photos", hint: "Or paste and drop", run: () => { onClose(); onAttach() } },
      { key: "skills", group: "Add context", icon: Sparkles, label: "Skills", hint: picked.length ? picked.length + " picked" : skills.length + " available", next: true, run: () => { setView("skills"); setQuery("") } },
      { key: "connect", group: "Add context", icon: Plug, label: "Connectors", hint: "GitHub, Google, MCP", next: true, run: () => { setView("connect"); setQuery("") } },
      { key: "plugins", group: "Add context", icon: Blocks, label: "Plugins", hint: "Browse and install", run: go("/app/plugins") },
      { key: "manage", group: "Add context", icon: Settings2, label: "Manage skills and memory", run: go("/app/customize") },
    ]
    if (!needle) return base
    return base.filter((item) => (item.label + " " + (item.hint || "")).toLowerCase().includes(needle)).concat(skills.filter(skillMatch).slice(0, 6).map((item) => skillRow(item, "Skills")))
  }, [view, needle, skills, picked, mode, onMode, onClose, onAttach, onToggleSkill, navigate])

  useEffect(() => setIndex(0), [needle, view])

  function onKey(event) {
    if (event.key === "ArrowDown") { event.preventDefault(); setIndex((index + 1) % Math.max(1, items.length)) }
    else if (event.key === "ArrowUp") { event.preventDefault(); setIndex((index - 1 + items.length) % Math.max(1, items.length)) }
    else if (event.key === "Enter" && items[index]) { event.preventDefault(); items[index].run() }
    else if ((event.key === "Backspace" || event.key === "ArrowLeft") && !query && view !== "main") { event.preventDefault(); setView("main") }
  }

  let group = ""
  return (
    <div className="fw-plus" onKeyDown={onKey}>
      <div className="fw-plus-search">
        {view !== "main" ? <button type="button" className="fw-plus-back" aria-label="Back" onClick={() => setView("main")}><ChevronLeft size={15} /></button> : <Search size={14} />}
        <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={view === "skills" ? "Search skills" : view === "connect" ? "Search connectors" : "Search modes, skills, connectors"} />
      </div>
      <div className="fw-plus-list">
        {items.length === 0 && <div className="fw-pop-empty">{view === "skills" && skills.length === 0 ? "Loading skills" : "Nothing matches"}</div>}
        {items.map((item, position) => {
          const head = item.group !== group ? item.group : ""
          group = item.group
          const Icon = item.icon
          return (
            <div key={item.key}>
              {head && <MenuLabel>{head}</MenuLabel>}
              <button type="button" className={cx("fw-plus-item", position === index && "is-kb", item.on && "is-on")} onMouseMove={() => setIndex(position)} onClick={item.run}>
                <span className={cx("fw-plus-icon", item.tone && "tone-" + item.tone)}><Icon size={15} /></span>
                <span className="fw-plus-label">{item.label}</span>
                {item.hint && <span className="fw-plus-hint">{item.hint}</span>}
                {item.on && <Check size={14} className="fw-plus-check" />}
                {item.next && <ChevronRight size={14} className="fw-plus-next" />}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ModePanel({ mode, onPick }) {
  const [hover, setHover] = useState(mode)
  const shown = MODES.find((item) => item.key === hover) || MODES[0]
  return (
    <>
      {MODES.map((item, index) => {
        const Icon = item.icon
        const on = item.key === mode
        return (
          <button key={item.key} type="button" role="menuitemradio" aria-checked={on} className={cx("fw-crow", on && "is-on")} onMouseEnter={() => setHover(item.key)} onFocus={() => setHover(item.key)} onClick={() => onPick(item.key)}>
            <Icon size={14} className={"fw-crow-icon tone-" + item.tone} />
            <span className="fw-crow-label">{item.label}</span>
            <span className="fw-crow-kbd">{"Alt " + (index + 1)}</span>
            <span className="fw-crow-check">{on && <Check size={13} />}</span>
          </button>
        )
      })}
      <div className="fw-crow-foot">{shown.hint}</div>
    </>
  )
}

function ModelPanel({ models, current, onPick, effort, chooseEffort }) {
  const [query, setQuery] = useState("")
  const groups = groupModels(models)
  const needle = query.trim().toLowerCase()
  const match = (item) => !needle || (item.label + " " + item.key + " " + vendorInfo(vendorOf(item)).label).toLowerCase().includes(needle)
  const shown = groups.map((group) => ({ vendor: group.vendor, items: group.items.filter(match) })).filter((group) => group.items.length > 0)
  return (
    <>
      <div className="fw-pop-search"><Search size={13} /><input autoFocus placeholder="Search models" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
      <div className="fw-pop-scroll" style={{ maxHeight: 280 }}>
        {shown.map((group) => (
          <div key={group.vendor.key}>
            {groups.length > 1 && <div className="fw-crow-group">{group.vendor.label}</div>}
            {group.items.map((item) => {
              const on = current && item.key === current.key
              return (
                <button key={item.key} type="button" role="menuitemradio" aria-checked={on} className={cx("fw-crow", on && "is-on")} onClick={() => onPick(item.key)}>
                  <span className="fw-crow-label">{item.label}</span>
                  {item.vision && <ImageIcon size={12} className="fw-crow-meta" aria-label="Reads images" />}
                  <span className="fw-crow-kbd">{modelMeta(item).split(" · ")[0]}</span>
                  <span className="fw-crow-check">{on && <Check size={13} />}</span>
                </button>
              )
            })}
          </div>
        ))}
        {shown.length === 0 && <div className="fw-pop-empty">No model matches</div>}
      </div>
      <div className="fw-crow-effort">
        <span><Brain size={13} />Thinking</span>
        <div className="fw-effort">
          {EFFORTS.map((item) => <button key={item.key || "auto"} type="button" title={item.hint} className={effort === item.key ? "is-on" : ""} onClick={() => chooseEffort(item.key)}>{item.label}</button>)}
        </div>
      </div>
    </>
  )
}

export default function Composer({ onSend, onStop, running, mode, onMode, model, onModel, models, getWorkspace, context, initialText, onCommand, placeholder, big }) {
  const [text, setText] = useState("")
  const [items, setItems] = useState([])
  const [wid, setWid] = useState(null)
  const [plusOpen, setPlusOpen] = useState(false)
  const [modelOpen, setModelOpen] = useState(false)
  const [modeOpen, setModeOpen] = useState(false)
  const modeRef = useRef(null)
  const [skillList, setSkillList] = useState([])
  const [pluginCommands, setPluginCommands] = useState([])
  const [picked, setPicked] = useState([])
  const [effort, setEffort] = useState(() => readStored("fw-effort", ""))
  const [listening, setListening] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState("")
  const [commandIndex, setCommandIndex] = useState(0)
  const area = useRef(null)
  const picker = useRef(null)
  const plusRef = useRef(null)
  const modelRef = useRef(null)
  const recognizer = useRef(null)
  const voiceBase = useRef("")
  const dragDepth = useRef(0)
  const widRef = useRef(null)
  const itemsRef = useRef(items)
  itemsRef.current = items

  useEffect(() => {
    if (initialText && initialText.value !== undefined) {
      setText(initialText.value)
      setTimeout(() => {
        const box = area.current
        if (box) {
          box.focus()
          box.setSelectionRange(box.value.length, box.value.length)
        }
      }, 30)
    }
  }, [initialText])

  useEffect(() => {
    const box = area.current
    if (!box) return
    box.style.height = "0px"
    box.style.height = Math.min(box.scrollHeight, 360) + "px"
  }, [text])

  useEffect(() => {
    loadSkills().then(setSkillList)
    loadPluginCommands().then(setPluginCommands)
  }, [])

  useEffect(() => {
    if (plusOpen) loadSkills(true).then(setSkillList)
  }, [plusOpen])

  useEffect(() => () => {
    if (recognizer.current) recognizer.current.abort()
    for (const item of itemsRef.current) if (item.preview) URL.revokeObjectURL(item.preview)
  }, [])

  function chooseEffort(value) {
    setEffort(value)
    store("fw-effort", value)
  }

  const togglePicked = useCallback((name) => {
    setPicked((old) => (old.includes(name) ? old.filter((item) => item !== name) : [...old, name].slice(0, 5)))
  }, [])

  const closePlus = useCallback(() => setPlusOpen(false), [])
  const openPicker = useCallback(() => picker.current && picker.current.click(), [])

  const ensureWorkspace = useCallback(async () => {
    if (widRef.current) return widRef.current
    const id = await getWorkspace()
    widRef.current = id
    setWid(id)
    return id
  }, [getWorkspace])

  async function addFiles(list, label) {
    const files = Array.from(list || []).filter(Boolean)
    if (files.length === 0) return
    setError("")
    const fresh = files.map((file) => ({
      id: Math.random().toString(36).slice(2),
      name: file.name || "file",
      label: label || "",
      size: file.size,
      kind: isImage(file) ? "image" : "file",
      preview: isImage(file) ? URL.createObjectURL(file) : "",
      status: "uploading",
      file: null,
    }))
    setItems((old) => [...old, ...fresh])
    let id = null
    try {
      id = await ensureWorkspace()
    } catch (problem) {
      setItems((old) => old.map((item) => (fresh.some((f) => f.id === item.id) ? { ...item, status: "error", error: problem.message } : item)))
      setError(problem.message)
      return
    }
    await Promise.all(files.map(async (file, index) => {
      const key = fresh[index].id
      try {
        const data = await upload(id, [file])
        const saved = data.files && data.files[0]
        setItems((old) => old.map((item) => (item.id === key ? { ...item, status: "done", file: saved, kind: saved && saved.kind === "image" ? "image" : item.kind } : item)))
      } catch (problem) {
        setItems((old) => old.map((item) => (item.id === key ? { ...item, status: "error", error: problem.message } : item)))
        setError(problem.message)
      }
    }))
  }

  function removeItem(key) {
    setItems((old) => {
      const found = old.find((item) => item.id === key)
      if (found && found.preview) URL.revokeObjectURL(found.preview)
      return old.filter((item) => item.id !== key)
    })
  }

  const slashing = text.startsWith("/") && !text.includes(" ")
  const commands = slashing ? [...COMMANDS, ...pluginCommands.filter((item) => !COMMANDS.some((base) => base.cmd === item.cmd))].filter((item) => item.cmd.startsWith(text.toLowerCase())) : []
  const slashSkills = slashing ? skillList.filter((item) => ("/" + item.name).startsWith(text.toLowerCase()) || (text.length > 2 && (item.title || "").toLowerCase().includes(text.slice(1).toLowerCase()))).slice(0, 8) : []
  const slashItems = [...commands.map((item) => ({ kind: "cmd", key: item.cmd, item })), ...slashSkills.map((item) => ({ kind: "skill", key: "s-" + item.name, item }))]

  function pickSlash(entry) {
    setText("")
    if (entry.kind === "cmd" && entry.item.skill) {
      if (!picked.includes(entry.item.skill)) togglePicked(entry.item.skill)
      setTimeout(() => area.current && area.current.focus(), 10)
      return
    }
    if (entry.kind === "cmd") {
      if (onCommand) onCommand(entry.item.cmd)
      return
    }
    if (!picked.includes(entry.item.name)) togglePicked(entry.item.name)
    setTimeout(() => area.current && area.current.focus(), 10)
  }

  function skillTitle(name) {
    const found = skillList.find((item) => item.name === name)
    return found ? found.title || found.name : name
  }

  const uploading = items.some((item) => item.status === "uploading")
  const ready = items.filter((item) => item.status === "done" && item.file).map((item) => item.file)
  const canSend = (text.trim() || ready.length > 0) && !uploading

  function submit() {
    const value = text.trim()
    if (slashItems.length > 0 && value.startsWith("/")) {
      pickSlash(slashItems[Math.min(commandIndex, slashItems.length - 1)])
      return
    }
    if (!canSend) return
    if (listening) stopVoice()
    onSend(value, ready, { effort, skills: picked })
    for (const item of items) if (item.preview) URL.revokeObjectURL(item.preview)
    setText("")
    setItems([])
    setPicked([])
    setError("")
  }

  function onKey(event) {
    if (slashItems.length > 0) {
      if (event.key === "ArrowDown") { event.preventDefault(); setCommandIndex((commandIndex + 1) % slashItems.length); return }
      if (event.key === "ArrowUp") { event.preventDefault(); setCommandIndex((commandIndex - 1 + slashItems.length) % slashItems.length); return }
      if (event.key === "Tab") { event.preventDefault(); pickSlash(slashItems[commandIndex % slashItems.length]); return }
      if (event.key === "Escape") { event.preventDefault(); setText(""); return }
    }
    if (event.altKey && ["1", "2", "3"].includes(event.key)) {
      event.preventDefault()
      onMode(MODES[Number(event.key) - 1].key)
      return
    }
    if (event.key === "Tab" && event.shiftKey) {
      event.preventDefault()
      const index = MODES.findIndex((item) => item.key === mode)
      onMode(MODES[(index + 1) % MODES.length].key)
      return
    }
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      submit()
    }
  }

  function onPaste(event) {
    const data = event.clipboardData
    if (!data) return
    const pasted = []
    for (const item of data.items || []) {
      if (item.kind === "file") {
        const file = item.getAsFile()
        if (file) pasted.push(file)
      }
    }
    if (pasted.length > 0) {
      event.preventDefault()
      const named = pasted.map((file, index) => (file.name && file.name !== "image.png" ? file : new File([file], "pasted-" + Date.now() + (index ? "-" + index : "") + "." + ((file.type.split("/")[1] || "png").replace("jpeg", "jpg")), { type: file.type })))
      addFiles(named)
      return
    }
    const plain = data.getData("text/plain") || ""
    const lines = plain.split("\n").length
    if (plain.length > PASTE_CHARS || lines > PASTE_LINES) {
      event.preventDefault()
      addFiles([new File([plain], "pasted-text-" + Date.now() + ".txt", { type: "text/plain" })], "Pasted text · " + lines + " lines")
    }
  }

  function onDragEnter(event) {
    if (!event.dataTransfer || Array.from(event.dataTransfer.types || []).indexOf("Files") === -1) return
    event.preventDefault()
    dragDepth.current += 1
    setDragging(true)
  }

  function onDragLeave(event) {
    event.preventDefault()
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragging(false)
  }

  function onDrop(event) {
    event.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    addFiles(event.dataTransfer.files)
  }

  function startVoice() {
    const Speech = speechApi()
    if (!Speech) {
      setError("Voice input needs Chrome, Edge or Safari.")
      return
    }
    setError("")
    const recognition = new Speech()
    recognition.lang = voiceLanguage()
    recognition.continuous = true
    recognition.interimResults = true
    voiceBase.current = text && !text.endsWith(" ") ? text + " " : text
    recognition.onresult = (event) => {
      let finalText = ""
      let interim = ""
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const piece = event.results[index][0].transcript
        if (event.results[index].isFinal) finalText += piece
        else interim += piece
      }
      if (finalText) voiceBase.current = voiceBase.current + finalText.trim() + " "
      setText(voiceBase.current + interim)
    }
    recognition.onerror = (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") setError("Microphone access is blocked. Allow it in the browser's site settings.")
      else if (event.error === "network") setError("Voice input could not reach the speech service.")
      else if (event.error !== "aborted" && event.error !== "no-speech") setError("Voice input stopped: " + event.error)
    }
    recognition.onend = () => {
      setListening(false)
      recognizer.current = null
      setText((value) => value.trimEnd())
    }
    try {
      recognition.start()
      recognizer.current = recognition
      setListening(true)
    } catch (problem) {
      setError("Voice input could not start.")
    }
  }

  function stopVoice() {
    if (recognizer.current) recognizer.current.stop()
  }

  const current = MODES.find((item) => item.key === mode) || MODES[0]
  const ModeIcon = current.icon
  const currentModel = models.find((item) => item.key === model) || models[0]
  const canVoice = Boolean(speechApi())

  return (
    <div className={cx("fw-composer", big && "is-big", "mode-" + mode, dragging && "is-dragging")}
      onDragEnter={onDragEnter} onDragOver={(e) => e.preventDefault()} onDragLeave={onDragLeave} onDrop={onDrop}>
      {dragging && <div className="fw-drop">Drop files to attach</div>}
      {slashItems.length > 0 && (
        <div className={cx("fw-slash", big && "is-below")} role="listbox">
          {slashItems.map((entry, index) => {
            const head = index === 0 || slashItems[index - 1].kind !== entry.kind ? (entry.kind === "cmd" ? "Commands" : "Skills") : ""
            return (
              <div key={entry.key}>
                {head && <MenuLabel>{head}</MenuLabel>}
                <button type="button" role="option" aria-selected={index === commandIndex % slashItems.length} className={cx("fw-slash-item", index === commandIndex % slashItems.length && "is-kb")} onMouseDown={(e) => { e.preventDefault(); pickSlash(entry) }}>
                  {entry.kind === "cmd" ? <span className="fw-mono">{entry.item.cmd}</span> : <span className="fw-slash-skill"><Sparkles size={13} />{entry.item.title || entry.item.name}</span>}
                  <span className="fw-slash-desc">{entry.kind === "cmd" ? entry.item.desc : entry.item.description}</span>
                </button>
              </div>
            )
          })}
        </div>
      )}
      {items.length > 0 && (
        <div className="fw-atts">
          {items.map((item) => <Attachment key={item.id} item={item} wid={wid} onRemove={removeItem} />)}
        </div>
      )}
      {picked.length > 0 && (
        <div className="fw-chips">
          {picked.map((name) => (
            <span key={name} className="fw-chip" title="Forkwise loads this skill first">
              <Sparkles size={12} /><span>{skillTitle(name)}</span>
              <button type="button" aria-label={"Remove skill " + skillTitle(name)} onClick={() => togglePicked(name)}><X size={11} /></button>
            </span>
          ))}
        </div>
      )}
      <textarea
        ref={area}
        dir="auto"
        rows={1}
        value={text}
        aria-label="Message"
        placeholder={listening ? "Listening…" : placeholder || (running ? "Add a follow-up. Forkwise reads it at the next step." : "Plan, build, or ask anything. / for commands and skills")}
        onChange={(e) => { setText(e.target.value); setCommandIndex(0); if (listening) voiceBase.current = e.target.value }}
        onKeyDown={onKey}
        onPaste={onPaste}
        autoFocus
      />
      {error && <div className="fw-composer-error" role="alert">{error}</div>}
      <div className="fw-composer-bar">
        <button ref={plusRef} type="button" className={cx("fw-cbtn", "fw-cbtn-plus", plusOpen && "is-on")} title="Modes, files, skills and connectors" aria-label="Add" aria-haspopup="menu" aria-expanded={plusOpen} onClick={() => setPlusOpen(!plusOpen)}>
          <Plus size={16} />
        </button>
        <Popover open={plusOpen} onClose={closePlus} anchorRef={plusRef} placement={big ? "bottom" : "top"} width={390} className="fw-pop-flush">
          <PlusPanel mode={mode} onMode={onMode} onAttach={openPicker} skills={skillList} picked={picked} onToggleSkill={togglePicked} onClose={closePlus} />
        </Popover>
        <input ref={picker} type="file" multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = "" }} />
        <button ref={modeRef} type="button" className={cx("fw-mode", "tone-" + current.tone, modeOpen && "is-on")} title={current.hint + " (Shift Tab to switch)"} aria-haspopup="menu" aria-expanded={modeOpen} onClick={() => setModeOpen(!modeOpen)}>
          <ModeIcon size={13} /><span>{current.label}</span><ChevronDown size={12} className="fw-mode-caret" />
        </button>
        <Popover open={modeOpen} onClose={() => setModeOpen(false)} anchorRef={modeRef} placement={big ? "bottom" : "top"} width={250} className="fw-pop-compact">
          <ModePanel mode={mode} onPick={(key) => { onMode(key); setModeOpen(false) }} />
        </Popover>
        {models.length > 0 && (
          <>
            <button ref={modelRef} type="button" className={cx("fw-model", modelOpen && "is-on")} aria-haspopup="menu" aria-expanded={modelOpen} onClick={() => setModelOpen(!modelOpen)}>
              <span>{currentModel ? currentModel.label : "Model"}</span>
              {effort && <span className="fw-model-effort">{effort}</span>}
              <ChevronDown size={12} className="fw-mode-caret" />
            </button>
            <Popover open={modelOpen} onClose={() => setModelOpen(false)} anchorRef={modelRef} placement={big ? "bottom" : "top"} width={290} className="fw-pop-compact">
              <ModelPanel models={models} current={currentModel} effort={effort} chooseEffort={chooseEffort} onPick={(key) => { rememberModel(key); onModel(key); setModelOpen(false) }} />
            </Popover>
          </>
        )}
        <span className="fw-composer-spacer" />
        <ContextRing context={context} />
        <button type="button" className="fw-cbtn" title="Attach files or photos" aria-label="Attach files" onClick={openPicker}><ImageIcon size={16} /></button>
        {canVoice && (
          <button type="button" className={cx("fw-cbtn", listening && "is-listening")} title={listening ? "Stop listening" : "Dictate"} aria-label={listening ? "Stop listening" : "Dictate"} aria-pressed={listening} onClick={listening ? stopVoice : startVoice}>
            {listening ? <span className="fw-wave"><i /><i /><i /><i /></span> : <Mic size={16} />}
          </button>
        )}
        {running && !canSend ? (
          <button type="button" className="fw-send is-stop" onClick={onStop} title="Stop" aria-label="Stop"><Square size={12} fill="currentColor" /></button>
        ) : (
          <button type="button" className="fw-send" disabled={!canSend} onClick={submit} title={uploading ? "Waiting for uploads" : "Send"} aria-label="Send">
            {uploading ? <Loader2 size={14} className="fw-spin" /> : <ArrowUp size={16} strokeWidth={2.4} />}
          </button>
        )}
      </div>
    </div>
  )
}

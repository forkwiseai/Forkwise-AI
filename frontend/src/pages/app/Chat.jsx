import { useEffect, useRef, useState } from "react"
import { Link, useLocation, useNavigate, useParams } from "react-router-dom"
import { ArrowDown, ChevronDown, Download, FolderKanban, FolderOpen, ListChecks, MessageSquare, PanelRight, Pencil, Pin, PinOff, Trash2 } from "lucide-react"
import Composer from "../../components/app/Composer"
import VoiceMode from "../../components/app/VoiceMode"
import MessageList from "../../components/app/MessageList"
import RunBar from "../../components/app/RunBar"
import Workspace from "../../components/app/workspace/Workspace"
import { Button, Empty, IconButton, MenuItem, MenuSep, Popover, Skeleton, useConfirm } from "../../dash/kit"
import { useChatActions } from "../../dash/Sidebar"
import { useChat } from "../../lib/useChat"
import { useStore } from "../../lib/store"
import { api, apiUrl } from "../../lib/api"

const FILE_TOOLS = ["write_file", "edit_file", "multi_edit", "bash", "create_tool", "show_file", "screenshot", "browser", "computer"]
const INIT_PROMPT = "Look through this project and write a FORKWISE.md file in the project folder: what the project is, the stack, how to install and run it (exact commands and ports), the folder layout, important decisions and conventions. Keep it short and useful for future work."

function readWidth() {
  try {
    return Number(localStorage.getItem("fw-panel")) || 560
  } catch (problem) {
    return 560
  }
}

function folderName(path) {
  const parts = String(path).split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] || path
}

export default function Chat() {
  const { chatId } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const { models, patchChat, theme, toast } = useStore()
  const confirm = useConfirm()
  const [panel, setPanel] = useState(false)
  const [tab, setTab] = useState("activity")
  const [openPath, setOpenPath] = useState("")
  const [refreshKey, setRefreshKey] = useState(0)
  const [width, setWidth] = useState(readWidth)
  const [seed, setSeed] = useState(null)
  const [atBottom, setAtBottom] = useState(true)
  const [voice, setVoice] = useState(false)
  const scroller = useRef(null)
  const sentFirst = useRef(false)
  const toolNames = useRef({})
  const widthRef = useRef(width)
  widthRef.current = width

  const { state, send, stop, respond, reload, setChat } = useChat(chatId, {
    onEvent(event) {
      if (event.type === "tool_start") {
        toolNames.current[event.id] = event.name
        if (event.name === "computer" || event.name === "browser" || event.name === "screenshot") {
          setPanel(true)
          setTab(event.name === "computer" ? "computer" : "browser")
        }
      }
      if (event.type === "preview") {
        setPanel(true)
        setTab("preview")
        setRefreshKey((value) => value + 1)
      }
      if (event.type === "tool_end" && FILE_TOOLS.indexOf(toolNames.current[event.id]) !== -1) setRefreshKey((value) => value + 1)
      if (event.type === "title") patchChat(chatId, { title: event.title })
      if (event.type === "start") patchChat(chatId, { running: true })
      if (event.type === "done") {
        patchChat(chatId, { running: false, updated_at: Date.now() / 1000 })
        setRefreshKey((value) => value + 1)
      }
      if (event.type === "capability") toast("Forkwise learned a new " + event.kind + ": " + event.name, "ok")
      if (event.type === "memory") toast("Saved to memory", "ok")
    },
  })

  useEffect(() => {
    sentFirst.current = false
    setPanel(false)
  }, [chatId])

  useEffect(() => {
    if (location.state && location.state.voice && !state.loading && state.chat) {
      setVoice(true)
      navigate(location.pathname + location.search, { replace: true, state: null })
      return
    }
    const first = location.state && location.state.first
    if (!first || sentFirst.current || state.loading || !state.chat) return
    sentFirst.current = true
    navigate(location.pathname + location.search, { replace: true, state: null })
    send(first.text, { attachments: first.files, mode: first.mode, model: first.model, effort: first.effort, skills: first.skills })
  }, [state.loading, state.chat, location.state])

  useEffect(() => {
    if (state.preview && !panel && state.messages.length > 0 && !state.loading) {
      setPanel(true)
    }
  }, [state.loading])

  useEffect(() => {
    if (atBottom && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight
  }, [state.messages, state.live, atBottom])

  function onScroll() {
    const box = scroller.current
    if (!box) return
    setAtBottom(box.scrollHeight - box.scrollTop - box.clientHeight < 80)
  }

  async function setMode(mode) {
    setChat({ mode })
    try {
      await api.patch("/api/chats/" + chatId, { mode })
    } catch (problem) {
      toast(problem.message, "error")
    }
  }

  async function setModel(model) {
    setChat({ model })
    await api.patch("/api/chats/" + chatId, { model })
  }

  async function command(cmd) {
    if (cmd === "/plan") return setMode("plan")
    if (cmd === "/auto") return setMode("auto")
    if (cmd === "/ask") return setMode("ask")
    if (cmd === "/new") return navigate("/app")
    if (cmd === "/memory") return navigate("/app/settings/memory")
    if (cmd === "/abilities") return navigate("/app/settings/abilities")
    if (cmd === "/init") return send(INIT_PROMPT)
    if (cmd === "/compact") {
      try {
        const data = await api.post("/api/chats/" + chatId + "/compact")
        toast(data.ok ? "Chat summarized" : "Nothing to summarize yet")
        reload(false)
      } catch (problem) {
        toast(problem.message, "error")
      }
    }
    return null
  }

  async function rewind(message) {
    const sure = await confirm({ title: "Go back to this message?", text: "Later messages are removed and file changes made after it are undone.", confirmLabel: "Go back", danger: true })
    if (!sure) return
    try {
      const data = await api.post("/api/chats/" + chatId + "/rewind", { message_id: message.id, files: true })
      await reload(false)
      setSeed({ value: data.content })
      setRefreshKey((value) => value + 1)
      toast(data.files_restored ? "Restored files and conversation" : "Restored conversation")
    } catch (problem) {
      toast(problem.message, "error")
    }
  }

  async function approvePlan() {
    await setMode("auto")
    send("The plan is approved. Build it now, following the plan, and verify the result.", { mode: "auto" })
  }

  function revisePlan() {
    setSeed({ value: "Change the plan: " })
  }

  function openFile(path) {
    setPanel(true)
    setTab("files")
    setOpenPath(path)
  }

  function openPreview() {
    setPanel(true)
    setTab("preview")
  }

  function startDrag(event) {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = width
    function move(e) {
      const next = Math.max(360, Math.min(window.innerWidth - 420, startWidth + (startX - e.clientX)))
      setWidth(next)
    }
    function up() {
      document.removeEventListener("mousemove", move)
      document.removeEventListener("mouseup", up)
      document.body.classList.remove("dragging")
      try {
        localStorage.setItem("fw-panel", String(widthRef.current))
      } catch (problem) {
        return
      }
    }
    document.body.classList.add("dragging")
    document.addEventListener("mousemove", move)
    document.addEventListener("mouseup", up)
  }

  if (state.notFound) {
    return (
      <div className="fw-page">
        <Empty icon={MessageSquare} title="This chat doesn't exist" text="It may have been deleted." action={<Button variant="primary" onClick={() => navigate("/app")}>Start a new chat</Button>} />
      </div>
    )
  }

  if (state.loading || !state.chat) {
    return <div className="fw-chat"><div className="fw-chat-scroll"><div className="fw-chat-inner"><Skeleton lines={6} /></div></div></div>
  }

  const chat = state.chat
  const todos = state.todos || []
  const done = todos.filter((item) => item.status === "completed").length
  const showTodos = todos.length > 0

  return (
    <div className="fw-chat-layout">
      <section className="fw-chat">
        <header className="fw-chat-head">
          <ChatTitle chat={chat} project={state.project} />
          <span className="fw-grow" />
          {showTodos && (
            <button type="button" className="fw-steps" title="Open the plan" onClick={() => { setPanel(true); setTab("plan") }}>
              <ListChecks size={14} />
              <span>Step {Math.min(done + (state.live.running ? 1 : 0), todos.length)} of {todos.length}</span>
              <span className="fw-steps-bar"><span style={{ width: (done / todos.length) * 100 + "%" }} /></span>
            </button>
          )}
          {!chat.local_path && <a className="fw-iconbtn" title="Download all files" aria-label="Download all files" href={apiUrl("/api/ws/" + chat.workspace_id + "/zip")}><Download size={16} /></a>}
          <IconButton icon={PanelRight} label="Workspace: preview, files, changes, terminal" active={panel} onClick={() => setPanel(!panel)} />
        </header>
        <div className="fw-chat-scroll" ref={scroller} onScroll={onScroll}>
          <div className="fw-chat-inner">
            {state.messages.length === 0 && !state.live.running && (
              <Empty icon={MessageSquare} title="Send a message to start" />
            )}
            <MessageList
              state={state}
              wid={chat.workspace_id}
              respond={respond}
              onPreview={openPreview}
              onRewind={rewind}
              onApprovePlan={approvePlan}
              onRevisePlan={revisePlan}
            />
          </div>
        </div>
        <div className="fw-chat-bottom">
          {!atBottom && (
            <button type="button" className="fw-tobottom" onClick={() => { scroller.current.scrollTop = scroller.current.scrollHeight }} aria-label="Scroll to the latest message"><ArrowDown size={15} /></button>
          )}
          <RunBar state={state} onStop={stop} onOpenChanges={() => { setPanel(true); setTab("changes") }} />
          {voice ? (
            <VoiceMode live={state.live} onSend={(text, extra) => send(text, extra)} onClose={() => setVoice(false)} />
          ) : (
          <Composer
            onVoiceMode={() => setVoice(true)}
            onSend={(text, files, extra) => send(text, { attachments: files, effort: extra && extra.effort, skills: extra && extra.skills })}
            onStop={stop}
            running={state.live.running}
            mode={chat.mode}
            onMode={setMode}
            model={chat.model}
            onModel={setModel}
            models={models}
            getWorkspace={async () => chat.workspace_id}
            context={state.live.context}
            initialText={seed}
            onCommand={command}
          />
          )}
        </div>
      </section>
      {panel && (
        <>
          <div className="fw-panel-handle" onMouseDown={startDrag} />
          <div className="fw-panel" style={{ width }}>
            <Workspace
              wid={chat.workspace_id}
              local={Boolean(chat.local_path)}
              tab={tab}
              setTab={setTab}
              onClose={() => setPanel(false)}
              preview={state.preview}
              refreshKey={refreshKey}
              checkpoint={state.checkpoint}
              changes={state.changes}
              theme={theme}
              openPath={openPath}
              messages={state.messages}
              todos={todos}
              running={state.live.running}
              onOpenFile={openFile}
            />
          </div>
        </>
      )}
    </div>
  )
}

function ChatTitle({ chat, project }) {
  const { chats } = useStore()
  const listed = chats.find((item) => item.id === chat.id) || chat
  const actions = useChatActions(listed)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(listed.title)
  const anchor = useRef(null)
  useEffect(() => setTitle(listed.title), [listed.title])
  function save() {
    setEditing(false)
    actions.rename(title)
  }
  return (
    <div className="fw-chat-title">
      {project && <Link to={"/app/projects/" + project.id} className="fw-crumb"><FolderKanban size={13} />{project.name}<span>/</span></Link>}
      {chat.local_path && <span className="fw-crumb" title={chat.local_path}><FolderOpen size={13} />{folderName(chat.local_path)}<span>/</span></span>}
      {editing ? (
        <input autoFocus className="fw-title-input" dir="auto" value={title} aria-label="Chat name" onChange={(e) => setTitle(e.target.value)} onBlur={save} onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") { setTitle(listed.title); setEditing(false) } }} />
      ) : (
        <button ref={anchor} type="button" className="fw-title-btn" onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open}>
          <span dir="auto">{listed.title}</span><ChevronDown size={14} />
        </button>
      )}
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchor} width={190}>
        <MenuItem icon={Pencil} onClick={() => { setOpen(false); setEditing(true) }}>Rename</MenuItem>
        <MenuItem icon={listed.pinned ? PinOff : Pin} onClick={() => { setOpen(false); actions.pin() }}>{listed.pinned ? "Unpin" : "Pin"}</MenuItem>
        <MenuSep />
        <MenuItem icon={Trash2} danger onClick={() => { setOpen(false); actions.remove() }}>Delete</MenuItem>
      </Popover>
    </div>
  )
}

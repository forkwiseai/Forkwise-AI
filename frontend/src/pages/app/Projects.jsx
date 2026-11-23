import { useEffect, useMemo, useState } from "react"
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom"
import { ArrowLeft, Brain, Code2, FolderKanban, MessageSquare, Palette, Plus, Search, Trash2 } from "lucide-react"
import { useStore } from "../../lib/store"
import { api } from "../../lib/api"
import { Button, Dialog, Empty, Field, Group, Input, PageHeader, Skeleton, Textarea, useConfirm } from "../../dash/kit"

const KIND = { code: Code2, design: Palette, chat: MessageSquare }

function ago(seconds) {
  const diff = Date.now() / 1000 - seconds
  if (diff < 60) return "just now"
  if (diff < 3600) return Math.floor(diff / 60) + "m ago"
  if (diff < 86400) return Math.floor(diff / 3600) + "h ago"
  return Math.floor(diff / 86400) + "d ago"
}

export function NewProjectDialog({ open, onClose }) {
  const { loadProjects, toast } = useStore()
  const navigate = useNavigate()
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setName("")
      setDescription("")
      setBusy(false)
    }
  }, [open])

  async function create(event) {
    if (event) event.preventDefault()
    if (!name.trim() || busy) return
    setBusy(true)
    try {
      const data = await api.post("/api/projects", { name, description })
      await loadProjects()
      onClose()
      navigate("/app/projects/" + data.project.id)
    } catch (problem) {
      toast(problem.message, "error")
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={<span className="fw-dialog-titlerow"><span className="fw-dialog-ico"><FolderKanban size={15} /></span>New project</span>} description="One set of files, instructions and memories shared by many chats."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!name.trim()} onClick={create}>Create project</Button></>}>
      <form onSubmit={create} className="fw-form">
        <Field label="Name" htmlFor="np-name"><Input id="np-name" data-autofocus dir="auto" value={name} onChange={(e) => setName(e.target.value)} placeholder="Online shop" maxLength={80} /></Field>
        <Field label="What is it about?" htmlFor="np-desc" hint="Optional. Forkwise reads this at the start of every chat in the project."><Textarea id="np-desc" dir="auto" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="A store with products, a cart and checkout" onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) create() }} /></Field>
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}

export function Projects() {
  const { projects, loadProjects } = useStore()
  const [params, setParams] = useSearchParams()
  const [creating, setCreating] = useState(params.get("new") === "1")
  const [query, setQuery] = useState("")

  useEffect(() => {
    loadProjects()
  }, [loadProjects])

  function closeCreate() {
    setCreating(false)
    if (params.get("new")) setParams({}, { replace: true })
  }

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return projects.filter((item) => !needle || (item.name + " " + (item.description || "")).toLowerCase().includes(needle))
  }, [projects, query])

  return (
    <div className="fw-page">
      <PageHeader title="Projects" description="Each project keeps one set of files, instructions and memories for many chats."
        actions={<Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>New project</Button>} />
      <NewProjectDialog open={creating} onClose={closeCreate} />
      {projects.length > 0 && <div className="fw-toolbar"><Input icon={Search} placeholder="Search projects" value={query} onChange={(e) => setQuery(e.target.value)} style={{ maxWidth: 320 }} /></div>}
      {projects.length === 0 && (
        <Empty icon={FolderKanban} title="No projects yet" text="Create one for each website, app or long job, so every chat in it shares the same files." action={<Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>New project</Button>} />
      )}
      <div className="fw-proj-grid">
        {shown.map((project) => (
          <Link key={project.id} to={"/app/projects/" + project.id} className="fw-proj-card">
            <span className="fw-proj-icon"><FolderKanban size={18} /></span>
            <strong dir="auto">{project.name}</strong>
            <p dir="auto">{project.description || "No description"}</p>
            <span className="fw-proj-meta">{project.chats || 0} chats · updated {ago(project.updated_at)}</span>
          </Link>
        ))}
        {projects.length > 0 && (
          <button type="button" className="fw-proj-card fw-proj-new" onClick={() => setCreating(true)}><Plus size={18} /><span>New project</span></button>
        )}
      </div>
    </div>
  )
}

export function Project() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const { loadProjects, toast } = useStore()
  const confirm = useConfirm()
  const [data, setData] = useState(null)
  const [instructions, setInstructions] = useState("")
  const [saved, setSaved] = useState(true)

  async function load() {
    try {
      const result = await api.get("/api/projects/" + projectId)
      setData(result)
      setInstructions(result.project.instructions || "")
      setSaved(true)
    } catch (problem) {
      setData({ missing: true })
    }
  }

  useEffect(() => {
    load()
  }, [projectId])

  async function save() {
    try {
      await api.patch("/api/projects/" + projectId, { instructions })
      setSaved(true)
      toast("Instructions saved", "ok")
    } catch (problem) {
      toast(problem.message, "error")
    }
  }

  async function remove() {
    const sure = await confirm({ title: "Delete this project?", text: "All its chats and files are removed for good.", confirmLabel: "Delete project", danger: true })
    if (!sure) return
    await api.del("/api/projects/" + projectId)
    await loadProjects()
    navigate("/app/projects")
  }

  if (!data) return <div className="fw-page"><Skeleton lines={6} /></div>
  if (data.missing) return <div className="fw-page"><Empty icon={FolderKanban} title="Project not found" action={<Button onClick={() => navigate("/app/projects")}>All projects</Button>} /></div>

  return (
    <div className="fw-page">
      <PageHeader
        back={<Link to="/app/projects" className="fw-back"><ArrowLeft size={14} />Projects</Link>}
        title={<span dir="auto">{data.project.name}</span>}
        description={data.project.description}
        actions={<><Button variant="ghost" icon={Trash2} onClick={remove}>Delete</Button><Button variant="primary" icon={Plus} onClick={() => navigate("/app?project=" + projectId)}>New chat here</Button></>}
      />
      <div className="fw-proj-layout">
        <Group label={"Chats (" + data.chats.length + ")"}>
          {data.chats.length === 0 && <div className="fw-pad fw-muted">No chats in this project yet.</div>}
          {data.chats.map((chat) => {
            const Icon = KIND[chat.kind] || MessageSquare
            return (
              <Link key={chat.id} to={"/app/c/" + chat.id} className="fw-row is-link">
                <span className="fw-row-icon"><Icon size={15} /></span>
                <span className="fw-row-text"><span className="fw-row-title" dir="auto">{chat.title}</span></span>
                <span className="fw-row-control fw-muted fw-small">{ago(chat.updated_at)}</span>
              </Link>
            )
          })}
        </Group>
        <div>
          <Group label="Instructions" description="Forkwise follows these in every chat of this project: brand colors, the stack, the tone of the copy.">
            <div className="fw-pad fw-form">
              <Textarea dir="auto" rows={9} value={instructions} onChange={(e) => { setInstructions(e.target.value); setSaved(false) }} placeholder="Use our brand colors: black and orange. All copy in British English." />
              <div className="fw-form-actions"><Button variant="primary" size="sm" disabled={saved} onClick={save}>Save instructions</Button></div>
            </div>
          </Group>
          {data.memories.length > 0 && (
            <Group label="Project memories">
              {data.memories.map((memory) => (
                <div key={memory.id} className="fw-row"><span className="fw-row-icon"><Brain size={15} /></span><span className="fw-row-text"><span className="fw-row-title" dir="auto">{memory.content}</span></span></div>
              ))}
            </Group>
          )}
        </div>
      </div>
    </div>
  )
}

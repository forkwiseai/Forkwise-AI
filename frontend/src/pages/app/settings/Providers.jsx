import { useEffect, useState } from "react"
import { ExternalLink, KeyRound, Pencil, Plus, Trash2, Zap } from "lucide-react"
import { api } from "../../../lib/api"
import { useStore } from "../../../lib/store"
import { Badge, Button, Checkbox, Dialog, Empty, Field, Group, Input, Row, Select, Skeleton, Switch, Textarea, useConfirm } from "../../../dash/kit"

function ProviderDialog({ open, onClose, presets, editing, onSaved }) {
  const { toast } = useStore()
  const [preset, setPreset] = useState("openai")
  const [name, setName] = useState("")
  const [url, setUrl] = useState("")
  const [key, setKey] = useState("")
  const [models, setModels] = useState("")
  const [vision, setVision] = useState(false)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setError("")
    setKey("")
    if (editing) {
      setPreset(editing.preset)
      setName(editing.name)
      setUrl(editing.base_url)
      setModels(editing.models.join(", "))
      setVision(editing.vision)
    } else {
      pick("openai")
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  function pick(id) {
    const found = presets.find((item) => item.id === id) || presets[presets.length - 1]
    if (!found) return
    setPreset(found.id)
    setName(found.id === "custom" ? "" : found.name)
    setUrl(found.url)
    setModels(found.models.split(",").join(", "))
    setVision(found.vision)
  }

  async function save() {
    setBusy(true)
    setError("")
    try {
      const body = { preset, name, base_url: url, api_key: key, models, vision, test: true }
      const data = editing ? await api.put("/api/providers/" + editing.id, body) : await api.post("/api/providers", body)
      toast("Connected. Its models are in the model picker.", "ok")
      onSaved(data)
      onClose()
    } catch (problem) {
      setError(problem.message)
    }
    setBusy(false)
  }

  const info = presets.find((item) => item.id === preset)
  return (
    <Dialog open={open} onClose={onClose} title={editing ? "Edit " + editing.name : "Connect your own API"} description="Use your own key from any OpenAI-compatible provider. We test it with a one-word request before saving."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!url || (!key && !editing) || !models.trim()} onClick={save}>{busy ? "Testing" : "Test and save"}</Button></>}>
      <div className="fw-form">
        <Field label="Provider"><Select value={preset} onChange={pick} width="100%" options={presets.map((item) => ({ value: item.id, label: item.name }))} /></Field>
        {preset === "custom" && <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Company gateway" maxLength={60} /></Field>}
        <Field label="API address" hint="The base URL that ends before /chat/completions."><Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://api.example.com/v1" spellCheck={false} /></Field>
        <Field label="API key" hint={editing ? "Leave empty to keep the saved key (" + editing.key_hint + ")." : info && info.keys ? <>Stored encrypted. <a className="fw-link" href={info.keys} target="_blank" rel="noreferrer">Get your {info.name} key</a></> : "Stored encrypted. Never shown again."}>
          <Input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={editing ? "••••••••" : "sk-…"} spellCheck={false} />
        </Field>
        <Field label="Models" hint="Model names exactly as the provider spells them, separated by commas."><Textarea rows={2} value={models} onChange={(e) => setModels(e.target.value)} spellCheck={false} placeholder="gpt-5, gpt-5-mini" /></Field>
        <Checkbox checked={vision} onChange={setVision} label="These models can read images" hint="Turn on if they accept screenshots and photos." />
        {error && <p className="fw-field-error">{error}</p>}
      </div>
    </Dialog>
  )
}

export default function Providers() {
  const { loadMe, toast } = useStore()
  const confirm = useConfirm()
  const [list, setList] = useState(null)
  const [presets, setPresets] = useState([])
  const [dialog, setDialog] = useState(null)

  async function load() {
    try {
      const [mine, options] = await Promise.all([api.get("/api/providers"), api.get("/api/providers/presets")])
      setList(mine.providers)
      setPresets(options.presets)
    } catch (problem) {
      setList([])
    }
  }

  useEffect(() => { load() }, [])

  async function toggle(item, enabled) {
    setList((rows) => rows.map((row) => (row.id === item.id ? { ...row, enabled } : row)))
    await api.patch("/api/providers/" + item.id, { enabled }).catch(() => null)
    loadMe()
  }

  async function test(item) {
    try {
      const data = await api.post("/api/providers/" + item.id + "/test")
      toast(data.message, data.ok ? "ok" : "error")
    } catch (problem) {
      toast(problem.message, "error")
    }
  }

  async function remove(item) {
    const sure = await confirm({ title: "Remove " + item.name + "?", text: "Its key is deleted and its models leave the model picker. Chats that used them switch to a Forkwise model.", confirmLabel: "Remove", danger: true })
    if (!sure) return
    await api.del("/api/providers/" + item.id).catch(() => null)
    setList((rows) => rows.filter((row) => row.id !== item.id))
    loadMe()
  }

  return (
    <>
      <Group label="Your own model providers" description="Bring your own key from OpenAI, Anthropic, Google, OpenRouter, DeepSeek or any OpenAI-compatible service. Work on your own key is billed by that provider and doesn't count toward your Forkwise daily allowance.">
        {list === null && <div className="fw-pad"><Skeleton lines={2} /></div>}
        {list && list.length === 0 && <Empty icon={KeyRound} title="No API keys connected" text="Connect one to use your own models and limits in every chat." action={<Button variant="primary" icon={Plus} onClick={() => setDialog({})}>Connect an API</Button>} />}
        {(list || []).map((item) => (
          <Row key={item.id} icon={Zap} title={<span className="fw-session-title">{item.name}<Badge>{item.key_hint}</Badge></span>} description={item.base_url + " · " + item.models.join(", ")}>
            <Button size="sm" variant="ghost" onClick={() => test(item)}>Test</Button>
            <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setDialog({ editing: item })} aria-label="Edit" />
            <Button size="sm" variant="ghost" icon={Trash2} onClick={() => remove(item)} aria-label="Remove" />
            <Switch checked={item.enabled} label={"Use " + item.name} onChange={(value) => toggle(item, value)} />
          </Row>
        ))}
      </Group>
      {list && list.length > 0 && <div className="fw-save-bar"><Button icon={Plus} onClick={() => setDialog({})}>Connect another API</Button></div>}
      <p className="fw-help" style={{ marginTop: 16 }}>Self-hosting Forkwise? Set <code>ALLOW_PRIVATE_PROVIDERS=1</code> on the server to connect Ollama or LM Studio on your own network. <a className="fw-link" href="/docs/own-api-keys" target="_blank" rel="noreferrer">Docs <ExternalLink size={11} /></a></p>
      <ProviderDialog open={Boolean(dialog)} editing={dialog && dialog.editing} presets={presets} onClose={() => setDialog(null)} onSaved={() => { load(); loadMe() }} />
    </>
  )
}

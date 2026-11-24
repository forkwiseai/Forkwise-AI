import { useEffect, useMemo, useRef, useState } from "react"
import { Link, Navigate, NavLink, useNavigate, useParams } from "react-router-dom"
import {
  ArrowLeft, ArrowUpRight, BarChart3, Bot, BookOpen, CalendarClock, Check, CheckCircle2, Chrome, Circle, Download, Film, FolderOpen, Gauge, Globe,
  Keyboard, KeyRound, Laptop, Link2, LogOut, Mail, Monitor, Moon, MousePointer2, Palette, Search, ShieldCheck, Smartphone, Sparkles, Sun, Terminal, Trash2, Upload, User,
} from "lucide-react"
import { useStore } from "../../lib/store"
import { api, apiUrl } from "../../lib/api"
import { desktopApp } from "../../lib/desktop"
import { Speaker, voiceInfo } from "../../lib/voice"
import Avatar from "../../dash/Avatar"
import { Badge, Button, CodeInput, Dialog, Field, Group, Input, Kbd, Row, Segmented, Select, Skeleton, Steps, Switch, Textarea, useConfirm, useCooldown } from "../../dash/kit"
import Connections from "./settings/Connections"
import Secrets from "./settings/Secrets"
import ApiKeys from "./settings/ApiKeys"
import Schedules from "./settings/Schedules"
import Providers from "./settings/Providers"
import Browser from "./settings/Browser"
import ModalConnect from "../../components/video/ModalConnect"

const GROUPS = [
  { title: "Account", tabs: [
    { key: "general", label: "Profile", icon: User, text: "Your name, photo and account" },
    { key: "appearance", label: "Preferences", icon: Palette, text: "Theme, voice input and notifications" },
    { key: "security", label: "Security", icon: ShieldCheck, text: "Password, sessions, activity and account deletion" },
  ] },
  { title: "Agent", tabs: [
    { key: "agent", label: "Models and behavior", icon: Bot, text: "Default model and custom instructions" },
    { key: "models", label: "Model providers", icon: KeyRound, text: "Bring your own OpenAI, Anthropic, Gemini or other API key" },
    { key: "schedules", label: "Automations", icon: CalendarClock, text: "Tasks that run on a schedule" },
  ] },
  { title: "Integrations", tabs: [
    { key: "connections", label: "Connected accounts", icon: Link2, text: "GitHub, Google and other accounts" },
    { key: "secrets", label: "Secrets", icon: KeyRound, text: "Keys your agent can use without seeing them" },
    { key: "api-keys", label: "API keys", icon: Terminal, text: "Use Forkwise from your own code" },
  ] },
  { title: "Computer", tabs: [
    { key: "computer", label: "Your computer", icon: Laptop, text: "Let the agent work on your machine" },
    { key: "browser", label: "Your browser", icon: Globe, text: "Let the agent use your own Chrome" },
    { key: "video", label: "Video rendering", icon: Film, text: "Render videos on your Modal account" },
  ] },
  { title: "Workspace", tabs: [
    { key: "usage", label: "Usage", icon: BarChart3, text: "Tokens and tasks per day" },
    { key: "shortcuts", label: "Keyboard shortcuts", icon: Keyboard, text: "Work faster from the keyboard" },
    { key: "data", label: "Your data", icon: BookOpen, text: "Export everything" },
  ] },
]

const ALL_TABS = GROUPS.flatMap((group) => group.tabs)

const VOICES = [
  ["en-US", "English (United States)"], ["en-GB", "English (United Kingdom)"], ["ar-SA", "Arabic"], ["zh-CN", "Chinese"], ["nl-NL", "Dutch"],
  ["fr-FR", "French"], ["de-DE", "German"], ["hi-IN", "Hindi"], ["it-IT", "Italian"], ["ja-JP", "Japanese"], ["ko-KR", "Korean"],
  ["fa-IR", "Persian"], ["pl-PL", "Polish"], ["pt-BR", "Portuguese"], ["ru-RU", "Russian"], ["es-ES", "Spanish"], ["tr-TR", "Turkish"], ["uk-UA", "Ukrainian"],
]

function useSave() {
  const { setUser, toast } = useStore()
  return async function save(body, message) {
    try {
      const data = await api.post("/api/auth/settings", body)
      setUser(data.user)
      if (message) toast(message, "ok")
      return true
    } catch (problem) {
      toast(problem.message, "error")
      return false
    }
  }
}

function Profile() {
  const { user, setUser, toast } = useStore()
  const save = useSave()
  const [name, setName] = useState(user.name)
  const [busy, setBusy] = useState(false)
  const [plan, setPlan] = useState("free")
  const picker = useRef(null)
  const settings = user.settings || {}
  const source = settings.avatar_source || ""
  const usingGoogle = user.has_google_picture && (source === "" || source === "google")

  useEffect(() => {
    api.get("/api/billing").then((data) => setPlan(data.plan || "free")).catch(() => setPlan("free"))
  }, [])

  async function upload(event) {
    const file = event.target.files && event.target.files[0]
    event.target.value = ""
    if (!file) return
    if (file.size > 5 * 1024 * 1024) {
      toast("The picture is larger than 5 MB.", "error")
      return
    }
    setBusy(true)
    try {
      const form = new FormData()
      form.append("file", file)
      const data = await api.post("/api/account/avatar", form)
      setUser(data.user)
      toast("Profile photo updated", "ok")
    } catch (problem) {
      toast(problem.message, "error")
    }
    setBusy(false)
  }

  async function choose(value) {
    setBusy(true)
    try {
      const data = await api.post("/api/account/avatar/source", { source: value })
      setUser(data.user)
      toast(value === "none" ? "Photo removed" : "Using your Google photo", "ok")
    } catch (problem) {
      toast(problem.message, "error")
    }
    setBusy(false)
  }

  const [emailOpen, setEmailOpen] = useState(false)
  return (
    <>
      <Group>
        <div className="fw-profile">
          <Avatar user={user} size={64} />
          <div className="fw-profile-text">
            <strong dir="auto">{user.name || user.email}</strong>
            <span>{user.email}</span>
            <div className="fw-profile-actions">
              <Button size="sm" icon={Upload} loading={busy} onClick={() => picker.current.click()}>{user.avatar ? "Change photo" : "Upload photo"}</Button>
              {user.has_google_picture && !usingGoogle && <Button size="sm" variant="ghost" disabled={busy} onClick={() => choose("google")}>Use Google photo</Button>}
              {user.avatar && <Button size="sm" variant="ghost" disabled={busy} onClick={() => choose("none")}>Remove</Button>}
            </div>
          </div>
          <Link to="/app/billing" className="fw-profile-plan"><Badge tone={plan === "free" ? "neutral" : "brand"}>{plan.charAt(0).toUpperCase() + plan.slice(1)} plan</Badge></Link>
          <input ref={picker} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={upload} />
        </div>
        <p className="fw-profile-note">{usingGoogle && user.avatar ? "Your photo comes from your Google account." : "PNG, JPG or WebP up to 5 MB, cropped to a square."}</p>
      </Group>
      <Group label="Details">
        <Row title="Display name" description="How Forkwise addresses you.">
          <Input value={name} dir="auto" onChange={(e) => setName(e.target.value)} style={{ width: 240 }} aria-label="Display name" />
          <Button variant="primary" size="sm" disabled={!name.trim() || name === user.name} onClick={() => save({ name, settings: {} }, "Name saved")}>Save</Button>
        </Row>
        <Row title="Email" description={user.email}>
          <Button size="sm" onClick={() => setEmailOpen(true)}>Change</Button>
        </Row>
        <Row title="Member since" description={user.created_at ? new Date(user.created_at * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "-"} />
      </Group>
      <EmailDialog open={emailOpen} onClose={() => setEmailOpen(false)} />
    </>
  )
}

function Preferences() {
  const { theme, setTheme, user } = useStore()
  const save = useSave()
  const [voice, setVoice] = useState(() => {
    try { return localStorage.getItem("fw-voice") || navigator.language || "en-US" } catch (e) { return "en-US" }
  })
  const emails = !(user.settings && user.settings.email_updates === false)
  const voiceOptions = VOICES.map(([value, label]) => ({ value, label }))
  if (!voiceOptions.some((item) => item.value === voice)) voiceOptions.unshift({ value: voice, label: voice })

  function pickVoice(value) {
    setVoice(value)
    try { localStorage.setItem("fw-voice", value) } catch (e) { /* storage blocked */ }
  }

  const [speech, setSpeech] = useState(null)
  const [speaker, setSpeaker] = useState(() => {
    try { return localStorage.getItem("fw-voice-name") || "" } catch (e) { return "" }
  })
  useEffect(() => {
    let alive = true
    voiceInfo().then((info) => { if (alive) setSpeech(info) })
    return () => { alive = false }
  }, [])

  function pickSpeaker(value) {
    setSpeaker(value)
    try { localStorage.setItem("fw-voice-name", value) } catch (e) { /* storage blocked */ }
  }

  function preview() {
    const sample = new Speaker({ server: Boolean(speech && speech.speak), voice: speaker || (speech && speech.voice) || "", language: voice })
    sample.say(voice.startsWith("fa") ? "سلام! من فورک‌وایز هستم. هر وقت آماده بودی، با من حرف بزن." : "Hi, I'm Forkwise. Talk to me whenever you're ready.")
  }

  return (
    <>
      <Group label="Appearance">
        <Row title="Theme" description="How Forkwise looks on this device.">
          <Segmented value={theme} onChange={setTheme} options={[{ value: "dark", label: "Dark", icon: Moon }, { value: "light", label: "Light", icon: Sun }]} />
        </Row>
      </Group>
      <Group label="Voice">
        <Row title="Language you speak" description="Used for dictation and for voice conversations.">
          <Select value={voice} onChange={pickVoice} options={voiceOptions} width={230} searchable />
        </Row>
        {speech && speech.speak && speech.voices.length > 0 && (
          <Row title="Forkwise's voice" description="The voice that reads replies in a voice conversation.">
            <Select value={speaker || speech.voice} onChange={pickSpeaker} options={speech.voices.map((name) => ({ value: name, label: name.charAt(0).toUpperCase() + name.slice(1) }))} width={160} />
          </Row>
        )}
        <Row title="Try it" description={speech && speech.speak ? "Hear the voice you picked." : "Replies are read with your browser's voices. Your server admin can turn on natural voices."}>
          <Button onClick={preview}>Play a sample</Button>
        </Row>
      </Group>
      <Group label="Email notifications" description="Sign-in codes, receipts and security alerts always arrive. They keep your account safe.">
        <Row title="Product news" description="New features and tips, a few times a month.">
          <Switch checked={emails} label="Product news emails" onChange={(value) => save({ settings: { email_updates: value } }, value ? "Product emails on" : "Product emails off")} />
        </Row>
        <Row title="Plugin installs" description="An email when a plugin is added to your account.">
          <Switch checked={!(user.settings && user.settings.notify_plugins === false)} label="Plugin emails" onChange={(value) => save({ settings: { notify_plugins: value } }, "Saved")} />
        </Row>
        <Row title="Security alerts" description="New sign-ins, password and email changes, account deletion.">
          <Badge>Always on</Badge>
        </Row>
      </Group>
    </>
  )
}

function Agent() {
  const { user, models } = useStore()
  const save = useSave()
  const settings = user.settings || {}
  const [model, setModel] = useState(settings.model || "")
  const [instructions, setInstructions] = useState(settings.instructions || "")
  const dirty = model !== (settings.model || "") || instructions !== (settings.instructions || "")
  return (
    <>
      <Group label="Model">
        <Row title="Default model" description="Used for new chats. You can switch in any chat from the message box.">
          <Select value={model} onChange={setModel} width={230} searchable options={[{ value: "", label: "Server default" }].concat(models.map((item) => ({ value: item.key, label: item.label })))} />
        </Row>
      </Group>
      <div className="fw-group">
        <div className="fw-group-head"><h4>Custom instructions</h4><p>Forkwise reads this before every answer, in every chat.</p></div>
        <Textarea rows={7} dir="auto" value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="For example: keep code simple, explain steps briefly, always write tests." />
      </div>
      <div className="fw-save-bar">
        <Button variant="primary" disabled={!dirty} onClick={() => save({ settings: { model, instructions } }, "Saved")}>Save changes</Button>
      </div>
    </>
  )
}

function ago(seconds) {
  const diff = Math.max(0, Date.now() / 1000 - seconds)
  if (diff < 120) return "Active now"
  if (diff < 3600) return Math.floor(diff / 60) + " minutes ago"
  if (diff < 86400) return Math.floor(diff / 3600) + " hours ago"
  return new Date(seconds * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
}

function stamp(seconds) {
  return new Date(seconds * 1000).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
}

function SendCode({ purpose, email, onSent, label = "Send code" }) {
  const { toast } = useStore()
  const [left, setLeft] = useCooldown()
  const [busy, setBusy] = useState(false)
  async function send() {
    setBusy(true)
    try {
      const data = await api.post("/api/auth/code", { purpose, email: email || "" })
      setLeft(30)
      toast("Code sent to " + data.sent_to, "ok")
      if (onSent) onSent(data.sent_to)
    } catch (problem) {
      toast(problem.message, "error")
    }
    setBusy(false)
  }
  return <Button size="sm" variant="secondary" loading={busy} disabled={left > 0} onClick={send}>{left > 0 ? "Resend in " + left + "s" : label}</Button>
}

function EmailDialog({ open, onClose }) {
  const { user, setUser, toast, emailReady } = useStore()
  const [step, setStep] = useState(0)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [code, setCode] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) { setStep(0); setEmail(""); setPassword(""); setCode(""); setError("") }
  }, [open])

  async function sendCode() {
    setBusy(true)
    setError("")
    try {
      await api.post("/api/auth/code", { purpose: "email", email })
      setStep(1)
    } catch (problem) {
      setError(problem.message)
    }
    setBusy(false)
  }

  async function confirmChange(value) {
    setBusy(true)
    setError("")
    try {
      const data = await api.post("/api/auth/email", { email, password, code: value || code })
      setUser(data.user)
      toast("Email changed. We let your old address know.", "ok")
      onClose()
    } catch (problem) {
      setError(problem.message)
    }
    setBusy(false)
  }

  return (
    <Dialog open={open} onClose={onClose} size="sm" title="Change email" description={step === 0 ? "We'll send a code to the new address to make sure it's yours." : "Enter the 6-digit code we sent to " + email + "."}
      footer={step === 0
        ? <><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!email.includes("@") || (user.has_password && !password)} onClick={sendCode}>Send code</Button></>
        : <><Button variant="ghost" onClick={() => setStep(0)}>Back</Button><Button variant="primary" loading={busy} disabled={code.length < 6} onClick={() => confirmChange()}>Confirm</Button></>}>
      {!emailReady && <p className="fw-note is-warn">Email isn't set up on this server yet, so codes can't be sent.</p>}
      {step === 0 ? (
        <>
          <Field label="New email"><Input data-autofocus type="email" autoComplete="email" value={email} onChange={(e) => { setEmail(e.target.value); setError("") }} placeholder="name@company.com" /></Field>
          {user.has_password && <Field label="Current password"><Input type="password" autoComplete="current-password" value={password} onChange={(e) => { setPassword(e.target.value); setError("") }} /></Field>}
        </>
      ) : (
        <div className="fw-code-wrap">
          <CodeInput autoFocus value={code} onChange={(value) => { setCode(value); setError("") }} invalid={Boolean(error)} onComplete={confirmChange} />
          <SendCode purpose="email" email={email} label="Resend code" />
        </div>
      )}
      {error && <p className="fw-field-error" style={{ marginTop: 10 }}>{error}</p>}
    </Dialog>
  )
}

function DeleteDialog({ open, onClose }) {
  const { user, signOut, emailReady } = useStore()
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [reason, setReason] = useState("")
  const [password, setPassword] = useState("")
  const [code, setCode] = useState("")
  const [sent, setSent] = useState("")
  const [typed, setTyped] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) { setStep(0); setReason(""); setPassword(""); setCode(""); setSent(""); setTyped(""); setError("") }
  }, [open])

  const verified = (!user.has_password || password.length > 0) && (!emailReady || code.length === 6)

  async function finish() {
    setBusy(true)
    setError("")
    try {
      await api.post("/api/auth/delete", { password, code, confirm: typed, reason })
      signOut()
      navigate("/?deleted=1")
    } catch (problem) {
      setError(problem.message)
      if (/password|code/i.test(problem.message)) setStep(1)
    }
    setBusy(false)
  }

  const footers = [
    <><Button variant="ghost" onClick={onClose}>Keep my account</Button><Button variant="danger" onClick={() => setStep(1)}>Continue</Button></>,
    <><Button variant="ghost" onClick={() => setStep(0)}>Back</Button><Button variant="danger" disabled={!verified} onClick={() => { setError(""); setStep(2) }}>Continue</Button></>,
    <><Button variant="ghost" onClick={() => setStep(1)}>Back</Button><Button variant="danger" icon={Trash2} loading={busy} disabled={typed.trim().toUpperCase() !== "DELETE"} onClick={finish}>Delete account</Button></>,
  ]

  return (
    <Dialog open={open} onClose={onClose} size="md" title="Delete your account" footer={footers[step]}>
      <Steps steps={["Review", "Verify it's you", "Confirm"]} current={step} />
      {step === 0 && (
        <div className="fw-delete-info">
          <p>Your account is scheduled for deletion and you're signed out everywhere. You have <strong>14 days</strong> to change your mind by signing in again. After that, these are removed for good:</p>
          <ul>
            <li>All chats, files and workspaces</li>
            <li>Projects, memories, skills and plugins</li>
            <li>Connected accounts, secrets and API keys</li>
          </ul>
          <p className="fw-muted">Paid time left on your plan is not refunded. Download your data first from Your data.</p>
          <Field label="Why are you leaving?" hint="Optional. It helps us improve."><Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Missing a feature, too expensive, just testing…" /></Field>
        </div>
      )}
      {step === 1 && (
        <div className="fw-form">
          {user.has_password && <Field label="Password"><Input data-autofocus type="password" autoComplete="current-password" value={password} onChange={(e) => { setPassword(e.target.value); setError("") }} /></Field>}
          {emailReady ? (
            <Field label="Email code" hint={sent ? "Sent to " + sent + ". It works for 10 minutes." : "We'll email a 6-digit code to " + user.email + "."}>
              <div className="fw-code-wrap">
                <CodeInput value={code} onChange={(value) => { setCode(value); setError("") }} invalid={Boolean(error) && /code/i.test(error)} />
                <SendCode purpose="delete" onSent={setSent} label={sent ? "Resend" : "Send code"} />
              </div>
            </Field>
          ) : <p className="fw-note">Email isn't set up on this server, so only your password is checked.</p>}
        </div>
      )}
      {step === 2 && (
        <Field label={<>Type <code>DELETE</code> to confirm</>}>
          <Input data-autofocus value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" placeholder="DELETE" />
        </Field>
      )}
      {error && <p className="fw-field-error" style={{ marginTop: 10 }}>{error}</p>}
    </Dialog>
  )
}

function PasswordDialog({ open, onClose }) {
  const { user, toast, emailReady } = useStore()
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  const [again, setAgain] = useState("")
  const [code, setCode] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) { setCurrent(""); setNext(""); setAgain(""); setCode(""); setError("") }
  }, [open])

  const strength = next.length === 0 ? 0 : next.length < 8 ? 1 : (/[A-Z]/.test(next) + /[0-9]/.test(next) + /[^A-Za-z0-9]/.test(next) + (next.length >= 12)) >= 2 ? 3 : 2
  const mismatch = again && again !== next

  async function save(event) {
    if (event) event.preventDefault()
    if (next !== again) { setError("The two passwords don't match."); return }
    setBusy(true)
    try {
      await api.post("/api/auth/password", { current, password: next, code })
      toast("Password changed. Other devices were signed out.", "ok")
      onClose()
    } catch (problem) {
      setError(problem.message)
    }
    setBusy(false)
  }

  return (
    <Dialog open={open} onClose={onClose} size="sm" title={user.has_password ? "Change password" : "Set a password"} description="Changing it signs you out on every other device."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={next.length < 8 || next !== again || (user.has_password ? !current : emailReady && code.length < 6)} onClick={save}>Save password</Button></>}>
      <form className="fw-form" onSubmit={save}>
        {user.has_password ? (
          <Field label="Current password"><Input data-autofocus type="password" autoComplete="current-password" value={current} onChange={(e) => { setCurrent(e.target.value); setError("") }} /></Field>
        ) : emailReady && (
          <Field label="Email code" hint={"You signed up with Google. We'll email a code to " + user.email + "."}>
            <div className="fw-code-wrap"><CodeInput value={code} onChange={setCode} /><SendCode purpose="password" /></div>
          </Field>
        )}
        <Field label="New password" hint="At least 8 characters. Longer is stronger.">
          <Input type="password" autoComplete="new-password" value={next} onChange={(e) => { setNext(e.target.value); setError("") }} />
          <div className={"fw-strength s" + strength}><span /><span /><span /></div>
        </Field>
        <Field label="Repeat new password" error={mismatch ? "Doesn't match" : ""}><Input type="password" autoComplete="new-password" value={again} className={mismatch ? "is-invalid" : ""} onChange={(e) => { setAgain(e.target.value); setError("") }} /></Field>
        <button type="submit" hidden />
      </form>
      {error && <p className="fw-field-error" style={{ marginTop: 10 }}>{error}</p>}
    </Dialog>
  )
}

function Security() {
  const { user, toast } = useStore()
  const confirm = useConfirm()
  const [sessions, setSessions] = useState(null)
  const [events, setEvents] = useState(null)
  const [password, setPassword] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showAll, setShowAll] = useState(false)

  function load() {
    api.get("/api/auth/sessions").then((data) => setSessions(data.sessions)).catch(() => setSessions([]))
    api.get("/api/auth/activity").then((data) => setEvents(data.events)).catch(() => setEvents([]))
  }

  useEffect(load, [])

  async function revoke(item) {
    try {
      await api.del("/api/auth/sessions/" + item.id)
      setSessions((list) => list.filter((entry) => entry.id !== item.id))
      toast("Signed out " + item.device, "ok")
    } catch (problem) {
      toast(problem.message, "error")
    }
  }

  async function others() {
    const sure = await confirm({ title: "Sign out every other device?", text: "You stay signed in here. Everywhere else has to sign in again.", confirmLabel: "Sign out others" })
    if (!sure) return
    try {
      await api.post("/api/auth/sign-out-others")
      toast("Signed out of all other devices", "ok")
      load()
    } catch (problem) {
      toast(problem.message, "error")
    }
  }

  const otherCount = (sessions || []).filter((item) => !item.current).length
  const shownEvents = (events || []).slice(0, showAll ? 30 : 6)
  return (
    <>
      <Group label="Sign-in">
        <Row icon={KeyRound} title="Password" description={user.has_password ? "Signs you in with your email." : "You sign in with Google. Set a password to sign in with email too."}>
          <Button size="sm" onClick={() => setPassword(true)}>{user.has_password ? "Change" : "Set password"}</Button>
        </Row>
        <Row icon={Mail} title="Email verification" description="We email a code before sensitive changes like a new email or deleting the account.">
          <Badge tone="blue" dot>On</Badge>
        </Row>
      </Group>
      <Group label="Where you're signed in" description="Sessions last 30 days. End any you don't recognise.">
        {sessions === null && <div className="fw-pad"><Skeleton lines={2} /></div>}
        {(sessions || []).map((item) => (
          <Row key={item.id} icon={/iPhone|Android|iPad/.test(item.device) ? Smartphone : Monitor} title={<span className="fw-session-title">{item.device}{item.current && <Badge tone="blue">This device</Badge>}</span>} description={item.ip + " · " + (item.current ? "Active now" : ago(item.last_seen)) + " · Signed in " + stamp(item.created_at)}>
            {!item.current && <Button size="sm" variant="ghost" onClick={() => revoke(item)}>Sign out</Button>}
          </Row>
        ))}
        {otherCount > 1 && (
          <Row title="Sign out all other devices" description={otherCount + " other sessions"}>
            <Button size="sm" onClick={others}>Sign out others</Button>
          </Row>
        )}
      </Group>
      <Group label="Recent activity" description="Security events on your account from the last few months.">
        {events === null && <div className="fw-pad"><Skeleton lines={3} /></div>}
        {events && events.length === 0 && <div className="fw-pad fw-muted">No activity yet.</div>}
        {shownEvents.map((item) => (
          <div key={item.id} className={"fw-event" + (/failed|new|delete/.test(item.kind) ? " is-alert" : "")}>
            <span className="fw-event-dot" />
            <span className="fw-event-text"><strong>{item.label}</strong><span>{item.device}{item.ip ? " · " + item.ip : ""}</span></span>
            <span className="fw-event-time">{stamp(item.created_at)}</span>
          </div>
        ))}
        {events && events.length > 6 && <button type="button" className="fw-event-more" onClick={() => setShowAll(!showAll)}>{showAll ? "Show less" : "Show all activity"}</button>}
      </Group>
      <Group label="Delete account">
        <Row icon={Trash2} danger title="Delete your account" description="Signs you out everywhere and deletes your data after a 14-day grace period.">
          <Button size="sm" variant="danger" onClick={() => setDeleting(true)}>Delete account</Button>
        </Row>
      </Group>
      <PasswordDialog open={password} onClose={() => setPassword(false)} />
      <DeleteDialog open={deleting} onClose={() => setDeleting(false)} />
    </>
  )
}

function Computer() {
  const { user, toast } = useStore()
  const save = useSave()
  const confirm = useConfirm()
  const [data, setData] = useState(null)

  function load() {
    api.get("/api/desktop").then(setData).catch((problem) => toast(problem.message, "error"))
  }

  useEffect(() => {
    load()
    const timer = setInterval(load, 5000)
    return () => clearInterval(timer)
  }, [])

  async function remove(device) {
    if (!(await confirm({ title: "Unlink " + device.name + "?", text: "Forkwise loses access to this computer right away.", confirmLabel: "Unlink", danger: true }))) return
    await api.del("/api/desktop/" + device.id).catch((problem) => toast(problem.message, "error"))
    load()
  }

  const auto = Boolean(user.settings && user.settings.desktop_auto)
  const devices = (data && data.devices) || []
  const online = devices.filter((device) => device.online)
  const inApp = desktopApp()
  const platform = navigator.userAgent.includes("Windows") ? "Windows" : navigator.userAgent.includes("Mac") ? "macOS" : "Linux"
  const steps = [
    { done: inApp || devices.length > 0, title: "Install Forkwise Desktop", text: "Windows, macOS and Linux, about 90 MB." },
    { done: devices.length > 0, title: "Sign in to the app", text: "Your computer links itself." },
    { done: online.length > 0, title: "Keep the app open", text: "The agent works on your computer while the app runs." },
    { done: online.some((device) => device.chrome), title: "Add Forkwise for Chrome", text: "Optional: work in your own signed-in browser." },
  ]
  const caps = [
    { icon: Terminal, title: "Terminal" },
    { icon: FolderOpen, title: "Approved folders" },
    { icon: MousePointer2, title: "Screen, mouse, keyboard" },
    { icon: Globe, title: "Agent browser" },
  ]
  return (
    <>
      <div className={"fw-hero" + (online.length ? " is-on" : "")}>
        <span className="fw-hero-icon"><Laptop size={22} /></span>
        <div className="fw-hero-text">
          <h3>{online.length ? "Your computer is connected" : "Use your own computer"}</h3>
          <p>{online.length ? "The agent can work on " + online.map((device) => device.name).join(", ") + "." : "Your files, your terminal, your apps. The AI stays in the cloud; the work happens on your machine."}</p>
        </div>
        <Badge tone={online.length ? "brand" : "neutral"} dot>{online.length ? "Online" : devices.length ? "Offline" : "Not linked"}</Badge>
        {!inApp && (
          <div className="fw-hero-actions">
            {devices.length === 0 && <Link className="fw-btn fw-btn-primary" to="/download"><Download size={15} /><span>Download for {platform}</span></Link>}
            <a className="fw-btn fw-btn-secondary" href="forkwise://open">Open the app</a>
          </div>
        )}
      </div>
      <Group label="Set up">
        {steps.map((step) => (
          <Row key={step.title} icon={step.done ? CheckCircle2 : Circle} title={step.title} description={step.text}>{step.done && <Badge tone="brand"><Check size={11} />Done</Badge>}</Row>
        ))}
      </Group>
      <Group label="Linked computers">
        {!data && <div className="fw-pad"><Skeleton lines={2} /></div>}
        {data && devices.length === 0 && <div className="fw-pad fw-muted">No computers linked yet. Install the app and sign in; it shows up here by itself.</div>}
        {devices.map((device) => (
          <div key={device.id} className="fw-device">
            <Row icon={Laptop} title={device.name} description={(device.online ? "Online now" : device.last_seen ? "Last seen " + new Date(device.last_seen * 1000).toLocaleString() : "Waiting for the app") + (device.platform ? " · " + device.platform : "")}>
              <Badge tone={device.online ? "brand" : "neutral"} dot>{device.online ? "Online" : "Offline"}</Badge>
              <Button size="sm" variant="ghost" icon={Trash2} onClick={() => remove(device)} aria-label={"Unlink " + device.name}>Unlink</Button>
            </Row>
            <div className="fw-caps">
              {caps.map((item) => { const Icon = item.icon; return <span key={item.title} className={"fw-cap" + (device.online ? " is-on" : "")}><Icon size={13} />{item.title}</span> })}
              <span className={"fw-cap" + (device.chrome ? " is-on" : "")}><Chrome size={13} />{device.chrome ? (device.chrome_name || "Your Chrome") : "Chrome not added"}</span>
            </div>
          </div>
        ))}
      </Group>
      <Group label="Permissions">
        <Row title="Ask before every action" description="Recommended. Screenshots never ask. Press Ctrl Alt Shift X on the computer to stop everything at once.">
          <Switch checked={!auto} label="Ask before every action" onChange={(value) => save({ settings: { desktop_auto: !value } }, "Saved")} />
        </Row>
      </Group>
    </>
  )
}

function Usage() {
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  useEffect(() => {
    api.get("/api/usage").then(setData).catch(() => setData({ days: [], limit: 0 }))
  }, [])
  if (!data) return <Skeleton lines={4} />
  const days = data.days.slice(0, 30).reverse()
  const max = Math.max(1, ...days.map((day) => day.tokens_in + day.tokens_out))
  const total = days.reduce((sum, day) => sum + day.tokens_in + day.tokens_out, 0)
  const runs = days.reduce((sum, day) => sum + day.runs, 0)
  const fmt = (value) => (value >= 1000000 ? (value / 1000000).toFixed(1) + "M" : value >= 1000 ? Math.round(value / 1000) + "k" : String(value))
  return (
    <>
      <div className="fw-kpis">
        <div><span>Tokens, last 30 days</span><strong>{fmt(total)}</strong></div>
        <div><span>Tasks, last 30 days</span><strong>{runs}</strong></div>
        <div><span>Used today</span><strong>{data.limits ? Math.round(data.limits.day.used_pct) + "%" : "—"}</strong></div>
        <div><span>Used this week</span><strong>{data.limits ? Math.round(data.limits.week.used_pct) + "%" : "—"}</strong></div>
      </div>
      {data.limits && (
        <p className="fw-muted" style={{ margin: "4px 0 16px" }}>
          {"The daily limit resets " + new Date(data.limits.day.resets_at * 1000).toLocaleString() + ", the weekly limit " + new Date(data.limits.week.resets_at * 1000).toLocaleDateString() + ". "}
          {data.limits.unit === "usd" ? "Stronger models and higher effort use the limit faster." : "The free plan runs free and open-weight models."}
        </p>
      )}
      <Group label="Daily usage" description="Tokens are the text the AI reads and writes.">
        <div className="fw-pad">
          {days.length === 0 ? <p className="fw-muted">No usage yet.</p> : (
            <div className="fw-chart">
              {days.map((day) => (
                <div key={day.day} className="fw-chart-col" title={day.day + ": " + (day.tokens_in + day.tokens_out).toLocaleString() + " tokens, " + day.runs + " tasks"}>
                  <span style={{ height: Math.max(2, ((day.tokens_in + day.tokens_out) / max) * 100) + "%" }} />
                  <small>{day.day.slice(8)}</small>
                </div>
              ))}
            </div>
          )}
        </div>
      </Group>
      <Group>
        <Row icon={Gauge} title="Plan and billing" description="See your plan, upgrade or change billing." onClick={() => navigate("/app/billing")}><ArrowUpRight size={15} className="fw-muted" /></Row>
      </Group>
    </>
  )
}

const SHORTCUTS = [
  ["Search chats, projects and actions", "Ctrl K"],
  ["Show or hide the sidebar", "Ctrl B"],
  ["Open settings", "Ctrl ,"],
  ["Switch mode: agent, plan, ask first", "Shift Tab"],
  ["Pick a skill or command", "/"],
  ["Send the message", "Enter"],
  ["New line in the message", "Shift Enter"],
  ["Save the open file", "Ctrl S"],
  ["Close a dialog or menu", "Esc"],
]

function Shortcuts() {
  return (
    <Group description="On a Mac use Cmd instead of Ctrl.">
      {SHORTCUTS.map(([label, keys]) => <Row key={label} title={label}><Kbd>{keys}</Kbd></Row>)}
    </Group>
  )
}

function DataTab() {
  const { toast } = useStore()
  async function download() {
    try {
      const response = await fetch(apiUrl("/api/account/export"), { credentials: "include" })
      if (!response.ok) throw new Error("Could not prepare your export.")
      const blob = await response.blob()
      const link = document.createElement("a")
      link.href = URL.createObjectURL(blob)
      link.download = "forkwise-export.json"
      link.click()
      URL.revokeObjectURL(link.href)
    } catch (problem) {
      toast(problem.message, "error")
    }
  }
  return (
    <Group>
      <Row icon={Download} title="Export your data" description="A JSON file with your profile, chats and memories. Files the agent built download from each chat's Files panel.">
        <Button size="sm" onClick={download}>Download</Button>
      </Row>
    </Group>
  )
}

function Video() {
  return (
    <>
      <ModalConnect />
      <p className="fw-help">When you ask for a video, Forkwise renders it on your own Modal account: each scene renders on its own machine at the same time, and the finished video and its source come back to your workspace. Modal bills your account per second; new accounts get free monthly credit.</p>
    </>
  )
}

export default function Settings() {
  const { tab } = useParams()
  const navigate = useNavigate()
  const [query, setQuery] = useState("")
  const search = useRef(null)
  const current = tab || "general"

  useEffect(() => {
    function key(event) {
      if (event.key === "/" && document.activeElement && !/input|textarea/i.test(document.activeElement.tagName)) {
        event.preventDefault()
        if (search.current) search.current.focus()
      }
    }
    window.addEventListener("keydown", key)
    return () => window.removeEventListener("keydown", key)
  }, [])

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return GROUPS
    return GROUPS.map((group) => ({ ...group, tabs: group.tabs.filter((item) => (item.label + " " + item.text + " " + group.title).toLowerCase().includes(needle)) })).filter((group) => group.tabs.length > 0)
  }, [query])

  if (current === "memory" || current === "abilities" || current === "connectors") return <Navigate to={"/app/customize/" + current} replace />
  if (current === "preferences") return <Navigate to="/app/settings/appearance" replace />
  if (current === "studio") return <Navigate to="/app/settings/video" replace />
  const info = ALL_TABS.find((item) => item.key === current)
  if (!info) return <Navigate to="/app/settings" replace />

  return (
    <div className="fw-settings">
      <nav className="fw-set-nav" aria-label="Settings">
        <button type="button" className="fw-set-back" onClick={() => navigate("/app")}><ArrowLeft size={15} />Back to app</button>
        <label className="fw-set-search">
          <Search size={14} />
          <input ref={search} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search settings" aria-label="Search settings" />
          <Kbd>/</Kbd>
        </label>
        <div className="fw-set-groups">
          {groups.map((group) => (
            <div key={group.title} className="fw-set-group">
              <div className="fw-set-label">{group.title}</div>
              {group.tabs.map((item) => {
                const Icon = item.icon
                return <NavLink key={item.key} to={"/app/settings/" + item.key} className={"fw-set-link" + (current === item.key ? " is-active" : "")}><Icon size={15} />{item.label}</NavLink>
              })}
            </div>
          ))}
          {groups.length === 0 && <div className="fw-set-empty">No setting matches.</div>}
          <div className="fw-set-group">
            <div className="fw-set-label">More</div>
            <Link to="/app/billing" className="fw-set-link"><Gauge size={15} />Plan and billing</Link>
            <Link to="/app/customize" className="fw-set-link"><Sparkles size={15} />Skills and memory</Link>
            <a href="/docs" target="_blank" rel="noreferrer" className="fw-set-link"><BookOpen size={15} />Docs<ArrowUpRight size={12} className="fw-set-ext" /></a>
          </div>
        </div>
      </nav>
      <div className="fw-set-body">
        <div className="fw-set-inner">
          <header className="fw-set-head">
            <h1>{info.label}</h1>
            <p>{info.text}</p>
          </header>
          <div className="fw-set-content">
            {current === "general" && <Profile />}
            {current === "appearance" && <Preferences />}
            {current === "security" && <Security />}
            {current === "agent" && <Agent />}
            {current === "models" && <Providers />}
            {current === "connections" && <Connections />}
            {current === "secrets" && <Secrets />}
            {current === "api-keys" && <ApiKeys />}
            {current === "schedules" && <Schedules />}
            {current === "computer" && <Computer />}
            {current === "browser" && <Browser />}
            {current === "video" && <Video />}
            {current === "usage" && <Usage />}
            {current === "shortcuts" && <Shortcuts />}
            {current === "data" && <DataTab />}
          </div>
        </div>
      </div>
    </div>
  )
}

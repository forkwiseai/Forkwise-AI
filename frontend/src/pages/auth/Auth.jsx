import { useEffect, useState } from "react"
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom"
import { ArrowLeft, ArrowRight, BarChart3, Blocks, Building2, Check, Code2, Eye, EyeOff, FileText, FolderKanban, Globe, ListChecks, Lock, MailCheck, Palette, PenTool, Search, ShieldCheck, Sparkles, User, Zap } from "lucide-react"
import { LogoMark } from "../../components/ui/Logo"
import { usePageTitle } from "../../components/site/parts"
import { useStore } from "../../lib/store"
import { api, apiUrl } from "../../lib/api"
import { Button, CodeInput, Field, Input, Select, Steps, cx, useCooldown } from "../../dash/kit"
import "../../dash/dash.css"
import "../../dash/auth.css"

function GoogleButton({ label }) {
  const [enabled, setEnabled] = useState(false)
  // Google blocks its sign-in page inside apps, so the Android app signs in with email.
  const inApp = typeof navigator !== "undefined" && navigator.userAgent.includes("ForkwiseAndroid")
  useEffect(() => {
    api.get("/api/auth/providers").then((data) => setEnabled(Boolean(data.google))).catch(() => setEnabled(false))
  }, [])
  if (!enabled || inApp) return null
  return (
    <>
      <a className="fw-btn fw-btn-secondary fw-btn-lg fw-auth-google" href={apiUrl("/api/auth/google/start")}>
        <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden="true">
          <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
          <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
          <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
          <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
        </svg>
        <span>{label}</span>
      </a>
      <div className="fw-auth-or"><span>or</span></div>
    </>
  )
}

function Showcase() {
  return (
    <aside className="fw-auth-side" aria-hidden="true">
      <div className="fw-auth-demo">
        <div className="fw-auth-demo-msg">Build a landing page for my bakery and deploy it</div>
        <div className="fw-auth-demo-steps">
          <span><Search size={13} />Explored 6 files</span>
          <span><PenTool size={13} />Edited index.html, styles.css</span>
          <span><Code2 size={13} />Ran npm run build</span>
          <span className="is-live"><Globe size={13} />Deploying preview</span>
        </div>
        <div className="fw-auth-demo-card">
          <div className="fw-auth-demo-bar"><i /><i /><i /><span>bakery.forkwise.app</span></div>
          <div className="fw-auth-demo-page"><b /><i className="w70" /><i className="w50" /><div><span /><span /><span /></div></div>
        </div>
      </div>
      <div className="fw-auth-quote">
        <strong>An engineer with its own computer.</strong>
        <p>Forkwise plans, writes and runs code, checks its own work and shows you the result.</p>
      </div>
    </aside>
  )
}

function Shell({ children, wide, side = true }) {
  const { user, theme } = useStore()
  useEffect(() => {
    document.documentElement.dataset.theme = theme || "dark"
  }, [theme])
  return (
    <div className={cx("fw fw-auth", !side && "is-single")}>
      <div className="fw-auth-main">
        <header className="fw-auth-top">
          <Link to="/" className="fw-brand"><LogoMark size={22} /><span>Forkwise</span></Link>
          {user && <Link to="/app" className="fw-auth-toplink">Open app<ArrowRight size={14} /></Link>}
        </header>
        <main className={cx("fw-auth-body", wide && "is-wide")}>{children}</main>
        <footer className="fw-auth-foot">
          <span>By continuing you agree to the <Link to="/terms">Terms</Link> and <Link to="/privacy">Privacy policy</Link>.</span>
          <span className="fw-auth-secure"><Lock size={12} />Encrypted connection</span>
        </footer>
      </div>
      {side && <Showcase />}
    </div>
  )
}

function Alert({ tone = "error", children }) {
  if (!children) return null
  return <div className={cx("fw-auth-alert", "is-" + tone)} role={tone === "error" ? "alert" : "status"}>{children}</div>
}

function PasswordInput({ value, onChange, autoComplete, id, autoFocus, invalid }) {
  const [show, setShow] = useState(false)
  return (
    <label className={cx("fw-input", "has-icon", "fw-pw", invalid && "is-invalid")}>
      <input id={id} type={show ? "text" : "password"} value={value} onChange={onChange} autoComplete={autoComplete} autoFocus={autoFocus} required />
      <button type="button" className="fw-pw-eye" onClick={() => setShow(!show)} aria-label={show ? "Hide password" : "Show password"}>
        {show ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </label>
  )
}

function strengthOf(password) {
  if (!password) return { level: 0, label: "" }
  if (password.length < 8) return { level: 1, label: "Too short" }
  const score = /[A-Z]/.test(password) + /[a-z]/.test(password) + /[0-9]/.test(password) + /[^A-Za-z0-9]/.test(password) + (password.length >= 12)
  if (score >= 4) return { level: 4, label: "Strong" }
  if (score >= 3) return { level: 3, label: "Good" }
  return { level: 2, label: "Fair" }
}

function Strength({ password }) {
  const { level, label } = strengthOf(password)
  return (
    <div className={"fw-auth-strength s" + level}>
      <div><span /><span /><span /><span /></div>
      <small>{label || "At least 8 characters"}</small>
    </div>
  )
}

const GOOGLE_ERRORS = {
  google_unverified: "Google says this email isn't verified.",
  google_off: "Google sign-in isn't switched on yet.",
  google_failed: "Google sign-in didn't work. Try again.",
}

export function Login() {
  usePageTitle("Sign in", "")
  const { user, signIn, loadMe, toast } = useStore()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  if (user) return <Navigate to={params.get("next") || "/app"} replace />

  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError("")
    try {
      const data = await api.post("/api/auth/login", { email, password })
      signIn(data.user)
      await loadMe()
      if (data.restored) toast("Welcome back. Your account is no longer scheduled for deletion.", "ok")
      navigate(params.get("next") || "/app")
    } catch (problem) {
      if (problem.raw === "verify_email") {
        navigate("/verify?email=" + encodeURIComponent(email.trim().toLowerCase()) + "&sent=1")
        return
      }
      setError(problem.message)
      setBusy(false)
    }
  }

  return (
    <Shell>
      <form className="fw-auth-form" onSubmit={submit}>
        <div className="fw-auth-head">
          <h1>Sign in to Forkwise</h1>
          <p>Welcome back. Pick up where you left off.</p>
        </div>
        <Alert>{GOOGLE_ERRORS[params.get("error")] || (params.get("error") ? GOOGLE_ERRORS.google_failed : "")}</Alert>
        <GoogleButton label="Continue with Google" />
        <Field label="Email" htmlFor="email">
          <Input id="email" type="email" value={email} onChange={(e) => { setEmail(e.target.value); setError("") }} autoComplete="email" placeholder="name@company.com" required autoFocus />
        </Field>
        <div className="fw-field">
          <div className="fw-auth-labelrow"><label className="fw-field-label" htmlFor="password">Password</label><Link to={"/forgot" + (email ? "?email=" + encodeURIComponent(email) : "")} className="fw-auth-link">Forgot password?</Link></div>
          <PasswordInput id="password" value={password} onChange={(e) => { setPassword(e.target.value); setError("") }} autoComplete="current-password" invalid={Boolean(error)} />
        </div>
        <Alert>{error}</Alert>
        <Button type="submit" variant="primary" size="lg" loading={busy} className="fw-auth-submit">{busy ? "Signing in" : "Sign in"}</Button>
        <p className="fw-auth-alt">New to Forkwise? <Link to="/register" className="fw-auth-link">Create an account</Link></p>
      </form>
    </Shell>
  )
}

export function Register() {
  usePageTitle("Create your account", "")
  const { user, signIn, loadMe } = useStore()
  const navigate = useNavigate()
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [agree, setAgree] = useState(false)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  if (user) return <Navigate to="/app" replace />

  async function submit(event) {
    event.preventDefault()
    if (password.length < 8) {
      setError("Use at least 8 characters for your password.")
      return
    }
    if (!agree) {
      setError("Accept the Terms and Privacy policy to continue.")
      return
    }
    setBusy(true)
    setError("")
    try {
      const data = await api.post("/api/auth/register", { email, password, name })
      if (data.pending) {
        navigate("/verify?email=" + encodeURIComponent(data.email) + "&sent=1")
        return
      }
      signIn(data.user)
      await loadMe()
      navigate("/welcome")
    } catch (problem) {
      setError(problem.message)
      setBusy(false)
    }
  }

  return (
    <Shell>
      <form className="fw-auth-form" onSubmit={submit}>
        <div className="fw-auth-head">
          <h1>Create your account</h1>
          <p>Free to start. No credit card needed.</p>
        </div>
        <GoogleButton label="Sign up with Google" />
        <Field label="Full name" htmlFor="name">
          <Input id="name" dir="auto" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="Ada Lovelace" autoFocus />
        </Field>
        <Field label="Work or personal email" htmlFor="email">
          <Input id="email" type="email" value={email} onChange={(e) => { setEmail(e.target.value); setError("") }} autoComplete="email" placeholder="name@company.com" required />
        </Field>
        <div className="fw-field">
          <label className="fw-field-label" htmlFor="password">Password</label>
          <PasswordInput id="password" value={password} onChange={(e) => { setPassword(e.target.value); setError("") }} autoComplete="new-password" />
          <Strength password={password} />
        </div>
        <label className="fw-auth-agree">
          <input type="checkbox" checked={agree} onChange={(e) => { setAgree(e.target.checked); setError("") }} />
          <span>I agree to the <Link to="/terms" target="_blank">Terms</Link> and <Link to="/privacy" target="_blank">Privacy policy</Link>.</span>
        </label>
        <Alert>{error}</Alert>
        <Button type="submit" variant="primary" size="lg" loading={busy} className="fw-auth-submit">{busy ? "Creating your account" : "Create account"}</Button>
        <p className="fw-auth-alt">Already have an account? <Link to="/login" className="fw-auth-link">Sign in</Link></p>
      </form>
    </Shell>
  )
}

export function Verify() {
  usePageTitle("Check your email", "")
  const { user, signIn, loadMe } = useStore()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const email = (params.get("email") || "").toLowerCase()
  const [code, setCode] = useState("")
  const [error, setError] = useState("")
  const [info, setInfo] = useState("")
  const [busy, setBusy] = useState(false)
  const [wait, setWait] = useCooldown()

  useEffect(() => {
    if (params.get("sent")) setWait(30)
  }, [])

  if (user) return <Navigate to="/welcome" replace />
  if (!email) return <Navigate to="/register" replace />

  async function submit(text) {
    if (busy) return
    setBusy(true)
    setError("")
    try {
      const data = await api.post("/api/auth/verify", { email, code: text })
      signIn(data.user)
      await loadMe()
      navigate("/welcome")
    } catch (problem) {
      setError(problem.message)
      setCode("")
      setBusy(false)
    }
  }

  async function resend() {
    setError("")
    setInfo("")
    try {
      await api.post("/api/auth/resend", { email })
      setInfo("A new code is on its way.")
      setWait(30)
      setCode("")
    } catch (problem) {
      setError(problem.message)
    }
  }

  return (
    <Shell>
      <form className="fw-auth-form" onSubmit={(event) => { event.preventDefault(); if (code.length === 6) submit(code) }}>
        <span className="fw-auth-badge"><MailCheck size={20} /></span>
        <div className="fw-auth-head">
          <h1>Check your email</h1>
          <p>We sent a 6-digit code to <strong>{email}</strong>. Enter it to confirm the address is yours.</p>
        </div>
        <CodeInput autoFocus value={code} onChange={(value) => { setCode(value); setError("") }} onComplete={submit} invalid={Boolean(error)} />
        <Alert tone="ok">{!error && info}</Alert>
        <Alert>{error}</Alert>
        <Button type="submit" variant="primary" size="lg" loading={busy} disabled={code.length < 6} className="fw-auth-submit">{busy ? "Checking" : "Verify email"}</Button>
        <div className="fw-auth-row">
          <button type="button" className="fw-auth-link" onClick={resend} disabled={wait > 0}>{wait > 0 ? "Resend code in " + wait + "s" : "Resend code"}</button>
          <Link to="/register" className="fw-auth-link">Use a different email</Link>
        </div>
        <p className="fw-auth-fine">Can't find it? Check spam or promotions. The code works for 10 minutes.</p>
      </form>
    </Shell>
  )
}

export function Forgot() {
  usePageTitle("Reset your password", "")
  const [params] = useSearchParams()
  const [email, setEmail] = useState(params.get("email") || "")
  const [sent, setSent] = useState(false)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [wait, setWait] = useCooldown()

  async function submit(event) {
    if (event) event.preventDefault()
    setBusy(true)
    setError("")
    try {
      await api.post("/api/auth/forgot", { email })
      setSent(true)
      setWait(30)
    } catch (problem) {
      setError(problem.message)
    }
    setBusy(false)
  }

  return (
    <Shell>
      <form className="fw-auth-form" onSubmit={submit}>
        <Link to="/login" className="fw-auth-back"><ArrowLeft size={14} />Back to sign in</Link>
        {sent ? (
          <>
            <span className="fw-auth-badge"><MailCheck size={20} /></span>
            <div className="fw-auth-head">
              <h1>Check your inbox</h1>
              <p>If an account exists for <strong>{email}</strong>, a link to reset the password is on its way. It works for one hour.</p>
            </div>
            <Button variant="secondary" size="lg" disabled={wait > 0} loading={busy} onClick={() => submit()} className="fw-auth-submit">{wait > 0 ? "Send again in " + wait + "s" : "Send again"}</Button>
          </>
        ) : (
          <>
            <div className="fw-auth-head">
              <h1>Reset your password</h1>
              <p>Enter the email you signed up with. We'll send you a secure link to choose a new password.</p>
            </div>
            <Field label="Email" htmlFor="email">
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" required autoFocus />
            </Field>
            <Alert>{error}</Alert>
            <Button type="submit" variant="primary" size="lg" loading={busy} className="fw-auth-submit">Send reset link</Button>
          </>
        )}
      </form>
    </Shell>
  )
}

export function Reset() {
  usePageTitle("Choose a new password", "")
  const { token } = useParams()
  const { signIn, loadMe } = useStore()
  const navigate = useNavigate()
  const [password, setPassword] = useState("")
  const [again, setAgain] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  async function submit(event) {
    event.preventDefault()
    if (password !== again) {
      setError("The two passwords don't match.")
      return
    }
    setBusy(true)
    setError("")
    try {
      const data = await api.post("/api/auth/reset", { token, password })
      signIn(data.user)
      await loadMe()
      navigate("/app")
    } catch (problem) {
      setError(problem.message)
      setBusy(false)
    }
  }

  return (
    <Shell>
      <form className="fw-auth-form" onSubmit={submit}>
        <span className="fw-auth-badge"><ShieldCheck size={20} /></span>
        <div className="fw-auth-head">
          <h1>Choose a new password</h1>
          <p>Every other device is signed out once you save it.</p>
        </div>
        <div className="fw-field">
          <label className="fw-field-label" htmlFor="password">New password</label>
          <PasswordInput id="password" value={password} onChange={(e) => { setPassword(e.target.value); setError("") }} autoComplete="new-password" autoFocus />
          <Strength password={password} />
        </div>
        <div className="fw-field">
          <label className="fw-field-label" htmlFor="again">Repeat password</label>
          <PasswordInput id="again" value={again} onChange={(e) => { setAgain(e.target.value); setError("") }} autoComplete="new-password" invalid={Boolean(again) && again !== password} />
        </div>
        <Alert>{error}</Alert>
        <Button type="submit" variant="primary" size="lg" loading={busy} disabled={password.length < 8 || !again} className="fw-auth-submit">Save and sign in</Button>
      </form>
    </Shell>
  )
}

const TEAM_SIZES = ["2-10", "11-50", "51-200", "201-1000", "1000+"]
const INDUSTRIES = ["Software and IT", "Marketing and media", "Education", "Finance", "E-commerce and retail", "Healthcare", "Design and creative", "Research and science", "Consulting and agency", "Government and non-profit", "Student", "Other"]
const ROLES = ["Founder or executive", "Software engineer", "Product manager", "Designer", "Data or analytics", "Marketing", "Operations", "Researcher", "Student", "Other"]
const GOALS = [
  { label: "Build websites and apps", icon: Code2, plugins: ["frontend-design", "testing"] },
  { label: "Review and fix code", icon: ShieldCheck, plugins: ["code-review", "security-audit"] },
  { label: "Analyse data", icon: BarChart3, plugins: ["data-analyst"] },
  { label: "Research topics", icon: Search, plugins: ["deep-research"] },
  { label: "Write docs and content", icon: FileText, plugins: ["docs-writer"] },
  { label: "Design and slides", icon: Palette, plugins: ["slides", "frontend-design"] },
  { label: "Plan products", icon: ListChecks, plugins: ["product-manager"] },
  { label: "Grow a website", icon: Globe, plugins: ["seo"] },
]
const EXPERIENCE = [
  { value: "beginner", label: "New to code" },
  { value: "intermediate", label: "Some experience" },
  { value: "expert", label: "Professional" },
]
const REFERRALS = ["Google search", "Friend or colleague", "X or Twitter", "YouTube", "LinkedIn", "Reddit", "Newsletter or blog", "Other"]
const GUIDE = [
  { icon: Zap, title: "Describe the outcome", text: "Type what you want built. Forkwise plans, writes and runs the code on its own computer, then shows you the result." },
  { icon: ListChecks, title: "Pick a mode", text: "Agent works start to finish. Plan agrees the approach first. Ask first checks with you before changing anything. Shift Tab switches." },
  { icon: Blocks, title: "Add plugins", text: "Plugins add skills, slash commands and connectors, like /review or live library docs." },
  { icon: FolderKanban, title: "Keep work in projects", text: "Projects share files, instructions and memory across many chats." },
]

function options(list) {
  return list.map((item) => ({ value: item, label: item }))
}

export function Welcome() {
  usePageTitle("Welcome", "")
  const { user, ready, setUser, toast } = useStore()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const saved = (user && user.settings && user.settings.profile) || {}
  const [step, setStep] = useState(0)
  const [profile, setProfile] = useState({
    account_type: saved.account_type || "",
    org_name: saved.org_name || "",
    team_size: saved.team_size && saved.team_size !== "1" ? saved.team_size : "2-10",
    industry: saved.industry || "",
    role: saved.role || "",
    goals: saved.goals || [],
    experience: saved.experience || "",
    referral: saved.referral || "",
  })
  const [picked, setPicked] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const next = params.get("next") || "/app"

  if (!ready) return <div className="fw fw-auth-loading" />
  if (!user) return <Navigate to="/login?next=/welcome" replace />

  function set(key, value) {
    setProfile((current) => ({ ...current, [key]: value }))
  }

  function toggleGoal(goal) {
    set("goals", profile.goals.includes(goal) ? profile.goals.filter((item) => item !== goal) : [...profile.goals, goal])
  }

  const suggested = []
  for (const goal of GOALS) {
    if (!profile.goals.includes(goal.label)) continue
    for (const id of goal.plugins) if (!suggested.includes(id)) suggested.push(id)
  }
  if (suggested.length === 0) suggested.push("code-review", "deep-research")
  const chosen = picked || suggested

  async function finish(skipped) {
    setBusy(true)
    setError("")
    try {
      const data = await api.post("/api/auth/profile", { ...profile, account_type: profile.account_type || "personal", skipped: Boolean(skipped) })
      if (!skipped && chosen.length) {
        await Promise.all(chosen.map((id) => api.post("/api/plugins/" + id + "/install").catch(() => null)))
        toast(chosen.length + " plugin" + (chosen.length > 1 ? "s" : "") + " installed", "ok")
      }
      setUser(data.user)
      try { localStorage.setItem("fw-onboarded", "1") } catch (e) { /* storage blocked */ }
      navigate(next, { replace: true })
    } catch (problem) {
      setError(problem.message)
      setBusy(false)
    }
  }

  const org = profile.account_type === "organization"
  const canContinue = step === 0 ? Boolean(profile.account_type) : step === 1 ? Boolean(profile.industry) && (!org || profile.org_name.trim()) : true
  const first = (user.name || "").split(" ")[0]

  return (
    <Shell wide side={false}>
      <form className="fw-auth-form fw-welcome" onSubmit={(event) => { event.preventDefault(); if (!canContinue) return; if (step < 3) setStep(step + 1); else finish(false) }}>
        <Steps steps={["Account", "About you", "Goals", "Get started"]} current={step} />
        <div className="fw-welcome-pane" key={step}>
          {step === 0 && (
            <>
              <div className="fw-auth-head">
                <h1>Welcome{first ? ", " + first : ""}</h1>
                <p>Your account is ready. A few quick questions so Forkwise fits the way you work.</p>
              </div>
              <div className="fw-choice-grid" role="radiogroup">
                {[{ value: "personal", icon: User, title: "For myself", text: "Personal projects, learning and everyday tasks." }, { value: "organization", icon: Building2, title: "For my team", text: "A company, startup, agency or school." }].map((item) => {
                  const Icon = item.icon
                  const on = profile.account_type === item.value
                  return (
                    <button key={item.value} type="button" role="radio" aria-checked={on} className={cx("fw-choice", on && "is-on")} onClick={() => set("account_type", item.value)}>
                      <span className="fw-choice-icon"><Icon size={18} /></span>
                      <strong>{item.title}</strong>
                      <small>{item.text}</small>
                      <span className="fw-choice-check"><Check size={12} strokeWidth={3} /></span>
                    </button>
                  )
                })}
              </div>
            </>
          )}
          {step === 1 && (
            <>
              <div className="fw-auth-head">
                <h1>{org ? "About your team" : "About you"}</h1>
                <p>This helps Forkwise pick better examples and defaults.</p>
              </div>
              {org && (
                <>
                  <Field label="Organization name"><Input dir="auto" value={profile.org_name} onChange={(e) => set("org_name", e.target.value)} maxLength={120} autoFocus placeholder="Acme Inc." /></Field>
                  <Field label="Team size">
                    <div className="fw-seg-choice" role="radiogroup">
                      {TEAM_SIZES.map((size) => <button type="button" role="radio" aria-checked={profile.team_size === size} key={size} className={profile.team_size === size ? "is-on" : ""} onClick={() => set("team_size", size)}>{size}</button>)}
                    </div>
                  </Field>
                </>
              )}
              <Field label={org ? "Industry" : "Field"}><Select value={profile.industry} onChange={(value) => set("industry", value)} options={options(INDUSTRIES)} placeholder="Choose one" width="100%" /></Field>
              <Field label="Your role"><Select value={profile.role} onChange={(value) => set("role", value)} options={options(ROLES)} placeholder="Choose one" width="100%" /></Field>
            </>
          )}
          {step === 2 && (
            <>
              <div className="fw-auth-head">
                <h1>What will you use it for?</h1>
                <p>Pick as many as you like. We'll suggest plugins to match.</p>
              </div>
              <div className="fw-goal-grid">
                {GOALS.map((goal) => {
                  const Icon = goal.icon
                  const on = profile.goals.includes(goal.label)
                  return (
                    <button type="button" key={goal.label} aria-pressed={on} className={cx("fw-goal", on && "is-on")} onClick={() => toggleGoal(goal.label)}>
                      <Icon size={15} /><span>{goal.label}</span>{on && <Check size={14} className="fw-goal-check" />}
                    </button>
                  )
                })}
              </div>
              <Field label="Coding experience">
                <div className="fw-seg-choice" role="radiogroup">
                  {EXPERIENCE.map((item) => <button type="button" role="radio" aria-checked={profile.experience === item.value} key={item.value} className={profile.experience === item.value ? "is-on" : ""} onClick={() => set("experience", item.value)}>{item.label}</button>)}
                </div>
              </Field>
              <Field label="How did you hear about us?" hint="Optional"><Select value={profile.referral} onChange={(value) => set("referral", value)} options={options(REFERRALS)} placeholder="Choose one" width="100%" /></Field>
            </>
          )}
          {step === 3 && (
            <>
              <div className="fw-auth-head">
                <h1>How Forkwise works</h1>
                <p>Four things worth knowing before your first task.</p>
              </div>
              <div className="fw-guide">
                {GUIDE.map((item, index) => {
                  const Icon = item.icon
                  return (
                    <div key={item.title} className="fw-guide-item" style={{ animationDelay: index * 50 + "ms" }}>
                      <span className="fw-guide-icon"><Icon size={16} /></span>
                      <div><strong>{item.title}</strong><p>{item.text}</p></div>
                    </div>
                  )
                })}
              </div>
              <div className="fw-guide-plugins">
                <span className="fw-field-label"><Sparkles size={13} />Suggested plugins</span>
                <div className="fw-goal-grid">
                  {suggested.map((id) => {
                    const on = chosen.includes(id)
                    return (
                      <button key={id} type="button" aria-pressed={on} className={cx("fw-goal", on && "is-on")} onClick={() => setPicked(on ? chosen.filter((item) => item !== id) : [...chosen, id])}>
                        <Blocks size={14} /><span>{id.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ")}</span>{on && <Check size={14} className="fw-goal-check" />}
                      </button>
                    )
                  })}
                </div>
              </div>
            </>
          )}
        </div>
        <Alert>{error}</Alert>
        <div className="fw-welcome-actions">
          {step > 0 ? <Button variant="ghost" icon={ArrowLeft} onClick={() => setStep(step - 1)}>Back</Button> : <Button variant="ghost" disabled={busy} onClick={() => finish(true)}>Skip for now</Button>}
          <Button type="submit" variant="primary" size="lg" loading={busy} disabled={!canContinue} iconRight={step < 3 ? ArrowRight : undefined}>{step < 3 ? "Continue" : "Start using Forkwise"}</Button>
        </div>
      </form>
    </Shell>
  )
}

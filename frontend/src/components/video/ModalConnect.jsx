import { useEffect, useRef, useState } from "react"
import { CheckCircle2, CloudCog, ExternalLink, Loader2, RefreshCw, Unplug, XCircle } from "lucide-react"
import { api } from "../../lib/api"
import { useStore } from "../../lib/store"

const LABELS = {
  ready: "Ready",
  deploying: "Installing in your account…",
  outdated: "Update ready to install",
  error: "Install failed",
  new: "Connected",
}

// Connects the user's own Modal account. Videos render there, never on Forkwise's server.
export default function ModalConnect({ compact = false, onChange }) {
  const { toast } = useStore()
  const [state, setState] = useState(null)
  const [tokenId, setTokenId] = useState("")
  const [tokenSecret, setTokenSecret] = useState("")
  const [busy, setBusy] = useState(false)
  const [showLog, setShowLog] = useState(false)
  const timer = useRef(null)

  async function refresh() {
    try {
      const next = await api.get("/api/studio/modal")
      setState(next)
      if (onChange) onChange(next)
      clearTimeout(timer.current)
      if (next.connected && next.status === "deploying") timer.current = setTimeout(refresh, 4000)
    } catch (problem) {
      setState({ connected: false })
    }
  }

  useEffect(() => {
    refresh()
    return () => clearTimeout(timer.current)
  }, [])

  async function connect(event) {
    event.preventDefault()
    setBusy(true)
    try {
      const next = await api.post("/api/studio/modal", { token_id: tokenId, token_secret: tokenSecret })
      setTokenId("")
      setTokenSecret("")
      toast("Modal connected. Installing the video renderer in your account.", "ok")
      setState(next)
      setTimeout(refresh, 1500)
    } catch (problem) {
      toast(problem.message, "error")
    }
    setBusy(false)
  }

  async function redeploy() {
    setBusy(true)
    try {
      setState(await api.post("/api/studio/modal/deploy"))
      setTimeout(refresh, 1500)
    } catch (problem) {
      toast(problem.message, "error")
    }
    setBusy(false)
  }

  async function disconnect() {
    setBusy(true)
    await api.del("/api/studio/modal").catch(() => null)
    setBusy(false)
    refresh()
  }

  if (!state) return <div className={"fw-settings-card fw-studio-connect" + (compact ? " fw-compact" : "")}><Loader2 size={16} className="fw-spin" /></div>

  if (state.connected) {
    const status = state.status || "new"
    const Icon = status === "ready" ? CheckCircle2 : status === "error" ? XCircle : status === "deploying" ? Loader2 : CloudCog
    return (
      <div className={"fw-settings-card fw-studio-connect fw-on" + (compact ? " fw-compact" : "")}>
        <div className="fw-studio-connect-row">
          <span className={"fw-studio-connect-icon " + status}><Icon size={18} className={status === "deploying" ? "fw-spin" : ""} /></span>
          <div className="fw-grow">
            <strong>Modal · {state.account || "your account"}</strong>
            <span className="fw-muted fw-small">{LABELS[status] || status}{status === "ready" ? " — videos render in your Modal account" : ""}{status === "error" && state.error ? ": " + state.error : ""}</span>
          </div>
          {(status === "outdated" || status === "error" || status === "new") && <button type="button" className="fw-btn fw-btn-primary fw-btn-sm" onClick={redeploy} disabled={busy}><RefreshCw size={14} />{status === "error" ? "Try again" : "Install now"}</button>}
          {!compact && <button type="button" className="fw-btn fw-btn-ghost fw-btn-sm" onClick={disconnect} disabled={busy}><Unplug size={14} />Disconnect</button>}
        </div>
        {!compact && state.log && <button type="button" className="fw-link-btn fw-small" onClick={() => setShowLog(!showLog)}>{showLog ? "Hide install log" : "Show install log"}</button>}
        {showLog && <pre className="fw-studio-log">{state.log}</pre>}
      </div>
    )
  }

  return (
    <form className={"fw-settings-card fw-studio-connect" + (compact ? " fw-compact" : "")} onSubmit={connect}>
      <div className="fw-studio-connect-row">
        <span className="fw-studio-connect-icon"><CloudCog size={18} /></span>
        <div className="fw-grow">
          <strong>Connect your Modal account</strong>
          <span className="fw-muted fw-small">Videos render on your own Modal account (it includes free monthly credit). Forkwise installs the renderer there for you.</span>
        </div>
      </div>
      <ol className="fw-studio-steps fw-small">
        <li>Sign in at <a href="https://modal.com/signup" target="_blank" rel="noreferrer">modal.com <ExternalLink size={11} /></a></li>
        <li>Open <a href="https://modal.com/settings/tokens" target="_blank" rel="noreferrer">Settings → API Tokens <ExternalLink size={11} /></a> and press <b>New Token</b></li>
        <li>Paste both values here (the secret is shown only once)</li>
      </ol>
      <div className="fw-studio-token-fields">
        <input className="fw-input fw-mono" placeholder="Token ID (ak-…)" value={tokenId} onChange={(event) => setTokenId(event.target.value)} autoComplete="off" spellCheck={false} />
        <input className="fw-input fw-mono" placeholder="Token Secret (as-…)" type="password" value={tokenSecret} onChange={(event) => setTokenSecret(event.target.value)} autoComplete="new-password" spellCheck={false} />
        <button className="fw-btn fw-btn-primary" disabled={busy || !tokenId || !tokenSecret}>{busy ? <Loader2 size={15} className="fw-spin" /> : <CloudCog size={15} />}Connect</button>
      </div>
      <span className="fw-muted fw-small">The token is stored encrypted and only used to render your videos.</span>
    </form>
  )
}

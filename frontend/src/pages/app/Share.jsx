import { useEffect, useState } from "react"
import { Link, useNavigate, useParams } from "react-router-dom"
import { GitBranch, Lock } from "lucide-react"
import MessageList from "../../components/app/MessageList"
import { LogoMark } from "../../components/ui/Logo"
import { api } from "../../lib/api"
import { emptyLive } from "../../lib/useChat"
import { useStore } from "../../lib/store"
import { Button, Skeleton } from "../../dash/kit"
import "../../dash/dash.css"
import "../../dash/layout.css"
import "../../dash/pages.css"
import "../../dash/chat.css"

function when(stamp) {
  return new Date(stamp * 1000).toLocaleDateString(undefined, { dateStyle: "long" })
}

// A shared chat, read-only, for anyone with the link.
export default function Share() {
  const { token } = useParams()
  const navigate = useNavigate()
  const { user, theme } = useStore()
  const [data, setData] = useState(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.setAttribute("data-dash", "")
    return () => document.documentElement.removeAttribute("data-dash")
  }, [theme])

  useEffect(() => {
    api.get("/api/share/" + token).then((result) => {
      setData(result)
      document.title = result.title + " · Forkwise"
    }).catch((problem) => setError(problem.message))
  }, [token])

  async function continueHere() {
    if (!user) {
      navigate("/login?next=" + encodeURIComponent("/share/" + token))
      return
    }
    setBusy(true)
    try {
      const result = await api.post("/api/share/" + token + "/fork")
      navigate("/app/c/" + result.chat.id)
    } catch (problem) {
      setError(problem.message)
      setBusy(false)
    }
  }

  const state = data && { messages: data.messages, live: emptyLive, chat: { mode: "auto" } }
  return (
    <div className="fw fw-share-page">
      <header className="fw-share-top">
        <Link to="/" className="fw-brand"><LogoMark size={22} /><span>Forkwise</span></Link>
        <span className="fw-grow" />
        {data && <Button variant="primary" size="sm" icon={GitBranch} loading={busy} onClick={continueHere}>{user ? "Continue this chat" : "Sign in to continue"}</Button>}
      </header>
      <main className="fw-share-main">
        {error && (
          <div className="fw-share-missing"><Lock size={22} /><h1>This chat isn't available</h1><p>{error}</p><Link className="fw-btn fw-btn-secondary fw-btn-sm" to="/app">Open Forkwise</Link></div>
        )}
        {!error && !data && <div className="fw-chat-inner"><Skeleton lines={8} /></div>}
        {data && (
          <div className="fw-chat-inner">
            <div className="fw-share-intro">
              <h1 dir="auto">{data.title}</h1>
              <p>Shared{data.author ? " by " + data.author : ""} · {when(data.shared_at)} · Read-only</p>
            </div>
            <MessageList state={state} wid={"share:" + token} respond={() => {}} onPreview={() => {}} readOnly />
          </div>
        )}
      </main>
    </div>
  )
}

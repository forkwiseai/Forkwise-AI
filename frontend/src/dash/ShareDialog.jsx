import { useEffect, useState } from "react"
import { Check, Copy, Eye, Globe2, Lock, RefreshCw } from "lucide-react"
import { Button, Dialog, Spinner } from "./kit"
import { api } from "../lib/api"
import { useStore } from "../lib/store"

function when(stamp) {
  if (!stamp) return ""
  return new Date(stamp * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
}

// Share a chat: private (only you) or public (anyone with the link can read a snapshot of it).
export default function ShareDialog() {
  const { toast } = useStore()
  const [chat, setChat] = useState(null)
  const [info, setInfo] = useState(null)
  const [busy, setBusy] = useState("")
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    function open(event) {
      setChat(event.detail)
      setInfo(null)
      setCopied(false)
      api.get("/api/chats/" + event.detail.id + "/share").then(setInfo).catch((problem) => {
        toast(problem.message, "error")
        setChat(null)
      })
    }
    window.addEventListener("fw-share", open)
    return () => window.removeEventListener("fw-share", open)
  }, [])

  async function change(visibility, update) {
    setBusy(update ? "update" : visibility)
    try {
      const next = await api.post("/api/chats/" + chat.id + "/share", { visibility, update: Boolean(update) })
      setInfo(next)
      if (visibility === "public" && next.url) {
        await copy(next.url)
        toast(update ? "Link updated with the latest messages" : "Public link created and copied", "ok")
      } else if (visibility === "private") toast("The link no longer works. Only you can see this chat.", "ok")
    } catch (problem) {
      toast(problem.message, "error")
    }
    setBusy("")
  }

  async function copy(url) {
    try {
      await navigator.clipboard.writeText(url || info.url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch (problem) {
      toast("Couldn't copy the link", "error")
    }
  }

  const isPublic = info && info.visibility === "public"
  return (
    <Dialog open={Boolean(chat)} onClose={() => setChat(null)} title="Share chat" description={chat ? chat.title : ""} size="md">
      {!info ? (
        <div className="fw-share-loading"><Spinner /></div>
      ) : (
        <div className="fw-share">
          <div className="fw-share-options" role="radiogroup" aria-label="Who can see this chat">
            <button type="button" role="radio" aria-checked={!isPublic} className={"fw-share-option" + (!isPublic ? " is-on" : "")} onClick={() => isPublic && change("private")} disabled={Boolean(busy)}>
              <span className="fw-share-icon"><Lock size={16} /></span>
              <span className="fw-share-copy"><strong>Private</strong><small>Only you can see this chat.</small></span>
              <span className="fw-share-radio">{busy === "private" ? <Spinner size={14} /> : null}</span>
            </button>
            <button type="button" role="radio" aria-checked={isPublic} className={"fw-share-option" + (isPublic ? " is-on" : "")} onClick={() => !isPublic && change("public")} disabled={Boolean(busy)}>
              <span className="fw-share-icon"><Globe2 size={16} /></span>
              <span className="fw-share-copy"><strong>Public link</strong><small>Anyone with the link can read the messages up to the moment you share. Later messages stay private.</small></span>
              <span className="fw-share-radio">{busy === "public" ? <Spinner size={14} /> : null}</span>
            </button>
          </div>
          {isPublic && (
            <div className="fw-share-link">
              <input readOnly value={info.url} onFocus={(event) => event.target.select()} aria-label="Share link" />
              <Button variant="primary" size="sm" icon={copied ? Check : Copy} onClick={() => copy()}>{copied ? "Copied" : "Copy"}</Button>
            </div>
          )}
          {isPublic && (
            <div className="fw-share-meta">
              <span>Snapshot from {when(info.upto)}</span>
              <span><Eye size={12} /> {info.views} {info.views === 1 ? "view" : "views"}</span>
              <span className="fw-grow" />
              <Button size="sm" variant="ghost" icon={RefreshCw} loading={busy === "update"} onClick={() => change("public", true)}>Update with latest messages</Button>
            </div>
          )}
          <p className="fw-share-note">Shared chats show messages, step results and the files shown in the chat. Other files in the project, and your keys, are never shared.</p>
        </div>
      )}
    </Dialog>
  )
}

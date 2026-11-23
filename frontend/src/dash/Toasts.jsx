import { createPortal } from "react-dom"
import { AlertCircle, CheckCircle2, Info } from "lucide-react"
import { useStore } from "../lib/store"

export default function Toasts() {
  const { toasts } = useStore()
  if (toasts.length === 0) return null
  return createPortal(
    <div className="fw fw-portal">
      <div className="fw-toasts" role="status" aria-live="polite">
        {toasts.map((item) => {
          const Icon = item.kind === "ok" ? CheckCircle2 : item.kind === "error" ? AlertCircle : Info
          return <div key={item.id} className={"fw-toast " + (item.kind || "info")}><Icon size={16} /><span>{item.text}</span></div>
        })}
      </div>
    </div>,
    document.body
  )
}

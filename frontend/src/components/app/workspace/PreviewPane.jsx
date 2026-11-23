import { useEffect, useRef, useState } from "react"
import { ExternalLink, Monitor, RotateCw, Smartphone, Tablet } from "lucide-react"
import { LogoMark } from "../../ui/Logo"

const SIZES = [
  { key: "desktop", icon: Monitor, width: "100%" },
  { key: "tablet", icon: Tablet, width: "820px" },
  { key: "phone", icon: Smartphone, width: "390px" },
]

export default function PreviewPane({ preview, refreshKey }) {
  const [address, setAddress] = useState("")
  const [src, setSrc] = useState("")
  const [size, setSize] = useState("desktop")
  const [nonce, setNonce] = useState(0)
  const frame = useRef(null)

  useEffect(() => {
    if (preview && preview.url) {
      setSrc(preview.url)
      setAddress(preview.url)
    }
  }, [preview && preview.url])

  useEffect(() => {
    if (refreshKey) setNonce((value) => value + 1)
  }, [refreshKey])

  if (!preview || !preview.url) {
    return (
      <div className="fw-preview-empty">
        <LogoMark size={56} plain />
        <h3>Nothing running yet</h3>
        <p className="fw-muted">When Forkwise builds a site or app, it runs it here so you can try it while it works.</p>
      </div>
    )
  }

  const width = SIZES.find((item) => item.key === size).width

  function go(event) {
    event.preventDefault()
    setSrc(address)
    setNonce(nonce + 1)
  }

  return (
    <div className="fw-preview-pane">
      <form className="fw-preview-bar" onSubmit={go}>
        <button type="button" className="fw-iconbtn fw-iconbtn-sm" title="Reload" onClick={() => setNonce(nonce + 1)}><RotateCw size={14} /></button>
        <input className="fw-preview-url fw-mono" value={address} onChange={(e) => setAddress(e.target.value)} spellCheck={false} />
        <div className="fw-preview-sizes">
          {SIZES.map((item) => {
            const Icon = item.icon
            return (
              <button key={item.key} type="button" className={"fw-iconbtn fw-iconbtn-sm" + (size === item.key ? " fw-active" : "")} title={item.key} onClick={() => setSize(item.key)}>
                <Icon size={14} />
              </button>
            )
          })}
        </div>
        <a className="fw-iconbtn fw-iconbtn-sm" href={src} target="_blank" rel="noreferrer" title="Open in a new tab"><ExternalLink size={14} /></a>
      </form>
      <div className="fw-preview-stage">
        <iframe
          ref={frame}
          key={src + nonce}
          title="Live preview"
          src={src}
          style={{ width }}
          className={size !== "desktop" ? "fw-framed" : ""}
          sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-modals allow-downloads"
        />
      </div>
    </div>
  )
}

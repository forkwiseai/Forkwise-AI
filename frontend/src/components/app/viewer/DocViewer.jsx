import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Download, ExternalLink, X } from "lucide-react"
import PptxView from "./PptxView"
import "./viewer.css"

export function viewerKind(name) {
  const lower = String(name || "").toLowerCase()
  if (lower.endsWith(".pptx")) return "pptx"
  if (lower.endsWith(".pdf")) return "pdf"
  if (lower.endsWith(".docx")) return "docx"
  if (/\.(png|jpe?g|gif|webp|svg|avif)$/.test(lower)) return "image"
  return ""
}

function DocxView({ url }) {
  const box = useRef(null)
  const [state, setState] = useState("loading")
  useEffect(() => {
    let alive = true
    setState("loading")
    Promise.all([fetch(url, { credentials: "include" }).then((response) => {
      if (!response.ok) throw new Error("Could not download the file.")
      return response.arrayBuffer()
    }), import("docx-preview")])
      .then(([buffer, docx]) => {
        if (!alive || !box.current) return
        box.current.innerHTML = ""
        return docx.renderAsync(buffer, box.current, null, { className: "dv-docx", inWrapper: true, breakPages: true, ignoreLastRenderedPageBreak: true })
      })
      .then(() => alive && setState("ready"))
      .catch((problem) => alive && setState(problem.message || "This document could not be opened."))
    return () => { alive = false }
  }, [url])
  return (
    <div className="dv-docx-wrap">
      {state === "loading" && <div className="pv-empty"><span className="pv-loader" />Opening the document…</div>}
      {state !== "loading" && state !== "ready" && <div className="pv-empty">{state}</div>}
      <div ref={box} />
    </div>
  )
}

function PdfView({ url, name }) {
  // The server sends files with a sandbox CSP, which stops Chrome's PDF viewer inside a frame. A blob copy of
  // the file has no such header, so it opens in the built-in viewer.
  const [blobUrl, setBlobUrl] = useState("")
  const [error, setError] = useState("")
  useEffect(() => {
    let made = ""
    let alive = true
    fetch(url, { credentials: "include" })
      .then((response) => {
        if (!response.ok) throw new Error("Could not download the file.")
        return response.blob()
      })
      .then((blob) => {
        made = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }))
        if (alive) setBlobUrl(made)
      })
      .catch((problem) => alive && setError(problem.message))
    return () => {
      alive = false
      if (made) URL.revokeObjectURL(made)
    }
  }, [url])
  if (error) return <div className="pv-empty">{error}</div>
  if (!blobUrl) return <div className="pv-empty"><span className="pv-loader" />Opening the PDF…</div>
  return <iframe className="dv-frame" src={blobUrl} title={name} />
}

export function DocBody({ url, name, kind }) {
  const type = kind || viewerKind(name)
  if (type === "pptx") return <PptxView url={url} name={name} />
  if (type === "pdf") return <PdfView url={url} name={name} />
  if (type === "docx") return <DocxView url={url} />
  if (type === "image") return <div className="dv-image"><img src={url} alt={name} /></div>
  return <div className="pv-empty">This file can't be shown here. Download it instead.</div>
}

// Full-screen reader for decks, PDFs, Word files and pictures, opened from a file card in the chat.
export default function DocViewer({ url, downloadUrl, name, kind, onClose }) {
  useEffect(() => {
    function key(event) {
      if (event.key === "Escape" && !document.fullscreenElement) onClose()
    }
    window.addEventListener("keydown", key)
    const previous = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      window.removeEventListener("keydown", key)
      document.body.style.overflow = previous
    }
  }, [onClose])
  return createPortal(
    <div className="fw dv-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="dv" role="dialog" aria-modal="true" aria-label={name}>
        <div className="dv-head">
          <strong dir="auto">{name}</strong>
          <span className="pv-grow" />
          <a className="pv-btn" href={url} target="_blank" rel="noreferrer" title="Open in a new tab" aria-label="Open in a new tab"><ExternalLink size={15} /></a>
          {downloadUrl && <a className="pv-btn" href={downloadUrl} title="Download" aria-label="Download"><Download size={15} /></a>}
          <button type="button" className="pv-btn" onClick={onClose} title="Close (Esc)" aria-label="Close"><X size={16} /></button>
        </div>
        <div className="dv-body"><DocBody url={url} name={name} kind={kind} /></div>
      </div>
    </div>,
    document.body,
  )
}

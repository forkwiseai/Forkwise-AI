import { useState } from "react"
import { Globe, X } from "lucide-react"
import { hostOf, useUnfurl } from "../../lib/links"

function Icon({ src }) {
  const [broken, setBroken] = useState(false)
  if (!src || broken) return <span className="fw-link-icon is-empty"><Globe size={13} /></span>
  return <img className="fw-link-icon" src={src} alt="" referrerPolicy="no-referrer" loading="lazy" onError={() => setBroken(true)} />
}

function Thumb({ src }) {
  const [broken, setBroken] = useState(false)
  if (!src || broken) return null
  return <img className="fw-link-thumb" src={src} alt="" referrerPolicy="no-referrer" loading="lazy" onError={() => setBroken(true)} />
}

// A preview of a link: icon, title and site, and the page's picture when it has one.
export default function LinkCard({ url, onRemove, compact }) {
  const data = useUnfurl(url)
  const host = hostOf(url)
  const loading = data === null
  const title = (data && data.title) || (data && data.site) || host
  return (
    <a className={"fw-link-card" + (loading ? " is-loading" : "") + (compact ? " is-compact" : "")} href={url} target="_blank" rel="noreferrer noopener" title={url}>
      <Icon src={data && data.icon} />
      <span className="fw-link-text">
        <span className="fw-link-title" dir="auto">{loading ? host : title}</span>
        <span className="fw-link-host">{data && data.title && data.site && data.site !== host ? data.site + " · " + host : host}</span>
      </span>
      {!compact && <Thumb src={data && data.image} />}
      {onRemove && (
        <button type="button" className="fw-link-x" aria-label={"Remove preview of " + host} onClick={(event) => { event.preventDefault(); event.stopPropagation(); onRemove(url) }}><X size={11} /></button>
      )}
    </a>
  )
}

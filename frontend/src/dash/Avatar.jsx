import { useEffect, useState } from "react"

function initials(user) {
  const source = (user && (user.name || user.email)) || "?"
  const parts = source.replace(/@.*/, "").trim().split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return source.slice(0, 1).toUpperCase()
}

export default function Avatar({ user, size = 28 }) {
  const url = user && user.avatar
  const [broken, setBroken] = useState(false)
  useEffect(() => setBroken(false), [url])
  return (
    <span className="fw-avatar" style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }} aria-hidden="true">
      {url && !broken ? <img src={url} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} /> : initials(user)}
    </span>
  )
}

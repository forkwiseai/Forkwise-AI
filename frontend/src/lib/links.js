import { useEffect, useState } from "react"
import { api } from "./api"

// A link is http(s)://…, www.…, or a bare domain with a common ending (github.com/x, chatgpt.com). File names like
// app.js or main.py are not links: their endings are not in the list.
const ENDINGS = "com|org|net|io|ai|dev|app|co|ir|me|so|gg|xyz|edu|gov|uk|de|fr|tv|ly|sh|to|cc|info|site|online|store|tech|page|design"
const LINK = new RegExp("((?:https?:\\/\\/|www\\.)[^\\s<>\"'`]+|\\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+(?:" + ENDINGS + ")\\b(?:\\/[^\\s<>\"'`]*)?)", "gi")
const TRAIL = /[.,;:!?)\]}'"،؛؟»]+$/

function trimLink(raw) {
  let link = raw.replace(TRAIL, "")
  // keep a closing bracket that belongs to the link, as in wikipedia.org/wiki/Fork_(software)
  if (raw.length > link.length && raw[link.length] === ")" && link.split("(").length > link.split(")").length) link = link + ")"
  return link
}

export function linkParts(text) {
  const parts = []
  let last = 0
  for (const match of String(text || "").matchAll(LINK)) {
    const link = trimLink(match[0])
    if (!link) continue
    if (match.index > 0 && /[@\w]/.test(text[match.index - 1])) continue // an email address or a word.word
    if (match.index > last) parts.push({ text: text.slice(last, match.index) })
    parts.push({ text: link, link: fullUrl(link) })
    last = match.index + link.length
  }
  if (last < String(text || "").length) parts.push({ text: text.slice(last) })
  return parts
}

export function findLinks(text, limit = 3) {
  const seen = []
  for (const part of linkParts(text)) {
    if (part.link && !seen.includes(part.link)) seen.push(part.link)
    if (seen.length >= limit) break
  }
  return seen
}

export function fullUrl(link) {
  return /^https?:\/\//i.test(link) ? link : "https://" + link
}

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

const cache = new Map()

export function unfurl(url) {
  if (!cache.has(url)) {
    const job = api.get("/api/unfurl?url=" + encodeURIComponent(url)).catch(() => ({ url, host: hostOf(url), site: hostOf(url), title: "", image: "", icon: "" }))
    cache.set(url, job)
    if (cache.size > 300) cache.delete(cache.keys().next().value)
  }
  return cache.get(url)
}

export function useUnfurl(url) {
  const [data, setData] = useState(null)
  useEffect(() => {
    let alive = true
    setData(null)
    if (url) unfurl(url).then((found) => { if (alive) setData(found) })
    return () => { alive = false }
  }, [url])
  return data
}

// The links in the text, settled: a link still being typed (no pause yet) is not looked up on every key.
export function useSettledLinks(text, delay = 450) {
  const [links, setLinks] = useState([])
  useEffect(() => {
    const timer = setTimeout(() => {
      const next = findLinks(text)
      setLinks((current) => (current.join(" ") === next.join(" ") ? current : next))
    }, links.length === 0 ? delay : 250)
    return () => clearTimeout(timer)
  }, [text]) // eslint-disable-line react-hooks/exhaustive-deps
  return links
}

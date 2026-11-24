import { memo, useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import rehypeKatex from "rehype-katex"
import rehypeHighlight from "rehype-highlight"
import { Check, Copy } from "lucide-react"
import "highlight.js/styles/github-dark.css"
import "katex/dist/katex.min.css"

function textOf(node) {
  if (node == null) return ""
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(textOf).join("")
  if (node.props) return textOf(node.props.children)
  return ""
}

function CodeBlock({ children }) {
  const [copied, setCopied] = useState(false)
  const child = Array.isArray(children) ? children[0] : children
  const className = (child && child.props && child.props.className) || ""
  const language = (className.match(/language-([\w-]+)/) || [])[1] || "text"
  const code = textOf(child)

  function copy() {
    navigator.clipboard.writeText(code.replace(/\n$/, ""))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="fw-code-block" dir="ltr">
      <div className="fw-code-head">
        <span className="fw-code-lang">{language}</span>
        <button type="button" className={"fw-code-copy" + (copied ? " fw-done" : "")} onClick={copy} aria-label="Copy code" title={copied ? "Copied" : "Copy"}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      </div>
      <pre>{children}</pre>
    </div>
  )
}

function Link({ href, children }) {
  return <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>
}

function Table({ children }) {
  return <div className="fw-table-wrap"><table>{children}</table></div>
}

function Picture({ src, alt }) {
  return <img className="fw-md-img" src={src} alt={alt || ""} loading="lazy" />
}

// Each block picks its own direction, so a Persian paragraph is right-to-left and an English one left-to-right
// inside the same answer.
const auto = (Tag) => function Directed({ node, ...props }) { return <Tag dir="auto" {...props} /> }

const components = { pre: CodeBlock, a: Link, table: Table, img: Picture, p: auto("p"), ul: auto("ul"), ol: auto("ol"), li: auto("li"), h1: auto("h1"), h2: auto("h2"), h3: auto("h3"), h4: auto("h4"), blockquote: auto("blockquote"), td: auto("td"), th: auto("th") }

// Some models wrap their whole answer in HTML like <div dir="rtl"> ... </div> (sometimes malformed, as
// <div dir="rtl")). That markup is shown as text, so it is removed; direction is handled per block above.
export function cleanModelText(text) {
  const parts = String(text || "").split(/(```[\s\S]*?(?:```|$))/)
  for (let i = 0; i < parts.length; i += 2) {
    parts[i] = parts[i]
      .replace(/^[ \t]*<div\s+dir\s*=\s*["']?(?:rtl|ltr|auto)["']?\s*[>)][ \t]*/gim, "")
      .replace(/^[ \t]*<\/div>[ \t]*$/gim, "")
      .replace(/<div\s+dir\s*=\s*["']?(?:rtl|ltr|auto)["']?\s*[>)]/gi, "")
      .replace(/\n{3,}/g, "\n\n")
  }
  return parts.join("")
}

function MarkdownView({ text }) {
  return (
    <div className="fw-md" dir="auto">
      <ReactMarkdown 
        remarkPlugins={[remarkGfm, remarkMath]} 
        rehypePlugins={[rehypeKatex, [rehypeHighlight, { ignoreMissing: true, detect: false }]]} 
        components={components}
      >
        {cleanModelText(text)}
      </ReactMarkdown>
    </div>
  )
}

export default memo(MarkdownView)
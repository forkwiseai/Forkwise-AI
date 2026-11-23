// Forkwise dashboard component kit. Every class starts with fw- and lives under a .fw root,
// so the marketing site's styles never reach these components and the other way round.
import { createContext, forwardRef, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Check, ChevronDown, Loader2, Search, X } from "lucide-react"

export function cx(...parts) {
  return parts.filter(Boolean).join(" ")
}

/* ---------- Buttons ---------- */

export const Button = forwardRef(function Button({ variant = "secondary", size = "md", icon: Icon, iconRight: IconRight, loading, className, children, type = "button", ...rest }, ref) {
  return (
    <button ref={ref} type={type} className={cx("fw-btn", "fw-btn-" + variant, "fw-btn-" + size, className)} {...rest} disabled={rest.disabled || loading}>
      {loading ? <Loader2 size={size === "sm" ? 13 : 15} className="fw-spin" /> : Icon ? <Icon size={size === "sm" ? 13 : 15} /> : null}
      {children && <span>{children}</span>}
      {IconRight && <IconRight size={size === "sm" ? 13 : 14} className="fw-btn-right" />}
    </button>
  )
})

export const IconButton = forwardRef(function IconButton({ icon: Icon, label, active, size = "md", className, type = "button", iconSize, ...rest }, ref) {
  return (
    <button ref={ref} type={type} aria-label={label} title={label} className={cx("fw-iconbtn", "fw-iconbtn-" + size, active && "is-active", className)} {...rest}>
      <Icon size={iconSize || (size === "sm" ? 14 : 16)} />
    </button>
  )
})

export function LinkButton({ as: Tag = "a", variant = "secondary", size = "md", icon: Icon, className, children, ...rest }) {
  return (
    <Tag className={cx("fw-btn", "fw-btn-" + variant, "fw-btn-" + size, className)} {...rest}>
      {Icon && <Icon size={size === "sm" ? 13 : 15} />}
      {children && <span>{children}</span>}
    </Tag>
  )
}

/* ---------- Form controls ---------- */

export const Input = forwardRef(function Input({ className, icon: Icon, size = "md", ...rest }, ref) {
  if (Icon) {
    return (
      <label className={cx("fw-input", "fw-input-" + size, "has-icon", className)}>
        <Icon size={14} />
        <input ref={ref} {...rest} />
      </label>
    )
  }
  return <input ref={ref} className={cx("fw-input", "fw-input-" + size, className)} {...rest} />
})

export const Textarea = forwardRef(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cx("fw-input", "fw-textarea", className)} {...rest} />
})

export function Field({ label, hint, error, htmlFor, children, className }) {
  return (
    <div className={cx("fw-field", className)}>
      {label && <label className="fw-field-label" htmlFor={htmlFor}>{label}</label>}
      {children}
      {error ? <span className="fw-field-error">{error}</span> : hint ? <span className="fw-field-hint">{hint}</span> : null}
    </div>
  )
}

export function Switch({ checked, onChange, disabled, label }) {
  return (
    <button type="button" role="switch" aria-checked={Boolean(checked)} aria-label={label} disabled={disabled} className={cx("fw-switch", checked && "is-on")} onClick={() => onChange(!checked)}>
      <span className="fw-switch-knob" />
    </button>
  )
}

export function Checkbox({ checked, onChange, label, hint, disabled }) {
  return (
    <label className={cx("fw-check", disabled && "is-disabled")}>
      <button type="button" role="checkbox" aria-checked={Boolean(checked)} disabled={disabled} className={cx("fw-check-box", checked && "is-on")} onClick={() => onChange(!checked)}>
        {checked && <Check size={12} strokeWidth={3} />}
      </button>
      <span><span className="fw-check-label">{label}</span>{hint && <span className="fw-check-hint">{hint}</span>}</span>
    </label>
  )
}

export function Segmented({ value, onChange, options, size = "md" }) {
  return (
    <div className={cx("fw-seg", "fw-seg-" + size)} role="radiogroup">
      {options.map((item) => {
        const Icon = item.icon
        return (
          <button key={item.value} type="button" role="radio" aria-checked={value === item.value} className={value === item.value ? "is-on" : ""} onClick={() => onChange(item.value)}>
            {Icon && <Icon size={13} />}{item.label}
          </button>
        )
      })}
    </div>
  )
}

/* ---------- Presence: keeps a closing element mounted for its exit fade ---------- */

export function usePresence(open, ms = 110) {
  const [mounted, setMounted] = useState(open)
  const [leaving, setLeaving] = useState(false)
  useEffect(() => {
    if (open) {
      setMounted(true)
      setLeaving(false)
      return undefined
    }
    if (!mounted) return undefined
    setLeaving(true)
    const timer = setTimeout(() => { setMounted(false); setLeaving(false) }, ms)
    return () => clearTimeout(timer)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  return [mounted, leaving]
}

/* ---------- Popover with automatic placement ---------- */

function usePlacement(open, anchorRef, popRef, preferred, align, offset) {
  const [style, setStyle] = useState({ visibility: "hidden", top: 0, left: 0 })
  const sideRef = useRef(null)
  const place = useCallback((event) => {
    const anchor = anchorRef.current
    const pop = popRef.current
    if (!anchor || !pop) return
    // Scrolling inside the menu itself must never move the menu.
    if (event && event.type === "scroll" && event.target instanceof Node && pop.contains(event.target)) return
    const a = anchor.getBoundingClientRect()
    const width = pop.offsetWidth
    const height = pop.scrollHeight
    const vw = window.innerWidth
    const vh = window.innerHeight
    const below = vh - a.bottom - offset - 8
    const above = a.top - offset - 8
    // The side is chosen once when the menu opens, so filtering or scrolling cannot flip it.
    let side = sideRef.current
    if (!side) {
      side = preferred
      if (side === "bottom" && height > below && above > below) side = "top"
      if (side === "top" && height > above && below > above) side = "bottom"
      sideRef.current = side
    }
    const room = Math.max(160, side === "bottom" ? below : above)
    const shown = Math.min(height, room)
    const top = side === "bottom" ? a.bottom + offset : Math.max(8, a.top - offset - shown)
    let left = align === "end" ? a.right - width : align === "center" ? a.left + a.width / 2 - width / 2 : a.left
    left = Math.max(8, Math.min(left, vw - width - 8))
    setStyle((prev) => {
      const next = { top, left, maxHeight: room, visibility: "visible", side }
      if (prev.top === next.top && prev.left === next.left && prev.maxHeight === next.maxHeight && prev.visibility === "visible") return prev
      return next
    })
  }, [anchorRef, popRef, preferred, align, offset])

  useLayoutEffect(() => {
    if (!open) {
      sideRef.current = null
      return undefined
    }
    place()
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => place()) : null
    if (observer && popRef.current) observer.observe(popRef.current)
    window.addEventListener("resize", place)
    return () => {
      if (observer) observer.disconnect()
      window.removeEventListener("resize", place)
    }
  }, [open, place, popRef])
  return style
}

export function Popover({ open, onClose, anchorRef, children, placement = "bottom", align = "start", offset = 6, className, width, role = "menu" }) {
  const popRef = useRef(null)
  const mounted = open
  const leaving = false
  const style = usePlacement(mounted, anchorRef, popRef, placement, align, offset)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    if (!open) return undefined
    function down(event) {
      if (popRef.current && popRef.current.contains(event.target)) return
      if (anchorRef.current && anchorRef.current.contains(event.target)) return
      closeRef.current()
    }
    function key(event) {
      if (event.key === "Escape") {
        event.stopPropagation()
        closeRef.current()
      }
    }
    // When the user scrolls anything outside the menu it closes, so it never drifts away from its button.
    // Wheel and touch are used instead of scroll so content that scrolls by itself (a streaming chat) does not close it.
    function scroll(event) {
      if (popRef.current && event.target instanceof Node && popRef.current.contains(event.target)) return
      closeRef.current()
    }
    document.addEventListener("mousedown", down)
    document.addEventListener("keydown", key, true)
    window.addEventListener("wheel", scroll, { capture: true, passive: true })
    window.addEventListener("touchmove", scroll, { capture: true, passive: true })
    return () => {
      document.removeEventListener("mousedown", down)
      document.removeEventListener("keydown", key, true)
      window.removeEventListener("wheel", scroll, { capture: true })
      window.removeEventListener("touchmove", scroll, { capture: true })
    }
  }, [open, anchorRef])

  if (!mounted) return null
  const { side, ...css } = style
  return createPortal(
    <div className="fw fw-portal">
      <div ref={popRef} role={role} className={cx("fw-pop", side === "top" && "is-top", leaving && "fw-is-leaving", className)} style={{ ...css, width: width || undefined, pointerEvents: leaving ? "none" : undefined }}>
        {children}
      </div>
    </div>,
    document.body
  )
}

export function MenuItem({ icon: Icon, children, hint, kbd, active, danger, right, onClick, as: Tag = "button", ...rest }) {
  const props = Tag === "button" ? { type: "button" } : {}
  return (
    <Tag role="menuitem" className={cx("fw-mi", active && "is-active", danger && "is-danger")} onClick={onClick} {...props} {...rest}>
      {Icon && <span className="fw-mi-icon"><Icon size={15} /></span>}
      <span className="fw-mi-text"><span className="fw-mi-title">{children}</span>{hint && <span className="fw-mi-hint">{hint}</span>}</span>
      {kbd && <Kbd>{kbd}</Kbd>}
      {right}
    </Tag>
  )
}

export function MenuLabel({ children }) {
  return <div className="fw-ml">{children}</div>
}

export function MenuSep() {
  return <div className="fw-msep" />
}

/* ---------- Select (custom dropdown) ---------- */

export function Select({ value, onChange, options, placeholder = "Choose", size = "md", width, id, searchable }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const anchor = useRef(null)
  const current = options.find((item) => item.value === value)
  const needle = query.trim().toLowerCase()
  const list = searchable && needle ? options.filter((item) => String(item.label).toLowerCase().includes(needle)) : options
  return (
    <>
      <button ref={anchor} id={id} type="button" className={cx("fw-select", "fw-select-" + size)} style={{ width }} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className={current ? "" : "fw-muted"}>{current ? current.label : placeholder}</span>
        <ChevronDown size={14} />
      </button>
      <Popover open={open} onClose={() => { setOpen(false); setQuery("") }} anchorRef={anchor} role="listbox" width={Math.max(200, anchor.current ? anchor.current.offsetWidth : 200)}>
        {searchable && <div className="fw-pop-search"><Search size={13} /><input autoFocus placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} /></div>}
        <div className="fw-pop-scroll">
          {list.map((item) => (
            <MenuItem key={String(item.value)} active={item.value === value} hint={item.hint} onClick={() => { onChange(item.value); setOpen(false); setQuery("") }} right={item.value === value ? <Check size={14} className="fw-mi-check" /> : null}>
              {item.label}
            </MenuItem>
          ))}
          {list.length === 0 && <div className="fw-pop-empty">No matches</div>}
        </div>
      </Popover>
    </>
  )
}

/* ---------- Dialog ---------- */

export function Dialog({ open, onClose, title, description, children, footer, size = "md", className, hideClose }) {
  const ref = useRef(null)
  const [mounted, leaving] = usePresence(open, 120)
  useEffect(() => {
    if (!open) return undefined
    const previous = document.activeElement
    function key(event) {
      if (event.key === "Escape") {
        event.stopPropagation()
        onClose()
      }
    }
    document.addEventListener("keydown", key, true)
    const timer = setTimeout(() => {
      const target = ref.current && (ref.current.querySelector("[data-autofocus]") || ref.current.querySelector("input, textarea"))
      if (target) target.focus()
    }, 30)
    return () => {
      clearTimeout(timer)
      document.removeEventListener("keydown", key, true)
      if (previous && previous.focus) previous.focus()
    }
  }, [open, onClose])
  if (!mounted) return null
  return createPortal(
    <div className="fw fw-portal">
      <div className={cx("fw-overlay", leaving && "fw-is-leaving")} onMouseDown={leaving ? undefined : onClose} />
      <div ref={ref} className={cx("fw-dialog", "fw-dialog-" + size, leaving && "fw-is-leaving", className)} role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : undefined}>
        <div className="fw-dialog-head">
          <div>
            {title && <h2 className="fw-dialog-title">{title}</h2>}
            {description && <p className="fw-dialog-desc">{description}</p>}
          </div>
          {!hideClose && <IconButton icon={X} label="Close" size="sm" onClick={onClose} />}
        </div>
        {children && <div className="fw-dialog-body">{children}</div>}
        {footer && <div className="fw-dialog-foot">{footer}</div>}
      </div>
    </div>,
    document.body
  )
}

const ConfirmContext = createContext(null)

export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null)
  const confirm = useCallback((options) => new Promise((resolve) => setState({ options, resolve })), [])
  function close(result) {
    if (state) state.resolve(result)
    setState(null)
  }
  const last = useRef({})
  if (state) last.current = state.options
  const options = last.current
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog open={Boolean(state)} onClose={() => close(false)} size="sm" title={options.title || "Are you sure?"} description={options.text}
        footer={<>
          <Button variant="ghost" onClick={() => close(false)}>{options.cancelLabel || "Cancel"}</Button>
          <Button data-autofocus variant={options.danger ? "danger" : "primary"} onClick={() => close(true)}>{options.confirmLabel || "Confirm"}</Button>
        </>} />
    </ConfirmContext.Provider>
  )
}

export function useConfirm() {
  return useContext(ConfirmContext)
}

/* ---------- Display ---------- */

export function Kbd({ children }) {
  const keys = String(children).split(" ")
  return <span className="fw-kbd">{keys.map((key, index) => <kbd key={index}>{key}</kbd>)}</span>
}

export function Badge({ tone = "neutral", children, dot }) {
  return <span className={cx("fw-badge", "fw-badge-" + tone)}>{dot && <span className="fw-badge-dot" />}{children}</span>
}

export function Card({ title, description, action, children, className, flush }) {
  return (
    <section className={cx("fw-card", flush && "is-flush", className)}>
      {(title || action) && (
        <header className="fw-card-head">
          <div>
            {title && <h3>{title}</h3>}
            {description && <p>{description}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  )
}

export function Row({ title, description, children, icon: Icon, onClick, danger }) {
  const Tag = onClick ? "button" : "div"
  return (
    <Tag type={onClick ? "button" : undefined} className={cx("fw-row", onClick && "is-link", danger && "is-danger")} onClick={onClick}>
      {Icon && <span className="fw-row-icon"><Icon size={16} /></span>}
      <span className="fw-row-text">
        <span className="fw-row-title">{title}</span>
        {description && <span className="fw-row-desc">{description}</span>}
      </span>
      {children && <span className="fw-row-control">{children}</span>}
    </Tag>
  )
}

export function Group({ label, description, children }) {
  return (
    <div className="fw-group">
      {(label || description) && (
        <div className="fw-group-head">
          {label && <h4>{label}</h4>}
          {description && <p>{description}</p>}
        </div>
      )}
      <div className="fw-group-body">{children}</div>
    </div>
  )
}

export function PageHeader({ title, description, actions, back }) {
  return (
    <header className="fw-pagehead">
      <div>
        {back}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="fw-pagehead-actions">{actions}</div>}
    </header>
  )
}

export function Empty({ icon: Icon, title, text, action }) {
  return (
    <div className="fw-empty">
      {Icon && <span className="fw-empty-icon"><Icon size={20} /></span>}
      <strong>{title}</strong>
      {text && <p>{text}</p>}
      {action}
    </div>
  )
}

export function Spinner({ size = 16 }) {
  return <Loader2 size={size} className="fw-spin" aria-label="Loading" />
}

export function Skeleton({ lines = 3 }) {
  return (
    <div className="fw-skel">
      {Array.from({ length: lines }).map((_, index) => <span key={index} style={{ width: 100 - ((index * 17) % 40) + "%" }} />)}
    </div>
  )
}

export function Meter({ value, max, tone }) {
  const share = max > 0 ? Math.min(1, value / max) : 0
  return <div className={cx("fw-meter", tone && "fw-meter-" + tone, share > 0.85 && "is-high")}><span style={{ width: share * 100 + "%" }} /></div>
}

export function Tabs({ value, onChange, tabs }) {
  return (
    <div className="fw-tabs" role="tablist">
      {tabs.map((tab) => (
        <button key={tab.value} type="button" role="tab" aria-selected={value === tab.value} className={value === tab.value ? "is-on" : ""} onClick={() => onChange(tab.value)}>
          {tab.label}{tab.count !== undefined && <span className="fw-tab-count">{tab.count}</span>}
        </button>
      ))}
    </div>
  )
}

export function CloseIcon(props) {
  return <X {...props} />
}

/* ---------- One-time code input ---------- */

export function CodeInput({ value, onChange, length = 6, autoFocus, invalid, onComplete }) {
  const refs = useRef([])
  const digits = (value || "").split("").concat(Array(length).fill("")).slice(0, length)

  function set(next) {
    const clean = next.replace(/\D/g, "").slice(0, length)
    onChange(clean)
    if (clean.length === length && onComplete) onComplete(clean)
  }

  function onKey(index, event) {
    if (event.key === "Backspace") {
      event.preventDefault()
      const chars = digits.slice()
      if (chars[index]) chars[index] = ""
      else if (index > 0) {
        chars[index - 1] = ""
        refs.current[index - 1].focus()
      }
      set(chars.join(""))
    } else if (event.key === "ArrowLeft" && index > 0) refs.current[index - 1].focus()
    else if (event.key === "ArrowRight" && index < length - 1) refs.current[index + 1].focus()
  }

  function onInput(index, event) {
    const typed = event.target.value.replace(/\D/g, "")
    if (!typed) return
    const chars = digits.slice()
    for (let offset = 0; offset < typed.length && index + offset < length; offset += 1) chars[index + offset] = typed[offset]
    set(chars.join(""))
    const focus = Math.min(length - 1, index + typed.length)
    if (refs.current[focus]) refs.current[focus].focus()
  }

  return (
    <div className={cx("fw-code", invalid && "is-invalid")} role="group" aria-label="Verification code">
      {digits.map((digit, index) => (
        <input key={index} ref={(node) => { refs.current[index] = node }} inputMode="numeric" autoComplete={index === 0 ? "one-time-code" : "off"} maxLength={length}
          autoFocus={autoFocus && index === 0} aria-label={"Digit " + (index + 1)} value={digit} className={digit ? "is-filled" : ""}
          onKeyDown={(e) => onKey(index, e)} onChange={(e) => onInput(index, e)} onFocus={(e) => e.target.select()}
          onPaste={(e) => { e.preventDefault(); set(e.clipboardData.getData("text")); const last = Math.min(length - 1, e.clipboardData.getData("text").replace(/\D/g, "").length); if (refs.current[last]) refs.current[last].focus() }} />
      ))}
    </div>
  )
}

/* ---------- Step indicator ---------- */

export function Steps({ steps, current }) {
  return (
    <ol className="fw-stepper">
      {steps.map((label, index) => (
        <li key={label} className={cx(index < current && "is-done", index === current && "is-on")}>
          <span className="fw-stepper-dot">{index < current ? <Check size={11} strokeWidth={3} /> : index + 1}</span>
          <span>{label}</span>
        </li>
      ))}
    </ol>
  )
}

/* ---------- Countdown for "resend code" buttons ---------- */

export function useCooldown() {
  const [left, setLeft] = useState(0)
  useEffect(() => {
    if (left <= 0) return undefined
    const timer = setTimeout(() => setLeft(left - 1), 1000)
    return () => clearTimeout(timer)
  }, [left])
  return [left, setLeft]
}

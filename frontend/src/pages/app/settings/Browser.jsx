import { useEffect, useRef, useState } from "react"
import { CheckCircle2, Chrome, Circle, Download, Globe, MousePointer2, Search, ShieldCheck, Unplug } from "lucide-react"
import { useStore } from "../../../lib/store"
import { browserState, linkBrowser, unlinkBrowser } from "../../../lib/ownBrowser"

function turnedOff() {
  try {
    return sessionStorage.getItem("fw-browser-off") === "1"
  } catch (problem) {
    return false
  }
}

export default function Browser() {
  const { toast } = useStore()
  const [state, setState] = useState(null)
  const [busy, setBusy] = useState(false)
  const [manual, setManual] = useState(false)
  const linking = useRef(false)

  async function refresh() {
    const next = await browserState()
    setState(next)
    // Installed but not linked yet (for example right after Add to Chrome): link it now.
    if (next.extension && next.extension.installed && !next.extension.linked && !(next.server && next.server.connected) && !linking.current && !turnedOff()) {
      linking.current = true
      setBusy(true)
      try {
        await linkBrowser(next.ids)
        toast("Your browser is connected", "ok")
      } catch (problem) {
        toast(problem.message, "error")
      }
      setBusy(false)
      setState(await browserState())
      linking.current = false
    }
  }

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, 3000)
    return () => clearInterval(timer)
  }, [])

  async function connect() {
    try {
      sessionStorage.removeItem("fw-browser-off")
    } catch (problem) {
      // storage blocked
    }
    setBusy(true)
    try {
      await linkBrowser(state ? state.ids : [])
      toast("Your browser is connected", "ok")
    } catch (problem) {
      toast(problem.message, "error")
    }
    setBusy(false)
    setState(await browserState())
  }

  async function disconnect() {
    setBusy(true)
    try {
      sessionStorage.setItem("fw-browser-off", "1")
    } catch (problem) {
      // storage blocked
    }
    await unlinkBrowser(state ? state.ids : [])
    setBusy(false)
    setState(await browserState())
  }

  const server = state && state.server
  const extension = state && state.extension
  const installed = Boolean(extension && extension.installed)
  const connected = Boolean(server && server.connected)
  const storeUrl = (server && server.store_url) || ""
  const isChromium = Boolean(window.chrome) && !/Firefox|FxiOS/.test(navigator.userAgent)
  const steps = [
    { done: installed, title: "Add Forkwise for Chrome", text: "One click. Works in Chrome, Edge, Brave and other Chromium browsers." },
    { done: connected, title: "It connects by itself", text: "Because you are signed in here. Nothing to copy or press." },
    { done: connected, title: "Ask in any chat", text: "For example: search flights to Istanbul next week, or open my Gmail and summarize unread emails." },
  ]
  const abilities = [
    { icon: Search, title: "Opens tabs and searches", text: "In its own tab group called Forkwise" },
    { icon: MousePointer2, title: "Reads, clicks and types", text: "On pages where you are signed in" },
    { icon: ShieldCheck, title: "Asks first", text: "Each new site needs your OK, and you can pause or stop it from the toolbar" },
  ]

  return (
    <div className="fw-settings-stack">
      <div className={"fw-settings-card fw-computer-hero" + (connected ? " fw-on" : "")}>
        <div className="fw-computer-hero-top">
          <span className="fw-computer-hero-icon"><Globe size={22} /></span>
          <div>
            <h3>{connected ? "Your browser is connected" : "Let Forkwise use your browser"}</h3>
            <p className="fw-muted fw-small">
              {connected
                ? "The agent can open tabs, search, read and click in " + (server.browser || "your browser") + ", in a tab group named Forkwise. It asks before each new site."
                : "The agent works in your own browser, signed in as you. Add it once; after that it only asks for permission when it wants to open a site."}
            </p>
          </div>
          <span className={"fw-status-pill" + (connected ? " fw-ok" : "")}><span className="fw-dot" />{connected ? "Connected" : busy || (installed && extension.linked) ? "Connecting…" : installed ? "Not connected" : "Not added"}</span>
        </div>
        <div className="fw-computer-actions">
          {!installed && storeUrl && <a className="fw-btn fw-btn-primary" href={storeUrl} target="_blank" rel="noreferrer"><Chrome size={15} />Add to Chrome</a>}
          {!installed && !storeUrl && <button type="button" className="fw-btn fw-btn-primary" onClick={() => setManual(true)}><Download size={15} />Add to Chrome</button>}
          {installed && !connected && turnedOff() && <button type="button" className="fw-btn fw-btn-primary" onClick={connect} disabled={busy}><Globe size={15} />Connect again</button>}
          {connected && <button type="button" className="fw-btn fw-btn-ghost" onClick={disconnect} disabled={busy}><Unplug size={15} />Disconnect</button>}
        </div>
        <ol className="fw-computer-steps">
          {steps.map((step, index) => (
            <li key={index} className={step.done ? "fw-done" : ""}>
              <span className="fw-step-mark">{step.done ? <CheckCircle2 size={17} /> : <Circle size={17} />}</span>
              <div><strong>{step.title}</strong><span className="fw-muted fw-small">{step.text}</span></div>
            </li>
          ))}
        </ol>
        {!isChromium && <p className="fw-muted fw-small">Open Forkwise in Chrome, Edge or Brave to use this. Other browsers cannot run it.</p>}
      </div>

      {!installed && !storeUrl && manual && (
        <div className="fw-settings-card">
          <h3><Chrome size={16} /> Install it by hand (until it is in the Chrome Web Store)</h3>
          <ol className="fw-browser-install">
            <li><a href="/downloads/forkwise-for-chrome.zip" download>Download forkwise-for-chrome.zip</a> and unzip it.</li>
            <li>Open <code>chrome://extensions</code> and turn on <b>Developer mode</b> (top right).</li>
            <li>Press <b>Load unpacked</b> and choose the forkwise-for-chrome folder.</li>
            <li>Come back here. It connects by itself in a few seconds.</li>
          </ol>
        </div>
      )}

      <div className="fw-settings-card">
        <h3>What it can do</h3>
        <div className="fw-browser-abilities">
          {abilities.map((item) => {
            const Icon = item.icon
            return (
              <div key={item.title} className="fw-browser-ability">
                <Icon size={18} />
                <div><strong>{item.title}</strong><span className="fw-muted fw-small">{item.text}</span></div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

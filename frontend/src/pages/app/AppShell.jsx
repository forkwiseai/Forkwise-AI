import { Suspense, useEffect, useState } from "react"
import { Navigate, Outlet, useLocation, useNavigate } from "react-router-dom"
import { Menu, PanelLeftOpen } from "lucide-react"
import { autoLink } from "../../lib/ownBrowser"
import { useStore } from "../../lib/store"
import { desktopApp, ensureLinked } from "../../lib/desktop"
import { LogoMark } from "../../components/ui/Logo"
import Sidebar from "../../dash/Sidebar"
import Search from "../../dash/Search"
import Toasts from "../../dash/Toasts"
import { ConfirmProvider, IconButton, Skeleton } from "../../dash/kit"
import "../../dash/dash.css"
import "../../dash/layout.css"
import "../../dash/pages.css"

function readCollapsed() {
  try {
    return localStorage.getItem("fw-sidebar") === "closed"
  } catch (problem) {
    return false
  }
}

function onboardedHere() {
  try {
    return localStorage.getItem("fw-onboarded") === "1"
  } catch (problem) {
    return false
  }
}

export function ShellLoading() {
  return (
    <div className="fw fw-app">
      <div className="fw-sb fw-sb-ghost"><Skeleton lines={8} /></div>
      <main className="fw-main"><div className="fw-page"><Skeleton lines={5} /></div></main>
    </div>
  )
}

export default function AppShell() {
  const { user, ready, theme, toast } = useStore()
  const navigate = useNavigate()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [mobileOpen, setMobileOpen] = useState(false)
  const inSettings = location.pathname.indexOf("/app/settings") === 0

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    document.documentElement.setAttribute("data-dash", "")
    return () => document.documentElement.removeAttribute("data-dash")
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem("fw-sidebar", collapsed ? "closed" : "open")
    } catch (problem) {
      // storage blocked
    }
  }, [collapsed])

  useEffect(() => setMobileOpen(false), [location.pathname])

  useEffect(() => {
    function key(event) {
      const mod = event.ctrlKey || event.metaKey
      if (mod && event.key.toLowerCase() === "b") {
        event.preventDefault()
        setCollapsed((value) => !value)
      }
      if (mod && event.key === ",") {
        event.preventDefault()
        navigate("/app/settings")
      }
    }
    window.addEventListener("keydown", key)
    return () => window.removeEventListener("keydown", key)
  }, [navigate])

  const userId = user && user.id
  useEffect(() => {
    if (!userId || desktopApp()) return undefined
    const timer = setTimeout(() => {
      autoLink().then((linked) => {
        if (linked) toast("Your browser is connected. Forkwise can open tabs in it when you ask.", "ok")
      })
    }, 1500)
    return () => clearTimeout(timer)
  }, [userId])

  useEffect(() => {
    const app = desktopApp()
    if (!app || !userId) return undefined
    ensureLinked().catch(() => {})
    return app.onOpenFolder(() => navigate("/app?folder=1"))
  }, [userId, navigate])

  if (!ready) return <ShellLoading />
  if (!user) return <Navigate to={"/login?next=" + encodeURIComponent(location.pathname + location.search)} replace />
  if (!(user.settings && user.settings.onboarded) && !onboardedHere()) return <Navigate to={"/welcome?next=" + encodeURIComponent(location.pathname + location.search)} replace />

  return (
    <ConfirmProvider>
      <div className={"fw fw-app" + (collapsed ? " is-collapsed" : "") + (inSettings ? " is-settings" : "")}>
        {!inSettings && <Sidebar onCollapse={() => setCollapsed(true)} mobileOpen={mobileOpen} onMobileClose={() => setMobileOpen(false)} />}
        <main className="fw-main">
          {!inSettings && (
            <div className="fw-mobilebar">
              <IconButton icon={Menu} label="Open menu" onClick={() => setMobileOpen(true)} />
              <LogoMark size={22} />
            </div>
          )}
          {collapsed && !inSettings && (
            <IconButton icon={PanelLeftOpen} label="Show sidebar (Ctrl B)" className="fw-sb-open" onClick={() => setCollapsed(false)} />
          )}
          <Suspense fallback={<div className="fw-page"><Skeleton lines={6} /></div>}>
            <Outlet key={(location.state && location.state.fresh) || "stable"} />
          </Suspense>
        </main>
      </div>
      <Search />
      <Toasts />
    </ConfirmProvider>
  )
}

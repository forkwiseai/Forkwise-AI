import { lazy, Suspense, useEffect } from "react"
import { createRoot } from "react-dom/client"
import { BrowserRouter, Navigate, Route, Routes, useLocation, useParams } from "react-router-dom"
import "./styles/base.css"
import "./styles/site.css"
import "./styles/app.css"
import "./styles/polish.css"
import "./styles/flat.css"
import "./styles/upgrade.css"
import "./styles/fixes.css"
import { StoreProvider, useStore } from "./lib/store"
import { ConfirmProvider } from "./components/ui/Modal"
import { PageSkeleton } from "./components/ui/Skeleton"
import 'katex/dist/katex.min.css';

function named(loader, name) {
  return lazy(() => loader().then((module) => ({ default: module[name] })))
}

const Login = named(() => import("./pages/auth/Auth"), "Login")
const Register = named(() => import("./pages/auth/Auth"), "Register")
const Verify = named(() => import("./pages/auth/Auth"), "Verify")
const Forgot = named(() => import("./pages/auth/Auth"), "Forgot")
const Reset = named(() => import("./pages/auth/Auth"), "Reset")
const Welcome = named(() => import("./pages/auth/Auth"), "Welcome")
const AppShell = lazy(() => import("./pages/app/AppShell"))
const AppHome = lazy(() => import("./pages/app/Home"))
const Chat = lazy(() => import("./pages/app/Chat"))
const Settings = lazy(() => import("./pages/app/Settings"))
const Projects = named(() => import("./pages/app/Projects"), "Projects")
const Project = named(() => import("./pages/app/Projects"), "Project")
const Billing = named(() => import("./pages/app/More"), "Billing")
const Customize = lazy(() => import("./pages/app/Customize"))
const Automations = lazy(() => import("./pages/app/Automations"))
const Admin = named(() => import("./pages/app/Admin"), "Admin")
const AppTemplates = named(() => import("./pages/app/More"), "AppTemplates")
const Design = lazy(() => import("./pages/app/Design"))
const Plugins = lazy(() => import("./pages/app/Plugins"))
const Share = lazy(() => import("./pages/app/Share"))

// Studio was folded into the agent: old links open the same chat
function StudioRedirect() {
  const { chatId } = useParams()
  return <Navigate to={"/app/c/" + chatId} replace />
}

function Toasts() {
  const { toasts } = useStore()
  const location = useLocation()
  if (location.pathname.indexOf("/app") === 0) return null
  return (
    <div className="toasts" role="status">
      {toasts.map((item) => <div key={item.id} className={"toast " + item.kind}>{item.text}</div>)}
    </div>
  )
}

// The marketing site lives in src/mk and is not part of the open-source repository.
// Without it, "/" opens the app and site pages (docs, pricing, legal) open on forkwiseai.com.
const site = Object.values(import.meta.glob("./mk/routes.jsx", { eager: true }))[0]
const SITE_URL = "https://forkwiseai.com"

function ToSite() {
  const location = useLocation()
  useEffect(() => {
    window.location.replace(SITE_URL + location.pathname + location.search + location.hash)
  }, [location])
  return <PageSkeleton />
}

function openSourceRoutes() {
  return [
    <Route key="home" path="/" element={<Navigate to="/app" replace />} />,
    ...["docs", "docs/*", "pricing", "download", "developers", "open-source", "changelog", "blog", "blog/*", "privacy", "terms", "security", "contact", "about", "product", "use-cases"].map((path) => (
      <Route key={path} path={"/" + path} element={<ToSite />} />
    )),
    <Route key="any" path="*" element={<Navigate to="/app" replace />} />,
  ]
}

function Bare({ children }) {
  return <Suspense fallback={<div className="auth-loading" />}>{children}</Suspense>
}


function App() {
  return (
    <BrowserRouter>
      <Routes>
        {site ? site.siteRoutes() : openSourceRoutes()}
        <Route path="/login" element={<Bare><Login /></Bare>} />
        <Route path="/register" element={<Bare><Register /></Bare>} />
        <Route path="/verify" element={<Bare><Verify /></Bare>} />
        <Route path="/forgot" element={<Bare><Forgot /></Bare>} />
        <Route path="/reset/:token" element={<Bare><Reset /></Bare>} />
        <Route path="/welcome" element={<Bare><Welcome /></Bare>} />
        <Route path="/share/:token" element={<Bare><Share /></Bare>} />
        <Route path="/studio" element={<Navigate to="/app" replace />} />
        <Route path="/studio/:chatId" element={<StudioRedirect />} />
        <Route path="/app" element={<Suspense fallback={<div style={{ position: "fixed", inset: 0, background: "#09090a" }} />}><AppShell /></Suspense>}>
          <Route index element={<AppHome kind="chat" />} />
          <Route path="code" element={<AppHome kind="code" />} />
          <Route path="design" element={<Design />} />
          <Route path="plugins" element={<Plugins />} />
          <Route path="studio" element={<Navigate to="/app" replace />} />
          <Route path="studio/:chatId" element={<StudioRedirect />} />
          <Route path="automations" element={<Automations />} />
          <Route path="customize" element={<Customize />} />
          <Route path="customize/:tab" element={<Customize />} />
          <Route path="c/:chatId" element={<Chat />} />
          <Route path="templates" element={<AppTemplates />} />
          <Route path="projects" element={<Projects />} />
          <Route path="projects/:projectId" element={<Project />} />
          <Route path="settings" element={<Settings />} />
          <Route path="settings/:tab" element={<Settings />} />
          <Route path="billing" element={<Billing />} />
          <Route path="admin" element={<Admin />} />
        </Route>
      </Routes>
      <Toasts />
    </BrowserRouter>
  )
}

createRoot(document.getElementById("root")).render(
  <StoreProvider>
  <ConfirmProvider>
    <App />
  </ConfirmProvider>
  </StoreProvider>
)

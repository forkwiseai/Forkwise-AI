"""Ready, tested project starters with pinned versions that work together, so the agent
never fights tooling (for example Tailwind 4 vs a Tailwind 3 config). The agent then builds
the real product on top."""

import json

REACT_DEPS = {"react": "^18.3.1", "react-dom": "^18.3.1", "react-router-dom": "^6.28.0", "lucide-react": "^0.460.0"}
REACT_DEV = {"vite": "^5.4.11", "@vitejs/plugin-react": "^4.3.4", "tailwindcss": "^4.0.0", "@tailwindcss/vite": "^4.0.0"}


def web(name, title, api=False):
    package = {"name": name, "private": True, "version": "0.1.0", "type": "module",
               "scripts": {"dev": "vite --host 0.0.0.0 --port 5173", "build": "vite build", "preview": "vite preview --host 0.0.0.0 --port 4173"},
               "dependencies": REACT_DEPS, "devDependencies": REACT_DEV}
    proxy = """,
    proxy: { "/api": { target: "http://127.0.0.1:8000", changeOrigin: true } }""" if api else ""
    return {
        "package.json": json.dumps(package, indent=2) + "\n",
        "vite.config.js": """import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    allowedHosts: true""" + proxy + """
  }
})
""",
        "index.html": """<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>""" + title + """</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
""",
        "src/index.css": """@import "tailwindcss";

@theme {
  --font-sans: "Inter", ui-sans-serif, system-ui, sans-serif;
  --color-brand: #6d5cf5;
}

html, body, #root { height: 100%; }
body { @apply bg-white text-zinc-900 antialiased; }
""",
        "src/main.jsx": """import React from "react"
import ReactDOM from "react-dom/client"
import { BrowserRouter } from "react-router-dom"
import App from "./App.jsx"
import "./index.css"

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
)
""",
        "src/App.jsx": """import { Routes, Route, Link } from "react-router-dom"
import Home from "./pages/Home.jsx"

export default function App() {
  return (
    <div className="min-h-full">
      <header className="border-b border-zinc-200">
        <nav className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-4">
          <Link to="/" className="font-semibold">""" + title + """</Link>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-10">
        <Routes>
          <Route path="/" element={<Home />} />
        </Routes>
      </main>
    </div>
  )
}
""",
        "src/pages/Home.jsx": ("""import { useEffect, useState } from "react"

export default function Home() {
  const [status, setStatus] = useState("checking")
  useEffect(() => {
    fetch("/api/health").then((r) => r.json()).then((d) => setStatus(d.status)).catch(() => setStatus("offline"))
  }, [])
  return (
    <section className="space-y-3">
      <h1 className="text-3xl font-bold tracking-tight">""" + title + """</h1>
      <p className="text-zinc-600">API: {status}</p>
    </section>
  )
}
""" if api else """export default function Home() {
  return (
    <section className="space-y-3">
      <h1 className="text-3xl font-bold tracking-tight">""" + title + """</h1>
      <p className="text-zinc-600">Replace this page with the real product.</p>
    </section>
  )
}
"""),
        ".gitignore": "node_modules/\ndist/\n.env\n.env.*\n*.log\n",
    }


def api_files(title):
    return {
        "requirements.txt": "fastapi>=0.115\nuvicorn[standard]>=0.32\npydantic>=2.9\nhttpx>=0.27\npytest>=8.3\n",
        "pytest.ini": "[pytest]\npythonpath = .\ntestpaths = tests\nfilterwarnings = ignore::DeprecationWarning\n",
        "app/__init__.py": "",
        "app/db.py": '''"""SQLite with plain SQL. Safe to run twice."""
import os
import sqlite3
from contextlib import contextmanager

PATH = os.environ.get("DATABASE_PATH", os.path.join(os.path.dirname(__file__), "..", "data.db"))


def init():
    with connect() as db:
        db.executescript("""
        CREATE TABLE IF NOT EXISTS items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        """)


@contextmanager
def connect():
    db = sqlite3.connect(PATH)
    db.row_factory = sqlite3.Row
    try:
        yield db
        db.commit()
    finally:
        db.close()
''',
        "app/main.py": '''from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from app import db

app = FastAPI(title="''' + title + '''")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
db.init()


class ItemIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/items")
def list_items(limit: int = 50, offset: int = 0):
    with db.connect() as conn:
        rows = conn.execute("SELECT * FROM items ORDER BY id DESC LIMIT ? OFFSET ?", (min(limit, 200), offset)).fetchall()
    return [dict(row) for row in rows]


@app.post("/api/items", status_code=201)
def create_item(item: ItemIn):
    with db.connect() as conn:
        cursor = conn.execute("INSERT INTO items (name) VALUES (?)", (item.name,))
        row = conn.execute("SELECT * FROM items WHERE id = ?", (cursor.lastrowid,)).fetchone()
    return dict(row)


@app.delete("/api/items/{item_id}", status_code=204)
def delete_item(item_id: int):
    with db.connect() as conn:
        if conn.execute("DELETE FROM items WHERE id = ?", (item_id,)).rowcount == 0:
            raise HTTPException(status_code=404, detail="Item not found")
''',
        "tests/test_api.py": '''import os
import tempfile

os.environ["DATABASE_PATH"] = os.path.join(tempfile.mkdtemp(), "test.db")

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

client = TestClient(app)


def test_health():
    assert client.get("/api/health").json() == {"status": "ok"}


def test_items_roundtrip():
    made = client.post("/api/items", json={"name": "first"})
    assert made.status_code == 201
    assert any(item["name"] == "first" for item in client.get("/api/items").json())
    assert client.delete("/api/items/" + str(made.json()["id"])).status_code == 204


def test_rejects_empty_name():
    assert client.post("/api/items", json={"name": ""}).status_code == 422
''',
        ".gitignore": ".venv/\n__pycache__/\n*.db\n.env\n.pytest_cache/\n",
    }


def static_files(title):
    return {
        "index.html": """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>""" + title + """</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <header class="site-header"><a href="index.html" class="logo">""" + title + """</a></header>
  <main class="container"><h1>""" + title + """</h1></main>
  <script src="main.js"></script>
</body>
</html>
""",
        "styles.css": """:root { --ink: #18181b; --muted: #52525b; --brand: #6d5cf5; --bg: #ffffff; }
* { box-sizing: border-box; }
body { margin: 0; font-family: Inter, system-ui, sans-serif; color: var(--ink); background: var(--bg); }
.container { max-width: 1120px; margin: 0 auto; padding: 48px 24px; }
.site-header { padding: 16px 24px; border-bottom: 1px solid #e4e4e7; }
.logo { font-weight: 700; color: inherit; text-decoration: none; }
""",
        "main.js": "// Page behaviour goes here.\n",
    }


TEMPLATES = {
    "react": "React + Vite + Tailwind CSS 4 + React Router (frontend only)",
    "api": "Python FastAPI + SQLite + pytest (backend only)",
    "fullstack": "React/Vite/Tailwind 4 frontend in web/ + FastAPI/SQLite backend in api/, /api proxied, tests included",
    "static": "Plain HTML/CSS/JS website (no build step)",
}


def files_for(template, title, name):
    if template == "react":
        return web(name, title), [("npm install --no-audit --no-fund", ".")], [{"name": "web", "command": "npm run dev", "cwd": ".", "port": 5173}]
    if template == "api":
        return api_files(title), [("python3 -m venv .venv && .venv/bin/pip install -q -r requirements.txt && .venv/bin/pytest -q", ".")], [{"name": "api", "command": ".venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000", "cwd": ".", "port": 8000, "path": "/api/health"}]
    if template == "fullstack":
        files = {}
        for path, text in web(name + "-web", title, api=True).items():
            files["web/" + path] = text
        for path, text in api_files(title).items():
            files["api/" + path] = text
        files["README.md"] = "# " + title + "\n\n- `api/`: FastAPI + SQLite. Run: `cd api && .venv/bin/uvicorn app.main:app --port 8000`. Tests: `cd api && .venv/bin/pytest -q`\n- `web/`: React + Vite + Tailwind 4. Run: `cd web && npm run dev` (proxies /api to port 8000). Build: `npm run build`\n"
        files[".gitignore"] = "node_modules/\ndist/\n.venv/\n__pycache__/\n*.db\n.env\n.env.*\n*.log\n"
        return files, [("python3 -m venv .venv && .venv/bin/pip install -q -r requirements.txt && .venv/bin/pytest -q", "api"), ("npm install --no-audit --no-fund", "web")], [
            {"name": "api", "command": ".venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000", "cwd": "api", "port": 8000, "path": "/api/health"},
            {"name": "web", "command": "npm run dev", "cwd": "web", "port": 5173}]
    if template == "static":
        return static_files(title), [], [{"name": "site", "command": "python3 -m http.server 5173 --bind 0.0.0.0", "cwd": ".", "port": 5173}]
    return None, [], []

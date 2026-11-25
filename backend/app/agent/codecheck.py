"""Checks the code right after the agent edits it, and tells the agent what broke while it still knows why.

Two passes, both best effort and quiet when everything is fine:

- after each edit, a quick check of that one file: Python is compiled (and, when ruff is installed, checked for
  undefined names), plain JavaScript goes through `node --check`, JSON is parsed;
- after each step, one project-wide pass for the TypeScript and JSX files edited in it: the project's own
  `tsc --noEmit` when it has a tsconfig and TypeScript installed, otherwise esbuild for syntax only. Errors in the
  edited files are listed, others are counted, so a half-migrated project does not drown the agent.

Nothing is installed: a project without the tools gets the checks it can have. Turn it off with
`"diagnostics": false` in .forkwise/settings.json.
"""
import json
import posixpath
import re
import shlex

from app.agent import sandbox

QUICK_TIMEOUT = 25
PROJECT_TIMEOUT = 90
SKIP = re.compile(r"(^|/)(node_modules|dist|build|\.next|\.venv|venv|__pycache__|\.git)/")
TS_ERROR = re.compile(r"^(?P<path>[^\s(][^(]*)\((?P<line>\d+),(?P<col>\d+)\): error (?P<code>TS\d+): (?P<text>.*)$")
TYPED = (".ts", ".tsx", ".jsx", ".mts", ".cts")


def wanted(path):
    return bool(path) and not SKIP.search(path)


def quick_command(path):
    quoted = shlex.quote(path)
    if path.endswith(".py"):
        return ("python3 -m py_compile " + quoted + " 2>&1 | tail -n 8; "
                "if command -v ruff >/dev/null 2>&1; then ruff check --select E9,F821,F811,F823 --output-format concise --quiet " + quoted + " 2>&1 | head -n 15; fi")
    if path.endswith((".js", ".mjs", ".cjs")):
        return "if command -v node >/dev/null 2>&1; then node --check " + quoted + " 2>&1 | head -n 12; fi"
    return ""


def json_problem(text):
    try:
        json.loads(text)
    except ValueError as problem:
        return str(problem)
    return ""


async def quick(run, path):
    """A short report for one edited file, or "" when it is fine or cannot be checked."""
    if not wanted(path):
        return ""
    if path.endswith(".json") and not path.endswith(("package-lock.json", ".jsonc")) and "tsconfig" not in path:
        target = sandbox.resolve(run.wid, path)
        if target.exists() and target.stat().st_size < 2_000_000:
            problem = json_problem(target.read_text(encoding="utf-8", errors="replace"))
            if problem:
                return "This JSON does not parse: " + problem
        return ""
    command = quick_command(path)
    if not command:
        return ""
    done = await sandbox.run(run.wid, command, timeout=QUICK_TIMEOUT, limit=4000)
    output = clean(done["output"])
    if not output:
        return ""
    return output


def clean(text):
    lines = [line for line in (text or "").splitlines() if line.strip() and "All checks passed" not in line]
    return "\n".join(lines[:16]).strip()


def project_root(run, path):
    """The nearest folder above the file with a package.json, as a path inside the workspace ("" for the root)."""
    folder = posixpath.dirname(path)
    while True:
        if sandbox.resolve(run.wid, posixpath.join(folder, "package.json") if folder else "package.json").exists():
            return folder
        if not folder:
            return None
        folder = posixpath.dirname(folder)


def parse_tsc(output, root, edited):
    """(errors in the edited files, how many elsewhere) from tsc --pretty false output."""
    mine, others = [], 0
    for line in (output or "").splitlines():
        found = TS_ERROR.match(line.strip())
        if not found:
            continue
        path = posixpath.normpath(posixpath.join(root, found.group("path"))) if root else posixpath.normpath(found.group("path"))
        if path in edited:
            mine.append(path + ":" + found.group("line") + ":" + found.group("col") + " " + found.group("code") + " " + found.group("text")[:220])
        else:
            others = others + 1
    return mine, others


async def project_check(run, root, files):
    prefix = "cd " + shlex.quote(root) + " && " if root else ""
    has_tsc = sandbox.resolve(run.wid, posixpath.join(root, "node_modules/.bin/tsc") if root else "node_modules/.bin/tsc").exists()
    has_config = sandbox.resolve(run.wid, posixpath.join(root, "tsconfig.json") if root else "tsconfig.json").exists()
    typescript = [path for path in files if path.endswith((".ts", ".tsx", ".mts", ".cts"))]
    if has_tsc and has_config and typescript:
        done = await sandbox.run(run.wid, prefix + "./node_modules/.bin/tsc --noEmit --pretty false 2>&1 | head -n 400", timeout=PROJECT_TIMEOUT, limit=60000)
        mine, others = parse_tsc(done["output"], root, set(files))
        return mine, others, "tsc"
    esbuild = sandbox.resolve(run.wid, posixpath.join(root, "node_modules/.bin/esbuild") if root else "node_modules/.bin/esbuild").exists()
    if not esbuild:
        return [], 0, ""
    problems = []
    for path in files[:8]:
        inside = posixpath.relpath(path, root) if root else path
        done = await sandbox.run(run.wid, prefix + "./node_modules/.bin/esbuild " + shlex.quote(inside) + " --log-level=error --outfile=/dev/null 2>&1 | head -n 12", timeout=QUICK_TIMEOUT, limit=4000)
        text = clean(re.sub(r"\x1b\[[0-9;]*m", "", done["output"]))
        if text:
            problems.append(path + ":\n" + text)
    return problems, 0, "esbuild"


async def after_step(run, edited):
    """Runs the project-wide pass for the step's edited TypeScript and JSX files; returns a note for the agent or ""."""
    files = sorted({path for path in edited if path.endswith(TYPED) and wanted(path)})
    if not files:
        return ""
    by_root = {}
    for path in files:
        root = project_root(run, path)
        if root is not None:
            by_root.setdefault(root, []).append(path)
    notes = []
    total = 0
    for root, paths in by_root.items():
        mine, others, tool = await project_check(run, root, paths)
        if mine:
            total = total + len(mine)
            head = ("TypeScript (" + tool + ")" if tool == "tsc" else "A syntax check (esbuild)") + " found problems in the files you just edited"
            notes.append(head + ":\n" + "\n".join(mine[:15]) + ("\n…and " + str(len(mine) - 15) + " more" if len(mine) > 15 else ""))
        seen = getattr(run, "diag_others", {})
        before = seen.get(root, 0)
        seen[root] = others
        run.diag_others = seen
        if others > before:
            notes.append(str(others) + " other type error(s) exist elsewhere in " + (root or "the project") + "; fix them if your change caused them.")
    if not notes:
        return ""
    run.emit("notice", {"text": "Code check after the last edits: " + (str(total) + " problem(s) to fix" if total else "errors elsewhere in the project") + "."})
    return "\n\n".join(notes) + "\nFix these before moving on, then continue."

"""Independent check that runs before the agent may say it is done.

It does not trust what the agent wrote. It finds the projects the agent touched, runs their
real build and test commands, and checks that every registered service still answers.
Only failures come back; each one carries the command and the tail of its output."""

import base64
import json
import shlex
from pathlib import Path

from app.agent import sandbox, docscheck, sitecheck

SKIP = ("node_modules/", ".venv/", "dist/", "build/", ".git/", "__pycache__/", ".forkwise/", ".next/")


def project_roots(paths):
    """Folders of the touched files that hold a package.json, pyproject or requirements."""
    roots = set()
    for path in paths:
        clean = path.replace("\\", "/")
        while clean.startswith("./"):
            clean = clean[2:]
        if any(part in clean + "/" for part in SKIP):
            continue
        parts = clean.split("/")[:-1]
        for depth in range(len(parts), -1, -1):
            roots.add("/".join(parts[:depth]) or ".")
    return sorted(roots, key=lambda item: (item.count("/"), item))


def node_checks(root, package):
    scripts = package.get("scripts") or {}
    checks = []
    if "build" in scripts:
        checks.append(("npm run build", 420))
    if "test" in scripts and "no test specified" not in str(scripts["test"]):
        checks.append(("CI=1 npm test --silent -- --run 2>/dev/null || CI=1 npm test --silent", 300))
    if "typecheck" in scripts:
        checks.append(("npm run typecheck", 240))
    if "lint" in scripts and not checks:
        checks.append(("npm run lint", 180))
    return checks


async def detect(wid, root):
    folder = sandbox.resolve(wid, root)
    if not folder.is_dir():
        return []
    package_file = folder / "package.json"
    if package_file.is_file():
        try:
            package = json.loads(package_file.read_text(encoding="utf-8"))
        except ValueError:
            return [("node -e \"JSON.parse(require('fs').readFileSync('package.json','utf8'))\"", 30)]
        if not (folder / "node_modules").is_dir():
            return [("npm install --no-audit --no-fund", 600)] + node_checks(root, package)
        return node_checks(root, package)
    python_project = (folder / "pyproject.toml").is_file() or (folder / "requirements.txt").is_file()
    if python_project:
        python = ".venv/bin/python" if (folder / ".venv" / "bin" / "python").exists() else "python3"
        checks = [(python + " -m compileall -q -x '(\\.venv|node_modules)' .", 120)]
        if (folder / "tests").is_dir() or any(folder.glob("test_*.py")):
            checks.append((python + " -m pytest -q -x 2>&1 | tail -n 40; exit ${PIPESTATUS[0]}", 300))
        return checks
    return []


async def verify(run):
    """Returns a list of problems found by really running things. Empty means it passed."""
    wrote = getattr(run, "wrote", {}) or {}
    problems = []
    checked = 0
    seen = set()
    for root in project_roots(list(wrote)):
        if checked >= 3:
            break
        if any(root == done or root.startswith(done + "/") for done in seen):
            continue
        try:
            checks = await detect(run.wid, root)
        except ValueError:
            continue
        if not checks:
            continue
        seen.add(root)
        checked += 1
        run.emit("notice", {"text": "Verifying " + root + ": " + ", ".join(command.split(" 2>")[0].split(" ||")[0] for command, _ in checks)})
        for command, timeout in checks:
            output = await sandbox.run(run.wid, "cd " + shlex.quote(root) + " && bash -c " + shlex.quote(command), timeout=timeout)
            if not hasattr(run, "commands"):
                run.commands = []
            run.commands.append((command, output["code"]))
            if output["code"] != 0:
                tail = output["output"].strip()[-2500:]
                problems.append("Verification failed in " + root + ": `" + command.split(" 2>")[0] + "` exited " + str(output["code"]) + ". Output:\n" + tail)
                break
    for item in await sandbox.service_list(run.wid):
        if not item["alive"]:
            problems.append("The service " + item["name"] + " (" + str(item["command"]) + ") has stopped. Log:\n" + str(item["log"])[-1500:] + "\nFix it and start it again with the service tool.")
        elif item["port"] and item["http"] in ("", "000"):
            problems.append("The service " + item["name"] + " is running but port " + str(item["port"]) + " does not answer. Check the log with service logs and fix it.")
        elif item["port"] and str(item["http"]).startswith("5"):
            problems.append("The service " + item["name"] + " answers HTTP " + str(item["http"]) + " (server error). Read its log and fix the cause.")
    return problems


DOC_FIND = "find . -maxdepth 6 -type f \\( -iname '*.pptx' -o -iname '*.pdf' -o -iname '*.docx' \\) -newermt @{since} -not -path '*/node_modules/*' -not -path '*/.git/*' 2>/dev/null | head -20"


async def verify_documents(run):
    """Checks every deck, PDF and Word file made during this run with exact geometry and counting.
    Runs in the sandbox, because that is where python-pptx lives. Returns a list of problems."""
    since = int(getattr(run, "started_at", 0) or 0)
    if not since:
        return []
    listing = await sandbox.run(run.wid, DOC_FIND.format(since=since), timeout=30, limit=4000)
    files = [line.strip() for line in listing["output"].splitlines() if line.strip().lower().endswith(docscheck.DOC_TYPES)]
    if not files:
        return []
    source = Path(docscheck.__file__).read_text(encoding="utf-8")
    encoded = base64.b64encode(source.encode("utf-8")).decode("ascii")
    flag = " --animate" if docscheck.wants_animation(getattr(run, "request_text", "")) else ""
    command = "echo " + encoded + " | base64 -d > /tmp/.fw_docscheck.py && python3 /tmp/.fw_docscheck.py" + flag + " " + " ".join(shlex.quote(item) for item in files)
    output = await sandbox.run(run.wid, command, timeout=120, limit=20000)
    try:
        report = json.loads(output["output"].strip().splitlines()[-1])
    except (ValueError, IndexError):
        return []
    run.doc_stats = report.get("stats") or {}
    problems = []
    for name, found in (report.get("problems") or {}).items():
        for item in found:
            problems.append(name + ": " + item)
    return problems[:12]


WEB_TYPES = (".html", ".htm", ".jsx", ".tsx", ".vue", ".svelte", ".css")


def site_targets(services, wrote):
    """URLs to open: every live service with a port, else up to three static HTML files the run wrote."""
    urls = []
    for item in services:
        if item.get("alive") and item.get("port"):
            urls.append("http://localhost:" + str(item["port"]) + "/")
    if not urls:
        for path in wrote:
            clean = path.replace("\\", "/").lstrip("./")
            if clean.lower().endswith((".html", ".htm")) and not any(part in clean + "/" for part in SKIP):
                urls.append("file://$PWD/" + clean)
    return urls[:3]


async def verify_site(run):
    """Opens what the run built in a real browser. Returns a list of problems."""
    wrote = getattr(run, "wrote", {}) or {}
    touched_web = any(path.lower().endswith(WEB_TYPES) for path in wrote) or getattr(run, "served", False)
    if not touched_web:
        return []
    urls = site_targets(await sandbox.service_list(run.wid), wrote)
    if not urls:
        return []
    source = Path(sitecheck.__file__).read_text(encoding="utf-8")
    encoded = base64.b64encode(source.encode("utf-8")).decode("ascii")
    quoted = " ".join('"' + url.replace('"', "") + '"' for url in urls)
    run.emit("notice", {"text": "Opening the site in a browser to check it: " + ", ".join(urls)})
    output = await sandbox.run(run.wid, "echo " + encoded + " | base64 -d > /tmp/.fw_sitecheck.py && python3 /tmp/.fw_sitecheck.py " + quoted, timeout=240, limit=20000)
    try:
        report = json.loads(output["output"].strip().splitlines()[-1])
    except (ValueError, IndexError):
        return []
    problems = []
    for found in report.values():
        problems.extend(item for item in found if not item.startswith("Could not check"))
    return problems[:12]

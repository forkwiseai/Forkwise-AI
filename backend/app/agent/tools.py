import asyncio
import base64
import difflib
import fnmatch
import json
import os
import re
import shlex
import time
from pathlib import Path
import httpx
from app.agent import library
from app import db, config
from app.agent import sandbox, web, specs, mcp, integrations

TEXT_LIMIT = 40000
IMAGE_TYPES = [".png", ".jpg", ".jpeg", ".gif", ".webp"]
SHOT_SCRIPT_LOCAL = str(config.ROOT / "sandbox" / "shot.py")
BROWSER_SCRIPT_LOCAL = str(config.ROOT / "sandbox" / "browser.py")


def result(text, ok=True, meta=None, image=None, end_turn=False):
    return {"text": text, "ok": ok, "meta": meta or {}, "image": image, "end_turn": end_turn}


def short(text, limit=TEXT_LIMIT):
    if len(text) <= limit:
        return text
    half = limit // 2
    return text[:half] + "\n\n[... " + str(len(text) - limit) + " characters cut ...]\n\n" + text[-half:]


def numbered(text, offset, limit):
    lines = text.split("\n")
    start = max(1, offset or 1)
    count = limit or 800
    end = min(len(lines), start + count - 1)
    out = []
    line_no = start
    while line_no <= end:
        line = lines[line_no - 1]
        if len(line) > 2000:
            line = line[:2000] + " [line cut]"
        out.append(str(line_no).rjust(5) + "  " + line)
        line_no = line_no + 1
    footer = ""
    if end < len(lines):
        footer = "\n[file has " + str(len(lines)) + " lines; read more with offset=" + str(end + 1) + "]"
    if len(out) == 0:
        return "[empty file]"
    return "\n".join(out) + footer


def make_diff(old, new, path):
    lines = difflib.unified_diff(old.splitlines(), new.splitlines(), "a/" + path, "b/" + path, lineterm="", n=2)
    text = "\n".join(lines)
    if len(text) > 30000:
        text = text[:30000] + "\n[diff cut]"
    return text


def count_changes(diff):
    added = 0
    removed = 0
    for line in diff.split("\n"):
        if line.startswith("+") and not line.startswith("+++"):
            added = added + 1
        elif line.startswith("-") and not line.startswith("---"):
            removed = removed + 1
    return added, removed


def read_settings(wid):
    path = sandbox.host_root(wid) / ".forkwise" / "settings.json"
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except ValueError:
        return {}


def blocked_command(run, command):
    deny = read_settings(run.wid).get("deny") or []
    for pattern in deny:
        if pattern and pattern in command:
            return pattern
    return ""


def guess_kind(path):
    lower = path.lower()
    for ending in IMAGE_TYPES + [".svg"]:
        if lower.endswith(ending):
            return "image"
    for ending in [".mp4", ".webm", ".mov", ".mkv"]:
        if lower.endswith(ending):
            return "video"
    for ending in [".mp3", ".wav", ".ogg", ".m4a", ".flac"]:
        if lower.endswith(ending):
            return "audio"
    if lower.endswith(".pdf"):
        return "pdf"
    if lower.endswith(".html") or lower.endswith(".htm"):
        return "html"
    return "file"


def image_data(path):
    data = Path(path).read_bytes()
    if len(data) > 5 * 1024 * 1024:
        return None
    kind = "png"
    lower = str(path).lower()
    if lower.endswith(".jpg") or lower.endswith(".jpeg"):
        kind = "jpeg"
    elif lower.endswith(".webp"):
        kind = "webp"
    elif lower.endswith(".gif"):
        kind = "gif"
    return "data:image/" + kind + ";base64," + base64.b64encode(data).decode("ascii")


async def read_file(run, args):
    target = sandbox.resolve(run.wid, args.get("path"))
    rel = sandbox.relative(run.wid, target)
    if not target.exists():
        return result("File not found: " + rel, ok=False)
    if target.is_dir():
        return result(rel + " is a folder. Use list_dir.", ok=False)
    if target.suffix.lower() in IMAGE_TYPES:
        image = None
        if run.vision:
            image = image_data(target)
        return result("Image " + rel + " (" + str(target.stat().st_size) + " bytes).", meta={"image": rel}, image=image)
    raw = target.read_bytes()
    if b"\x00" in raw[:4000]:
        return result(rel + " is a binary file of " + str(len(raw)) + " bytes.", ok=False)
    text = raw.decode("utf-8", "replace")
    run.read_files[rel] = True
    lines = text.count("\n") + 1
    return result(short(numbered(text, args.get("offset"), args.get("limit"))), meta={"lines": lines})


async def write_file(run, args):
    target = sandbox.resolve(run.wid, args.get("path"))
    rel = sandbox.relative(run.wid, target)
    content = args.get("content")
    if content is None:
        return result("content is missing.", ok=False)
    old = ""
    existed = target.exists()
    if existed:
        old = target.read_text(encoding="utf-8", errors="replace")
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")
    diff = make_diff(old, content, rel)
    added, removed = count_changes(diff)
    word = "Created "
    if existed:
        word = "Replaced "
    run.changed = True
    return result(word + rel + " (" + str(content.count("\n") + 1) + " lines).", meta={"path": rel, "diff": diff, "added": added, "removed": removed, "created": not existed})


def replace_once(text, old, new, replace_all, rel):
    if old == "":
        return None, "old_string is empty. Use write_file to create a file."
    count = text.count(old)
    if count == 0:
        stripped = old.strip()
        if stripped and text.count(stripped) == 1:
            return text.replace(stripped, new.strip(), 1), ""
        return None, "old_string was not found in " + rel + ". Read the file again and copy the text exactly, including spaces."
    if count > 1 and not replace_all:
        return None, "old_string appears " + str(count) + " times in " + rel + ". Add more surrounding lines to make it unique, or set replace_all."
    if replace_all:
        return text.replace(old, new), ""
    return text.replace(old, new, 1), ""


async def apply_edits(run, path, edits):
    target = sandbox.resolve(run.wid, path)
    rel = sandbox.relative(run.wid, target)
    if not target.exists():
        return result("File not found: " + rel + ". Use write_file to create it.", ok=False)
    old = target.read_text(encoding="utf-8", errors="replace")
    text = old
    number = 1
    for edit in edits:
        changed, problem = replace_once(text, edit.get("old_string", ""), edit.get("new_string", ""), bool(edit.get("replace_all")), rel)
        if changed is None:
            if len(edits) > 1:
                problem = "Edit " + str(number) + ": " + problem + " No edits were saved."
            return result(problem, ok=False)
        text = changed
        number = number + 1
    target.write_text(text, encoding="utf-8")
    diff = make_diff(old, text, rel)
    added, removed = count_changes(diff)
    run.changed = True
    return result("Edited " + rel + " (+" + str(added) + " -" + str(removed) + ").", meta={"path": rel, "diff": diff, "added": added, "removed": removed})


async def edit_file(run, args):
    return await apply_edits(run, args.get("path"), [args])


async def multi_edit(run, args):
    edits = args.get("edits") or []
    if len(edits) == 0:
        return result("edits is empty.", ok=False)
    return await apply_edits(run, args.get("path"), edits)


async def list_dir(run, args):
    target = sandbox.resolve(run.wid, args.get("path"))
    if not target.exists():
        return result("Folder not found.", ok=False)
    depth = args.get("depth") or 3
    root = sandbox.host_root(run.wid).resolve()
    lines = []
    tree_lines(target, root, 0, depth, lines)
    if len(lines) == 0:
        return result("The folder is empty.")
    return result(short("\n".join(lines[:1500])))


def tree_lines(folder, root, level, depth, lines):
    if level >= depth or len(lines) > 1500:
        return
    try:
        entries = sorted(os.scandir(folder), key=sandbox.sort_key)
    except OSError:
        return
    for entry in entries:
        pad = "  " * level
        if entry.is_dir(follow_symlinks=False):
            if entry.name in sandbox.SKIP_DIRS:
                lines.append(pad + entry.name + "/ (skipped)")
            else:
                lines.append(pad + entry.name + "/")
                tree_lines(entry.path, root, level + 1, depth, lines)
        else:
            lines.append(pad + entry.name)


def walk_files(start):
    found = []
    if start.is_file():
        found.append(start)
        return found
    for folder, dirs, files in os.walk(start):
        kept = []
        for name in dirs:
            if name not in sandbox.SKIP_DIRS:
                kept.append(name)
        dirs[:] = kept
        for name in files:
            found.append(Path(folder) / name)
            if len(found) > 20000:
                return found
    return found


async def glob_files(run, args):
    start = sandbox.resolve(run.wid, args.get("path"))
    pattern = args.get("pattern") or "*"
    root = sandbox.host_root(run.wid).resolve()
    matches = []
    for path in walk_files(start):
        rel = str(path.relative_to(root))
        if fnmatch.fnmatch(rel, pattern) or fnmatch.fnmatch(path.name, pattern) or fnmatch.fnmatch(rel, pattern.replace("**/", "")):
            matches.append(rel)
    if len(matches) == 0:
        return result("No files match " + pattern)
    matches.sort()
    text = "\n".join(matches[:500])
    if len(matches) > 500:
        text = text + "\n[" + str(len(matches) - 500) + " more]"
    return result(text)


async def grep_files(run, args):
    start = sandbox.resolve(run.wid, args.get("path"))
    flags = 0
    if args.get("ignore_case"):
        flags = re.IGNORECASE
    try:
        pattern = re.compile(args.get("pattern", ""), flags)
    except re.error as problem:
        return result("Bad regular expression: " + str(problem), ok=False)
    include = args.get("include") or ""
    context = min(int(args.get("context") or 0), 5)
    root = sandbox.host_root(run.wid).resolve()
    out = []
    for path in walk_files(start):
        if include and not fnmatch.fnmatch(path.name, include):
            continue
        try:
            if path.stat().st_size > 2 * 1024 * 1024:
                continue
            raw = path.read_bytes()
        except OSError:
            continue
        if b"\x00" in raw[:2000]:
            continue
        lines = raw.decode("utf-8", "replace").split("\n")
        rel = str(path.relative_to(root))
        index = 0
        while index < len(lines):
            if pattern.search(lines[index]):
                low = max(0, index - context)
                high = min(len(lines), index + context + 1)
                spot = low
                while spot < high:
                    mark = ":"
                    if spot != index:
                        mark = "-"
                    out.append(rel + mark + str(spot + 1) + mark + " " + lines[spot][:400])
                    spot = spot + 1
                if context:
                    out.append("--")
            index = index + 1
            if len(out) > 400:
                break
        if len(out) > 400:
            out.append("[too many matches, narrow the search]")
            break
    if len(out) == 0:
        return result("No matches.")
    return result("\n".join(out))


async def bash(run, args, call_id):
    command = args.get("command") or ""
    if command.strip() == "":
        return result("command is empty.", ok=False)
    blocked = blocked_command(run, command)
    if blocked:
        return result("This command is blocked by the project settings (" + blocked + ").", ok=False)
    if args.get("run_in_background"):
        job = await sandbox.start_background(run.wid, command, args.get("description") or "")
        await run.sleep(2)
        status = await sandbox.job_output(run.wid, job["id"], tail=3000)
        state = "running"
        if not status.get("alive"):
            state = "already stopped"
        run.changed = True
        text = "Started in the background as " + job["id"] + " (" + state + ").\nFirst output:\n" + (status.get("output") or "(nothing yet)")
        return result(text, meta={"job": job["id"]})
    timeout = int(args.get("timeout") or 180)
    timeout = max(5, min(timeout, 900))

    async def on_output(piece):
        run.emit("tool_output", {"id": call_id, "text": piece})

    output = await sandbox.run(run.wid, command, timeout=timeout, on_output=on_output)
    run.changed = True
    if not hasattr(run, "commands"):
        run.commands = []
    run.commands.append((command, output["code"]))
    text = output["output"].strip() or "(no output)"
    hint = command_hint(command, output)
    return result("exit code " + str(output["code"]) + "\n" + text + hint, ok=output["code"] == 0, meta={"code": output["code"]})


def command_hint(command, output):
    """Points the model to the built-in capability when it tries to do by hand what Forkwise already does."""
    text = output["output"]
    if output["code"] == 0:
        return ""
    if re.search(r"\bgit\s+push\b|\bgh\s+(repo|pr)\b", command):
        return "\n\nHint: there are no GitHub credentials in this shell. Use the github tool: action publish (create repo + commit + push) or push."
    if "playwright" in command or "playwright" in text:
        return "\n\nHint: do not install Playwright yourself. Use the screenshot and browser tools; they come with a working browser."
    if "tailwindcss" in text and "PostCSS plugin has moved" in text:
        return "\n\nHint: this is Tailwind CSS v4. Use the scaffold tool for a working setup, or install @tailwindcss/vite and add tailwindcss() to vite.config plugins with @import \"tailwindcss\"; in the CSS."
    if re.search(r"EADDRINUSE|address already in use", text):
        return "\n\nHint: the port is busy. Use the service tool to list and restart services instead of starting another copy."
    return ""


async def service_tool(run, args):
    action = (args.get("action") or "").strip().lower()
    name = re.sub(r"[^a-zA-Z0-9_-]", "", (args.get("name") or "").strip())[:40]
    if action in ("start", "restart"):
        known = sandbox.read_services(run.wid).get(name, {})
        command = (args.get("command") or known.get("command") or "").strip()
        if not name or not command:
            return result("Give name and command.", ok=False)
        cwd = (args.get("cwd") or known.get("cwd") or ".").strip() or "."
        try:
            folder = sandbox.resolve(run.wid, cwd)
        except ValueError as problem:
            return result(str(problem), ok=False)
        port = int(args.get("port") or known.get("port") or 0)
        state = await sandbox.service_start(run.wid, name, command, port, args.get("path") or known.get("path") or "/", sandbox.relative(run.wid, folder) or ".")
        run.changed = True
        if port and state.get("healthy"):
            run.served = True
            url = preview_url(run.wid, port, args.get("path") or "/")
            return result("Service " + name + " is up on port " + str(port) + " (HTTP " + str(state.get("http")) + "). Preview link: " + url + "\nRecent log:\n" + short(state.get("log", ""), 1500))
        if state.get("healthy"):
            return result("Service " + name + " is running.\nRecent log:\n" + short(state.get("log", ""), 1500))
        reason = "stopped" if not state.get("alive") else "running but port " + str(port) + " does not answer yet"
        return result("Service " + name + " is " + reason + ". Read the log, fix the cause and start it again.\nLog:\n" + short(state.get("log", ""), 4000), ok=False)
    if action == "stop":
        found = await sandbox.service_stop(run.wid, name)
        return result("Stopped " + name + "." if found else "No service named " + name + ".", ok=found)
    if action in ("status", "logs", "list"):
        items = await sandbox.service_list(run.wid)
        if not items:
            return result("No services yet. Start one with action start.")
        lines = []
        for item in items:
            if name and item["name"] != name:
                continue
            health = "up" if item["alive"] and (not item["port"] or item["http"] not in ("", "000")) else "running, port not answering" if item["alive"] else "stopped"
            lines.append("- " + item["name"] + ": " + health + (" on port " + str(item["port"]) + " (HTTP " + str(item["http"]) + ")" if item["port"] else "") + " | " + str(item["command"]) + " in " + str(item["cwd"]))
            if action == "logs" or not item["alive"]:
                lines.append(short(item["log"], 2500))
        return result("\n".join(lines))
    return result("Unknown action. Use start, stop, restart, status or logs.", ok=False)


async def scaffold_tool(run, args):
    from app.agent import scaffolds
    template = (args.get("template") or "").strip().lower()
    folder = (args.get("folder") or "").strip().strip("/")
    if template not in scaffolds.TEMPLATES:
        return result("Unknown template. Choose: " + ", ".join(k + " (" + v + ")" for k, v in scaffolds.TEMPLATES.items()), ok=False)
    if not folder:
        return result("Give the new folder name.", ok=False)
    try:
        target = sandbox.resolve(run.wid, folder)
    except ValueError as problem:
        return result(str(problem), ok=False)
    if target.exists() and any(target.iterdir()):
        return result("The folder " + folder + " is not empty. Pick a new folder name.", ok=False)
    title = (args.get("title") or folder.replace("-", " ").title()).strip()[:60]
    name = re.sub(r"[^a-z0-9-]", "-", folder.lower()).strip("-") or "app"
    files, installs, services = scaffolds.files_for(template, title, name)
    for path, text in files.items():
        file_path = target / path
        file_path.parent.mkdir(parents=True, exist_ok=True)
        file_path.write_text(text, encoding="utf-8")
        if not hasattr(run, "wrote"):
            run.wrote = {}
        run.wrote[sandbox.relative(run.wid, file_path)] = len(text)
    run.changed = True
    rel = sandbox.relative(run.wid, target)
    report = ["Created " + rel + " from the " + template + " starter (" + str(len(files)) + " files)."]
    ok = True
    for command, where in installs:
        run.emit("notice", {"text": "Installing packages in " + (rel + "/" + where if where != "." else rel) + "..."})
        output = await sandbox.run(run.wid, "cd " + shlex.quote(rel + ("/" + where if where != "." else "")) + " && " + command, timeout=600)
        if not hasattr(run, "commands"):
            run.commands = []
        run.commands.append((command, output["code"]))
        report.append("$ " + command + " (in " + where + ") -> exit " + str(output["code"]) + "\n" + short(output["output"].strip(), 1500))
        ok = ok and output["code"] == 0
    if ok and args.get("start", True) is not False:
        for item in services:
            cwd = rel + ("/" + item["cwd"] if item["cwd"] != "." else "")
            state = await sandbox.service_start(run.wid, item["name"], item["command"], item["port"], item.get("path", "/"), cwd)
            if state.get("healthy"):
                run.served = True
                report.append("Service " + item["name"] + " is up: " + preview_url(run.wid, item["port"], "/"))
            else:
                ok = False
                report.append("Service " + item["name"] + " did not come up:\n" + short(state.get("log", ""), 1500))
    files_list = "\n".join("  " + path for path in sorted(files))
    report.append("Files:\n" + files_list)
    report.append("Next: build the real product on top (pages, data model, API), keep the services running, and use preview to show it.")
    return result("\n\n".join(report), ok=ok)


async def job_output(run, args):
    status = await sandbox.job_output(run.wid, args.get("job_id", ""))
    if not status.get("found"):
        return result("No job with this id. Jobs: " + ", ".join(job_ids(run.wid)), ok=False)
    state = "running"
    if not status["alive"]:
        state = "stopped"
    return result("Job " + status["job"]["id"] + " is " + state + ".\n" + (status["output"] or "(no output)"))


def find_job(wid, ref):
    found = None
    for job in sandbox.read_jobs(wid):
        if job["id"] == ref:
            return job
        if ref and job.get("name") == ref:
            found = job  # a service's newest job
    return found


def tail_lines(text, count=25):
    lines = [line for line in (text or "").splitlines() if line.strip()]
    return "\n".join(lines[-count:])


async def monitor(run, args):
    """Waits on a background job or service until its output shows a line, it stops, or time runs out."""
    ref = str(args.get("job_id") or args.get("service") or "").strip()
    job = find_job(run.wid, ref)
    if job is None:
        return result("No job or service called " + (ref or "(empty)") + ". Jobs: " + (", ".join(job_ids(run.wid)) or "none"), ok=False)
    try:
        until = re.compile(args["until"], re.I) if args.get("until") else None
        fail = re.compile(args["fail"], re.I) if args.get("fail") else None
    except re.error as problem:
        return result("until or fail is not a valid regular expression: " + str(problem), ok=False)
    timeout = min(max(int(args.get("timeout") or 60), 1), 300)
    path = sandbox.host_root(run.wid) / job["log"]

    def read():
        return path.read_text(encoding="utf-8", errors="replace") if path.exists() else ""
    start = len(read()) if args.get("only_new") else 0
    began = time.time()
    checked = 0.0
    while True:
        text = read()
        if len(text) < start:
            start = 0
        fresh = text[start:]
        for line in fresh.splitlines():
            if fail is not None and fail.search(line):
                return result("Failure line after " + str(int(time.time() - began)) + "s: " + line.strip()[:400] + "\n\nRecent output:\n" + tail_lines(fresh), ok=False, meta={"matched": "fail"})
            if until is not None and until.search(line):
                return result("Matched after " + str(int(time.time() - began)) + "s: " + line.strip()[:400] + "\n\nRecent output:\n" + tail_lines(fresh), meta={"matched": "until"})
        now = time.time()
        if now - checked >= 3:
            checked = now
            if not await sandbox.job_alive(run.wid, job):
                said = " without printing a line that matches " + args["until"] if until is not None else ""
                return result("The job stopped after " + str(int(now - began)) + "s" + said + ".\n\nLast output:\n" + (tail_lines(fresh) or tail_lines(text) or "(none)"), ok=until is None, meta={"stopped": True})
        if now - began >= timeout:
            if until is None:
                return result("Still running after " + str(timeout) + "s.\n\nRecent output:\n" + (tail_lines(fresh) or "(no new output)"))
            return result("Waited " + str(timeout) + "s and no line matched " + args["until"] + ". The job is still running.\n\nRecent output:\n" + (tail_lines(fresh) or "(no new output)"), ok=False)
        if run.stop_flag.is_set():
            return result("Stopped by the user.", ok=False)
        await asyncio.sleep(0.5)


def job_ids(wid):
    ids = []
    for job in sandbox.read_jobs(wid):
        ids.append(job["id"] + " (" + job["command"][:40] + ")")
    return ids


async def kill_job(run, args):
    found = await sandbox.kill_job(run.wid, args.get("job_id", ""))
    if not found:
        return result("No such job.", ok=False)
    return result("Stopped.")


def preview_url(wid, port, path="/"):
    if not path.startswith("/"):
        path = "/" + path
    if config.PREVIEW_HOST:
        return config.PREVIEW_SCHEME + "://p-" + wid + "-" + str(port) + "." + config.PREVIEW_HOST + path
    return config.API_URL + "/p/" + wid + "/" + str(port) + path


async def preview(run, args):
    import httpx
    port = int(args.get("port") or 0)
    if port < 1 or port > 65535:
        return result("Give a valid port.", ok=False)
    path = args.get("path") or "/"
    info = {"port": port, "command": args.get("command") or "", "path": path}
    folder = sandbox.host_root(run.wid) / ".forkwise"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "preview.json").write_text(json.dumps(info), encoding="utf-8")
    db.update("chats", "id", run.chat["id"], {"preview_port": port})
    address = await sandbox.box_address(run.wid)
    status = 0
    problem = ""
    tries = 0
    while tries < 10:
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                response = await client.get("http://" + address + ":" + str(port) + "/", headers={"Host": "localhost:" + str(port)})
            status = response.status_code
            break
        except Exception as error:
            problem = str(error)[:120]
        tries = tries + 1
        await run.sleep(1.5)
    url = preview_url(run.wid, port, path)
    run.emit("preview", {"url": url, "port": port})
    if status == 0:
        return result("Preview registered at " + url + " but nothing answers on port " + str(port) + " yet (" + problem + "). Check the server job output.", ok=False, meta={"url": url, "port": port})
    return result("The user now sees the app in the Preview panel: " + url + " (HTTP " + str(status) + ").", meta={"url": url, "port": port})


async def screenshot(run, args):
    url = args.get("url") or ""
    if url == "":
        return result("url is missing.", ok=False)
    folder = sandbox.host_root(run.wid) / ".forkwise" / "shots"
    folder.mkdir(parents=True, exist_ok=True)
    name = "shot_" + str(int(time.time() * 1000)) + ".png"
    rel = ".forkwise/shots/" + name
    width = int(args.get("width") or 1280)
    full = "0"
    if args.get("full_page"):
        full = "1"
    wait = int(args.get("wait_ms") or 800)
    script = "/opt/forkwise/shot.py"
    if not sandbox.is_docker():
        script = SHOT_SCRIPT_LOCAL
    command = "python3 " + script + " " + shell_quote(url) + " " + shell_quote(rel) + " " + str(width) + " " + full + " " + str(wait)
    output = await sandbox.run(run.wid, command, timeout=90, limit=6000)
    path = sandbox.host_root(run.wid) / rel
    if not path.exists():
        return result("The screenshot failed:\n" + output["output"][-3000:], ok=False)
    image = None
    if run.vision:
        image = image_data(path)
    note = output["output"].strip()
    if not run.vision:
        note = note + "\n(Your model cannot see images; use the page text and console output above.)"
    return result(short(note, 8000) or "Screenshot taken.", meta={"image": rel, "url": url}, image=image)


async def browser(run, args):
    action = args.get("action") or "screenshot"
    request = dict(args)
    rel = ""
    if action not in ["tabs", "close"]:
        folder = sandbox.host_root(run.wid) / ".forkwise" / "shots"
        folder.mkdir(parents=True, exist_ok=True)
        rel = ".forkwise/shots/browser_" + str(int(time.time() * 1000)) + ".png"
        request["out"] = rel
    script = "/opt/forkwise/browser.py"
    if not sandbox.is_docker():
        script = BROWSER_SCRIPT_LOCAL
    output = await sandbox.run(run.wid, "python3 " + script + " " + shell_quote(json.dumps(request)), timeout=150, limit=40000)
    lines = output["output"].strip().splitlines()
    try:
        answer = json.loads(lines[-1])
    except (ValueError, IndexError):
        return result("The browser failed:\n" + output["output"][-3000:], ok=False)
    text = short(answer.get("text") or "", 16000)
    meta = {"action": action, "url": args.get("url") or ""}
    image = None
    path = sandbox.host_root(run.wid) / rel if rel else None
    if path is not None and path.exists():
        meta["image"] = rel
        if run.vision:
            image = image_data(path)
        else:
            text = text + "\n(Your model cannot see images; use the clickable list and page text.)"
    return result(text or "Done.", ok=bool(answer.get("ok")), meta=meta, image=image)


async def computer(run, args):
    from app.routes import desktop
    if run.local and not args.get("device"):
        args["device"] = run.local_device
        args["exact"] = True
    answer = await desktop.call(run.user["id"], args)
    meta = {"action": args.get("action"), "device": answer.get("device", "")}
    image = None
    if answer.get("image"):
        folder = sandbox.host_root(run.wid) / ".forkwise" / "shots"
        folder.mkdir(parents=True, exist_ok=True)
        rel = ".forkwise/shots/pc_" + str(int(time.time() * 1000)) + ".png"
        (sandbox.host_root(run.wid) / rel).write_bytes(base64.b64decode(answer["image"]))
        meta["image"] = rel
        if run.vision:
            image = image_data(sandbox.host_root(run.wid) / rel)
    return result(short(answer.get("text") or "Done.", 20000), ok=bool(answer.get("ok")), meta=meta, image=image)


async def my_browser(run, args):
    from app.routes import browser as own_browser
    message = {key: value for key, value in args.items() if value is not None}
    answer = await own_browser.call(run.user["id"], message, timeout=60)
    meta = {"op": args.get("op")}
    image = None
    if answer.get("image"):
        folder = sandbox.host_root(run.wid) / ".forkwise" / "shots"
        folder.mkdir(parents=True, exist_ok=True)
        rel = ".forkwise/shots/mine_" + str(int(time.time() * 1000)) + ".png"
        (sandbox.host_root(run.wid) / rel).write_bytes(base64.b64decode(answer["image"]))
        meta["image"] = rel
        if run.vision:
            image = image_data(sandbox.host_root(run.wid) / rel)
    return result(short(answer.get("text") or "Done.", 20000), ok=bool(answer.get("ok")), meta=meta, image=image)


def shell_quote(text):
    import shlex
    return shlex.quote(text)


async def web_search(run, args):
    query = (args.get("query") or "").strip()
    if query == "":
        return result("query is empty.", ok=False)
    try:
        found = await web.search(query)
    except Exception as problem:
        return result(str(problem), ok=False)
    lines = []
    sources = []
    number = 1
    for item in found:
        lines.append(str(number) + ". " + item["title"] + "\n   " + item["url"] + "\n   " + item["snippet"])
        sources.append({"title": item["title"], "url": item["url"]})
        number = number + 1
    return result("\n".join(lines), meta={"sources": sources})


async def web_fetch(run, args):
    try:
        page = await web.fetch(args.get("url") or "", int(args.get("max_chars") or 20000))
    except Exception as problem:
        return result("Could not open the page: " + str(problem)[:300], ok=False)
    text = "URL: " + page["url"] + "\nHTTP " + str(page["status"]) + "\nTitle: " + page["title"] + "\n\n" + page["text"]
    return result(text, meta={"sources": [{"title": page["title"] or page["url"], "url": page["url"]}]})


async def todo_write(run, args):
    todos = []
    for item in args.get("todos") or []:
        status = item.get("status") or "pending"
        if status not in ["pending", "in_progress", "completed"]:
            status = "pending"
        todos.append({"content": str(item.get("content", ""))[:300], "status": status})
    db.update("chats", "id", run.chat["id"], {"todos": db.dump_json(todos)})
    run.todos = todos
    run.emit("todos", {"todos": todos})
    done = 0
    for item in todos:
        if item["status"] == "completed":
            done = done + 1
    return result("Task list saved (" + str(done) + "/" + str(len(todos)) + " done).", meta={"todos": todos})


async def memory(run, args):
    action = args.get("action") or "list"
    user_id = run.user["id"]
    if action == "save":
        content = (args.get("content") or "").strip()
        if content == "":
            return result("content is empty.", ok=False)
        project_id = None
        if args.get("scope") == "project" and run.chat.get("project_id"):
            project_id = run.chat["project_id"]
        memory_id = db.new_id("m_")
        db.insert("memories", {"id": memory_id, "user_id": user_id, "project_id": project_id, "content": content[:1000], "created_at": db.now()})
        run.emit("memory", {"action": "save", "id": memory_id, "content": content})
        return result("Saved to long term memory as " + memory_id + ".", meta={"memory": content})
    if action == "delete":
        memory_id = args.get("id") or ""
        row = db.one_row("SELECT * FROM memories WHERE id = ? AND user_id = ?", (memory_id, user_id))
        if row is None:
            return result("No memory with this id.", ok=False)
        db.execute("DELETE FROM memories WHERE id = ?", (memory_id,))
        return result("Forgot: " + row["content"], meta={"forgot": row["content"]})
    rows = db.all_rows("SELECT * FROM memories WHERE user_id = ? ORDER BY created_at", (user_id,))
    lines = []
    for row in rows:
        lines.append(row["id"] + ": " + row["content"])
    return result("\n".join(lines) or "No memories yet.")


async def ask_user(run, args, call_id):
    question = args.get("question") or ""
    options = args.get("options") or []
    answer = await run.wait_for_user(call_id, "question", {"question": question, "options": options})
    if answer is None:
        return result("The user did not answer. Choose the most reasonable option yourself and say which.", ok=False)
    return result("The user answered: " + str(answer), meta={"answer": str(answer)})


async def show_file(run, args):
    target = sandbox.resolve(run.wid, args.get("path"))
    rel = sandbox.relative(run.wid, target)
    if not target.exists() or target.is_dir():
        return result("File not found: " + rel, ok=False)
    meta = {"file": rel, "size": target.stat().st_size, "kind": guess_kind(rel), "caption": args.get("caption") or ""}
    run.emit("file", meta)
    return result("The user now sees " + rel + " with a download button.", meta=meta)


async def video_tool(run, args):
    from argparse import Namespace
    from app.agent import video
    action = (args.get("action") or "").strip().lower()
    project = (args.get("project") or "video").strip() or "video"
    try:
        folder = sandbox.resolve(run.wid, project)
    except ValueError as problem:
        return result(str(problem), ok=False)
    rel = sandbox.relative(run.wid, folder)
    if action == "new":
        language = (args.get("language") or "en").strip()
        size = (args.get("size") or "16:9").strip()
        video.engine().command_init(Namespace(project=str(folder), size=size, language=language))
        return result("Created " + rel + "/project.json, " + rel + "/scenes/01-opening.html (a starting example: replace it) and " + rel + "/assets/. "
                      "Now write the script into project.json (scenes with lines and who speaks), write one HTML file per scene, then run video voice.")
    if not (folder / "project.json").exists():
        return result("There is no " + rel + "/project.json. Run video with action new first.", ok=False)
    stamp = str(int(time.time() * 1000))
    if action == "voice":
        ok, log = await video.run_engine(run, folder, ["voice", "."], 900)
        return result(short(log, 12000), ok=ok)
    if action in ("storyboard", "board"):
        target = "build/review/storyboard-" + stamp + ".png"
        ok, log = await video.run_engine(run, folder, ["board", ".", "-o", target], 1200)
        image_path = folder / target
        if not image_path.exists():
            return result("The storyboard failed:\n" + short(log, 6000), ok=False)
        meta = {"file": rel + "/" + target, "size": image_path.stat().st_size, "kind": "image", "caption": "Storyboard: " + video.summary_of(folder)}
        run.emit("file", meta)
        return result(short(log, 6000) + "\n\nThe user can see this storyboard. Check it yourself, then ask the user to approve it or say what to change before the final render.", meta=meta, image=image_data(image_path) if run.vision else None)
    if action in ("preview", "still"):
        number = int(args.get("scene") or 1)
        target = "build/review/scene" + str(number) + "-" + stamp + ".png"
        argv = ["still", ".", "--scene", str(number), "-o", target]
        if (args.get("times") or "").strip():
            argv = argv[:4] + ["--at", str(args.get("times")).replace(" ", "")] + argv[4:]
        ok, log = await video.run_engine(run, folder, argv, 900)
        image_path = folder / target
        if not image_path.exists():
            return result("The preview failed:\n" + short(log, 6000), ok=False)
        note = "" if run.vision else "\n(Your model cannot see images; rely on the errors above.)"
        return result(short(log, 6000) + note, meta={"image": rel + "/" + target}, image=image_data(image_path) if run.vision else None)
    if action == "render":
        output = (args.get("output") or "out/video.mp4").strip().lstrip("/")
        if not output.endswith(".mp4"):
            output = output + ".mp4"
        draft = bool(args.get("draft"))
        if draft and output == "out/video.mp4":
            output = "out/draft.mp4"
        argv = ["render", ".", "-o", output]
        if draft:
            argv.append("--draft")
        if (args.get("scenes") or "").strip():
            argv += ["--scenes", str(args.get("scenes")).replace(" ", "")]
        run.emit("notice", {"text": "Rendering the " + ("draft" if draft else "final") + " video. Long videos can take several minutes."})
        ok, log = await video.run_engine(run, folder, argv, 5400)
        video_path = folder / output
        if not video_path.exists():
            return result("The render failed:\n" + short(log, 10000), ok=False)
        meta = {"file": rel + "/" + output, "size": video_path.stat().st_size, "kind": "video", "caption": "Draft preview" if draft else ""}
        sheet = folder / (str(Path(output).with_suffix("")) + "-sheet.png")
        if sheet.exists():
            meta["image"] = rel + "/" + sheet.relative_to(folder).as_posix()
        run.emit("file", meta)
        source = folder / (str(Path(output).with_suffix("")) + "-source.zip")
        if source.exists() and not draft:
            run.emit("file", {"file": rel + "/" + source.relative_to(folder).as_posix(), "size": source.stat().st_size, "kind": "file", "caption": "Full source of the video (project, scenes and assets)"})
        advice = "\n\nThe contact sheet shows 12 frames in order. Check: text readable and inside the frame, characters and objects where they should be, no empty or broken frames, motion matches the voice, subtitles correct, sound not SILENT. Fix scenes and render again if anything is off."
        return result(short(log, 10000) + advice, ok=ok, meta=meta, image=image_data(sheet) if run.vision and sheet.exists() else None)
    if action in ("transcribe", "cuts", "beats"):
        media = (args.get("file") or "").strip().lstrip("/")
        if not media or not (folder / media).exists():
            return result("Give file: the path of the video or audio inside " + rel + " (copy the user's file into " + rel + "/assets/ first).", ok=False)
        if action == "transcribe":
            argv = ["transcribe", ".", media]
            if (args.get("language") or "").strip():
                argv += ["--language", args.get("language").strip()]
            run.emit("notice", {"text": "Transcribing " + media + " (about a third of its length)."})
            ok, log = await video.run_engine(run, folder, argv, 3600)
        elif action == "beats":
            ok, log = await video.run_engine(run, folder, ["beats", ".", media], 600)
        else:
            argv = ["cuts", ".", media, "--fillers", "--gap", str(args.get("gap") or "0.45")]
            ok, log = await video.run_engine(run, folder, argv, 600)
        return result(short(log, 30000), ok=ok)
    return result("Unknown action " + action + ". Use new, voice, storyboard, preview, render, transcribe, cuts or beats.", ok=False)


async def image_cloudflare(prompt_text, width, height):
    account, token = config.cloudflare_credentials()
    if account == "":
        return None, "Cloudflare Workers AI is not set up"
    url = "https://api.cloudflare.com/client/v4/accounts/" + account + "/ai/run/@cf/black-forest-labs/flux-1-schnell"
    async with httpx.AsyncClient(timeout=180) as client:
        reply = await client.post(url, headers={"Authorization": "Bearer " + token}, json={"prompt": prompt_text[:2000], "steps": 6})
    if reply.status_code >= 300:
        return None, "Cloudflare answered " + str(reply.status_code) + ": " + reply.text[:160]
    return base64.b64decode(reply.json()["result"]["image"]), ""


async def image_openai(prompt_text, width, height):
    key = config.text("OPENAI_IMAGE_KEY") or config.text("OPENAI_API_KEY")
    if not key:
        return None, "no OpenAI key"
    size = "1024x1536" if height > width * 1.2 else "1536x1024" if width > height * 1.2 else "1024x1024"
    async with httpx.AsyncClient(timeout=240) as client:
        reply = await client.post("https://api.openai.com/v1/images/generations", headers={"Authorization": "Bearer " + key},
                                  json={"model": config.text("OPENAI_IMAGE_MODEL", "gpt-image-1"), "prompt": prompt_text[:3000], "size": size, "n": 1})
    if reply.status_code >= 300:
        return None, "OpenAI answered " + str(reply.status_code) + ": " + reply.text[:160]
    item = reply.json()["data"][0]
    if item.get("b64_json"):
        return base64.b64decode(item["b64_json"]), ""
    async with httpx.AsyncClient(timeout=120) as client:
        return (await client.get(item["url"])).content, ""


async def image_pollinations(prompt_text, width, height):
    from urllib.parse import quote
    url = "https://image.pollinations.ai/prompt/" + quote(prompt_text[:1500]) + "?width=" + str(width) + "&height=" + str(height) + "&nologo=true&model=flux&seed=" + str(int(time.time()) % 100000)
    async with httpx.AsyncClient(timeout=180, follow_redirects=True) as client:
        reply = await client.get(url)
    if reply.status_code >= 300 or not reply.headers.get("content-type", "").startswith("image/"):
        return None, "Pollinations answered " + str(reply.status_code)
    return reply.content, ""


IMAGE_PROVIDERS = {"cloudflare": image_cloudflare, "openai": image_openai, "pollinations": image_pollinations}


async def generate_image(run, args):
    prompt_text = (args.get("prompt") or "").strip()
    if prompt_text == "":
        return result("Describe the image in the prompt.", ok=False)
    ratio = str(args.get("size") or "").strip()
    width, height = {"portrait": (768, 1344), "9:16": (768, 1344), "landscape": (1344, 768), "16:9": (1344, 768), "square": (1024, 1024), "1:1": (1024, 1024)}.get(ratio, (1024, 1024))
    order = [name.strip() for name in config.text("IMAGE_PROVIDERS", "cloudflare,openai,pollinations").split(",") if name.strip() in IMAGE_PROVIDERS]
    data = None
    failures = []
    for name in order:
        try:
            data, why = await IMAGE_PROVIDERS[name](prompt_text, width, height)
        except Exception as problem:
            data, why = None, str(problem)[:160]
        if data and len(data) > 1000:
            break
        data = None
        failures.append(name + ": " + why)
    if data is None:
        return result("No image service could make this image (" + "; ".join(failures) + "). Tell the user, and draw it with SVG or code if that is good enough.", ok=False)
    path = (args.get("path") or "").strip()
    if path == "":
        slug = re.sub(r"[^a-z0-9]+", "-", prompt_text.lower())[:40].strip("-") or "image"
        path = "images/" + slug + "-" + str(int(time.time()) % 100000) + ".jpg"
    target = sandbox.resolve(run.wid, path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    run.changed = True
    rel = sandbox.relative(run.wid, target)
    meta = {"file": rel, "size": len(data), "kind": "image", "caption": prompt_text[:120]}
    run.emit("file", meta)
    return result("Saved the image as " + rel + " and showed it to the user. Use this path in pages and documents.", meta=meta)


def tool_folder(user_id):
    folder = config.TOOLS_DIR / user_id
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def tool_path_in_box(user_id, name):
    if sandbox.is_docker():
        return "/opt/fwtools/" + user_id + "/" + name + ".py"
    return str(tool_folder(user_id) / (name + ".py"))


async def run_custom(run, name, args):
    row = db.one_row("SELECT * FROM custom_tools WHERE user_id = ? AND name = ? AND enabled = 1", (run.user["id"], name))
    if row is None:
        return result("This tool does not exist any more.", ok=False)
    path = tool_folder(run.user["id"]) / (name + ".py")
    path.write_text(row["code"], encoding="utf-8")
    temp = sandbox.host_root(run.wid) / ".forkwise" / "tmp"
    temp.mkdir(parents=True, exist_ok=True)
    args_name = "args_" + str(int(time.time() * 1000)) + ".json"
    (temp / args_name).write_text(json.dumps(args, ensure_ascii=False), encoding="utf-8")
    command = "python3 " + shell_quote(tool_path_in_box(run.user["id"], name)) + " < .forkwise/tmp/" + args_name
    output = await sandbox.run(run.wid, command, timeout=300)
    try:
        (temp / args_name).unlink()
    except OSError:
        pass
    db.execute("UPDATE custom_tools SET uses = uses + 1 WHERE id = ?", (row["id"],))
    text = output["output"].strip() or "(no output)"
    return result(short(text), ok=output["code"] == 0)


async def create_tool(run, args):
    name = re.sub(r"[^a-z0-9_]", "_", (args.get("name") or "").strip().lower())[:40].strip("_")
    if name == "":
        return result("Give the tool a name.", ok=False)
    code = args.get("code") or ""
    parameters = args.get("parameters") or {"type": "object", "properties": {}}
    if isinstance(parameters, str):
        try:
            parameters = json.loads(parameters)
        except ValueError:
            return result("parameters must be a JSON schema object.", ok=False)
    parameters = clean_parameters(parameters)
    if "json.load" not in code and "stdin" not in code:
        return result("The code must read its arguments from stdin with json.load(sys.stdin).", ok=False)
    user_id = run.user["id"]
    existing = db.one_row("SELECT id FROM custom_tools WHERE user_id = ? AND name = ?", (user_id, name))
    values = {"description": (args.get("description") or "")[:1000], "parameters": db.dump_json(parameters), "code": code, "enabled": 1, "updated_at": db.now()}
    if existing:
        db.update("custom_tools", "id", existing["id"], values)
    else:
        values["id"] = db.new_id("t_")
        values["user_id"] = user_id
        values["name"] = name
        values["created_at"] = db.now()
        db.insert("custom_tools", values)
    (tool_folder(user_id) / (name + ".py")).write_text(code, encoding="utf-8")
    run.tools_changed = True
    text = "Saved the tool my_" + name + ". It is available now and in every later chat."
    if args.get("test_input") is not None:
        sample = args.get("test_input") or {}
        if isinstance(sample, str):
            try:
                sample = json.loads(sample)
            except ValueError:
                sample = {}
        if not isinstance(sample, dict):
            sample = {}
        test = await run_custom(run, name, sample)
        text = text + "\n\nTest run:\n" + test["text"]
        if not test["ok"]:
            text = text + "\n\nThe test failed. Fix the code and call create_tool again with the same name."
    run.emit("capability", {"kind": "tool", "name": "my_" + name})
    return result(text, meta={"tool": "my_" + name})


async def save_skill(run, args):
    name = re.sub(r"[^a-z0-9-]", "-", (args.get("name") or "").strip().lower())[:50].strip("-")
    if name == "":
        return result("Give the skill a name.", ok=False)
    user_id = run.user["id"]
    values = {"description": (args.get("description") or "")[:500], "body": args.get("instructions") or "", "enabled": 1, "updated_at": db.now()}
    existing = db.one_row("SELECT id FROM skills WHERE user_id = ? AND name = ?", (user_id, name))
    if existing:
        db.update("skills", "id", existing["id"], values)
    else:
        values["id"] = db.new_id("s_")
        values["user_id"] = user_id
        values["name"] = name
        values["created_at"] = db.now()
        db.insert("skills", values)
    run.emit("capability", {"kind": "skill", "name": name})
    return result("Saved the skill " + name + ".", meta={"skill": name})


def install_deckkit(run):
    """Copies the animation helper into the project, so decks work even in a sandbox built before it existed."""
    source = config.ROOT / "sandbox" / "deckkit.py"
    try:
        target = sandbox.host_root(run.wid) / ".forkwise" / "deckkit.py"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(source.read_text(encoding="utf-8"), encoding="utf-8")
    except OSError:
        pass


async def use_skill(run, args):
    name = (args.get("name") or "").strip()
    row = db.one_row("SELECT * FROM skills WHERE user_id = ? AND name = ?", (run.user["id"], name))
    if row is None:
        path = sandbox.host_root(run.wid) / ".forkwise" / "skills" / (name + ".md")
        if path.exists():
            return result(path.read_text(encoding="utf-8", errors="replace"))
        found = library.find(name)
        if found:
            run.emit("capability", {"kind": "skill_used", "name": name})
            if name in ("presentations", "documents"):
                install_deckkit(run)
            return result(found["body"], meta={"skill": name})
        return result("No skill named " + name + ".", ok=False)
    return result(row["body"])


async def exit_plan_mode(run, args):
    plan = args.get("plan") or ""
    run.emit("plan", {"plan": plan})
    return result("The plan was shown to the user. Stop here and wait for their approval.", meta={"plan": plan}, end_turn=True)


TYPE_ALIASES = {"str": "string", "text": "string", "int": "integer", "float": "number", "double": "number", "bool": "boolean", "list": "array", "dict": "object", "map": "object", "any": "string"}
SCHEMA_TYPES = ["string", "number", "integer", "boolean", "array", "object", "null"]


def clean_type(value):
    if isinstance(value, list):
        found = []
        for item in value:
            name = TYPE_ALIASES.get(str(item).lower(), str(item).lower())
            if name in SCHEMA_TYPES:
                found.append(name)
        if len(found) == 0:
            return "string"
        return found[0]
    name = TYPE_ALIASES.get(str(value).lower(), str(value).lower())
    if name in SCHEMA_TYPES:
        return name
    return "string"


def clean_property(value):
    if isinstance(value, str):
        return {"type": clean_type(value)}
    if not isinstance(value, dict):
        return {"type": "string"}
    result = {"type": clean_type(value.get("type", "string"))}
    if isinstance(value.get("description"), str):
        result["description"] = value["description"][:500]
    if isinstance(value.get("enum"), list) and len(value["enum"]) > 0:
        result["enum"] = value["enum"][:50]
    if isinstance(value.get("default"), (str, int, float, bool)):
        result["default"] = value["default"]
    if result["type"] == "array":
        result["items"] = clean_property(value.get("items", {"type": "string"}))
    if result["type"] == "object":
        result["properties"] = clean_properties(value.get("properties"))
    return result


def clean_properties(value):
    result = {}
    if isinstance(value, dict):
        for key in value:
            result[str(key)[:64]] = clean_property(value[key])
    return result


def clean_parameters(parameters):
    if isinstance(parameters, str):
        try:
            parameters = json.loads(parameters)
        except ValueError:
            parameters = {}
    if not isinstance(parameters, dict):
        parameters = {}
    properties = clean_properties(parameters.get("properties"))
    cleaned = {"type": "object", "properties": properties}
    required = []
    if isinstance(parameters.get("required"), list):
        for name in parameters["required"]:
            if isinstance(name, str) and name in properties:
                required.append(name)
    if len(required) > 0:
        cleaned["required"] = required
    return cleaned


def custom_specs(user_id):
    rows = db.all_rows("SELECT * FROM custom_tools WHERE user_id = ? AND enabled = 1 ORDER BY name", (user_id,))
    found = []
    for row in rows:
        found.append({"type": "function", "function": {
            "name": "my_" + row["name"],
            "description": row["description"] + " (a tool you created)",
            "parameters": clean_parameters(db.load_json(row["parameters"], {"type": "object", "properties": {}})),
        }})
    return found


async def mcp_specs(user_id):
    rows = db.all_rows("SELECT * FROM mcp_servers WHERE user_id = ? AND enabled = 1", (user_id,))
    servers = []
    for row in rows:
        row["headers"] = db.load_json(row["headers"], {})
        servers.append(row)
    if len(servers) == 0:
        return [], {}
    found, routes = await mcp.tools_for(servers)
    for spec in found:
        spec["function"]["parameters"] = clean_parameters(spec["function"].get("parameters"))
    return found, routes


def needs_approval(name, args):
    if name in specs.READ_ONLY:
        return False
    if name == "github" and args.get("action") in integrations.GITHUB_READ:
        return False
    if name == "gmail" and args.get("action") in ["search", "read", "labels"]:
        return False
    if name == "google_api" and (args.get("method") or "GET").upper() == "GET":
        return False
    if name == "browser" and args.get("action") in specs.BROWSER_READ_ONLY:
        return False
    if name == "computer" and args.get("action") in specs.COMPUTER_READ_ONLY:
        return False
    if name == "task" and (args.get("agent") or "explore") == "explore":
        return False
    return True


async def execute(run, name, args, call_id):
    try:
        if run.local:
            from app.agent import local
            outcome = await local.execute(run, name, args, call_id)
            if outcome is not None:
                return outcome
        if name == "read_file":
            return await read_file(run, args)
        if name == "write_file":
            return await write_file(run, args)
        if name == "edit_file":
            return await edit_file(run, args)
        if name == "multi_edit":
            return await multi_edit(run, args)
        if name == "list_dir":
            return await list_dir(run, args)
        if name == "glob":
            return await glob_files(run, args)
        if name == "grep":
            return await grep_files(run, args)
        if name == "bash":
            return await bash(run, args, call_id)
        if name == "job_output":
            return await job_output(run, args)
        if name == "service":
            return await service_tool(run, args)
        if name == "scaffold":
            return await scaffold_tool(run, args)
        if name == "kill_job":
            return await kill_job(run, args)
        if name == "monitor":
            return await monitor(run, args)
        if name == "advisor":
            from app.agent import advisor
            return await advisor.consult(run, args.get("question") or "", args.get("context") or "")
        if name == "preview":
            return await preview(run, args)
        if name == "screenshot":
            return await screenshot(run, args)
        if name == "browser":
            return await browser(run, args)
        if name == "computer":
            return await computer(run, args)
        if name == "my_browser":
            return await my_browser(run, args)
        if name == "video":
            return await video_tool(run, args)
        if name in ["github", "gmail", "google_api"]:
            return await integrations.execute(run, name, args)
        if name == "web_search":
            return await web_search(run, args)
        if name == "web_fetch":
            return await web_fetch(run, args)
        if name == "todo_write":
            return await todo_write(run, args)
        if name == "memory":
            return await memory(run, args)
        if name == "ask_user":
            return await ask_user(run, args, call_id)
        if name == "show_file":
            return await show_file(run, args)
        if name == "generate_image":
            return await generate_image(run, args)
        if name == "create_tool":
            return await create_tool(run, args)
        if name == "save_skill":
            return await save_skill(run, args)
        if name == "use_skill":
            return await use_skill(run, args)
        if name == "exit_plan_mode":
            return await exit_plan_mode(run, args)
        if name == "task":
            return await run.subagent(args, call_id)
        if name.startswith("my_"):
            return await run_custom(run, name[3:], args)
        if name in run.mcp_routes:
            route = run.mcp_routes[name]
            text = await mcp.call_tool(route["server"], route["name"], args)
            return result(short(text))
        return result("Unknown tool " + name + ". Use only the tools in your tool list.", ok=False)
    except ValueError as problem:
        return result(str(problem), ok=False)
    except Exception as problem:
        return result("The tool failed: " + type(problem).__name__ + ": " + str(problem)[:500], ok=False)

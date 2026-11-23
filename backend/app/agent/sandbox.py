import asyncio
import re
import json
import os
import shlex
import shutil
import subprocess
import time
from pathlib import Path
from app import config, db, vault

LAST_USED = {}
STARTING = {}
SKIP_DIRS = ["node_modules", ".git", "__pycache__", ".venv", "venv", ".next", "dist", "build", ".cache", ".forkwise"]


def is_docker():
    return config.SANDBOX == "docker"


def box_name(wid):
    return "fw-" + wid


def host_root(wid):
    folder = config.WORKSPACES_DIR / wid
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def root_label(wid):
    if is_docker():
        return "/workspace"
    return str(host_root(wid))


def resolve(wid, path):
    root = host_root(wid).resolve()
    text = str(path or "").strip()
    label = root_label(wid)
    if text == "" or text == "." or text == label:
        return root
    if text.startswith(label + "/"):
        text = text[len(label) + 1:]
    elif text.startswith("/workspace/"):
        text = text[len("/workspace/"):]
    elif text == "/workspace":
        return root
    elif text.startswith("~/"):
        text = text[2:]
    target = (root / text).resolve()
    if target != root and root not in target.parents:
        raise ValueError("The path " + str(path) + " is outside the project folder.")
    return target


def relative(wid, target):
    root = host_root(wid).resolve()
    try:
        return str(Path(target).resolve().relative_to(root))
    except ValueError:
        return str(target)


def touch(wid):
    LAST_USED[wid] = time.time()


async def run_process(argv, timeout=60, cwd=None, stdin_text=None):
    process = await asyncio.create_subprocess_exec(
        *argv,
        cwd=cwd,
        stdin=asyncio.subprocess.PIPE if stdin_text is not None else asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    data = b""
    try:
        if stdin_text is not None:
            data, ignored = await asyncio.wait_for(process.communicate(stdin_text.encode("utf-8")), timeout)
        else:
            data, ignored = await asyncio.wait_for(process.communicate(), timeout)
    except asyncio.TimeoutError:
        process.kill()
        return {"code": -1, "output": "Timed out after " + str(timeout) + " seconds."}
    return {"code": process.returncode, "output": data.decode("utf-8", "replace")}


IMAGE_ID = {"id": "", "checked": 0.0}
CHECKED_BOXES = {}


async def current_image_id():
    """Id of the sandbox image as built now (cached for a minute)."""
    now = time.time()
    if IMAGE_ID["id"] and now - IMAGE_ID["checked"] < 60:
        return IMAGE_ID["id"]
    result = await run_process(["docker", "image", "inspect", "-f", "{{.Id}}", config.SANDBOX_IMAGE], timeout=20)
    if result["code"] == 0:
        IMAGE_ID["id"] = result["output"].strip()
        IMAGE_ID["checked"] = now
    return IMAGE_ID["id"]


async def box_outdated(wid):
    """True when the workspace box was made from an older sandbox image. The project files live on the host,
    so recreating the box loses nothing but packages installed inside it."""
    image = await current_image_id()
    if not image:
        return False
    result = await run_process(["docker", "inspect", "-f", "{{.Image}}", box_name(wid)], timeout=20)
    return result["code"] == 0 and result["output"].strip() not in ("", image)


async def box_running(wid):
    result = await run_process(["docker", "inspect", "-f", "{{.State.Running}}", box_name(wid)], timeout=20)
    running = result["code"] == 0 and result["output"].strip() == "true"
    if running:
        image = await current_image_id()
        if CHECKED_BOXES.get(wid) != image:
            if await box_outdated(wid):
                await run_process(["docker", "rm", "-f", box_name(wid)], timeout=60)
                CHECKED_BOXES.pop(wid, None)
                return False
            CHECKED_BOXES[wid] = image
    return running


async def ensure_network():
    result = await run_process(["docker", "network", "inspect", config.SANDBOX_NETWORK], timeout=20)
    if result["code"] != 0:
        await run_process([
            "docker", "network", "create", "--driver", "bridge",
            "--subnet", config.SANDBOX_SUBNET,
            "-o", "com.docker.network.bridge.name=fwbr0",
            "-o", "com.docker.network.bridge.enable_icc=false",
            config.SANDBOX_NETWORK,
        ], timeout=30)


async def start_box(wid):
    root = host_root(wid)
    name = box_name(wid)
    exists = await run_process(["docker", "inspect", name], timeout=20)
    if exists["code"] == 0 and await box_outdated(wid):
        await run_process(["docker", "rm", "-f", name], timeout=60)
        exists = {"code": 1}
    if exists["code"] == 0:
        started = await run_process(["docker", "start", name], timeout=60)
        if started["code"] == 0:
            return
        await run_process(["docker", "rm", "-f", name], timeout=30)
    await ensure_network()
    argv = [
        "docker", "run", "-d", "--name", name, "--hostname", "forkwise",
        "--network", config.SANDBOX_NETWORK,
        "--memory", config.SANDBOX_MEMORY, "--cpus", config.SANDBOX_CPUS,
        "--pids-limit", config.SANDBOX_PIDS,
        "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
        "--user", str(os.getuid()) + ":" + str(os.getgid()),
        "-e", "HOME=/home/agent", "-e", "WORKSPACE=/workspace",
        "-v", str(root) + ":/workspace:z",
        "-v", str(config.TOOLS_DIR) + ":/opt/fwtools:ro,z",
        "-w", "/workspace",
        "--label", "forkwise=1",
    ]
    if config.SANDBOX_RUNTIME:
        argv = argv + ["--runtime", config.SANDBOX_RUNTIME]
    argv = argv + [config.SANDBOX_IMAGE, "sleep", "infinity"]
    result = await run_process(argv, timeout=120)
    if result["code"] != 0:
        raise RuntimeError("Could not start the sandbox: " + result["output"][-500:])


async def ensure(wid):
    touch(wid)
    host_root(wid)
    if not is_docker():
        return
    if await box_running(wid):
        return
    if wid in STARTING:
        await STARTING[wid].wait()
        return
    event = asyncio.Event()
    STARTING[wid] = event
    try:
        await start_box(wid)
    finally:
        event.set()
        STARTING.pop(wid, None)
    if read_services(wid):
        task = asyncio.create_task(restore_services(wid))
        RESTORING.add(task)
        task.add_done_callback(RESTORING.discard)


def secret_env(wid):
    owner = db.one_row("SELECT id, user_id FROM projects WHERE workspace_id = ?", (wid,))
    project_id = None
    user_id = ""
    if owner:
        user_id = owner["user_id"]
        project_id = owner["id"]
    else:
        chat = db.one_row("SELECT user_id FROM chats WHERE workspace_id = ? LIMIT 1", (wid,))
        if chat:
            user_id = chat["user_id"]
    env = {}
    if user_id == "":
        return env
    rows = db.all_rows("SELECT * FROM secrets WHERE user_id = ? ORDER BY created_at", (user_id,))
    for row in rows:
        if row["project_id"] and row["project_id"] != project_id:
            continue
        value = vault.unseal(row["value_enc"])
        if value:
            env[row["name"]] = value
    return env


def shell_argv(wid, command, interactive=False, env_names=()):
    if is_docker():
        argv = ["docker", "exec", "-i"]
        if interactive:
            argv.append("-t")
        for name in env_names:
            argv = argv + ["-e", name]
        argv = argv + ["-w", "/workspace", box_name(wid), "bash", "-lc", command]
        return argv, None
    return ["bash", "-lc", command], str(host_root(wid))


def process_env(wid, extra=None):
    values = secret_env(wid)
    if extra:
        for name in extra:
            values[name] = extra[name]
    if is_docker():
        env = dict(os.environ)
    else:
        env = clean_env(wid)
    for name in values:
        env[name] = values[name]
    return env, list(values.keys())


SECRET_WORDS = ["KEY", "SECRET", "PASSWORD", "TOKEN", "PASS", "CREDENTIAL"]


def clean_env(wid):
    env = {}
    for name in os.environ:
        upper = name.upper()
        secret = False
        for word in SECRET_WORDS:
            if word in upper:
                secret = True
        if name.startswith(("MYSQL_", "SMTP_", "PROVIDER_", "LLM_", "CF_", "GOOGLE_", "GITHUB_", "NOWPAYMENTS_")):
            secret = True
        if not secret:
            env[name] = os.environ[name]
    env["WORKSPACE"] = str(host_root(wid))
    return env


async def run(wid, command, timeout=120, on_output=None, limit=30000, extra_env=None):
    await ensure(wid)
    env, names = process_env(wid, extra_env)
    argv, cwd = shell_argv(wid, command, env_names=names)
    process = await asyncio.create_subprocess_exec(
        *argv, cwd=cwd, env=env,
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
        start_new_session=True,
    )
    chunks = []
    size = 0
    timed_out = False
    started = time.time()
    while True:
        left = timeout - (time.time() - started)
        if left <= 0:
            timed_out = True
            break
        try:
            data = await asyncio.wait_for(process.stdout.read(4096), left)
        except asyncio.TimeoutError:
            timed_out = True
            break
        if not data:
            break
        piece = data.decode("utf-8", "replace")
        size = size + len(piece)
        chunks.append(piece)
        if on_output is not None:
            await on_output(piece)
    if timed_out:
        try:
            os.killpg(process.pid, 9)
        except OSError:
            process.kill()
        if is_docker():
            await run_process(["docker", "exec", box_name(wid), "bash", "-lc", "pkill -f " + shlex.quote(command[:60]) + " || true"], timeout=15)
    try:
        code = await asyncio.wait_for(process.wait(), 10)
    except asyncio.TimeoutError:
        code = -1
    touch(wid)
    output = "".join(chunks)
    if len(output) > limit:
        half = limit // 2
        output = output[:half] + "\n\n[... " + str(len(output) - limit) + " characters cut ...]\n\n" + output[-half:]
    if timed_out:
        output = output + "\n[stopped: the command ran longer than " + str(timeout) + " seconds. Use run_in_background for servers and long jobs.]"
        code = -1
    return {"code": code, "output": output}


def logs_dir(wid):
    folder = host_root(wid) / ".forkwise" / "logs"
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def jobs_file(wid):
    return host_root(wid) / ".forkwise" / "jobs.json"


def read_jobs(wid):
    path = jobs_file(wid)
    if not path.exists():
        return []
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except ValueError:
        return []


def write_jobs(wid, jobs):
    logs_dir(wid)
    jobs_file(wid).write_text(json.dumps(jobs, ensure_ascii=False, indent=1), encoding="utf-8")


# ------------------------------------------------------------ services
# Long-running processes (dev servers, APIs, databases) that must stay up. They are remembered in
# .forkwise/services.json and started again by themselves when the box restarts.
RESTORING = set()


def services_path(wid):
    return host_root(wid) / ".forkwise" / "services.json"


def read_services(wid):
    try:
        return json.loads(services_path(wid).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def write_services(wid, services):
    path = services_path(wid)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(services, indent=1), encoding="utf-8")


async def http_status(wid, port, path="/"):
    probe = "curl -s -o /dev/null -m 4 -w '%{http_code}' " + shlex.quote("http://127.0.0.1:" + str(int(port)) + (path if path.startswith("/") else "/" + path)) + " || true"
    output = await run(wid, probe, timeout=15)
    code = output["output"].strip()[-3:]
    return code if code.isdigit() else "000"


async def service_stop(wid, name):
    services = read_services(wid)
    item = services.pop(name, None)
    if item and item.get("job"):
        await kill_job(wid, item["job"])
    write_services(wid, services)
    return item is not None


async def service_start(wid, name, command, port=0, path="/", cwd=".", wait=90):
    services = read_services(wid)
    old = services.get(name)
    if old and old.get("job"):
        await kill_job(wid, old["job"])
    if port:
        # free the port if an old copy still holds it
        await run(wid, "(command -v fuser >/dev/null && fuser -k " + str(int(port)) + "/tcp) >/dev/null 2>&1; true", timeout=15)
    full = "cd " + shlex.quote(cwd or ".") + " && " + command
    job = await start_background(wid, full, "service:" + name)
    services = read_services(wid)
    services[name] = {"name": name, "command": command, "cwd": cwd or ".", "port": int(port or 0), "path": path or "/", "job": job["id"], "started": time.time()}
    write_services(wid, services)
    state = {"name": name, "job": job["id"], "alive": True, "http": "", "healthy": not port}
    if port:
        deadline = time.time() + max(5, wait)
        while time.time() < deadline:
            await asyncio.sleep(2)
            status = await job_output(wid, job["id"], tail=2500)
            state["alive"] = status.get("alive", False)
            state["log"] = status.get("output", "")
            if not state["alive"]:
                break
            code = await http_status(wid, port, path or "/")
            state["http"] = code
            if code != "000":
                state["healthy"] = True
                break
    else:
        await asyncio.sleep(3)
        status = await job_output(wid, job["id"], tail=2500)
        state["alive"] = status.get("alive", False)
        state["healthy"] = state["alive"]
        state["log"] = status.get("output", "")
    return state


async def service_list(wid):
    out = []
    for name, item in read_services(wid).items():
        status = await job_output(wid, item.get("job", ""), tail=1200) if item.get("job") else {"alive": False, "output": ""}
        code = await http_status(wid, item["port"], item.get("path", "/")) if item.get("port") and status.get("alive") else ""
        out.append({"name": name, "port": item.get("port"), "alive": status.get("alive", False), "http": code, "command": item.get("command"), "cwd": item.get("cwd"), "log": status.get("output", "")})
    return out


async def restore_services(wid):
    for name, item in list(read_services(wid).items()):
        try:
            await service_start(wid, name, item["command"], item.get("port", 0), item.get("path", "/"), item.get("cwd", "."), wait=5)
        except Exception:
            continue


async def start_background(wid, command, name=""):
    logs_dir(wid)
    job_id = "job" + str(int(time.time() * 1000) % 100000000)
    log = ".forkwise/logs/" + job_id + ".log"
    script = "nohup setsid bash -lc " + shlex.quote(command) + " > " + log + " 2>&1 < /dev/null & echo $!"
    result = await run(wid, script, timeout=30)
    pid = result["output"].strip().split("\n")[-1].strip()
    jobs = read_jobs(wid)
    jobs.append({"id": job_id, "pid": pid, "command": command, "name": name, "log": log, "started": time.time()})
    write_jobs(wid, jobs)
    return {"id": job_id, "pid": pid, "log": log}


async def job_alive(wid, job):
    result = await run(wid, "kill -0 " + str(job["pid"]) + " 2>/dev/null && echo alive || echo dead", timeout=15)
    return "alive" in result["output"]


async def job_output(wid, job_id, tail=6000):
    jobs = read_jobs(wid)
    for job in jobs:
        if job["id"] == job_id:
            path = host_root(wid) / job["log"]
            text = ""
            if path.exists():
                text = path.read_text(encoding="utf-8", errors="replace")
            if len(text) > tail:
                text = "[... earlier output cut ...]\n" + text[-tail:]
            alive = await job_alive(wid, job)
            return {"found": True, "alive": alive, "output": text, "job": job}
    return {"found": False}


async def kill_job(wid, job_id):
    jobs = read_jobs(wid)
    kept = []
    found = False
    for job in jobs:
        if job["id"] == job_id or job["pid"] == str(job_id):
            found = True
            await run(wid, "kill -TERM -- -" + str(job["pid"]) + " 2>/dev/null; kill -TERM " + str(job["pid"]) + " 2>/dev/null; true", timeout=15)
        else:
            kept.append(job)
    write_jobs(wid, kept)
    return found


async def box_address(wid):
    if not is_docker():
        return "127.0.0.1"
    result = await run_process(["docker", "inspect", "-f", "{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}", box_name(wid)], timeout=20)
    for part in result["output"].strip().split():
        if re.match(r"^[0-9]{1,3}[.][0-9]{1,3}[.][0-9]{1,3}[.][0-9]{1,3}$", part):
            return part
    print("BOX ADDRESS NOT FOUND for", wid, ":", result["output"][:200], flush=True)
    return ""


async def stop(wid):
    if is_docker():
        await run_process(["docker", "stop", "-t", "3", box_name(wid)], timeout=30)
    LAST_USED.pop(wid, None)


async def remove(wid):
    if is_docker():
        await run_process(["docker", "rm", "-f", box_name(wid)], timeout=30)
    folder = config.WORKSPACES_DIR / wid
    if folder.exists():
        shutil.rmtree(folder, ignore_errors=True)


async def reaper():
    while True:
        await asyncio.sleep(60)
        limit = config.SANDBOX_IDLE_MINUTES * 60
        for wid in list(LAST_USED.keys()):
            if time.time() - LAST_USED.get(wid, 0) > limit:
                try:
                    await stop(wid)
                except Exception:
                    pass


def tree(wid, max_items=3000):
    root = host_root(wid).resolve()
    items = []
    walk(root, root, items, max_items, 0)
    return items


def walk(root, folder, items, max_items, depth):
    if len(items) >= max_items or depth > 12:
        return
    try:
        entries = sorted(os.scandir(folder), key=sort_key)
    except OSError:
        return
    for entry in entries:
        if len(items) >= max_items:
            return
        rel = str(Path(entry.path).relative_to(root))
        if entry.is_dir(follow_symlinks=False):
            skipped = entry.name in SKIP_DIRS
            items.append({"path": rel, "type": "dir", "skipped": skipped})
            if not skipped:
                walk(root, entry.path, items, max_items, depth + 1)
        else:
            try:
                size = entry.stat(follow_symlinks=False).st_size
            except OSError:
                size = 0
            items.append({"path": rel, "type": "file", "size": size})


def sort_key(entry):
    if entry.is_dir(follow_symlinks=False):
        return "0" + entry.name.lower()
    return "1" + entry.name.lower()


def docker_ready():
    if not is_docker():
        return True
    try:
        result = subprocess.run(["docker", "image", "inspect", config.SANDBOX_IMAGE], capture_output=True, timeout=20)
        return result.returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False

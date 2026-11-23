"""The agent's video tool. Projects live in the user's workspace; voices, previews and
renders run on the cloud (Modal) so the Forkwise server never renders video itself."""

import asyncio
import importlib.util
import io
import json
import tarfile
import time
import uuid
from pathlib import Path

from app import config, db, vault
from app.agent import sandbox

MOTION_LOCAL = config.ROOT / "sandbox" / "motion"
TOOL_IN_BOX = "/opt/forkwise/motion/fwmotion.py"
SKIP = ("build/scenes", "build/draft", "build/assemble", "out", "node_modules", ".git")
_engine = None


def engine():
    """fwmotion.py loaded as a module (only light parts are used here: init and project checks)."""
    global _engine
    if _engine is None:
        spec = importlib.util.spec_from_file_location("fwmotion", MOTION_LOCAL / "fwmotion.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        _engine = module
    return _engine


CLOUD_APP = config.ROOT / "cloud" / "modal_video.py"
DEPLOYING = {}


def mode():
    if config.VIDEO_RENDER == "local":
        return "local"
    if config.VIDEO_RENDER == "off":
        return "off"
    return "cloud"


def engine_version():
    """Changes whenever the renderer code changes, so each user's cloud copy is updated automatically."""
    import hashlib
    digest = hashlib.sha1()
    files = sorted(p for p in MOTION_LOCAL.rglob("*") if p.is_file() and "__pycache__" not in p.parts) + [CLOUD_APP]
    for path in files:
        digest.update(str(path.relative_to(config.ROOT)).encode())
        digest.update(str(path.stat().st_size).encode())
        if path.suffix in (".py", ".js"):
            digest.update(path.read_bytes())
    return digest.hexdigest()[:16]


def modal_row(user_id):
    return db.one_row("SELECT * FROM connections WHERE user_id = ? AND provider = 'modal' ORDER BY created_at DESC", (user_id,))


def modal_state(user_id):
    row = modal_row(user_id)
    if row is None:
        return {"connected": False}
    meta = db.load_json(row["meta"], {})
    status = meta.get("status") or "new"
    if user_id in DEPLOYING:
        status = "deploying"
    elif status == "ready" and meta.get("version") != engine_version():
        status = "outdated"
    return {"connected": True, "account": row["account"], "status": status, "error": meta.get("error", ""),
            "deployed_at": meta.get("deployed_at", 0), "log": meta.get("log", "")[-3000:]}


def credentials(user_id):
    row = modal_row(user_id)
    if row is None:
        return None
    token_id = vault.unseal(row["token_enc"])
    token_secret = vault.unseal(row["refresh_enc"])
    if not token_id or not token_secret:
        return None
    return token_id, token_secret


def save_meta(user_id, changes):
    row = modal_row(user_id)
    if row is None:
        return
    meta = db.load_json(row["meta"], {})
    meta.update(changes)
    db.update("connections", "id", row["id"], {"meta": json.dumps(meta), "last_used": time.time()})


def check_credentials(token_id, token_secret):
    """Blocking. Returns the workspace name, or raises with a readable reason."""
    import modal
    client = modal.Client.from_credentials(token_id, token_secret)
    modal.Volume.from_name("forkwise-video", create_if_missing=True, client=client).hydrate()
    try:
        from modal.config import config as modal_config
        return str(modal_config.get("workspace") or "")
    except Exception:
        return ""


async def deploy(user_id):
    """Installs (or updates) the Forkwise video app in the user's own Modal account. Returns (ok, log)."""
    if user_id in DEPLOYING:
        return await DEPLOYING[user_id]
    loop = asyncio.get_running_loop()
    future = loop.create_future()
    DEPLOYING[user_id] = future
    try:
        creds = credentials(user_id)
        if not creds:
            result = (False, "Connect your Modal account first (Settings > Studio).")
        else:
            import os
            import sys
            env = dict(os.environ)
            env["MODAL_TOKEN_ID"], env["MODAL_TOKEN_SECRET"] = creds
            env.pop("MODAL_PROFILE", None)
            version = engine_version()
            save_meta(user_id, {"status": "deploying", "error": ""})
            process = await asyncio.create_subprocess_exec(sys.executable, "-m", "modal", "deploy", str(CLOUD_APP), cwd=str(config.ROOT),
                                                           env=env, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
            try:
                out, _ = await asyncio.wait_for(process.communicate(), 1800)
            except asyncio.TimeoutError:
                process.kill()
                out = b"Timed out after 30 minutes."
            log = out.decode("utf-8", "replace")[-6000:]
            ok = process.returncode == 0
            if ok:
                save_meta(user_id, {"status": "ready", "version": version, "deployed_at": time.time(), "log": log, "error": ""})
            else:
                save_meta(user_id, {"status": "error", "log": log, "error": log.strip().splitlines()[-1][:300] if log.strip() else "Deploy failed."})
            result = (ok, log)
    except Exception as problem:
        save_meta(user_id, {"status": "error", "error": str(problem)[:300]})
        result = (False, str(problem))
    DEPLOYING.pop(user_id, None)
    future.set_result(result)
    return result


NOT_CONNECTED = ("Video rendering runs on the user's own Modal account, and none is connected yet. Tell the user to open "
                 "Settings > Studio (or the Studio page), create a token at modal.com/settings/tokens and paste it there. "
                 "Forkwise then installs the renderer in their account by itself. You can still write the whole project now.")


BIG = 20 * 1024 * 1024


def file_hash(path):
    import hashlib
    digest = hashlib.sha1()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 22), b""):
            digest.update(chunk)
    return digest.hexdigest()


def pack(folder, store=None):
    """Project as a tar.gz. Files over 20 MB (footage, music) go to the cloud store once, by content,
    and are listed in .fwmedia.json instead of being uploaded with every job."""
    buffer = io.BytesIO()
    media = {}
    known = None
    with tarfile.open(fileobj=buffer, mode="w:gz") as archive:
        for path in sorted(folder.rglob("*")):
            rel = path.relative_to(folder).as_posix()
            if any(rel == s or rel.startswith(s + "/") for s in SKIP) or not path.is_file():
                continue
            size = path.stat().st_size
            if size >= BIG and store is not None:
                if known is None:
                    try:
                        known = {entry.path.rsplit("/", 1)[-1] for entry in store.listdir("/media")}
                    except Exception:
                        known = set()
                name = file_hash(path) + path.suffix.lower()
                if name not in known:
                    with store.batch_upload(force=True) as upload:
                        upload.put_file(str(path), "/media/" + name)
                    known.add(name)
                media[rel] = "media/" + name
            elif size < 400 * 1024 * 1024:
                archive.add(path, arcname=rel)
        if media:
            data = json.dumps(media).encode()
            info = tarfile.TarInfo(".fwmedia.json")
            info.size = len(data)
            archive.addfile(info, io.BytesIO(data))
    return buffer.getvalue()


def cloud_run(folder, argv, timeout, creds):
    """Blocking: upload the project, run the job on the user's Modal account, download the results into folder."""
    import modal
    client = modal.Client.from_credentials(*creds)
    store = modal.Volume.from_name("forkwise-video", create_if_missing=True, client=client)
    job_id = time.strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:8]
    data = pack(folder, store)
    with store.batch_upload(force=True) as upload:
        upload.put_file(io.BytesIO(data), "/in/" + job_id + ".tar.gz")
    function = modal.Function.from_name(config.MODAL_VIDEO_APP, "job", client=client)
    call = function.spawn(job_id, argv)
    result = call.get(timeout=timeout)
    for rel in result.get("files") or []:
        target = (folder / rel).resolve()
        if folder.resolve() not in target.parents:
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        with open(target, "wb") as handle:
            store.read_file_into_fileobj("/out/" + job_id + "/" + rel, handle)
    try:
        store.remove_file("/out/" + job_id, recursive=True)
    except Exception:
        pass
    return result


async def run_engine(run, folder, argv, timeout):
    """Runs one fwmotion command for the project in folder. Returns (ok, log)."""
    current = mode()
    if current == "off":
        return False, "Video rendering is turned off on this server."
    if current == "cloud":
        user_id = run.user["id"]
        creds = credentials(user_id)
        if not creds:
            return False, NOT_CONNECTED
        state = modal_state(user_id)
        if state.get("status") != "ready":
            run.emit("notice", {"text": "Installing the video renderer in your Modal account (first time takes a few minutes)."})
            ok, log = await deploy(user_id)
            if not ok:
                return False, "Installing the renderer in the user's Modal account failed. Ask them to check the token in Settings > Studio.\n" + log[-2000:]
        try:
            result = await asyncio.wait_for(asyncio.to_thread(cloud_run, folder, argv, timeout, creds), timeout + 120)
        except asyncio.TimeoutError:
            return False, "The cloud render took longer than " + str(timeout // 60) + " minutes and was stopped. Render fewer scenes at a time (scenes argument), or use a draft first."
        except Exception as problem:
            text = str(problem)
            if "not found" in text.lower():
                save_meta(user_id, {"status": "outdated"})
                text = "The renderer was missing in the Modal account; it will be installed again on the next try. (" + text[:300] + ")"
            return False, "Cloud rendering failed: " + text[:1500]
        return bool(result.get("ok")), result.get("log") or ""
    # local: inside the agent's own sandbox (development only)
    tool = TOOL_IN_BOX if sandbox.is_docker() else str(MOTION_LOCAL / "fwmotion.py")
    rel = sandbox.relative(run.wid, folder)
    quoted = " ".join(shell_quote(a) for a in argv)
    output = await sandbox.run(run.wid, "cd " + shell_quote(rel) + " && python3 " + tool + " " + quoted, timeout=timeout, limit=14000)
    ok = output.get("code", 0) == 0 and "ERROR:" not in output["output"]
    if ok and argv[0] == "render":
        out_rel = argv[argv.index("-o") + 1]
        sheet = str(Path(out_rel).with_suffix("")) + "-sheet.png"
        check = await sandbox.run(run.wid, "cd " + shell_quote(rel) + " && python3 " + tool + " check " + shell_quote(out_rel) + " -o " + shell_quote(sheet) + " -n 12", timeout=300, limit=4000)
        output["output"] = output["output"] + "\n" + check["output"]
    return ok, output["output"]


def shell_quote(text):
    import shlex
    return shlex.quote(str(text))


def summary_of(folder):
    try:
        data = json.loads((folder / "project.json").read_text(encoding="utf-8"))
    except Exception as problem:
        return "project.json problem: " + str(problem)
    scenes = data.get("scenes") or []
    lines = sum(len(s.get("lines") or []) for s in scenes if isinstance(s, dict))
    return "%d scenes, %d voice lines, size %s, language %s" % (len(scenes), lines, data.get("size", "16:9"), data.get("language", "en"))

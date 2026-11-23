"""Forkwise Studio: video projects, and each user's own Modal account that renders them."""
import asyncio
import json
import re
import time
from pathlib import Path

from fastapi import HTTPException, Request
from pydantic import BaseModel

from app import db, vault
from app.agent import sandbox, video
from app.routes.auth import current_user

TASKS = set()


class ModalBody(BaseModel):
    token_id: str = ""
    token_secret: str = ""


def project_dir(wid):
    root = sandbox.host_root(wid)
    if (root / "video" / "project.json").exists():
        return root / "video"
    for path in sorted(root.glob("*/project.json")):
        try:
            if "scenes" in json.loads(path.read_text(encoding="utf-8")):
                return path.parent
        except (OSError, ValueError):
            continue
    return None


def newest(folder, patterns):
    found = []
    for pattern in patterns:
        found.extend(p for p in folder.glob(pattern) if p.is_file())
    return sorted(found, key=lambda p: p.stat().st_mtime, reverse=True)


def summary(chat, with_details=False):
    wid = chat["workspace_id"]
    folder = project_dir(wid)
    root = sandbox.host_root(wid)
    item = {"chat_id": chat["id"], "title": chat["title"], "kind": chat.get("kind") or "chat", "wid": wid, "updated_at": chat["updated_at"], "has_project": folder is not None}
    if folder is None:
        return item
    try:
        data = json.loads((folder / "project.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        data = {}
    timing = {}
    try:
        timing = json.loads((folder / "build" / "timing.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        pass
    scenes = [s if isinstance(s, dict) else {"file": s} for s in data.get("scenes") or []]
    timed = timing.get("scenes") or []
    durations = [(timed[i]["duration"] if i < len(timed) else float(s.get("duration") or 4)) for i, s in enumerate(scenes)]
    rel = lambda p: p.relative_to(root).as_posix()
    videos = [p for p in newest(folder, ["out/*.mp4"])]
    finals = [p for p in videos if "draft" not in p.name]
    poster = newest(folder, ["out/*-sheet.png", "build/review/storyboard-*.png", "build/review/*.png"])
    item.update({
        "folder": rel(folder), "name": data.get("title") or chat["title"], "size": data.get("size", "16:9"), "language": data.get("language", "en"),
        "scenes": len(scenes), "duration": round(sum(durations), 1),
        "video": rel((finals or videos)[0]) if videos else "", "poster": rel(poster[0]) if poster else "",
    })
    if with_details:
        out = []
        default = data.get("transition", {"type": "fade", "duration": 0.4})
        at = 0.0
        prev = None
        for index, scene in enumerate(scenes):
            lines = timed[index]["lines"] if index < len(timed) else [l if isinstance(l, dict) else {"text": l} for l in scene.get("lines") or []]
            shots = newest(folder, ["build/review/scene%d-*.png" % (index + 1)])
            trans = scene.get("transition", default) if index else {"type": "cut"}
            if isinstance(trans, str):
                trans = {"type": trans}
            kind = trans.get("type", "fade") if isinstance(trans, dict) else "cut"
            overlap = 0.0 if kind == "cut" or index == 0 else min(float(trans.get("duration", 0.4)), durations[index] * 0.45, (prev or 0) * 0.45)
            start = max(0.0, at - overlap)
            at = start + durations[index]
            prev = durations[index]
            out.append({"number": index + 1, "file": scene.get("file"), "start": round(start, 3), "duration": durations[index], "chapter": scene.get("chapter", ""),
                        "transition": kind if index else "", "transition_duration": round(overlap, 2),
                        "lines": [{"who": l.get("who", "narrator"), "text": l.get("text", ""), "start": l.get("start"), "end": l.get("end")} for l in lines],
                        "sfx": [{"file": str(x.get("file", "")), "at": float(x.get("at", 0))} for x in scene.get("sfx") or [] if isinstance(x, dict)],
                        "preview": rel(shots[0]) if shots else ""})
        total = at
        music = []
        for entry in data.get("music") or []:
            if isinstance(entry, str):
                entry = {"file": entry}
            start = float(entry.get("start", 0))
            if entry.get("start_scene") and 0 < int(entry["start_scene"]) <= len(out):
                start = out[int(entry["start_scene"]) - 1]["start"]
            end = float(entry.get("end", total))
            if entry.get("end_scene") and 0 < int(entry["end_scene"]) <= len(out):
                last = out[int(entry["end_scene"]) - 1]
                end = last["start"] + last["duration"]
            music.append({"file": str(entry.get("file", "")), "start": round(start, 2), "end": round(min(end, total), 2), "volume": entry.get("volume", 0.22)})
        item["duration"] = round(total, 1)
        item["music"] = music
        item.update({
            "scene_list": out,
            "voices": sorted((data.get("voices") or {}).keys()),
            "captions": data.get("captions", {}) if data.get("captions") is not False else False,
            "videos": [{"path": rel(p), "name": p.name, "size": p.stat().st_size, "time": p.stat().st_mtime} for p in videos[:12]],
            "downloads": [{"path": rel(p), "name": p.name, "size": p.stat().st_size} for p in newest(folder, ["out/*-source.zip", "out/*.srt", "out/*-chapters.txt"])[:9]],
            "images": [rel(p) for p in newest(folder, ["build/review/storyboard-*.png", "out/*-sheet.png"])[:8]],
            "assets": [rel(p) for p in newest(folder, ["assets/**/*.mp4", "assets/**/*.mov", "assets/**/*.png", "assets/**/*.jpg", "assets/**/*.mp3", "assets/**/*.wav"])[:40]],
        })
    return item


def list_studio(request: Request):
    user = current_user(request)
    rows = db.all_rows("SELECT * FROM chats WHERE user_id = ? AND local_path = '' ORDER BY updated_at DESC LIMIT 300", (user["id"],))
    projects = []
    for chat in rows:
        if (chat.get("kind") or "chat") == "studio" or project_dir(chat["workspace_id"]) is not None:
            projects.append(summary(chat))
    return {"projects": projects[:120], "modal": video.modal_state(user["id"]), "render": video.mode()}


def get_studio(chat_id: str, request: Request):
    user = current_user(request)
    chat = db.one_row("SELECT * FROM chats WHERE id = ? AND user_id = ?", (chat_id, user["id"]))
    if chat is None:
        raise HTTPException(status_code=404, detail="Project not found.")
    return {"project": summary(chat, True), "modal": video.modal_state(user["id"])}


def modal_status(request: Request):
    user = current_user(request)
    return video.modal_state(user["id"])


def start_deploy(user_id):
    task = asyncio.create_task(video.deploy(user_id))
    TASKS.add(task)
    task.add_done_callback(TASKS.discard)


async def connect_modal(body: ModalBody, request: Request):
    user = current_user(request)
    token_id = body.token_id.strip()
    token_secret = body.token_secret.strip()
    if not re.match(r"^ak-[A-Za-z0-9]{8,}$", token_id) or not re.match(r"^as-[A-Za-z0-9]{8,}$", token_secret):
        raise HTTPException(status_code=400, detail="Paste the Token ID (starts with ak-) and the Token Secret (starts with as-) from modal.com/settings/tokens.")
    try:
        account = await asyncio.wait_for(asyncio.to_thread(video.check_credentials, token_id, token_secret), 45)
    except asyncio.TimeoutError:
        raise HTTPException(status_code=400, detail="Modal did not answer in time. Try again in a minute.")
    except Exception as problem:
        text = str(problem)
        if "auth" in text.lower() or "token" in text.lower() or "unauthenticated" in text.lower():
            text = "Modal did not accept this token. Create a new one at modal.com/settings/tokens and paste both parts."
        raise HTTPException(status_code=400, detail=text[:300])
    db.execute("DELETE FROM connections WHERE user_id = ? AND provider = 'modal'", (user["id"],))
    db.insert("connections", {
        "id": db.new_id("cn_"), "user_id": user["id"], "provider": "modal", "label": "Modal", "account": account or "Modal account",
        "scopes": "", "token_enc": vault.seal(token_id), "refresh_enc": vault.seal(token_secret), "expires_at": 0,
        "meta": json.dumps({"status": "new"}), "created_at": time.time(), "last_used": 0,
    })
    start_deploy(user["id"])
    return video.modal_state(user["id"])


async def redeploy_modal(request: Request):
    user = current_user(request)
    if not video.credentials(user["id"]):
        raise HTTPException(status_code=400, detail="Connect your Modal account first.")
    start_deploy(user["id"])
    await asyncio.sleep(0.2)
    return video.modal_state(user["id"])


def disconnect_modal(request: Request):
    user = current_user(request)
    db.execute("DELETE FROM connections WHERE user_id = ? AND provider = 'modal'", (user["id"],))
    return {"connected": False}


def register_routes(app):
    app.add_api_route("/api/studio", list_studio, methods=["GET"])
    app.add_api_route("/api/studio/modal", modal_status, methods=["GET"])
    app.add_api_route("/api/studio/modal", connect_modal, methods=["POST"])
    app.add_api_route("/api/studio/modal/deploy", redeploy_modal, methods=["POST"])
    app.add_api_route("/api/studio/modal", disconnect_modal, methods=["DELETE"])
    app.add_api_route("/api/studio/{chat_id}", get_studio, methods=["GET"])

"""Sharing a chat, and forking (branching) one.

A share is a snapshot: the link shows the messages that existed when it was created or last updated (`upto`), so
anything said later stays private until the owner presses "Update link". Visibility is either private (no link
exists) or public (anyone with the link can read it, nothing is listed or indexed). Files are served to a link
only when the shared messages themselves show them (a picture, a shared file, an attachment), never the rest of
the project folder, which may hold keys or private data.

Forking copies a conversation into a new chat with its own project folder: a branch of one's own chat (optionally
cut at a message), or a copy of someone's shared chat to continue it in one's own account.
"""
import secrets
import shutil

from fastapi import HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app import config, db
from app.agent import sandbox, runs
from app.routes.auth import current_user

TOOL_TEXT_LIMIT = 3000
SKIP = shutil.ignore_patterns(*sandbox.SKIP_DIRS)


class ShareBody(BaseModel):
    visibility: str = "public"
    update: bool = False


class ForkBody(BaseModel):
    message_id: int = 0


def own_chat(user, chat_id):
    chat = db.one_row("SELECT * FROM chats WHERE id = ? AND user_id = ?", (chat_id, user["id"]))
    if chat is None:
        raise HTTPException(status_code=404, detail="Chat not found.")
    return chat


def share_url(token):
    return config.SITE_URL + "/share/" + token


def share_info(row):
    if row is None:
        return {"visibility": "private", "token": "", "url": "", "upto": 0, "views": 0}
    return {"visibility": row["visibility"], "token": row["token"], "url": share_url(row["token"]), "upto": row["upto"], "views": row["views"]}


def get_share(chat_id: str, request: Request):
    user = current_user(request)
    own_chat(user, chat_id)
    return share_info(db.one_row("SELECT * FROM chat_shares WHERE chat_id = ?", (chat_id,)))


def set_share(chat_id: str, body: ShareBody, request: Request):
    user = current_user(request)
    chat = own_chat(user, chat_id)
    if chat["local_path"]:
        raise HTTPException(status_code=400, detail="Chats that work on your own computer can't be shared.")
    if body.visibility not in ("public", "private"):
        raise HTTPException(status_code=400, detail="Choose public or private.")
    row = db.one_row("SELECT * FROM chat_shares WHERE chat_id = ?", (chat_id,))
    if body.visibility == "private":
        db.execute("DELETE FROM chat_shares WHERE chat_id = ?", (chat_id,))
        return share_info(None)
    if row is None:
        token = secrets.token_urlsafe(16)
        db.insert("chat_shares", {"token": token, "chat_id": chat_id, "user_id": user["id"], "visibility": "public", "upto": db.now(), "views": 0, "created_at": db.now()})
    elif body.update:
        db.update("chat_shares", "token", row["token"], {"upto": db.now()})
    return share_info(db.one_row("SELECT * FROM chat_shares WHERE chat_id = ?", (chat_id,)))


def shared_rows(chat_id, upto):
    return db.all_rows("SELECT * FROM messages WHERE chat_id = ? AND hidden = 0 AND created_at <= ? ORDER BY created_at, id", (chat_id, upto))


def visible_files(rows):
    """Paths the shared messages display, the only files a link may fetch."""
    found = set()
    for row in rows:
        meta = db.load_json(row["meta"], {})
        for key in ("file", "image"):
            if isinstance(meta.get(key), str):
                found.add(meta[key].lstrip("/").replace("workspace/", "", 1) if meta[key].startswith("/workspace/") else meta[key])
        for item in meta.get("attachments") or []:
            if isinstance(item, dict) and isinstance(item.get("path"), str):
                found.add(item["path"])
    return found


def public_message(row):
    content = row["content"] or ""
    if row["role"] == "tool" and len(content) > TOOL_TEXT_LIMIT:
        content = content[:TOOL_TEXT_LIMIT] + "\n[... cut ...]"
    meta = db.load_json(row["meta"], {})
    keep = {key: meta[key] for key in ("ok", "file", "image", "kind", "caption", "size", "added", "removed", "attachments", "sources", "plan", "answer", "continues", "skills") if key in meta}
    return {
        "id": row["id"], "role": row["role"], "content": content, "reasoning": row["reasoning"] or "",
        "tool_calls": db.load_json(row["tool_calls"], []), "tool_call_id": row["tool_call_id"], "name": row["name"],
        "meta": keep, "created_at": row["created_at"], "compacted": bool(row["compacted"]),
    }


def find_share(token):
    row = db.one_row("SELECT * FROM chat_shares WHERE token = ?", (token,))
    if row is None or row["visibility"] != "public":
        raise HTTPException(status_code=404, detail="This link is private or no longer exists.")
    chat = db.one_row("SELECT * FROM chats WHERE id = ?", (row["chat_id"],))
    if chat is None:
        raise HTTPException(status_code=404, detail="This chat was deleted.")
    return row, chat


def read_share(token: str):
    row, chat = find_share(token)
    db.execute("UPDATE chat_shares SET views = views + 1 WHERE token = ?", (token,))
    owner = db.one_row("SELECT name FROM users WHERE id = ?", (chat["user_id"],)) or {}
    first_name = (owner.get("name") or "").split(" ")[0][:40]
    return {
        "title": chat["title"], "kind": chat["kind"], "shared_at": row["upto"], "author": first_name,
        "messages": [public_message(item) for item in shared_rows(chat["id"], row["upto"])],
    }


def share_raw(token: str, path: str):
    row, chat = find_share(token)
    allowed = visible_files(shared_rows(chat["id"], row["upto"]))
    clean = path.lstrip("/")
    if clean.startswith("workspace/"):
        clean = clean[len("workspace/"):]
    if clean not in allowed and path not in allowed:
        raise HTTPException(status_code=404, detail="File not found.")
    try:
        target = sandbox.resolve(chat["workspace_id"], clean)
    except ValueError:
        raise HTTPException(status_code=404, detail="File not found.")
    if not target.exists() or target.is_dir():
        raise HTTPException(status_code=404, detail="File not found.")
    response = FileResponse(str(target))
    response.headers["Content-Security-Policy"] = "sandbox"
    response.headers["Cache-Control"] = "public, max-age=300"
    return response


def copy_messages(rows, chat_id):
    for row in rows:
        db.insert("messages", {
            "chat_id": chat_id, "role": row["role"], "content": row["content"], "reasoning": row["reasoning"],
            "tool_calls": row["tool_calls"], "tool_call_id": row["tool_call_id"], "name": row["name"], "meta": row["meta"],
            "hidden": row["hidden"], "compacted": row["compacted"], "created_at": row["created_at"],
        })


def new_chat_like(user, source, title):
    chat_id = db.new_id("c_")
    now = db.now()
    db.insert("chats", {"id": chat_id, "user_id": user["id"], "project_id": None, "title": title[:200], "model": source["model"] if source["user_id"] == user["id"] else "",
                        "mode": source["mode"], "kind": source["kind"], "local_path": "", "local_device": "", "workspace_id": db.new_id("w"), "created_at": now, "updated_at": now})
    return db.one_row("SELECT * FROM chats WHERE id = ?", (chat_id,))


def fork_chat(chat_id: str, body: ForkBody, request: Request):
    """Branch: a new chat with this conversation (up to a message, if given) and a copy of the project folder."""
    user = current_user(request)
    source = own_chat(user, chat_id)
    if source["local_path"]:
        raise HTTPException(status_code=400, detail="Chats that work on your own computer can't be forked.")
    if chat_id in runs.ACTIVE:
        raise HTTPException(status_code=409, detail="Wait until the task is finished.")
    rows = db.all_rows("SELECT * FROM messages WHERE chat_id = ? ORDER BY created_at, id", (chat_id,))
    if body.message_id:
        cut = next((row for row in rows if row["id"] == body.message_id), None)
        if cut is None:
            raise HTTPException(status_code=404, detail="Message not found.")
        # keep the chosen message and the whole answer to it, up to the next user message
        index = rows.index(cut)
        end = index + 1
        while end < len(rows) and rows[end]["role"] != "user":
            end += 1
        rows = rows[:end]
    chat = new_chat_like(user, source, "Branch of " + source["title"])
    copy_messages(rows, chat["id"])
    origin = sandbox.host_root(source["workspace_id"])
    target = sandbox.host_root(chat["workspace_id"])
    try:
        shutil.copytree(origin, target, dirs_exist_ok=True, ignore=SKIP)
    except (OSError, shutil.Error):
        pass
    db.update("chats", "id", chat["id"], {"todos": source["todos"]})
    return {"chat": {"id": chat["id"], "title": chat["title"]}}


def fork_share(token: str, request: Request):
    """Continue someone's shared chat in your own account: the shared messages and the files they show."""
    user = current_user(request)
    row, source = find_share(token)
    rows = shared_rows(source["id"], row["upto"])
    chat = new_chat_like(user, source, source["title"])
    copy_messages(rows, chat["id"])
    origin = sandbox.host_root(source["workspace_id"])
    target = sandbox.host_root(chat["workspace_id"])
    for path in visible_files(rows):
        try:
            source_file = sandbox.resolve(source["workspace_id"], path)
            if source_file.is_file():
                destination = target / source_file.relative_to(origin.resolve())
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source_file, destination)
        except (OSError, ValueError):
            continue
    return {"chat": {"id": chat["id"], "title": chat["title"]}}


def register_routes(app):
    app.add_api_route("/api/chats/{chat_id}/share", get_share, methods=["GET"])
    app.add_api_route("/api/chats/{chat_id}/share", set_share, methods=["POST"])
    app.add_api_route("/api/chats/{chat_id}/fork", fork_chat, methods=["POST"])
    app.add_api_route("/api/share/{token}", read_share, methods=["GET"])
    app.add_api_route("/api/share/{token}/raw", share_raw, methods=["GET"])
    app.add_api_route("/api/share/{token}/fork", fork_share, methods=["POST"])

"""The user's own browser, through the Forkwise for Chrome extension, with no desktop app.

The site gives the extension a token (Settings > Your browser > Connect). The extension keeps a
WebSocket open to /api/ws/browser and runs the agent's tab actions in the user's real browser,
inside a tab group called "Forkwise", only on sites the user allows."""
import asyncio
import hashlib
import itertools
import json
import secrets
import time
from fastapi import HTTPException, Request, WebSocket, WebSocketDisconnect
from app import db, config
from app.routes.auth import current_user

ONLINE = {}
DEV_EXTENSION_ID = "ifdnipndnhjfgjgjaljleajebhjpnogn"
COUNTER = itertools.count(1)
ASK_WAIT = 190


class Link:
    def __init__(self, websocket, row, browser, version):
        self.websocket = websocket
        self.row = row
        self.browser = browser
        self.version = version
        self.pending = {}
        self.lock = asyncio.Lock()
        self.connected_at = time.time()


def hash_token(token):
    return hashlib.sha256(token.encode()).hexdigest()


def online(user_id):
    return ONLINE.get(user_id)


def status(request: Request):
    user = current_user(request)
    link = ONLINE.get(user["id"])
    count = db.one_row("SELECT COUNT(*) AS n FROM browsers WHERE user_id = ?", (user["id"],))
    ids = [item for item in [config.CHROME_EXTENSION_ID, DEV_EXTENSION_ID] if item]
    return {
        "connected": link is not None,
        "browser": link.browser if link else "",
        "version": link.version if link else "",
        "linked": int(count["n"]) if count else 0,
        "extension_ids": ids,
        "store_url": "https://chromewebstore.google.com/detail/" + config.CHROME_EXTENSION_ID if config.CHROME_EXTENSION_ID else "",
    }


def pair(request: Request):
    user = current_user(request)
    rows = db.all_rows("SELECT id FROM browsers WHERE user_id = ? ORDER BY created_at DESC", (user["id"],))
    for old in rows[4:]:
        db.execute("DELETE FROM browsers WHERE id = ?", (old["id"],))
    token = "fwb_" + secrets.token_urlsafe(32)
    db.insert("browsers", {
        "id": db.new_id("brw_"),
        "user_id": user["id"],
        "token_hash": hash_token(token),
        "name": "",
        "created_at": db.now(),
        "last_seen": 0,
    })
    return {"token": token, "server": config.API_URL}


async def unlink(request: Request):
    user = current_user(request)
    db.execute("DELETE FROM browsers WHERE user_id = ?", (user["id"],))
    link = ONLINE.pop(user["id"], None)
    if link is not None:
        try:
            await link.websocket.close(code=4401)
        except Exception:
            pass
    return {"ok": True}


async def call(user_id, message, timeout=45):
    link = ONLINE.get(user_id)
    if link is None:
        return {"ok": False, "text": "The user's browser is not connected. Ask them to install Forkwise for Chrome and press Connect in Settings > Your browser."}
    message = dict(message)
    message["id"] = next(COUNTER)
    loop = asyncio.get_running_loop()
    entry = {"future": loop.create_future(), "deadline": loop.time() + timeout}
    link.pending[message["id"]] = entry
    try:
        async with link.lock:
            await link.websocket.send_text(json.dumps(message))
        while True:
            left = entry["deadline"] - loop.time()
            if left <= 0:
                return {"ok": False, "text": "The browser did not answer in time. The user may have closed it or not answered the permission window."}
            try:
                return await asyncio.wait_for(asyncio.shield(entry["future"]), timeout=min(left, 5))
            except asyncio.TimeoutError:
                continue
    except Exception as problem:
        return {"ok": False, "text": "The browser disconnected: " + str(problem)[:200]}
    finally:
        link.pending.pop(message["id"], None)


async def browser_socket(websocket: WebSocket):
    await websocket.accept()
    try:
        first = json.loads(await asyncio.wait_for(websocket.receive_text(), timeout=15))
    except Exception:
        await websocket.close(code=4400)
        return
    token = str(first.get("token") or "")
    row = db.one_row("SELECT * FROM browsers WHERE token_hash = ?", (hash_token(token),)) if token.startswith("fwb_") else None
    if row is None:
        await websocket.send_text(json.dumps({"type": "denied", "text": "This browser is not linked any more. Press Connect in Forkwise again."}))
        await websocket.close(code=4401)
        return
    user_id = row["user_id"]
    link = Link(websocket, row, str(first.get("browser") or "Chrome")[:60], str(first.get("version") or "")[:20])
    old = ONLINE.get(user_id)
    ONLINE[user_id] = link
    if old is not None:
        try:
            await old.websocket.close(code=4409)
        except Exception:
            pass
    db.update("browsers", "id", row["id"], {"last_seen": db.now(), "name": link.browser})
    await websocket.send_text(json.dumps({"type": "welcome"}))
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                message = json.loads(raw)
            except ValueError:
                continue
            if message.get("type") == "ping":
                continue
            entry = link.pending.get(message.get("id"))
            if entry is None:
                continue
            if message.get("asking"):
                entry["deadline"] = asyncio.get_running_loop().time() + ASK_WAIT
                continue
            if not entry["future"].done():
                entry["future"].set_result({"ok": bool(message.get("ok")), "text": str(message.get("text") or "")[:40000], "image": message.get("image") or ""})
    except WebSocketDisconnect:
        pass
    except Exception as problem:
        print("BROWSER LINK ERROR " + repr(problem), flush=True)
    finally:
        if ONLINE.get(user_id) is link:
            ONLINE.pop(user_id, None)
        for entry in link.pending.values():
            if not entry["future"].done():
                entry["future"].set_exception(ConnectionError("disconnected"))
        db.update("browsers", "id", row["id"], {"last_seen": db.now()})


def register_routes(app):
    app.add_api_route("/api/browser", status, methods=["GET"])
    app.add_api_route("/api/browser/pair", pair, methods=["POST"])
    app.add_api_route("/api/browser", unlink, methods=["DELETE"])
    app.add_api_websocket_route("/api/ws/browser", browser_socket)

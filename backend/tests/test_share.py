import asyncio

from app import db
from app.routes import share
from app.agent import sandbox


class Req:
    pass


def make_user(uid):
    db.execute("DELETE FROM users WHERE id = ?", (uid,))
    db.insert("users", {"id": uid, "email": uid + "@example.com", "name": "Test Person", "password_hash": "x", "created_at": db.now()})
    return db.one_row("SELECT * FROM users WHERE id = ?", (uid,))


def test_share_snapshot_files_and_fork(monkeypatch):
    owner = make_user("u_share_owner")
    other = make_user("u_share_other")
    who = {"user": owner}
    monkeypatch.setattr(share, "current_user", lambda request: who["user"])
    chat_id = db.new_id("c_")
    wid = db.new_id("w")
    db.insert("chats", {"id": chat_id, "user_id": owner["id"], "title": "Deck", "workspace_id": wid, "created_at": db.now(), "updated_at": db.now()})
    root = sandbox.host_root(wid)
    (root / "deck.pptx").write_bytes(b"PK")
    (root / ".env").write_text("SECRET=1")
    db.insert("messages", {"chat_id": chat_id, "role": "user", "content": "make a deck", "created_at": db.now() - 5})
    db.insert("messages", {"chat_id": chat_id, "role": "tool", "content": "shared", "meta": '{"file": "deck.pptx", "kind": "file"}', "created_at": db.now() - 4})
    db.insert("messages", {"chat_id": chat_id, "role": "note", "content": "hidden note", "hidden": 1, "created_at": db.now() - 3})

    info = share.set_share(chat_id, share.ShareBody(visibility="public"), Req())
    assert info["visibility"] == "public" and info["url"].endswith(info["token"])
    db.insert("messages", {"chat_id": chat_id, "role": "user", "content": "said after sharing", "created_at": db.now() + 5})

    page = share.read_share(info["token"])
    texts = [item["content"] for item in page["messages"]]
    assert "make a deck" in texts and "said after sharing" not in texts and "hidden note" not in texts
    assert share.share_raw(info["token"], "deck.pptx").path.endswith("deck.pptx")
    try:
        share.share_raw(info["token"], ".env")
        assert False, "the .env file must not be served"
    except Exception as problem:
        assert getattr(problem, "status_code", 0) == 404

    who["user"] = other
    forked = share.fork_share(info["token"], Req())
    copy = db.one_row("SELECT * FROM chats WHERE id = ?", (forked["chat"]["id"],))
    assert copy["user_id"] == other["id"]
    assert (sandbox.host_root(copy["workspace_id"]) / "deck.pptx").exists()
    assert not (sandbox.host_root(copy["workspace_id"]) / ".env").exists()

    who["user"] = owner
    assert share.set_share(chat_id, share.ShareBody(visibility="private"), Req())["visibility"] == "private"
    try:
        share.read_share(info["token"])
        assert False
    except Exception as problem:
        assert getattr(problem, "status_code", 0) == 404

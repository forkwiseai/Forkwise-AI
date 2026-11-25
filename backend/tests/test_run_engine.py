"""A whole run with a scripted model: permission rules, a project hook, the code check, read-only helpers in
parallel, the monitor tool and the advisor all take part."""
import asyncio
import json
import time

from app import config, db
from app.agent import llm, runs, sandbox


def answer(content="", calls=None):
    return {"content": content, "reasoning": "", "tool_calls": calls or [], "finish": "stop" if not calls else "tool_calls",
            "usage": {"prompt_tokens": 10, "completion_tokens": 5, "cached_tokens": 0}}


def call(cid, name, args):
    return {"id": cid, "type": "function", "function": {"name": name, "arguments": json.dumps(args)}}


def make_user_and_chat():
    now = time.time()
    user_id = db.new_id("u_")
    db.insert("users", {"id": user_id, "email": user_id + "@x.test", "name": "T", "password_hash": "x", "created_at": now, "settings": "{}", "plan": "premium", "plan_until": now + 86400, "is_admin": 0})
    chat_id = db.new_id("c_")
    db.insert("chats", {"id": chat_id, "user_id": user_id, "title": "New chat", "workspace_id": db.new_id("w"), "created_at": now, "updated_at": now, "model": "", "mode": "agent"})
    return db.one_row("SELECT * FROM users WHERE id = ?", (user_id,)), db.one_row("SELECT * FROM chats WHERE id = ?", (chat_id,))


def test_full_run_with_rules_hooks_checks_helpers_and_advisor(monkeypatch):
    if not config.MODELS:
        config.MODELS.append({"key": "main:test", "id": "test", "label": "Test", "url": "http://x", "api_key": "k", "vision": False, "context": 128000})
    config.MODELS.append({"key": "main:strong", "id": "strong", "label": "Strong", "url": "http://x", "api_key": "k", "vision": False, "context": 128000})
    monkeypatch.setenv("ADVISOR_MODEL", "main:strong")
    monkeypatch.setattr(config, "SANDBOX", "local")
    user, chat = make_user_and_chat()
    chat = dict(chat, model=config.MODELS[0]["key"])
    root = sandbox.host_root(chat["workspace_id"])
    (root / ".forkwise").mkdir(parents=True, exist_ok=True)
    (root / ".forkwise" / "settings.json").write_text(json.dumps({
        "permissions": {"deny": ["bash(*curl*)"]},
        "hooks": {"on_prompt": [{"command": "echo use tabs"}], "after_edit": "echo checked {file}"},
    }))
    script = [
        answer(calls=[call("a1", "write_file", {"path": "conf.json", "content": "{\"a\": 1,}"}), call("a2", "bash", {"command": "curl http://evil"})]),
        answer(calls=[call("b1", "task", {"description": "look", "prompt": "list files", "agent": "explore"}), call("b2", "task", {"description": "review", "prompt": "review conf.json", "agent": "reviewer"})]),
        answer(calls=[call("c1", "bash", {"command": "sleep 0.2; echo READY now", "run_in_background": True})]),
        answer(calls=[call("d1", "monitor", {"job_id": "PLACEHOLDER", "until": "READY", "timeout": 20})]),
        answer(calls=[call("e1", "advisor", {"question": "is this fine?"})]),
        answer("All done."),
    ]
    seen = {"main": 0, "helpers": 0, "advisor": 0, "tools": []}

    async def fake_stream(model, messages, tools=None, **kwargs):
        if tools is None:
            seen["advisor"] += 1
            assert model["key"] == "main:strong"
            return answer("Looks fine. Ship it.")
        system = messages[0]["content"] if isinstance(messages[0]["content"], str) else ""
        if len(messages) <= 3 and ("helper" in system.lower() or "review" in system.lower()) and messages[-1]["role"] == "user" and "list files" in str(messages[-1]["content"]) + "review conf.json":
            seen["helpers"] += 1
            return answer("helper report")
        if messages[-1]["role"] == "user" and str(messages[-1]["content"]) in ("list files", "review conf.json"):
            seen["helpers"] += 1
            return answer("helper report")
        seen["tools"] = [spec["function"]["name"] for spec in tools]
        step = script[seen["main"]]
        seen["main"] += 1
        if step["tool_calls"] and step["tool_calls"][0]["function"]["name"] == "monitor":
            job = sandbox.read_jobs(chat["workspace_id"])[-1]["id"]
            step["tool_calls"][0]["function"]["arguments"] = json.dumps({"job_id": job, "until": "READY", "timeout": 20})
        return step
    monkeypatch.setattr(llm, "stream_chat", fake_stream)

    async def go():
        run, _ = runs.start(chat, user, None, "make a config", {})
        for _ in range(600):
            if run.done:
                break
            await asyncio.sleep(0.05)
        return run
    run = asyncio.run(go())
    rows = db.all_rows("SELECT role, content, name, hidden FROM messages WHERE chat_id = ? ORDER BY id", (chat["id"],))
    tool_text = {row["name"]: row["content"] for row in rows if row["role"] == "tool"}
    notes = [row["content"] for row in rows if row["role"] == "note"]
    assert run.done and seen["main"] == 6
    assert any("use tabs" in note for note in notes)                                  # on_prompt hook
    assert "does not parse" in tool_text["write_file"]                                  # code check
    assert "after_edit hook" in tool_text["write_file"] and "checked conf.json" in tool_text["write_file"]
    assert tool_text["bash"].startswith("Not allowed") or any("Not allowed" in row["content"] for row in rows if row["name"] == "bash")
    assert seen["helpers"] == 2                                                         # explore + reviewer ran
    assert "Matched" in tool_text["monitor"] and "READY" in tool_text["monitor"]
    assert "Looks fine" in tool_text["advisor"] and seen["advisor"] == 1
    assert "advisor" in seen["tools"] and "monitor" in seen["tools"]
    config.MODELS[:] = [model for model in config.MODELS if model["key"] != "main:strong"]

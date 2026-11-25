import asyncio
import json
import time
import types

from app.agent import engine, agents, tools, sandbox, advisor
from app.agent import codecheck as diagnostics


def run_obj(**extra):
    events = []
    value = types.SimpleNamespace(emit=lambda kind, data: events.append((kind, data)), events=events, stop_flag=asyncio.Event(), local=None, wid="w1")
    for key, item in extra.items():
        setattr(value, key, item)
    return value


def test_chain_runs_outermost_first_and_can_refuse():
    found = engine.Engine()
    order = []

    async def user(run, event, next):
        order.append("user")
        return await next(event)

    async def policy(run, event, next):
        order.append("policy")
        if event["args"].get("bad"):
            return {"decision": "deny", "reason": "no"}
        return await next(event)

    async def core(event):
        order.append("core")
        return {"decision": "default"}
    found.on("tool.check", user, tier="user")
    found.on("tool.check", policy, tier="policy")
    assert asyncio.run(found.emit(None, "tool.check", {"name": "bash", "args": {}}, core)) == {"decision": "default"}
    assert order == ["policy", "user", "core"]
    order.clear()
    assert asyncio.run(found.emit(None, "tool.check", {"name": "bash", "args": {"bad": 1}}, core))["decision"] == "deny"
    assert order == ["policy"]


def test_a_crashing_guard_is_skipped_unless_it_must_deny():
    found = engine.Engine()

    async def broken(run, event, next):
        raise RuntimeError("boom")

    async def core(event):
        return {"decision": "default"}
    found.on("tool.check", broken, tier="user")
    assert asyncio.run(found.emit(None, "tool.check", {"name": "x", "args": {}}, core))["decision"] == "default"
    strict = engine.Engine()
    strict.on("tool.check", broken, tier="policy", on_error="deny")
    assert asyncio.run(strict.emit(None, "tool.check", {"name": "x", "args": {}}, core))["decision"] == "deny"


def test_match_limits_a_handler_to_some_tools():
    found = engine.Engine()
    seen = []

    async def only_edits(run, event, next):
        seen.append(event["name"])
        return await next(event)

    async def core(event):
        return {"ok": True}
    found.on("tool.call", only_edits, match="write_file|edit_file")
    for name in ["bash", "write_file", "edit_file", "read_file"]:
        asyncio.run(found.emit(None, "tool.call", {"name": name, "args": {}}, core))
    assert seen == ["write_file", "edit_file"]


def test_permission_rules_deny_beats_allow():
    rules = {"allow": ["bash(npm *)", "read_file"], "deny": ["bash(npm publish*)", "write_file(.env*)"], "ask": ["bash(git push*)"]}
    assert engine.verdict(rules, "bash", {"command": "npm run build"})[0] == "allow"
    assert engine.verdict(rules, "bash", {"command": "npm publish --access public"})[0] == "deny"
    assert engine.verdict(rules, "bash", {"command": "git push origin main"})[0] == "ask"
    assert engine.verdict(rules, "write_file", {"path": "/workspace/.env.local"})[0] == "deny"
    assert engine.verdict(rules, "write_file", {"path": "src/app.js"})[0] == "default"
    assert engine.verdict(rules, "read_file", {"path": "anything"})[0] == "allow"


def test_project_settings_become_handlers():
    calls = []

    async def run_command(command, payload):
        calls.append((command, payload["event"]))
        if "guard" in command:
            return {"code": 2, "output": "no force pushes"}
        if "context" in command:
            return {"code": 0, "output": "We use pnpm."}
        return {"code": 1, "output": "lint: 1 error"}
    settings = {
        "hooks": {
            "before_tool": [{"match": "bash", "command": "./guard.sh"}],
            "after_edit": "eslint {file}",
            "on_prompt": [{"command": "cat context.md"}],
        },
        "permissions": {"deny": ["bash(rm -rf /*)"]},
    }
    found = engine.Engine()
    engine.install_permissions(found, settings)
    engine.install_project_hooks(found, settings, run_command)

    async def check_core(event):
        return {"decision": "default"}
    refused = asyncio.run(found.emit(None, "tool.check", {"name": "bash", "args": {"command": "git push -f"}}, check_core))
    assert refused == {"decision": "deny", "reason": "no force pushes"}
    rule = asyncio.run(found.emit(None, "tool.check", {"name": "bash", "args": {"command": "rm -rf /"}}, check_core))
    assert rule["decision"] == "deny" and "permission rule" in rule["reason"] and calls == [("./guard.sh", "before_tool")]

    async def call_core(event):
        return {"ok": True, "text": "Edited src/a.js", "meta": {"path": "src/a.js"}}
    edited = asyncio.run(found.emit(None, "tool.call", {"name": "edit_file", "args": {"path": "src/a.js"}}, call_core))
    assert "after_edit hook (exit 1)" in edited["text"] and calls[-1] == ("eslint src/a.js", "after_tool")

    async def prompt_core(event):
        return {"text": event["text"], "notes": []}
    submitted = asyncio.run(found.emit(None, "prompt.submit", {"text": "hi"}, prompt_core))
    assert submitted["notes"] and "We use pnpm." in submitted["notes"][0]


def test_hook_json_decision():
    assert engine.hook_decision('{"decision": "deny", "reason": "frozen"}', 0) == ("deny", "frozen")
    assert engine.hook_decision("checking...\n{\"decision\": \"ask\"}", 0)[0] == "ask"
    assert engine.hook_decision("all good", 0) == (None, "")


def test_monitor_waits_for_a_line(tmp_path, monkeypatch):
    log = tmp_path / "job.log"
    log.write_text("old ready line\n")
    monkeypatch.setattr(sandbox, "host_root", lambda wid: tmp_path)
    monkeypatch.setattr(sandbox, "read_jobs", lambda wid: [{"id": "j1", "name": "web", "pid": 1, "log": "job.log", "command": "npm run dev"}])

    async def alive(wid, job):
        return True
    monkeypatch.setattr(sandbox, "job_alive", alive)

    async def go():
        async def later():
            await asyncio.sleep(0.6)
            with open(log, "a") as handle:
                handle.write("compiling\n  Local:   http://localhost:3000/\n")
        writer = asyncio.ensure_future(later())
        outcome = await tools.monitor(run_obj(), {"job_id": "web", "until": "Local:", "timeout": 10, "only_new": True})
        await writer
        return outcome
    outcome = asyncio.run(go())
    assert outcome["ok"] and "Local:" in outcome["text"] and "old ready" not in outcome["text"]

    failed = asyncio.run(_monitor_fail(tmp_path, log))
    assert not failed["ok"] and "EADDRINUSE" in failed["text"]


async def _monitor_fail(tmp_path, log):
    async def later():
        await asyncio.sleep(0.3)
        with open(log, "a") as handle:
            handle.write("Error: listen EADDRINUSE :::3000\n")
    writer = asyncio.ensure_future(later())
    outcome = await tools.monitor(run_obj(), {"job_id": "j1", "until": "Local:", "fail": "EADDRINUSE", "timeout": 10, "only_new": True})
    await writer
    return outcome


def test_project_agents_and_task_spec(tmp_path, monkeypatch):
    folder = tmp_path / ".forkwise" / "agents"
    folder.mkdir(parents=True)
    (folder / "migrator.md").write_text("---\nname: migrator\ndescription: Runs migrations\ntools: read_file, bash\nmodel: inherit\n---\nYou run migrations.")
    (folder / "Bad Name.md").write_text("---\nname: Bad Name!\n---\nx")
    monkeypatch.setattr(sandbox, "host_root", lambda wid: tmp_path)
    run = run_obj()
    found = agents.available(run)
    assert "migrator" in found and found["migrator"]["prompt"] == "You run migrations." and "bad name!" not in found
    assert agents.read_only(found["explore"]) and agents.read_only(found["reviewer"])
    assert not agents.read_only(found["migrator"]) and not agents.read_only(found["general"])
    base = {"type": "function", "function": {"name": "task", "description": "x", "parameters": {"type": "object", "properties": {"agent": {"type": "string", "enum": ["explore", "general"]}}}}}
    spec = agents.task_spec(run, base)
    assert "migrator" in spec["function"]["parameters"]["properties"]["agent"]["enum"]
    assert base["function"]["parameters"]["properties"]["agent"]["enum"] == ["explore", "general"]
    assert [item["function"]["name"] for item in agents.specs_for(run, found["migrator"])] == ["read_file", "bash"]


def test_tsc_output_is_split_into_mine_and_others():
    output = "src/App.tsx(12,5): error TS2322: Type 'string' is not assignable to type 'number'.\nsrc/old.ts(1,1): error TS2304: Cannot find name 'x'.\nFound 2 errors."
    mine, others = diagnostics.parse_tsc(output, "web", {"web/src/App.tsx"})
    assert mine == ["web/src/App.tsx:12:5 TS2322 Type 'string' is not assignable to type 'number'."] and others == 1


def test_quick_check_finds_broken_json(tmp_path, monkeypatch):
    (tmp_path / "data.json").write_text('{"a": 1,}')
    monkeypatch.setattr(sandbox, "resolve", lambda wid, path: tmp_path / path)
    report = asyncio.run(diagnostics.quick(run_obj(), "data.json"))
    assert "does not parse" in report
    assert asyncio.run(diagnostics.quick(run_obj(), "node_modules/x/data.json")) == ""


def test_no_advisor_without_a_configured_model(monkeypatch):
    monkeypatch.delenv("ADVISOR_MODEL", raising=False)
    run = run_obj(user={"id": "u", "settings": "{}", "plan": "free"}, model={"key": "main:a"})
    assert advisor.model_for(run) is None and not advisor.available(run)

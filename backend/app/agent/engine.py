"""The run's event engine: every step that can be watched, changed or refused goes through a chain of handlers.

A handler is `async def handler(run, event, next)`. It can look at the event, change it and pass it on with
`await next(event)`, change what comes back, or answer by itself without calling `next` (a refusal, a cached
answer). The innermost link is the core: the engine's own behaviour.

Handlers sit in tiers, outermost first, so a lower-trust handler can never get around a higher one:
  policy   rules the person or workspace set (permissions)      always runs first
  builtin  Forkwise's own behaviour (diagnostics, hooks loader)
  user     the project's own hooks (.forkwise/settings.json)    closest to the core

A handler that raises is skipped (its `next` runs as if it were not there) unless it was registered with
`on_error="deny"`, in which case the event is refused: a guard that crashes must not let the action through.

Events:
  tool.check   {name, args}            -> {decision: allow|ask|deny|default, reason}
  tool.call    {name, args, call_id}   -> tool outcome (tools.result)
  prompt.submit {text}                 -> {text, notes: [...] }   (notes are given to the model with the message)
  turn.end     {status, changed}       -> None
"""
import fnmatch
import json
import re
import shlex
import traceback

TIERS = {"policy": 0, "builtin": 1, "user": 2}


class Engine:
    def __init__(self):
        self.handlers = {}

    def on(self, event, handler, tier="builtin", match=None, on_error="skip", name=""):
        """match: a tool-name pattern (fnmatch, | for alternatives) the event's name must fit, or None for all."""
        found = self.handlers.setdefault(event, [])
        found.append({"fn": handler, "tier": TIERS[tier], "order": len(found), "match": match, "on_error": on_error, "name": name or getattr(handler, "__name__", "handler")})
        found.sort(key=lambda item: (item["tier"], item["order"]))

    def has(self, event):
        return bool(self.handlers.get(event))

    async def emit(self, run, event_name, event, core):
        chain = [item for item in self.handlers.get(event_name, []) if fits(item["match"], event.get("name"))]

        async def step(index, value):
            if index >= len(chain):
                return await core(value)
            item = chain[index]

            async def next_link(changed=None):
                return await step(index + 1, value if changed is None else changed)
            try:
                return await item["fn"](run, value, next_link)
            except Exception:
                traceback.print_exc()
                if item["on_error"] == "deny":
                    return {"decision": "deny", "reason": "A safety check (" + item["name"] + ") failed, so the action was refused."}
                return await step(index + 1, value)
        return await step(0, event)


def fits(pattern, name):
    if not pattern:
        return True
    if name is None:
        return False
    return any(fnmatch.fnmatchcase(name, part.strip()) for part in str(pattern).split("|") if part.strip())


# ---------- permission rules: "tool" or "tool(pattern)", pattern matched against the call's subject ----------

RULE = re.compile(r"^\s*([A-Za-z0-9_*|.-]+)\s*(?:\((.*)\))?\s*$")


def subject(name, args):
    """The part of a call a rule's pattern is matched against."""
    if name == "bash":
        return str(args.get("command") or "").strip()
    if name in ("read_file", "write_file", "edit_file", "multi_edit", "list_dir", "show_file"):
        path = str(args.get("path") or "")
        if path.startswith("/workspace/"):
            path = path[len("/workspace/"):]
        while path.startswith("./"):
            path = path[2:]
        return path
    if name in ("web_fetch", "screenshot"):
        return str(args.get("url") or "")
    if name == "browser":
        return str(args.get("url") or args.get("action") or "")
    return json.dumps(args, sort_keys=True, ensure_ascii=False)


def rule_matches(rule, name, args):
    found = RULE.match(rule or "")
    if not found or not fits(found.group(1), name):
        return False
    pattern = found.group(2)
    if pattern is None or pattern.strip() in ("", "*"):
        return True
    return fnmatch.fnmatchcase(subject(name, args), pattern.strip())


def verdict(permissions, name, args):
    """Deny wins over allow; returns (decision, rule) with decision in deny|allow|ask|default."""
    permissions = permissions or {}
    for rule in permissions.get("deny") or []:
        if rule_matches(rule, name, args):
            return "deny", rule
    for rule in permissions.get("ask") or []:
        if rule_matches(rule, name, args):
            return "ask", rule
    for rule in permissions.get("allow") or []:
        if rule_matches(rule, name, args):
            return "allow", rule
    return "default", ""


# ---------- the project's own hooks, from .forkwise/settings.json ----------
#
# "hooks": {
#   "before_tool": [{"match": "bash", "command": "./scripts/check.sh"}],   exit 2 (or {"decision": "deny"}) refuses
#   "after_tool":  [{"match": "write_file|edit_file", "command": "npx eslint {file}"}],
#   "on_prompt":   [{"command": "cat docs/CONTEXT.md"}],                   its output is given to the model
#   "after_edit":  "npx prettier --write {file}",   "after_turn": "npm test"   (the older single-command form)
# }
# Every hook gets the event as JSON in FORKWISE_HOOK_INPUT, runs in the project folder, and has 60 seconds.

def hook_list(value):
    if isinstance(value, str):
        return [{"command": value}]
    if isinstance(value, dict):
        return [value]
    return [item for item in (value or []) if isinstance(item, dict) and item.get("command")]


def fill(command, args):
    path = str(args.get("path") or "").replace("/workspace/", "", 1)
    return command.replace("{file}", shlex.quote(path) if path else "")


def hook_decision(output, code):
    text = (output or "").strip()
    for candidate in [text] + text.splitlines():
        candidate = candidate.strip()
        if not candidate.startswith("{"):
            continue
        try:
            data = json.loads(candidate)
        except ValueError:
            continue
        if isinstance(data, dict) and data.get("decision") in ("deny", "allow", "ask"):
            return data["decision"], str(data.get("reason") or "")
    if code == 2:
        return "deny", text[-800:] or "A project hook refused this."
    return None, ""


def install_project_hooks(engine, settings, run_command):
    """Registers the hooks of a project's settings. run_command(command, payload) -> {"code", "output"}."""
    hooks = (settings or {}).get("hooks") or {}

    for hook in hook_list(hooks.get("before_tool")):
        async def before(run, event, next, hook=hook):
            done = await run_command(fill(hook["command"], event.get("args") or {}), {"event": "before_tool", "tool": event.get("name"), "args": event.get("args")})
            decision, reason = hook_decision(done["output"], done["code"])
            if decision == "deny":
                return {"decision": "deny", "reason": reason}
            outcome = await next(event)
            if decision == "ask" and outcome.get("decision") in ("default", "allow"):
                return {"decision": "ask", "reason": reason}
            return outcome
        engine.on("tool.check", before, tier="user", match=hook.get("match"), name="before_tool hook")

    after_hooks = hook_list(hooks.get("after_tool"))
    if hooks.get("after_edit"):
        after_hooks.append({"match": "write_file|edit_file|multi_edit", "command": hooks["after_edit"], "edit": True})
    for hook in after_hooks:
        async def after(run, event, next, hook=hook):
            outcome = await next(event)
            if not outcome.get("ok"):
                return outcome
            done = await run_command(fill(hook["command"], event.get("args") or {}), {"event": "after_tool", "tool": event.get("name"), "args": event.get("args"), "ok": outcome.get("ok")})
            if done["code"] != 0 or done["output"].strip():
                label = "after_edit hook" if hook.get("edit") else "after_tool hook"
                outcome["text"] = outcome["text"] + "\n\n" + label + " (exit " + str(done["code"]) + "):\n" + done["output"].strip()[-3000:]
            return outcome
        engine.on("tool.call", after, tier="user", match=hook.get("match"), name="after_tool hook")

    for hook in hook_list(hooks.get("on_prompt")):
        async def on_prompt(run, event, next, hook=hook):
            done = await run_command(hook["command"], {"event": "on_prompt", "text": event.get("text")})
            decision, reason = hook_decision(done["output"], done["code"])
            if decision == "deny":
                return {"text": event.get("text"), "blocked": reason or "A project hook stopped this message."}
            result = await next(event)
            if done["output"].strip() and decision is None:
                result.setdefault("notes", []).append("Context from the project's on_prompt hook:\n" + done["output"].strip()[-4000:])
            return result
        engine.on("prompt.submit", on_prompt, tier="user", name="on_prompt hook")

    if hooks.get("after_turn"):
        command = hooks["after_turn"] if isinstance(hooks["after_turn"], str) else hooks["after_turn"].get("command", "")

        async def after_turn(run, event, next):
            result = await next(event)
            if event.get("changed") and event.get("status") == "done" and command:
                done = await run_command(command, {"event": "after_turn"})
                run.emit("notice", {"text": "after_turn hook exit " + str(done["code"]) + ": " + done["output"][-600:]})
            return result
        engine.on("turn.end", after_turn, tier="user", name="after_turn hook")


def install_permissions(engine, settings):
    permissions = dict((settings or {}).get("permissions") or {})
    legacy = [item for item in (settings or {}).get("deny") or [] if isinstance(item, str) and item]
    if legacy:
        permissions["deny"] = list(permissions.get("deny") or []) + ["bash(*" + item + "*)" for item in legacy]
    if not any(permissions.get(key) for key in ("allow", "ask", "deny")):
        return

    async def rules(run, event, next):
        decision, rule = verdict(permissions, event.get("name"), event.get("args") or {})
        if decision == "deny":
            return {"decision": "deny", "reason": "The project's permission rule " + rule + " does not allow this."}
        outcome = await next(event)
        if decision in ("allow", "ask") and outcome.get("decision") == "default":
            return {"decision": decision, "reason": rule}
        return outcome
    engine.on("tool.check", rules, tier="policy", on_error="deny", name="permission rules")

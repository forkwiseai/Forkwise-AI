"""Two-tier tool catalog.

Every tool definition is sent on every step. Measured on the built-in set, 27 tools are 19,181 characters per step,
before any MCP or integration tools, which are often larger. Most runs call a handful of them.

Tier 1 (core) is sent with the full schema. Tier 2 is sent as a stub: name, first sentence of the description and an
open parameter object. A stub costs about 190 characters instead of 300 to 2,600.

The list is fixed for the whole run. Providers cache the request prefix, and the tool block comes before the system
prompt and the history in that prefix, so adding a schema mid-run would make every later step pay full price for
the whole history again. Instead, a full schema reaches the model as a tool result, which is appended to the history
and keeps the cached prefix intact:

- the model calls a stub tool with arguments that satisfy the real schema: it runs, no extra step;
- it calls it with {} or with wrong arguments: the result is the full schema, and the call is not executed.

Arguments are always checked against the real schema on the server, so a stub never lets bad input through."""

import re
import json
import threading

from app import config

CORE = {
    "read_file", "write_file", "edit_file", "multi_edit", "list_dir", "glob", "grep", "bash",
    "todo_write", "web_search", "web_fetch", "ask_user", "exit_plan_mode",
}
HINT = " Call it with {} to get the full definition."
TYPES = {"string": str, "integer": int, "number": (int, float), "boolean": bool, "array": list, "object": dict}


def first_sentence(text):
    text = (text or "").strip()
    for mark in (". ", "! ", "? ", "\n"):
        cut = text.find(mark)
        if 0 < cut < 160:
            return text[:cut + 1].strip()
    return text[:160]


def signature(parameters, enum_chars=70):
    """Compact parameter list, e.g. (action*: open|click|type, url, ref:int). * marks required."""
    properties = (parameters or {}).get("properties") or {}
    required = set((parameters or {}).get("required") or [])
    parts = []
    for key, rule in properties.items():
        text = key + ("*" if key in required else "")
        kind = rule.get("type") if isinstance(rule, dict) else None
        allowed = rule.get("enum") if isinstance(rule, dict) else None
        if allowed:
            listed = "|".join(str(item) for item in allowed)
            text += ": " + (listed if len(listed) <= enum_chars else listed[:enum_chars] + "...")
        elif kind and kind != "string":
            text += ":" + ("int" if kind == "integer" else str(kind))
        parts.append(text)
    return "(" + ", ".join(parts) + ")"


def stub(spec):
    function = spec["function"]
    return {"type": "function", "function": {
        "name": function["name"],
        "description": first_sentence(function.get("description")) + " Parameters " + signature(function.get("parameters")) + ", * = required." + HINT,
        "parameters": {"type": "object", "properties": {}, "additionalProperties": True},
    }}


def build(found, core=CORE, full_all=False):
    """Returns (specs to send, {name: full spec}, set of stubbed names)."""
    full = {spec["function"]["name"]: spec for spec in found}
    if full_all:
        return list(found), full, set()
    sent = []
    stubbed = set()
    for spec in found:
        name = spec["function"]["name"]
        if name in core:
            sent.append(spec)
        else:
            sent.append(stub(spec))
            stubbed.add(name)
    return sent, full, stubbed


def size(specs):
    return len(json.dumps(specs, ensure_ascii=False))


def type_ok(value, kind):
    if kind is None:
        return True
    kinds = kind if isinstance(kind, list) else [kind]
    for item in kinds:
        python = TYPES.get(item)
        if python is None:
            return True
        if item in ("integer", "number") and isinstance(value, bool):
            continue
        if isinstance(value, python):
            return True
    return False


def coerce_value(value, kind):
    """Turns what a model meant into what the schema says: "8000" -> 8000, "true" -> True, 8000.0 -> 8000,
    '["a","b"]' -> ["a","b"]. Small models often quote numbers; refusing those calls wastes a whole turn."""
    kinds = kind if isinstance(kind, list) else [kind]
    if type_ok(value, kind):
        if "integer" in kinds and isinstance(value, float) and value.is_integer():
            return int(value)
        return value
    for item in kinds:
        if isinstance(value, str):
            text = value.strip()
            if item == "integer" and re.fullmatch(r"[+-]?\d+(\.0+)?", text):
                return int(float(text))
            if item == "number" and re.fullmatch(r"[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?", text):
                number = float(text)
                return int(number) if number.is_integer() else number
            if item == "boolean" and text.lower() in ("true", "false", "yes", "no", "1", "0"):
                return text.lower() in ("true", "yes", "1")
            if item in ("array", "object") and text[:1] in "[{":
                try:
                    parsed = json.loads(text)
                except ValueError:
                    continue
                if isinstance(parsed, TYPES[item]):
                    return parsed
            if item == "array" and text:
                return [part.strip() for part in text.split(",") if part.strip()]
        if item == "integer" and isinstance(value, float) and value.is_integer():
            return int(value)
        if item == "string" and isinstance(value, (int, float)) and not isinstance(value, bool):
            return str(value)
    return value


def coerce(spec, args):
    """Fixes top-level argument types in place, following the tool's schema. Returns args."""
    if not spec or not isinstance(args, dict):
        return args
    properties = ((spec.get("function") or {}).get("parameters") or {}).get("properties") or {}
    for key in list(args.keys()):
        rule = properties.get(key)
        if rule and rule.get("type") is not None and args[key] is not None:
            args[key] = coerce_value(args[key], rule.get("type"))
    return args


def problems(spec, args):
    """Mismatches between args and the full schema: missing required keys and wrong top-level types."""
    parameters = spec["function"].get("parameters") or {}
    properties = parameters.get("properties") or {}
    found = []
    for key in parameters.get("required") or []:
        if key not in args or args[key] is None:
            found.append("missing required parameter \"" + key + "\"")
    for key, value in args.items():
        rule = properties.get(key)
        if rule is None:
            if parameters.get("additionalProperties") is False:
                found.append("unknown parameter \"" + key + "\"")
            continue
        if not type_ok(value, rule.get("type")):
            found.append("parameter \"" + key + "\" should be " + str(rule.get("type")))
        allowed = rule.get("enum")
        if allowed and value not in allowed:
            found.append("parameter \"" + key + "\" must be one of " + ", ".join(str(item) for item in allowed))
    return found


def schema_text(spec, issues=()):
    function = spec["function"]
    head = "Full definition of " + function["name"] + ". The call was not run"
    head += (" because: " + "; ".join(issues) + "." if issues else ".")
    return head + " Call it again with arguments that match:\n" + function.get("description", "") + "\nParameters (JSON schema):\n" + json.dumps(function.get("parameters") or {}, ensure_ascii=False, indent=1)


def gate(run, name, args):
    """None when the call may run. Otherwise the text to return instead of running it."""
    stubbed = getattr(run, "stubbed", set())
    full = getattr(run, "full_specs", {})
    if name not in stubbed or name not in full:
        return None
    issues = problems(full[name], args) if args else ["no arguments were given"]
    tried = getattr(run, "stub_tried", None)
    if tried is None:
        tried = run.stub_tried = set()
    if name not in tried:
        tried.add(name)
        key = (getattr(run, "model", None) or {}).get("key", "")
        if key:
            record_first_call(key, bool(issues))
    if issues:
        return schema_text(full[name], issues if args else ())
    return None


def promote(run, name):
    """After a stub's definition was shown once, the model gets the full definition from then on.

    Some providers decode tool arguments against the schema they were given (vLLM guided decoding, strict
    function calling). For a stub that schema has no properties, so the model can only ever send {} and would
    get the definition back forever. Promoting also keeps a model that ignored the text from looping."""
    promoted = getattr(run, "promoted", None)
    if promoted is None:
        promoted = run.promoted = set()
    promoted.add(name)
    stubbed = getattr(run, "stubbed", set())
    stubbed.discard(name)
    full = (getattr(run, "full_specs", None) or {}).get(name)
    if full is not None and getattr(run, "tool_specs", None):
        run.tool_specs = [full if spec["function"]["name"] == name else spec for spec in run.tool_specs]


# Measured switch. A run saves N*D tokens and loses q*(P + s*N) per stubbed tool whose first call fails the check.
# bench/proofs.py gives break-even q* between 0.21 and 0.43 for realistic runs, so stubs stay on for a model only
# while its measured failure share q stays below Q_MAX. Counts persist per model.
Q_MAX = 0.25
MIN_TRIALS = 8
STATS_PATH = config.DATA_DIR / "toolcatalog.json"
STATS = {}
STATS_LOCK = threading.Lock()
STATS_LOADED = {"done": False}


def load_stats():
    if STATS_LOADED["done"]:
        return
    STATS_LOADED["done"] = True
    try:
        STATS.update(json.loads(STATS_PATH.read_text(encoding="utf-8")))
    except (OSError, ValueError):
        pass


def record_first_call(model_key, revealed):
    with STATS_LOCK:
        load_stats()
        item = STATS.setdefault(model_key, {"trials": 0, "reveals": 0})
        item["trials"] += 1
        item["reveals"] += 1 if revealed else 0
        try:
            STATS_PATH.parent.mkdir(parents=True, exist_ok=True)
            STATS_PATH.write_text(json.dumps(STATS), encoding="utf-8")
        except OSError:
            pass


def stubs_pay_off(model_key):
    with STATS_LOCK:
        load_stats()
        item = STATS.get(model_key) or {}
    trials = item.get("trials", 0)
    if trials < MIN_TRIALS:
        return True
    return item.get("reveals", 0) / trials <= Q_MAX

"""Helper agent types for the task tool: Forkwise's own and the project's.

A project defines its own in .forkwise/agents/NAME.md:

    ---
    name: db-migrator
    description: Writes and runs database migrations, then checks the schema.
    tools: read_file, edit_file, write_file, bash        (or: read-only, or: all)
    model: inherit                                        (or: fast, strong, or a model key)
    ---
    The instructions the helper starts with.

Read-only helpers (no tool that changes files or runs commands) may run side by side when the agent starts several
in one step; helpers that change things run one after another, so two never edit the same files at once.
"""
import os
import re

from app import config, plans
from app.agent import sandbox, specs

FOLDER = ".forkwise/agents"
NAME = re.compile(r"^[a-z0-9][a-z0-9_-]{0,39}$")
READ_TOOLS = ["read_file", "list_dir", "glob", "grep", "web_search", "web_fetch", "screenshot", "job_output"]
CHANGING = {"write_file", "edit_file", "multi_edit", "bash", "service", "scaffold", "kill_job", "generate_image", "video", "browser", "computer"}
MAX_PARALLEL = 4

BUILTIN = {
    "explore": {"description": "Read-only: search the codebase or research the web and report back.", "tools": "read-only", "model": "inherit", "builtin": True},
    "general": {"description": "Can change files and run commands, for a self-contained piece of work.", "tools": "all", "model": "inherit", "builtin": True},
    "reviewer": {
        "description": "Read-only code review of the given files or change: bugs, security problems and missing edge cases, ranked by severity.",
        "tools": "read-only", "model": "strong",
        "prompt": "You review code. Read the files or change you are pointed to and the code around them. Report real problems only, ranked most severe first: "
                  "for each, the file and line, what goes wrong and in which situation, and the fix in one or two sentences. Check correctness, error handling, "
                  "security (injection, secrets, auth), concurrency and edge cases. If you find nothing important, say so. You cannot change files.",
    },
    "tester": {
        "description": "Writes and runs tests for the given code with the project's test runner, then reports what passed and what failed.",
        "tools": "all", "model": "inherit",
        "prompt": "You write and run tests. Find the project's test runner and conventions first and follow them (add one only if there is none). "
                  "Cover the main paths and the edge cases of the code you are pointed to, run the tests, and fix the tests (not the code) when they are wrong. "
                  "Report which tests you added, what passed and what failed, with the failure messages. Do not change application code unless asked.",
    },
}


def parse(text):
    """(fields, body) from a file with --- front matter; fields are lower-cased keys."""
    fields = {}
    body = text
    if text.startswith("---"):
        end = text.find("\n---", 3)
        if end > 0:
            for line in text[3:end].splitlines():
                if ":" in line:
                    key, value = line.split(":", 1)
                    fields[key.strip().lower()] = value.strip().strip("\"'")
            body = text[end + 4:].lstrip("\n")
    return fields, body.strip()


def project_agents(wid):
    found = {}
    if not wid:
        return found
    try:
        folder = sandbox.host_root(wid) / FOLDER
    except Exception:
        return found
    if not folder.is_dir():
        return found
    for path in sorted(folder.glob("*.md"))[:20]:
        try:
            fields, body = parse(path.read_text(encoding="utf-8", errors="replace")[:20000])
        except OSError:
            continue
        name = (fields.get("name") or path.stem).lower()
        if not NAME.match(name) or name in ("explore", "general"):
            continue
        found[name] = {"description": fields.get("description") or "A project helper.", "tools": fields.get("tools") or "read-only", "model": fields.get("model") or "inherit", "prompt": body}
    return found


def available(run):
    found = dict(BUILTIN)
    if not getattr(run, "local", None):
        found.update(project_agents(run.wid))
    return found


def tool_names(definition):
    wanted = str(definition.get("tools") or "read-only").strip().lower()
    if wanted in ("read-only", "readonly", "read"):
        return list(READ_TOOLS)
    if wanted in ("all", "*"):
        return None
    return [name.strip() for name in re.split(r"[,\s]+", wanted) if name.strip()]


def read_only(definition):
    names = tool_names(definition)
    return names is not None and not (set(names) & CHANGING)


def specs_for(run, definition):
    names = tool_names(definition)
    if names is None:
        return specs.general_specs()
    found = []
    for spec in specs.BUILTIN:
        name = spec["function"]["name"]
        if name in names and name not in specs.GENERAL_EXCLUDE:
            found.append(spec)
    return found or specs.explore_specs()


def exact_model(key):
    for model in config.MODELS:
        if key and (model["key"] == key or model["id"] == key):
            return model
    return None


def model_for(run, definition):
    choice = str(definition.get("model") or "inherit").strip()
    model = None
    if choice == "strong":
        from app.agent import advisor
        model = advisor.model_for(run)
    elif choice == "fast":
        model = exact_model(os.environ.get("FAST_MODEL", "").strip())
    elif choice != "inherit":
        model = exact_model(choice)
    if model is None or not plans.allows(run.user, model):
        return run.model
    return model


def task_spec(run, base):
    """The task tool's definition with this run's helper types listed."""
    found = available(run)
    lines = [name + ": " + item["description"] for name, item in found.items()]
    spec = {"type": "function", "function": dict(base["function"])}
    parameters = dict(spec["function"]["parameters"])
    properties = dict(parameters["properties"])
    properties["agent"] = {"type": "string", "enum": list(found.keys()), "description": "Which helper. Default explore."}
    parameters["properties"] = properties
    spec["function"]["parameters"] = parameters
    spec["function"]["description"] = ("Give a self-contained job to a helper agent with its own fresh context, and get its final report. "
                                       "Start several read-only helpers in one step to run them side by side. Helpers:\n- " + "\n- ".join(lines))
    return spec

"""A stronger model the working model can ask for advice, so a cheap or free model does most of the steps and a better
one is paid only for the few moments that decide the outcome: choosing an approach, getting unstuck, a last look
before saying the work is done.

The advisor gets a compact brief (the task, the plan, the last steps and their results, the question), never the
whole history, and answers in a few short paragraphs; it has no tools and changes nothing.

Which model advises: the person's own choice (settings "advisor_model"), else the server's ADVISOR_MODEL (a model
key or id). It is offered only when that model exists, differs from the one doing the work, and the plan allows it.
"""
import json
import os

from app import config, db, plans

SYSTEM = ("You are a senior software engineer advising another AI agent that is doing a task on its own Linux computer. "
          "It shows you a brief of the task and its recent steps and asks one question. Answer it directly: the likely cause, "
          "the approach you would take, and the next two or three concrete steps (commands, files, checks). Point out a wrong "
          "assumption if you see one. No preamble, no code longer than a few lines, at most 250 words.")
STEPS = 14
RESULT_CHARS = 700


def exact_model(key):
    for model in config.MODELS:
        if key and (model["key"] == key or model["id"] == key):
            return model
    return None


def model_for(run):
    settings = db.load_json((run.user or {}).get("settings"), {})
    model = exact_model(str(settings.get("advisor_model") or "")) or exact_model(os.environ.get("ADVISOR_MODEL", "").strip())
    if model is None or (run.model or {}).get("key") == model["key"]:
        return None
    if not plans.allows(run.user, model):
        return None
    return model


def available(run):
    return not getattr(run, "unattended_advice_off", False) and model_for(run) is not None


def clip(text, size):
    text = str(text or "")
    return text if len(text) <= size else text[:size] + " …[cut]"


def brief(run, question, context=""):
    rows = db.all_rows("SELECT role, content, tool_calls, name FROM messages WHERE chat_id = ? AND compacted = 0 ORDER BY id DESC LIMIT ?", (run.chat["id"], STEPS * 2 + 6))
    rows = list(reversed(rows))
    first = db.one_row("SELECT content FROM messages WHERE chat_id = ? AND role = 'user' ORDER BY id DESC LIMIT 1", (run.chat["id"],))
    parts = ["TASK:\n" + clip((first or {}).get("content") or getattr(run, "request", ""), 2500)]
    todos = getattr(run, "todos", None) or []
    if todos:
        parts.append("PLAN:\n" + "\n".join("[" + str(item.get("status")) + "] " + str(item.get("content")) for item in todos[:20]))
    steps = []
    for row in rows:
        if row["role"] == "assistant":
            calls = db.load_json(row.get("tool_calls"), [])
            said = clip(row.get("content"), 400).strip()
            names = ", ".join((call.get("function") or {}).get("name", "") + " " + clip((call.get("function") or {}).get("arguments", ""), 160) for call in calls)
            if said or names:
                steps.append("AGENT: " + (said + " " if said else "") + ("calls " + names if names else ""))
        elif row["role"] == "tool":
            steps.append("RESULT of " + (row.get("name") or "tool") + ": " + clip(row.get("content"), RESULT_CHARS))
    if steps:
        parts.append("RECENT STEPS (oldest first):\n" + "\n".join(steps[-STEPS * 2:]))
    if context:
        parts.append("MORE CONTEXT FROM THE AGENT:\n" + clip(context, 3000))
    parts.append("QUESTION:\n" + clip(question, 1500))
    return "\n\n".join(parts)


async def ask(run, question, context=""):
    """The advisor's answer as text, or "" when no advisor is available. Charged like any other model call."""
    model = model_for(run)
    if model is None:
        return ""
    from app.agent import llm, runs
    messages = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": brief(run, question, context)}]
    answer = await llm.stream_chat(model, messages, tools=None, max_tokens=1200, stop_flag=run.stop_flag)
    run.tokens_in = run.tokens_in + answer["usage"]["prompt_tokens"]
    run.tokens_out = run.tokens_out + answer["usage"]["completion_tokens"]
    answer.setdefault("model_key", model["key"])
    runs.charge(run, answer)
    return (answer.get("content") or "").strip()


async def consult(run, question, context=""):
    from app.agent import tools
    if not question.strip():
        return tools.result("Ask a question.", ok=False)
    model = model_for(run)
    if model is None:
        return tools.result("No advisor model is available here. Continue on your own.", ok=False)
    run.emit("notice", {"text": "Asking " + model.get("label", "the advisor") + " for advice."})
    text = await ask(run, question, context)
    if not text:
        return tools.result("The advisor gave no answer. Continue on your own.", ok=False)
    return tools.result("Advice from " + model.get("label", "the advisor") + ":\n" + text, meta={"advisor": model.get("label", "")})


SPEC = {
    "type": "function",
    "function": {
        "name": "advisor",
        "description": "Ask a stronger model for advice when it matters: before committing to an approach on a hard task, when you are stuck after a few failed attempts, or for a last look before saying a big task is done. It sees the task, your plan and your recent steps. It costs more than a normal step, so do not use it for easy things.",
        "parameters": {"type": "object", "properties": {
            "question": {"type": "string", "description": "What you want advice on, specific."},
            "context": {"type": "string", "description": "Anything it needs that is not in your recent steps, such as an error text or a file excerpt."},
        }, "required": ["question"]},
    },
}

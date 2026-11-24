"""Bring your own API: people add their own OpenAI-compatible endpoint and key, and its models
show up next to the server's. Keys are encrypted at rest and never sent back to the browser."""
import ipaddress
import re
import socket
from urllib.parse import urlparse
import httpx
from fastapi import HTTPException
from app import config, db, vault

PRESETS = [
    {"id": "openai", "name": "OpenAI", "url": "https://api.openai.com/v1", "models": "gpt-5,gpt-5-mini", "vision": True, "keys": "https://platform.openai.com/api-keys"},
    {"id": "anthropic", "name": "Anthropic", "url": "https://api.anthropic.com/v1", "models": "claude-sonnet-4-5,claude-opus-4-1", "vision": True, "keys": "https://console.anthropic.com/settings/keys"},
    {"id": "openrouter", "name": "OpenRouter", "url": "https://openrouter.ai/api/v1", "models": "anthropic/claude-sonnet-4.5,openai/gpt-5", "vision": True, "keys": "https://openrouter.ai/keys"},
    {"id": "gemini", "name": "Google Gemini", "url": "https://generativelanguage.googleapis.com/v1beta/openai", "models": "gemini-2.5-pro,gemini-2.5-flash", "vision": True, "keys": "https://aistudio.google.com/apikey"},
    {"id": "deepseek", "name": "DeepSeek", "url": "https://api.deepseek.com/v1", "models": "deepseek-chat,deepseek-reasoner", "vision": False, "keys": "https://platform.deepseek.com/api_keys"},
    {"id": "xai", "name": "xAI", "url": "https://api.x.ai/v1", "models": "grok-4", "vision": True, "keys": "https://console.x.ai"},
    {"id": "groq", "name": "Groq", "url": "https://api.groq.com/openai/v1", "models": "moonshotai/kimi-k2-instruct", "vision": False, "keys": "https://console.groq.com/keys"},
    {"id": "mistral", "name": "Mistral", "url": "https://api.mistral.ai/v1", "models": "mistral-large-latest,devstral-medium-latest", "vision": False, "keys": "https://console.mistral.ai/api-keys"},
    {"id": "custom", "name": "Other (OpenAI-compatible)", "url": "", "models": "", "vision": False, "keys": ""},
]

MAX_PROVIDERS = 10
MAX_MODELS = 20


def allow_private():
    # Self-hosters may point at Ollama or LM Studio on their own network.
    return config.flag("ALLOW_PRIVATE_PROVIDERS", False)


def check_url(url):
    """Refuses URLs that would make the server call itself or a private network."""
    parsed = urlparse(url)
    if parsed.scheme not in ("https", "http") or not parsed.hostname:
        raise HTTPException(status_code=400, detail="Enter a full URL, for example https://api.openai.com/v1")
    if allow_private():
        return
    if parsed.scheme != "https":
        raise HTTPException(status_code=400, detail="The API address must start with https://")
    try:
        infos = socket.getaddrinfo(parsed.hostname, parsed.port or 443, proto=socket.IPPROTO_TCP)
    except socket.gaierror:
        raise HTTPException(status_code=400, detail="That address can't be found. Check the URL.")
    for info in infos:
        address = ipaddress.ip_address(info[4][0])
        if address.is_private or address.is_loopback or address.is_link_local or address.is_reserved or address.is_multicast or address.is_unspecified:
            raise HTTPException(status_code=400, detail="That address points to a private network, which isn't allowed here.")


def clean_models(text):
    out = []
    for item in re.split(r"[,\n]", text or ""):
        name = item.strip()
        if name and name not in out and re.match(r"^[\w.:/@+-]{1,120}$", name):
            out.append(name)
    return out[:MAX_MODELS]


def rows(user_id):
    return db.all_rows("SELECT * FROM user_providers WHERE user_id = ? ORDER BY created_at", (user_id,))


def model_dicts(row):
    result = []
    for name in db.load_json(row["models"], []):
        result.append({
            "key": "u" + row["id"] + ":" + name,
            "id": name,
            "label": name.split("/")[-1],
            "url": row["base_url"].rstrip("/"),
            "api_key": vault.unseal(row["key_enc"]),
            "vision": bool(row["vision"]),
            "context": int(row["context"] or 128000),
            "own": True,
            "provider_name": row["name"],
        })
    return result


def user_models(user_id):
    out = []
    for row in rows(user_id):
        if row["enabled"]:
            out.extend(model_dicts(row))
    return out


def find(user_id, key):
    """The model a chat should use: one of the person's own models, or a server model."""
    if key and str(key).startswith("u") and user_id:
        provider_id = str(key)[1:].split(":", 1)[0]
        row = db.one_row("SELECT * FROM user_providers WHERE id = ? AND user_id = ?", (provider_id, user_id))
        if row and row["enabled"]:
            for model in model_dicts(row):
                if model["key"] == key:
                    return model
    return config.find_model(key)


def public_models(user_id):
    from app import plans
    result = config.public_models()
    user = db.one_row("SELECT * FROM users WHERE id = ?", (user_id,)) if user_id else None
    if user is not None:
        keys = {model["key"] for model in config.MODELS if plans.allows(user, model)}
        result = [item for item in result if item["key"] in keys]
    for model in user_models(user_id):
        result.append({"key": model["key"], "label": model["label"], "vision": model["vision"], "context": model["context"], "vendor": "own", "vendor_label": "Your API: " + model["provider_name"], "own": True})
    return result


def public_row(row):
    key = vault.unseal(row["key_enc"])
    return {
        "id": row["id"], "name": row["name"], "preset": row["preset"], "base_url": row["base_url"], "models": db.load_json(row["models"], []),
        "vision": bool(row["vision"]), "context": row["context"], "enabled": bool(row["enabled"]), "created_at": row["created_at"],
        "key_hint": ("…" + key[-4:]) if len(key) >= 8 else "set",
    }


async def probe(base_url, key, model):
    """Sends a one-word request so a wrong URL, key or model name fails now, not in the middle of a task."""
    try:
        async with httpx.AsyncClient(timeout=25, follow_redirects=False) as client:
            reply = await client.post(base_url.rstrip("/") + "/chat/completions", headers={"Authorization": "Bearer " + key, "content-type": "application/json"},
                                      json={"model": model, "messages": [{"role": "user", "content": "Reply with the word ok."}], "max_tokens": 5})
    except httpx.HTTPError:
        return False, "Couldn't reach that address. Check the URL."
    if reply.status_code == 401 or reply.status_code == 403:
        return False, "The API key was refused."
    if reply.status_code == 404:
        return False, "The address or the model name \"" + model + "\" wasn't found."
    if reply.status_code >= 300:
        text = reply.text[:200].replace("\n", " ")
        return False, "The API answered with an error (" + str(reply.status_code) + "): " + text
    return True, "Connected. " + model + " answered."

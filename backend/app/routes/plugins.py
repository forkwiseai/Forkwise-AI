import re
from fastapi import HTTPException, Request
from pydantic import BaseModel
from app import db, plugins, security
from app.routes.auth import current_user

SLUG = re.compile(r"^[a-z0-9][a-z0-9-]{1,46}$")


class ToggleBody(BaseModel):
    enabled: bool


class CustomBody(BaseModel):
    manifest: dict


def installed_rows(user_id):
    rows = db.all_rows("SELECT * FROM plugins WHERE user_id = ?", (user_id,))
    return {row["plugin_id"]: row for row in rows}


def manifest_for(user_id, plugin_id):
    row = db.one_row("SELECT * FROM plugins WHERE user_id = ? AND plugin_id = ?", (user_id, plugin_id))
    if row:
        saved = db.load_json(row["manifest"], {})
        if saved.get("id"):
            return saved
    return plugins.BY_ID.get(plugin_id)


def list_plugins(request: Request):
    user = current_user(request)
    installed = installed_rows(user["id"])
    providers = {row["provider"] for row in db.all_rows("SELECT provider FROM connections WHERE user_id = ?", (user["id"],))}
    installs = {row["plugin_id"]: row["n"] for row in db.all_rows("SELECT plugin_id, COUNT(*) AS n FROM plugins GROUP BY plugin_id")}
    recent = {row["plugin_id"]: row["n"] for row in db.all_rows("SELECT plugin_id, COUNT(*) AS n FROM plugins WHERE installed_at > ? GROUP BY plugin_id", (db.now() - 7 * 86400,))}
    items = []
    for item in plugins.CATALOG:
        data = plugins.public(item, installed.get(item["id"]))
        if item.get("builtin"):
            data["installed"] = item["builtin"] in providers
            data["enabled"] = data["installed"]
        data["installs"] = installs.get(item["id"], 0)
        data["recent"] = recent.get(item["id"], 0)
        items.append(data)
    for plugin_id, row in installed.items():
        if plugin_id in plugins.BY_ID:
            continue
        manifest = db.load_json(row["manifest"], {})
        if manifest.get("id"):
            manifest["custom"] = True
            items.append(plugins.public(fill(manifest), row))
    return {"plugins": items, "categories": plugins.CATEGORIES, "featured": plugins.FEATURED, "workflows": plugins.WORKFLOWS}


def fill(manifest):
    for key, default in (("publisher", "You"), ("verified", False), ("category", "Engineering"), ("icon", "blocks"), ("summary", ""), ("description", ""), ("commands", []), ("skills", []), ("connectors", [])):
        manifest.setdefault(key, default)
    return manifest


def apply(user_id, manifest, enabled=True):
    now = db.now()
    for entry in manifest.get("skills", []):
        existing = db.one_row("SELECT id FROM skills WHERE user_id = ? AND name = ?", (user_id, entry["name"]))
        values = {"description": entry["description"], "body": entry["body"], "enabled": 1 if enabled else 0, "updated_at": now}
        if existing:
            db.update("skills", "id", existing["id"], values)
        else:
            values.update({"id": db.new_id("sk_"), "user_id": user_id, "name": entry["name"], "created_at": now})
            db.insert("skills", values)
    for entry in manifest.get("connectors", []):
        existing = db.one_row("SELECT id FROM mcp_servers WHERE user_id = ? AND url = ?", (user_id, entry["url"]))
        if existing:
            db.execute("UPDATE mcp_servers SET enabled = ? WHERE id = ?", (1 if enabled else 0, existing["id"]))
        else:
            db.insert("mcp_servers", {"id": db.new_id("mcp_"), "user_id": user_id, "name": entry["name"], "url": entry["url"], "headers": "{}", "enabled": 1 if enabled else 0, "created_at": now})


def remove(user_id, manifest):
    for entry in manifest.get("skills", []):
        db.execute("DELETE FROM skills WHERE user_id = ? AND name = ?", (user_id, entry["name"]))
    for entry in manifest.get("connectors", []):
        db.execute("DELETE FROM mcp_servers WHERE user_id = ? AND url = ?", (user_id, entry["url"]))


def install(plugin_id: str, request: Request):
    user = current_user(request)
    item = plugins.BY_ID.get(plugin_id)
    if item is None:
        raise HTTPException(status_code=404, detail="That plugin is not in the catalog.")
    if item.get("builtin"):
        raise HTTPException(status_code=400, detail="Connect this one from Settings, Connected accounts.")
    if db.one_row("SELECT id FROM plugins WHERE user_id = ? AND plugin_id = ?", (user["id"], plugin_id)):
        return {"plugin": plugins.public(item, installed_rows(user["id"]).get(plugin_id))}
    apply(user["id"], item)
    db.insert("plugins", {"id": db.new_id("pl_"), "user_id": user["id"], "plugin_id": plugin_id, "manifest": "{}", "enabled": 1, "installed_at": db.now()})
    security.plugin_installed(user, item["name"])
    return {"plugin": plugins.public(item, installed_rows(user["id"]).get(plugin_id))}


def uninstall(plugin_id: str, request: Request):
    user = current_user(request)
    manifest = manifest_for(user["id"], plugin_id)
    if manifest is None:
        raise HTTPException(status_code=404, detail="That plugin is not installed.")
    remove(user["id"], manifest)
    db.execute("DELETE FROM plugins WHERE user_id = ? AND plugin_id = ?", (user["id"], plugin_id))
    return {"ok": True}


def toggle(plugin_id: str, body: ToggleBody, request: Request):
    user = current_user(request)
    row = db.one_row("SELECT * FROM plugins WHERE user_id = ? AND plugin_id = ?", (user["id"], plugin_id))
    if row is None:
        raise HTTPException(status_code=404, detail="That plugin is not installed.")
    manifest = manifest_for(user["id"], plugin_id)
    apply(user["id"], manifest, body.enabled)
    db.execute("UPDATE plugins SET enabled = ? WHERE id = ?", (1 if body.enabled else 0, row["id"]))
    return {"ok": True}


def clean_manifest(raw):
    plugin_id = str(raw.get("id") or "").strip().lower()
    if not SLUG.match(plugin_id):
        raise HTTPException(status_code=400, detail="The manifest needs an id made of lowercase letters, numbers and dashes.")
    if plugin_id in plugins.BY_ID:
        raise HTTPException(status_code=400, detail="That id belongs to a catalog plugin. Pick another.")
    name = str(raw.get("name") or "").strip()[:60]
    if not name:
        raise HTTPException(status_code=400, detail="The manifest needs a name.")
    skills = []
    for entry in (raw.get("skills") or [])[:20]:
        skill_name = str(entry.get("name") or "").strip().lower()
        body = str(entry.get("body") or "").strip()
        if not SLUG.match(skill_name) or not body:
            raise HTTPException(status_code=400, detail="Each skill needs a name (lowercase, dashes) and a body.")
        skills.append({"name": skill_name, "description": str(entry.get("description") or "")[:200], "body": body[:20000]})
    connectors = []
    for entry in (raw.get("connectors") or [])[:10]:
        url = str(entry.get("url") or "").strip()
        if not url.startswith("https://"):
            raise HTTPException(status_code=400, detail="Connector URLs must start with https://")
        connectors.append({"name": str(entry.get("name") or url)[:60], "url": url[:500]})
    commands = []
    for entry in (raw.get("commands") or [])[:20]:
        command = str(entry.get("name") or "").strip()
        if re.match(r"^/[a-z0-9-]{1,30}$", command):
            commands.append({"name": command, "description": str(entry.get("description") or "")[:120]})
    if not skills and not connectors:
        raise HTTPException(status_code=400, detail="A plugin needs at least one skill or connector.")
    return fill({
        "id": plugin_id, "name": name, "summary": str(raw.get("summary") or raw.get("description") or "")[:160],
        "description": str(raw.get("description") or "")[:1000], "category": raw.get("category") if raw.get("category") in plugins.CATEGORIES else "Engineering",
        "skills": skills, "connectors": connectors, "commands": commands, "publisher": "You",
    })


def add_custom(body: CustomBody, request: Request):
    user = current_user(request)
    manifest = clean_manifest(body.manifest)
    old = db.one_row("SELECT * FROM plugins WHERE user_id = ? AND plugin_id = ?", (user["id"], manifest["id"]))
    if old:
        remove(user["id"], db.load_json(old["manifest"], {}))
        db.execute("DELETE FROM plugins WHERE id = ?", (old["id"],))
    apply(user["id"], manifest)
    db.insert("plugins", {"id": db.new_id("pl_"), "user_id": user["id"], "plugin_id": manifest["id"], "manifest": db.dump_json(manifest), "enabled": 1, "installed_at": db.now()})
    manifest["custom"] = True
    return {"plugin": plugins.public(manifest, installed_rows(user["id"]).get(manifest["id"]))}


def register_routes(app):
    app.add_api_route("/api/plugins", list_plugins, methods=["GET"])
    app.add_api_route("/api/plugins/custom", add_custom, methods=["POST"])
    app.add_api_route("/api/plugins/{plugin_id}/install", install, methods=["POST"])
    app.add_api_route("/api/plugins/{plugin_id}", uninstall, methods=["DELETE"])
    app.add_api_route("/api/plugins/{plugin_id}", toggle, methods=["PATCH"])

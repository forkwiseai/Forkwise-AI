from fastapi import HTTPException, Request
from pydantic import BaseModel
from app import db, providers, vault
from app.routes.auth import current_user


class ProviderBody(BaseModel):
    name: str = ""
    preset: str = "custom"
    base_url: str
    api_key: str = ""
    models: str
    vision: bool = False
    context: int = 128000
    test: bool = True


class ToggleBody(BaseModel):
    enabled: bool


def presets(request: Request):
    current_user(request)
    return {"presets": providers.PRESETS}


def list_providers(request: Request):
    user = current_user(request)
    return {"providers": [providers.public_row(row) for row in providers.rows(user["id"])]}


async def save(body: ProviderBody, request: Request, provider_id: str = ""):
    user = current_user(request)
    base_url = body.base_url.strip().rstrip("/")
    providers.check_url(base_url)
    models = providers.clean_models(body.models)
    if not models:
        raise HTTPException(status_code=400, detail="Add at least one model name, for example gpt-5.")
    old = None
    if provider_id:
        old = db.one_row("SELECT * FROM user_providers WHERE id = ? AND user_id = ?", (provider_id, user["id"]))
        if old is None:
            raise HTTPException(status_code=404, detail="That API connection is gone.")
    key = body.api_key.strip() or (vault.unseal(old["key_enc"]) if old else "")
    if not key:
        raise HTTPException(status_code=400, detail="Paste your API key.")
    if len(key) > 500:
        raise HTTPException(status_code=400, detail="That key is too long.")
    if body.test:
        ok, message = await providers.probe(base_url, key, models[0])
        if not ok:
            raise HTTPException(status_code=400, detail=message)
    preset = body.preset if any(item["id"] == body.preset for item in providers.PRESETS) else "custom"
    name = body.name.strip()[:60] or next((item["name"] for item in providers.PRESETS if item["id"] == preset), "My API")
    values = {
        "name": name, "preset": preset, "base_url": base_url, "key_enc": vault.seal(key), "models": db.dump_json(models),
        "vision": 1 if body.vision else 0, "context": max(4000, min(int(body.context or 128000), 2000000)),
    }
    if old:
        db.update("user_providers", "id", old["id"], values)
        row_id = old["id"]
    else:
        if len(providers.rows(user["id"])) >= providers.MAX_PROVIDERS:
            raise HTTPException(status_code=400, detail="You can connect up to 10 APIs.")
        row_id = db.new_id("pv")
        values.update({"id": row_id, "user_id": user["id"], "enabled": 1, "created_at": db.now()})
        db.insert("user_providers", values)
    row = db.one_row("SELECT * FROM user_providers WHERE id = ?", (row_id,))
    return {"provider": providers.public_row(row), "models": providers.public_models(user["id"])}


async def create(body: ProviderBody, request: Request):
    return await save(body, request)


async def update(provider_id: str, body: ProviderBody, request: Request):
    return await save(body, request, provider_id)


def toggle(provider_id: str, body: ToggleBody, request: Request):
    user = current_user(request)
    db.execute("UPDATE user_providers SET enabled = ? WHERE id = ? AND user_id = ?", (1 if body.enabled else 0, provider_id, user["id"]))
    return {"ok": True, "models": providers.public_models(user["id"])}


def remove(provider_id: str, request: Request):
    user = current_user(request)
    db.execute("DELETE FROM user_providers WHERE id = ? AND user_id = ?", (provider_id, user["id"]))
    return {"ok": True, "models": providers.public_models(user["id"])}


async def test(provider_id: str, request: Request):
    user = current_user(request)
    row = db.one_row("SELECT * FROM user_providers WHERE id = ? AND user_id = ?", (provider_id, user["id"]))
    if row is None:
        raise HTTPException(status_code=404, detail="That API connection is gone.")
    providers.check_url(row["base_url"])
    ok, message = await providers.probe(row["base_url"], vault.unseal(row["key_enc"]), db.load_json(row["models"], [""])[0])
    return {"ok": ok, "message": message}


def register_routes(app):
    app.add_api_route("/api/providers/presets", presets, methods=["GET"])
    app.add_api_route("/api/providers", list_providers, methods=["GET"])
    app.add_api_route("/api/providers", create, methods=["POST"])
    app.add_api_route("/api/providers/{provider_id}", update, methods=["PUT"])
    app.add_api_route("/api/providers/{provider_id}", toggle, methods=["PATCH"])
    app.add_api_route("/api/providers/{provider_id}", remove, methods=["DELETE"])
    app.add_api_route("/api/providers/{provider_id}/test", test, methods=["POST"])

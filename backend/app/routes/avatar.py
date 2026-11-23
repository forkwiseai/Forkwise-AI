"""Profile photo: the user's Google photo, or a picture they upload (cropped square, 256px)."""

import io
import time

from fastapi import File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel

from app import config, db

FOLDER = config.DATA_DIR / "avatars"
ALLOWED = {"image/png", "image/jpeg", "image/webp", "image/gif"}
LIMIT = 5 * 1024 * 1024


def file_for(user_id):
    safe = "".join(ch for ch in user_id if ch.isalnum() or ch in "_-")
    return FOLDER / (safe + ".webp")


def avatar_url(user):
    settings = db.load_json(user.get("settings"), {})
    source = settings.get("avatar_source", "")
    if source == "upload" and file_for(user["id"]).is_file():
        return config.API_URL + "/api/avatar/" + user["id"] + "?v=" + str(int(settings.get("avatar_at", 0)))
    if source in ("", "google") and settings.get("google_picture"):
        return settings["google_picture"]
    return ""


def remember_google_picture(user_id, picture):
    """Called on every Google sign-in so the photo stays current."""
    if not picture or not str(picture).startswith("https://"):
        return
    user = db.one_row("SELECT * FROM users WHERE id = ?", (user_id,))
    if user is None:
        return
    settings = db.load_json(user["settings"], {})
    settings["google_picture"] = str(picture)[:600]
    db.update("users", "id", user_id, {"settings": db.dump_json(settings)})


def shrink(data):
    try:
        from PIL import Image, ImageOps
    except ImportError:
        raise HTTPException(status_code=500, detail="Image support is not installed on the server (Pillow).")
    try:
        image = Image.open(io.BytesIO(data))
        image = ImageOps.exif_transpose(image).convert("RGB")
    except Exception:
        raise HTTPException(status_code=400, detail="That file is not a picture we can read. Use PNG, JPG or WebP.")
    side = min(image.size)
    left = (image.width - side) // 2
    top = (image.height - side) // 2
    image = image.crop((left, top, left + side, top + side)).resize((256, 256), Image.LANCZOS)
    out = io.BytesIO()
    image.save(out, "WEBP", quality=88)
    return out.getvalue()


async def upload_avatar(request: Request, file: UploadFile = File(...)):
    from app.routes.auth import current_user, public_user
    user = current_user(request)
    if (file.content_type or "") not in ALLOWED:
        raise HTTPException(status_code=400, detail="Use a PNG, JPG, WebP or GIF picture.")
    data = await file.read(LIMIT + 1)
    if len(data) > LIMIT:
        raise HTTPException(status_code=400, detail="The picture is larger than 5 MB.")
    picture = shrink(data)
    FOLDER.mkdir(parents=True, exist_ok=True)
    file_for(user["id"]).write_bytes(picture)
    settings = db.load_json(user["settings"], {})
    settings["avatar_source"] = "upload"
    settings["avatar_at"] = time.time()
    db.update("users", "id", user["id"], {"settings": db.dump_json(settings)})
    return {"user": public_user(db.one_row("SELECT * FROM users WHERE id = ?", (user["id"],)))}


class SourceBody(BaseModel):
    source: str


def set_source(body: SourceBody, request: Request):
    from app.routes.auth import current_user, public_user
    user = current_user(request)
    settings = db.load_json(user["settings"], {})
    if body.source == "google":
        if not settings.get("google_picture"):
            raise HTTPException(status_code=400, detail="Sign in with Google once to use your Google photo.")
        settings["avatar_source"] = "google"
    elif body.source == "none":
        settings["avatar_source"] = "none"
        file_for(user["id"]).unlink(missing_ok=True)
    else:
        raise HTTPException(status_code=400, detail="Unknown photo source.")
    db.update("users", "id", user["id"], {"settings": db.dump_json(settings)})
    return {"user": public_user(db.one_row("SELECT * FROM users WHERE id = ?", (user["id"],)))}


def get_avatar(user_id: str):
    path = file_for(user_id)
    if not path.is_file():
        return Response(status_code=404)
    return FileResponse(path, media_type="image/webp", headers={"Cache-Control": "public, max-age=31536000, immutable"})


def register_routes(app):
    app.add_api_route("/api/account/avatar", upload_avatar, methods=["POST"])
    app.add_api_route("/api/account/avatar/source", set_source, methods=["POST"])
    app.add_api_route("/api/avatar/{user_id}", get_avatar, methods=["GET"])

"""Speech to text and text to speech, through any OpenAI-compatible audio API.

STT_* settings point at /audio/transcriptions (OpenAI, Groq and most Whisper servers).
TTS_* settings point at /audio/speech (OpenAI and compatible servers).
When a side is not set up, the apps fall back to the browser's own speech features.
"""
import time

import httpx
from fastapi import File, Form, HTTPException, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel

from app import config
from app.routes.auth import current_user

MAX_AUDIO = 25 * 1024 * 1024
MAX_SPEECH = 4000
PER_MINUTE = 40
FORMATS = {"mp3": "audio/mpeg", "opus": "audio/ogg", "aac": "audio/aac", "wav": "audio/wav"}
DEFAULT_VOICES = ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse"]
DEFAULT_STYLE = (
    "Speak like a friendly, calm colleague in a real conversation: natural rhythm, warm tone, "
    "short pauses between thoughts, never robotic. Match the language of the text."
)
RECENT = {}


class SpeakBody(BaseModel):
    text: str
    voice: str = ""
    format: str = "mp3"


def stt_settings():
    base = config.text("STT_BASE_URL").rstrip("/")
    key = config.text("STT_API_KEY")
    if not base or not key:
        return None
    model = config.text("STT_MODEL") or ("whisper-large-v3-turbo" if "groq.com" in base else "whisper-1")
    return {"base": base, "key": key, "model": model}


def tts_settings():
    base = config.text("TTS_BASE_URL").rstrip("/")
    key = config.text("TTS_API_KEY")
    if not base or not key:
        return None
    voices = [item.strip() for item in config.text("TTS_VOICES").split(",") if item.strip()] or DEFAULT_VOICES
    voice = config.text("TTS_VOICE") or ("coral" if "coral" in voices else voices[0])
    return {
        "base": base,
        "key": key,
        "model": config.text("TTS_MODEL") or "gpt-4o-mini-tts",
        "voice": voice,
        "voices": voices,
        "style": config.text("TTS_INSTRUCTIONS", DEFAULT_STYLE),
    }


def check_rate(user_id):
    now = time.time()
    recent = [moment for moment in RECENT.get(user_id, []) if now - moment < 60]
    if len(recent) >= PER_MINUTE:
        raise HTTPException(status_code=429, detail="Too many voice requests. Wait a moment and try again.")
    recent.append(now)
    RECENT[user_id] = recent


def provider_error(reply, what):
    try:
        detail = reply.json().get("error", {})
        message = detail.get("message") if isinstance(detail, dict) else str(detail)
    except ValueError:
        message = reply.text[:200]
    raise HTTPException(status_code=502, detail=what + " failed: " + (message or "status " + str(reply.status_code)))


def info(request: Request):
    current_user(request)
    stt = stt_settings()
    tts = tts_settings()
    return {
        "transcribe": stt is not None,
        "speak": tts is not None,
        "voices": tts["voices"] if tts else [],
        "voice": tts["voice"] if tts else "",
    }


async def transcribe(request: Request, audio: UploadFile = File(...), language: str = Form("")):
    user = current_user(request)
    settings = stt_settings()
    if settings is None:
        raise HTTPException(status_code=501, detail="Speech to text is not set up on this server.")
    check_rate(user["id"])
    data = await audio.read()
    if len(data) == 0:
        raise HTTPException(status_code=400, detail="The recording is empty.")
    if len(data) > MAX_AUDIO:
        raise HTTPException(status_code=413, detail="The recording is too long. Keep it under 25 MB.")
    fields = {"model": settings["model"], "response_format": "json"}
    code = language.split("-")[0].strip().lower()
    if len(code) == 2 and code.isalpha():
        fields["language"] = code
    name = audio.filename or "speech.webm"
    files = {"file": (name, data, audio.content_type or "audio/webm")}
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            reply = await client.post(settings["base"] + "/audio/transcriptions", headers={"Authorization": "Bearer " + settings["key"]}, data=fields, files=files)
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="The speech service could not be reached.")
    if reply.status_code >= 400:
        provider_error(reply, "Speech to text")
    text = (reply.json().get("text") or "").strip()
    return {"text": text}


async def speak(body: SpeakBody, request: Request):
    user = current_user(request)
    settings = tts_settings()
    if settings is None:
        raise HTTPException(status_code=501, detail="Text to speech is not set up on this server.")
    text = body.text.strip()
    if text == "":
        raise HTTPException(status_code=400, detail="There is no text to read.")
    if len(text) > MAX_SPEECH:
        raise HTTPException(status_code=413, detail="The text is too long. Keep it under " + str(MAX_SPEECH) + " characters.")
    check_rate(user["id"])
    fmt = body.format if body.format in FORMATS else "mp3"
    voice = body.voice if body.voice in settings["voices"] else settings["voice"]
    payload = {"model": settings["model"], "input": text, "voice": voice, "response_format": fmt}
    if settings["style"] and "gpt-4o" in settings["model"]:
        payload["instructions"] = settings["style"]
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            reply = await client.post(settings["base"] + "/audio/speech", headers={"Authorization": "Bearer " + settings["key"]}, json=payload)
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="The speech service could not be reached.")
    if reply.status_code >= 400:
        provider_error(reply, "Text to speech")
    return Response(content=reply.content, media_type=FORMATS[fmt], headers={"Cache-Control": "no-store"})


def register_routes(app):
    app.add_api_route("/api/voice", info, methods=["GET"])
    app.add_api_route("/api/voice/transcribe", transcribe, methods=["POST"])
    app.add_api_route("/api/voice/speak", speak, methods=["POST"])

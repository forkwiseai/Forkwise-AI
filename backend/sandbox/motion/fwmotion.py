#!/usr/bin/env python3
"""Forkwise Motion: renders an animation project (HTML/CSS/SVG/Canvas/WebGL scenes written
by the agent) into a finished video with voices, sound, transitions and subtitles.

  python3 fwmotion.py init    <project> [--size 16:9] [--language fa]
  python3 fwmotion.py voice   <project>                    make voices, print timings
  python3 fwmotion.py still   <project> --scene 2 --at 0.5,2,4 -o still.png
  python3 fwmotion.py board   <project> -o storyboard.png    one frame of every scene
  python3 fwmotion.py render  <project> -o out.mp4 [--draft] [--scenes 1-4] [--workers 4]
  python3 fwmotion.py check   <video> -o sheet.png

Project layout:
  project.json          size, fps, language, voices, scenes, music, captions
  scenes/*.html         one page per scene; animate with FW (fw.js) or any web animation
  assets/...            images, audio, lottie files
  build/                made by this tool (voices, scene clips, cache)

Every frame is rendered from a virtual clock, so the result is exact and repeatable."""

import argparse
import asyncio
import base64
import hashlib
import json
import math
import mimetypes
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ENGINE = "fwmotion-1"
SIZES = {"16:9": (1920, 1080), "9:16": (1080, 1920), "1:1": (1080, 1080), "4:5": (1080, 1350), "4k": (3840, 2160)}
RTL = {"fa", "ar", "he", "ur", "ps", "ku"}
DEFAULT_VOICES = {
    "fa": "fa-IR-FaridNeural",
    "ar": "ar-SA-HamedNeural",
    "en": "en-US-AndrewMultilingualNeural",
    "tr": "tr-TR-AhmetNeural",
    "de": "de-DE-ConradNeural",
    "fr": "fr-FR-HenriNeural",
    "es": "es-ES-AlvaroNeural",
}
XFADE = {"fade", "fadeblack", "fadewhite", "dissolve", "wipeleft", "wiperight", "wipeup", "wipedown", "slideleft", "slideright", "slideup", "slidedown",
         "smoothleft", "smoothright", "smoothup", "smoothdown", "circleopen", "circleclose", "circlecrop", "rectcrop", "radial", "pixelize", "zoomin",
         "hblur", "distance", "diagtl", "diagtr", "diagbl", "diagbr", "hlslice", "hrslice", "vuslice", "vdslice", "squeezeh", "squeezev", "coverleft",
         "coverright", "revealleft", "revealright"}


def fail(message):
    print("ERROR: " + message, file=sys.stderr)
    sys.exit(1)


def run(command):
    done = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if done.returncode != 0:
        fail("Command failed: " + " ".join(command[:6]) + " ...\n" + done.stderr[-2500:])
    return done.stdout


def media_length(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(path)], stdout=subprocess.PIPE, text=True).stdout.strip()
    try:
        return float(out)
    except ValueError:
        return 0.0


def stamp(seconds):
    seconds = max(0, seconds)
    return "%d:%02d" % (int(seconds // 60), int(seconds % 60)) if seconds < 3600 else "%d:%02d:%02d" % (int(seconds // 3600), int(seconds // 60 % 60), int(seconds % 60))


# ------------------------------------------------------------------ project

class Project:
    def __init__(self, folder):
        self.dir = Path(folder).resolve()
        if self.dir.is_file():
            self.dir = self.dir.parent
        path = self.dir / "project.json"
        if not path.exists():
            fail("No project.json in " + str(self.dir) + ". Create one first (fwmotion.py init).")
        try:
            self.data = json.loads(path.read_text(encoding="utf-8"))
        except ValueError as problem:
            fail("project.json is not valid JSON: " + str(problem))
        d = self.data
        size = d.get("size", "16:9")
        if "width" in d and "height" in d:
            self.width, self.height = int(d["width"]), int(d["height"])
        elif size in SIZES:
            self.width, self.height = SIZES[size]
        else:
            fail("Unknown size " + str(size) + ". Use 16:9, 9:16, 1:1, 4:5, 4k or width/height.")
        self.fps = int(d.get("fps", 30))
        self.language = d.get("language", "en")
        self.scenes = d.get("scenes") or []
        if not self.scenes:
            fail("project.json has no scenes.")
        for index, scene in enumerate(self.scenes):
            if isinstance(scene, str):
                self.scenes[index] = scene = {"file": scene}
            if not scene.get("file"):
                fail("Scene " + str(index + 1) + " has no file.")
            if not (self.dir / scene["file"]).exists():
                fail("Scene " + str(index + 1) + " file not found: " + scene["file"])
        self.build = self.dir / "build"
        self.build.mkdir(exist_ok=True)

    def voice_for(self, who):
        voices = self.data.get("voices") or {}
        spec = voices.get(who) or voices.get("narrator") or {}
        if isinstance(spec, str):
            spec = {"voice": spec}
        return {
            "voice": spec.get("voice") or DEFAULT_VOICES.get(self.language, DEFAULT_VOICES["en"]),
            "rate": spec.get("rate", self.data.get("rate", "+0%")),
            "pitch": spec.get("pitch", "+0Hz"),
            "volume": float(spec.get("volume", 1.0)),
        }

    def timing(self):
        path = self.build / "timing.json"
        if path.exists():
            data = json.loads(path.read_text(encoding="utf-8"))
            if data.get("key") == self.voice_key():
                return data
        return None

    def voice_key(self):
        parts = []
        for scene in self.scenes:
            parts.append(json.dumps([scene.get("lines") or [], scene.get("duration"), scene.get("voice_start")], ensure_ascii=False, sort_keys=True))
        parts.append(json.dumps(self.data.get("voices") or {}, sort_keys=True))
        parts.append(self.language)
        return hashlib.sha1("|".join(parts).encode()).hexdigest()


# ------------------------------------------------------------------ voices

async def tts(text, spec, target):
    import edge_tts
    kwargs = {"rate": spec["rate"], "pitch": spec["pitch"]}
    try:
        talk = edge_tts.Communicate(text, spec["voice"], boundary="WordBoundary", **kwargs)
    except TypeError:
        talk = edge_tts.Communicate(text, spec["voice"], **kwargs)
    words = []
    with open(target, "wb") as handle:
        async for chunk in talk.stream():
            if chunk["type"] == "audio":
                handle.write(chunk["data"])
            elif chunk["type"] == "WordBoundary":
                start = chunk["offset"] / 10_000_000
                words.append({"text": chunk["text"], "start": round(start, 3), "end": round(start + chunk["duration"] / 10_000_000, 3)})
    return words


def estimate(text, rate):
    speed = 1.0
    match = re.match(r"([+-]\d+)%", rate or "")
    if match:
        speed = 1 + int(match.group(1)) / 100
    words = []
    at = 0.1
    for word in [w for w in re.split(r"\s+", text.strip()) if w]:
        length = max(0.18, len(word) / (13.0 * speed))
        words.append({"text": word, "start": round(at, 3), "end": round(at + length, 3)})
        at = at + length + 0.06
    return words, at + 0.15


def make_voices(project):
    folder = project.build / "voice"
    folder.mkdir(exist_ok=True)
    result = {"key": project.voice_key(), "scenes": [], "silent": False}
    missing_service = None
    for index, scene in enumerate(project.scenes):
        lines = scene.get("lines") or []
        at = float(scene.get("voice_start", 0.4))
        out = []
        for number, line in enumerate(lines):
            if isinstance(line, str):
                line = {"text": line}
            text = str(line.get("text") or "").strip()
            if not text:
                continue
            who = line.get("who") or "narrator"
            spec = project.voice_for(who)
            if line.get("rate"):
                spec["rate"] = line["rate"]
            if line.get("pitch"):
                spec["pitch"] = line["pitch"]
            key = hashlib.sha1(json.dumps([text, spec["voice"], spec["rate"], spec["pitch"]], ensure_ascii=False).encode()).hexdigest()[:16]
            audio = folder / (key + ".mp3")
            info = folder / (key + ".json")
            if audio.exists() and info.exists():
                saved = json.loads(info.read_text())
                words, length, real = saved["words"], saved["length"], saved["real"]
            else:
                real = False
                words = []
                length = 0
                if not missing_service:
                    try:
                        words = asyncio.run(tts(text, spec, audio))
                        length = media_length(audio)
                        real = length > 0
                    except Exception as problem:
                        missing_service = str(problem)[:160]
                if not real:
                    words, length = estimate(text, spec["rate"])
                    run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono", "-t", str(round(length, 2)), "-c:a", "libmp3lame", str(audio)])
                else:
                    info.write_text(json.dumps({"words": words, "length": length, "real": True}, ensure_ascii=False))
                if not words:
                    words, _ = estimate(text, spec["rate"])
            start = float(line["at"]) if line.get("at") is not None else at
            item = {
                "who": who, "text": text, "start": round(start, 3), "end": round(start + length, 3), "file": str(audio.relative_to(project.dir)),
                "volume": spec["volume"], "words": [{"text": w["text"], "start": round(start + w["start"], 3), "end": round(start + w["end"], 3)} for w in words],
            }
            out.append(item)
            at = start + length + float(line.get("pause", scene.get("pause", 0.35)))
            if not real:
                result["silent"] = True
        need = (out[-1]["end"] + float(scene.get("tail", 0.6))) if out else 0
        duration = max(float(scene.get("duration") or 0), need, 0.5)
        result["scenes"].append({"duration": round(duration, 3), "lines": out})
    if missing_service:
        result["warning"] = "The voice service was not reachable (" + missing_service + "). Lines are silent with estimated timing."
    (project.build / "timing.json").write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")
    return result


def ensure_timing(project):
    return project.timing() or make_voices(project)


# ------------------------------------------------------------------ browser

FONT_CSS = ""


def font_css():
    global FONT_CSS
    if FONT_CSS:
        return FONT_CSS
    faces = [
        ("Vazirmatn", "vazirmatn-arabic-400-normal", 400), ("Vazirmatn", "vazirmatn-arabic-700-normal", 700), ("Vazirmatn", "vazirmatn-arabic-800-normal", 800),
        ("Inter", "inter-latin-400-normal", 400), ("Inter", "inter-latin-600-normal", 600), ("Inter", "inter-latin-800-normal", 800),
        ("Lalezar", "lalezar-arabic-400-normal", 400), ("Lalezar", "lalezar-latin-400-normal", 400),
        ("Baloo Bhaijaan 2", "baloo-bhaijaan-2-arabic-500-normal", 500), ("Baloo Bhaijaan 2", "baloo-bhaijaan-2-arabic-800-normal", 800),
        ("Baloo Bhaijaan 2", "baloo-bhaijaan-2-latin-500-normal", 500), ("Baloo Bhaijaan 2", "baloo-bhaijaan-2-latin-800-normal", 800),
        ("Fredoka", "fredoka-latin-500-normal", 500), ("Fredoka", "fredoka-latin-700-normal", 700),
        ("Playfair Display", "playfair-display-latin-500-normal", 500), ("Playfair Display", "playfair-display-latin-800-normal", 800),
    ]
    css = []
    for family, name, weight in faces:
        if (HERE / "fonts" / (name + ".woff2")).exists():
            rng = "U+0600-06FF,U+0750-077F,U+08A0-08FF,U+200C-200E,U+FB50-FDFF,U+FE70-FEFF" if "arabic" in name else "U+0000-024F,U+2000-206F,U+20AC,U+2122"
            css.append("@font-face{font-family:'%s';src:url('/_fw/fonts/%s.woff2') format('woff2');font-weight:%d;font-display:block;unicode-range:%s}" % (family, name, weight, rng))
    FONT_CSS = "".join(css)
    return FONT_CSS


def init_script(project, index, scene_timing, draft):
    scene = project.scenes[index]
    data = {
        "index": index, "number": index + 1, "duration": scene_timing["duration"], "lines": scene_timing["lines"], "fps": project.fps,
        "width": project.width, "height": project.height, "language": project.language, "rtl": project.language in RTL,
        "draft": bool(draft), "data": scene.get("data") or {},
    }
    base = "html,body{margin:0;padding:0;width:%dpx;height:%dpx;overflow:hidden}body{font-family:%s;-webkit-font-smoothing:antialiased}" % (
        project.width, project.height, "Vazirmatn,Inter,sans-serif" if project.language in RTL else "Inter,Vazirmatn,sans-serif")
    style = "(function(){var s=document.createElement('style');s.textContent=%s;(document.head||document.documentElement).appendChild(s)})();" % json.dumps(font_css() + base)
    parts = ["window.FW_SCENE=" + json.dumps(data, ensure_ascii=False)] + [(HERE / name).read_text() for name in ("clock.js", "fw.js", "character.js", "scenery.js")]
    return ";\n".join(parts) + ";\ndocument.addEventListener('DOMContentLoaded',function(){" + style + "});"


async def open_browser():
    from playwright.async_api import async_playwright
    play = await async_playwright().start()
    browser = await play.chromium.launch(args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--font-render-hinting=none", "--disable-lcd-text", "--hide-scrollbars", "--autoplay-policy=no-user-gesture-required"])
    return play, browser


MEDIA_TYPES = (".mp4", ".mov", ".webm", ".mkv", ".m4v", ".avi")


def media_refs(project):
    """Video files the scenes use (found in scene files and project.json)."""
    found = {}
    texts = [(project.dir / "project.json", project.dir)]
    for scene in project.scenes:
        texts.append((project.dir / scene["file"], (project.dir / scene["file"]).parent))
    for extra in (project.dir / "assets").rglob("*.js") if (project.dir / "assets").exists() else []:
        texts.append((extra, project.dir))
    pattern = re.compile(r"""["'`(]([^"'`()\s]+\.(?:mp4|mov|webm|mkv|m4v|avi))["'`)]""", re.I)
    for path, base in texts:
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for ref in pattern.findall(text):
            ref = ref.split("?")[0]
            for candidate in ((project.dir / ref.lstrip("/")) if ref.startswith("/") else (base / ref), project.dir / ref.lstrip("./")):
                candidate = Path(os.path.abspath(candidate))
                if candidate.is_file() and project.dir in candidate.parents and "build" not in candidate.relative_to(project.dir).parts[:1]:
                    found[candidate.relative_to(project.dir).as_posix()] = candidate
                    break
    return found


def prepare_media(project):
    """Makes seek-friendly copies of the videos the scenes use, so every frame can be shown exactly."""
    proxies = {}
    folder = project.build / "proxy"
    for rel, path in media_refs(project).items():
        stat = path.stat()
        key = hashlib.sha1((rel + ":" + str(stat.st_size) + ":" + str(int(stat.st_mtime))).encode()).hexdigest()[:16]
        target = folder / (key + ".mp4")
        if not target.exists():
            folder.mkdir(parents=True, exist_ok=True)
            print("  preparing video " + rel + " ...", flush=True)
            run(["ffmpeg", "-y", "-v", "error", "-i", str(path), "-an", "-vf", "scale='min(1920,iw)':-2:flags=bicubic,format=yuv420p",
                 "-c:v", "libx264", "-preset", "veryfast", "-crf", "17", "-g", "6", "-bf", "0", "-movflags", "+faststart", str(target.with_suffix(".tmp.mp4"))])
            target.with_suffix(".tmp.mp4").replace(target)
        proxies[rel] = target
    return proxies


class FileServer:
    """Serves the project, the engine and video proxies over http://127.0.0.1 (with byte ranges for video)."""

    def __init__(self, project, proxies):
        import http.server
        from urllib.parse import unquote
        root = project.dir
        owner = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def target(self):
                path = unquote(self.path.split("?", 1)[0].split("#", 1)[0]).lstrip("/")
                if path.startswith("_fw/fonts/"):
                    return (HERE / "fonts" / path[len("_fw/fonts/"):]).resolve()
                if path.startswith("_fw/sfx/"):
                    return (HERE / "sfx" / path[len("_fw/sfx/"):]).resolve()
                if path.startswith("_fw/"):
                    name = path[len("_fw/"):]
                    return (HERE / name) if name in ("fw.js", "character.js", "scenery.js", "clock.js") else (HERE / "lib" / name).resolve()
                if path in proxies:
                    return proxies[path]
                found = Path(os.path.abspath(root / path))
                if found != root and root not in found.parents:
                    return None
                return found

            def do_GET(self):
                target = self.target()
                if not target or not target.is_file():
                    self.send_response(404)
                    self.end_headers()
                    return
                size = target.stat().st_size
                kind = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
                if target.suffix in (".js", ".mjs"):
                    kind = "text/javascript"
                start, end = 0, size - 1
                header = self.headers.get("Range")
                if header and header.startswith("bytes="):
                    a, _, b = header[6:].split(",")[0].partition("-")
                    start = int(a) if a else max(0, size - int(b))
                    end = int(b) if a and b else size - 1
                    self.send_response(206)
                    self.send_header("Content-Range", "bytes %d-%d/%d" % (start, end, size))
                else:
                    self.send_response(200)
                self.send_header("Content-Type", kind)
                self.send_header("Accept-Ranges", "bytes")
                self.send_header("Content-Length", str(end - start + 1))
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                try:
                    with open(target, "rb") as handle:
                        handle.seek(start)
                        left = end - start + 1
                        while left > 0:
                            chunk = handle.read(min(1 << 20, left))
                            if not chunk:
                                break
                            self.wfile.write(chunk)
                            left -= len(chunk)
                except (BrokenPipeError, ConnectionResetError):
                    pass

        import threading
        self.httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.httpd.daemon_threads = True
        self.base = "http://127.0.0.1:%d/" % self.httpd.server_address[1]
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def close(self):
        self.httpd.shutdown()


async def open_scene(browser, project, index, timing, draft, scale=1.0, server=None):
    scene_timing = timing["scenes"][index]
    context = await browser.new_context(viewport={"width": project.width, "height": project.height}, device_scale_factor=scale)
    base = server.base
    errors = []
    page = await context.new_page()
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("console", lambda message: errors.append("console: " + message.text) if message.type == "error" else None)
    page.on("requestfailed", lambda request: None if "ABORTED" in str(request.failure or "") else errors.append("failed to load " + request.url.replace(base, "") + " (" + str(request.failure) + ")"))
    page.on("response", lambda response: errors.append("missing file " + response.url.replace(base, "")) if response.status == 404 else None)
    await page.add_init_script(init_script(project, index, scene_timing, draft))
    await page.goto(base + project.scenes[index]["file"], wait_until="load", timeout=60000)
    try:
        await asyncio.wait_for(page.evaluate("Promise.all([document.fonts.ready, window.FW ? FW.__ready() : null])"), 30)
        await page.wait_for_timeout(30)
    except Exception as problem:
        errors.append("while loading: " + str(problem)[:300])
    duration = scene_timing["duration"]
    try:
        declared = await page.evaluate("window.FW && FW.scene.durationSet ? FW.duration : 0")
        if declared and declared > duration:
            duration = float(declared)
    except Exception:
        pass
    return context, page, errors, duration


async def seek(page, seconds):
    await page.evaluate("t => window.__fwClock.seek(t)", seconds * 1000.0)


async def grab(page, cdp, quality, fmt="jpeg"):
    shot = await cdp.send("Page.captureScreenshot", {"format": fmt, "quality": quality, "optimizeForSpeed": True} if fmt == "jpeg" else {"format": fmt})
    return base64.b64decode(shot["data"])


# ------------------------------------------------------------------ cache

def assets_signature(project):
    items = []
    for path in sorted(project.dir.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(project.dir)
        if rel.parts[0] in ("build", "out") or rel.suffix in (".mp4",) and rel.parts[0] != "assets":
            continue
        if rel.parts[0] == "scenes" or rel.name == "project.json":
            continue
        stat = path.stat()
        with open(path, "rb") as handle:
            head = handle.read(65536)
        items.append(str(rel) + ":" + str(stat.st_size) + ":" + hashlib.sha1(head).hexdigest()[:10])
    return hashlib.sha1("\n".join(items).encode()).hexdigest()


def scene_key(project, index, timing, draft, assets):
    scene = project.scenes[index]
    engine = "".join((HERE / name).read_text() for name in ("clock.js", "fw.js", "character.js", "scenery.js"))
    parts = [ENGINE, hashlib.sha1(engine.encode()).hexdigest(), (project.dir / scene["file"]).read_text(encoding="utf-8", errors="replace"),
             json.dumps(scene, ensure_ascii=False, sort_keys=True), json.dumps(timing["scenes"][index], ensure_ascii=False, sort_keys=True),
             str(project.width), str(project.height), str(project.fps), str(bool(draft)), assets, project.language]
    return hashlib.sha1("\n".join(parts).encode()).hexdigest()[:20]


# ------------------------------------------------------------------ render

async def render_one(browser, project, index, timing, draft, target, progress, server):
    scale = 0.5 if draft else 1.0
    fps = max(10, project.fps // 2) if draft else project.fps
    context, page, errors, duration = await open_scene(browser, project, index, timing, draft, scale, server)
    frames = max(1, int(round(duration * fps)))
    width, height = int(project.width * scale) // 2 * 2, int(project.height * scale) // 2 * 2
    temp = target.with_suffix(".part.mp4")
    encoder = subprocess.Popen([
        "ffmpeg", "-y", "-v", "error", "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", str(fps), "-i", "-",
        "-vf", "scale=%d:%d:flags=lanczos,format=yuv420p" % (width, height), "-r", str(fps),
        "-c:v", "libx264", "-preset", "veryfast" if draft else "medium", "-crf", "26" if draft else "17", "-pix_fmt", "yuv420p", str(temp),
    ], stdin=subprocess.PIPE)
    cdp = await context.new_cdp_session(page)
    quality = 80 if draft else 94
    try:
        for frame in range(frames):
            await seek(page, frame / fps)
            if frame == 0:
                errors.extend(await page.evaluate("window.__fwClock.errors()"))
            encoder.stdin.write(await grab(page, cdp, quality))
            if frame % (fps * 2) == 0:
                progress(index, frame, frames)
        errors.extend(await page.evaluate("window.__fwClock.errors()"))
        audio = await page.evaluate("window.FW ? FW.__audio : []")
    finally:
        encoder.stdin.close()
        encoder.wait()
        await context.close()
    if encoder.returncode != 0 or not temp.exists():
        raise RuntimeError("Encoding scene " + str(index + 1) + " failed")
    temp.replace(target)
    return {"index": index, "frames": frames, "fps": fps, "duration": frames / fps, "errors": dedupe(errors), "audio": clean_audio(project, index, audio)}


def clean_audio(project, index, items):
    """Audio of video clips placed in a scene (from FW.clip): resolve paths against the project."""
    out = []
    scene_dir = (project.dir / project.scenes[index]["file"]).parent
    for item in items or []:
        src = str(item.get("src") or "").split("?")[0]
        path = Path(os.path.abspath((project.dir / src.lstrip("/")) if src.startswith("/") else (scene_dir / src)))
        if not path.is_file():
            path = Path(os.path.abspath(project.dir / src))
        if not path.is_file() or project.dir not in path.parents:
            continue
        out.append({"file": path.relative_to(project.dir).as_posix(), "from": float(item.get("from") or 0), "to": item.get("to"),
                    "at": float(item.get("at") or 0), "speed": float(item.get("speed") or 1), "volume": float(item.get("volume", 1)),
                    "clean": bool(item.get("clean")), "captions": item.get("captions", True) is not False})
    return out


def dedupe(errors):
    seen = []
    for item in errors:
        if item and item not in seen:
            seen.append(item)
    return seen[:12]


def parse_range(text, count):
    if not text:
        return list(range(count))
    picked = set()
    for part in str(text).split(","):
        if "-" in part:
            a, b = part.split("-", 1)
            picked.update(range(int(a) - 1, int(b)))
        elif part.strip():
            picked.add(int(part) - 1)
    return sorted(i for i in picked if 0 <= i < count)


async def render_scenes(project, timing, draft, indexes, workers):
    folder = project.build / ("draft" if draft else "scenes")
    folder.mkdir(exist_ok=True)
    assets = assets_signature(project)
    jobs = []
    results = {}
    for index in indexes:
        key = scene_key(project, index, timing, draft, assets)
        target = folder / ("%03d-%s.mp4" % (index + 1, key))
        meta = target.with_suffix(".json")
        if target.exists() and meta.exists():
            results[index] = json.loads(meta.read_text())
            results[index]["file"] = str(target)
            results[index]["cached"] = True
        else:
            jobs.append((index, target, meta))
    if jobs:
        server = FileServer(project, prepare_media(project))
        play, browser = await open_browser()
        limit = asyncio.Semaphore(max(1, workers))
        started = time.time()
        printed = {}

        def progress(index, frame, frames):
            now = time.time()
            if now - printed.get("at", 0) > 5:
                printed["at"] = now
                print("  scene %d: %d/%d frames (%.0fs)" % (index + 1, frame, frames, now - started), flush=True)

        async def job(index, target, meta):
            async with limit:
                info = await render_one(browser, project, index, timing, draft, target, progress, server)
                meta.write_text(json.dumps(info, ensure_ascii=False))
                info["file"] = str(target)
                results[index] = info
                print("  scene %d done (%.1fs of video)%s" % (index + 1, info["duration"], " with errors" if info["errors"] else ""), flush=True)

        try:
            await asyncio.gather(*[job(*item) for item in jobs])
        finally:
            await browser.close()
            await play.stop()
            server.close()
    return results


def caption_chunks(words, max_words, max_chars):
    chunks, current = [], []
    for word in words:
        text = " ".join(w["text"] for w in current + [word])
        if current and (len(current) >= max_words or len(text) > max_chars or word["start"] - current[-1]["end"] > 0.6 or re.search(r"[.!?؟،,:;]$", current[-1]["text"])):
            chunks.append(current)
            current = []
        current.append(word)
    if current:
        chunks.append(current)
    return chunks


def ass_time(seconds):
    cs = int(round(max(0, seconds) * 100))
    return "%d:%02d:%02d.%02d" % (cs // 360000, cs // 6000 % 60, cs // 100 % 60, cs % 100)


def ass_color(hex_color, alpha=0):
    h = hex_color.lstrip("#")
    if len(h) == 3:
        h = "".join(c + c for c in h)
    return "&H%02X%s%s%s" % (alpha, h[4:6], h[2:4], h[0:2])


def write_captions(project, timeline, out_ass, out_srt):
    settings = project.data.get("captions", {})
    if settings is False or (isinstance(settings, dict) and settings.get("enabled") is False):
        return None
    if not isinstance(settings, dict):
        settings = {}
    vertical = project.height > project.width
    style = settings.get("style", "pop")
    accent = settings.get("accent", "#ffd400")
    color = settings.get("color", "#ffffff")
    size = int(settings.get("size", min(project.width, project.height) * (0.068 if vertical else 0.058)))
    margin = int(settings.get("margin", project.height * (0.2 if vertical else 0.075)))
    max_words = int(settings.get("words", 3 if vertical else 5))
    max_chars = int(settings.get("chars", 22 if vertical else 38))
    font = "Vazirmatn Black" if style != "clean" else "Vazirmatn"
    border = 3 if style == "box" else 1
    outline = 0 if style == "box" else max(3, size // 14)
    back = ass_color("#000000", 0x55) if style == "box" else ass_color("#000000", 0x80)
    header = "\n".join([
        "[Script Info]", "ScriptType: v4.00+", "PlayResX: %d" % project.width, "PlayResY: %d" % project.height, "WrapStyle: 2", "ScaledBorderAndShadow: yes", "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        "Style: Cap,%s,%d,%s,%s,%s,%s,0,0,0,0,100,100,0,0,%d,%d,%d,2,60,60,%d,-1" % (font, size, ass_color(color), ass_color(accent), ass_color("#000000"), back, border, outline, 0 if style == "box" else 2, margin),
        "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ])
    events, srt = [], []

    def clean(text):
        return text.replace("\\", "").replace("{", "(").replace("}", ")")

    number = 0
    for words in timeline:
        for chunk in caption_chunks(words, max_words, max_chars):
            number += 1
            start, end = chunk[0]["start"], chunk[-1]["end"] + 0.12
            srt.append("%d\n%s --> %s\n%s\n" % (number, srt_time(start), srt_time(end), " ".join(w["text"] for w in chunk)))
            if style in ("clean", "box"):
                events.append("Dialogue: 0,%s,%s,Cap,,0,0,0,,%s" % (ass_time(start), ass_time(end), clean(" ".join(w["text"] for w in chunk))))
                continue
            for i, word in enumerate(chunk):
                a = word["start"] if i else start
                b = chunk[i + 1]["start"] if i + 1 < len(chunk) else end
                parts = []
                for j, other in enumerate(chunk):
                    if j == i:
                        parts.append("{\\c%s\\fscx108\\fscy108}%s{\\c%s\\fscx100\\fscy100}" % (ass_color(accent), clean(other["text"]), ass_color(color)))
                    else:
                        parts.append(clean(other["text"]))
                pop = "{\\fad(60,0)}" if i == 0 else ""
                events.append("Dialogue: 0,%s,%s,Cap,,0,0,0,,%s%s" % (ass_time(a), ass_time(b), pop, " ".join(parts)))
    if not events:
        return None
    out_ass.write_text(header + "\n" + "\n".join(events) + "\n", encoding="utf-8")
    out_srt.write_text("\n".join(srt), encoding="utf-8")
    return out_ass


def srt_time(seconds):
    ms = int(round(max(0, seconds) * 1000))
    return "%02d:%02d:%02d,%03d" % (ms // 3600000, ms // 60000 % 60, ms // 1000 % 60, ms % 1000)


def mix_audio(project, clips, music, total, target):
    """clips: [(file, start, volume)], music: [{file, start, end, volume, fade_in, fade_out, duck}]"""
    if not clips and not music:
        run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", str(round(total, 3)), "-c:a", "aac", str(target)])
        return target
    inputs, filters, voice_labels, sfx_labels = [], [], [], []
    for index, clip in enumerate(clips):
        file, start, volume, kind = clip[:4]
        extra = clip[4] if len(clip) > 4 else {}
        if extra.get("from") is not None or extra.get("to") is not None:
            seek_args = ["-ss", "%.3f" % float(extra.get("from") or 0)]
            if extra.get("to") is not None:
                seek_args += ["-to", "%.3f" % float(extra["to"])]
            inputs += seek_args + ["-i", str(file)]
        else:
            inputs += ["-i", str(file)]
        delay = int(max(0, start) * 1000)
        label = ("v" if kind in ("voice", "speech") else "s") + str(index)
        chain = "aresample=48000,aformat=channel_layouts=stereo"
        speed = float(extra.get("speed") or 1)
        while speed > 2.0:
            chain += ",atempo=2.0"
            speed /= 2.0
        while speed < 0.5:
            chain += ",atempo=0.5"
            speed /= 0.5
        if abs(speed - 1) > 0.001:
            chain += ",atempo=%.4f" % speed
        if extra.get("clean"):
            chain += ",highpass=f=80,afftdn=nf=-25,acompressor=threshold=0.08:ratio=3:attack=10:release=200,equalizer=f=3000:t=q:w=1.2:g=2"
        if extra.get("fade", True) and kind == "speech":
            chain += ",afade=t=in:d=0.015"
        filters.append("[%d:a]%s,volume=%.3f,adelay=%d|%d[%s]" % (index, chain, volume, delay, delay, label))
        (voice_labels if kind in ("voice", "speech") else sfx_labels).append("[" + label + "]")
    music_labels = []
    for number, item in enumerate(music):
        index = len(clips) + number
        path = (project.dir / item["file"]).resolve()
        if not path.exists():
            fail("Music file not found: " + item["file"])
        inputs += ["-stream_loop", "-1", "-i", str(path)]
        start = float(item.get("start", 0))
        end = float(item.get("end", total))
        length = max(0.1, min(total, end) - start)
        fade_in = float(item.get("fade_in", 1.0))
        fade_out = float(item.get("fade_out", 2.0))
        delay = int(start * 1000)
        filters.append("[%d:a]aresample=48000,aformat=channel_layouts=stereo,atrim=0:%.3f,volume=%.3f,afade=t=in:st=0:d=%.2f,afade=t=out:st=%.3f:d=%.2f,adelay=%d|%d[m%d]" % (
            index, length, float(item.get("volume", 0.22)), fade_in, max(0, length - fade_out), fade_out, delay, delay, number))
        music_labels.append("[m%d]" % number)
    last = []
    if voice_labels:
        filters.append("".join(voice_labels) + "amix=inputs=%d:normalize=0,apad,atrim=0:%.3f[voice]" % (len(voice_labels), total))
    if music_labels:
        filters.append("".join(music_labels) + "amix=inputs=%d:normalize=0,apad,atrim=0:%.3f[music]" % (len(music_labels), total))
        if voice_labels and project.data.get("duck", True) is not False:
            filters.append("[voice]asplit=2[voice1][key]")
            filters.append("[music][key]sidechaincompress=threshold=0.025:ratio=10:attack=15:release=450[ducked]")
            last += ["[voice1]", "[ducked]"]
        else:
            if voice_labels:
                last.append("[voice]")
            last.append("[music]")
    elif voice_labels:
        last.append("[voice]")
    last += sfx_labels
    if len(last) > 1:
        filters.append("".join(last) + "amix=inputs=%d:normalize=0,apad,atrim=0:%.3f[mix]" % (len(last), total))
    else:
        filters.append(last[0] + "apad,atrim=0:%.3f[mix]" % total)
    filters.append("[mix]loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[out]")
    script = target.with_suffix(".filter")
    script.write_text(";".join(filters))
    run(["ffmpeg", "-y", "-v", "error"] + inputs + ["-filter_complex_script", str(script), "-map", "[out]", "-c:a", "aac", "-b:a", "192k", str(target)])
    return target


def assemble(project, timing, results, indexes, draft, output):
    fps = max(10, project.fps // 2) if draft else project.fps
    default = project.data.get("transition", {"type": "fade", "duration": 0.4})
    starts, length = [], 0.0
    plan = []
    for position, index in enumerate(indexes):
        info = results[index]
        scene = project.scenes[index]
        trans = scene.get("transition", default) if position > 0 else {"type": "cut"}
        if isinstance(trans, str):
            trans = {"type": trans}
        kind = trans.get("type", "fade")
        dur = float(trans.get("duration", 0.4)) if kind != "cut" else 0.0
        dur = min(dur, info["duration"] * 0.45, (plan[-1]["duration"] * 0.45) if plan else 0)
        if kind != "cut" and kind not in XFADE:
            kind = "fade"
        start = length - dur
        plan.append({"index": index, "file": info["file"], "duration": info["duration"], "type": kind, "trans": dur, "start": start})
        length = start + info["duration"]
    total = length
    work = project.build / "assemble"
    work.mkdir(exist_ok=True)
    # video chain
    inputs, filters = [], []
    for number, item in enumerate(plan):
        inputs += ["-i", item["file"]]
        filters.append("[%d:v]settb=AVTB,fps=%d,format=yuv420p[s%d]" % (number, fps, number))
    current, cur_len = "[s0]", plan[0]["duration"]
    for number, item in enumerate(plan[1:], 1):
        label = "[c%d]" % number
        if item["type"] == "cut" or item["trans"] <= 0:
            filters.append("%s[s%d]concat=n=2:v=1:a=0%s" % (current, number, label))
            cur_len = cur_len + item["duration"]
        else:
            filters.append("%s[s%d]xfade=transition=%s:duration=%.3f:offset=%.3f%s" % (current, number, item["type"], item["trans"], cur_len - item["trans"], label))
            cur_len = cur_len + item["duration"] - item["trans"]
        current = label
    # captions and audio
    timeline, clips = [], []
    for item in plan:
        scene_t = timing["scenes"][item["index"]]
        for line in scene_t["lines"]:
            clips.append((project.dir / line["file"], item["start"] + line["start"], float(line.get("volume", 1.0)), "voice"))
            if project.scenes[item["index"]].get("captions", True) is not False:
                timeline.append([{"text": w["text"], "start": item["start"] + w["start"], "end": item["start"] + w["end"]} for w in line["words"]])
        for sound in results[item["index"]].get("audio") or []:
            path = project.dir / sound["file"]
            if not has_audio(path):
                continue
            clips.append((path, item["start"] + sound["at"], sound["volume"], "speech", sound))
            if sound.get("captions") and project.scenes[item["index"]].get("captions", True) is not False:
                words = transcript_words(project, path)
                if words:
                    a, b = sound["from"], sound["to"] if sound["to"] is not None else 1e9
                    mapped = [{"text": w["text"], "start": item["start"] + sound["at"] + (w["start"] - a) / sound["speed"], "end": item["start"] + sound["at"] + (w["end"] - a) / sound["speed"]}
                              for w in words if w["start"] >= a - 0.02 and w["end"] <= b + 0.05]
                    if mapped:
                        timeline.append(mapped)
        for sfx in project.scenes[item["index"]].get("sfx") or []:
            name = str(sfx.get("file") or "")
            path = (HERE / "sfx" / (name[3:] + ".mp3")) if name.startswith("fw:") else (project.dir / name).resolve()
            if path.exists():
                clips.append((path, item["start"] + float(sfx.get("at", 0)), float(sfx.get("volume", 0.8)), "sfx"))
            else:
                print("WARNING: sound effect not found: " + sfx["file"])
    music = []
    for entry in project.data.get("music") or []:
        if isinstance(entry, str):
            entry = {"file": entry}
        entry = dict(entry)
        for key in ("start", "end"):
            ref = entry.get(key + "_scene")
            if ref is not None:
                position = [p for p in plan if p["index"] == int(ref) - 1]
                if position:
                    entry[key] = position[0]["start"] + (position[0]["duration"] if key == "end" else 0)
        music.append(entry)
    ass = write_captions(project, timeline, work / "captions.ass", output.with_suffix(".srt"))
    post = current
    if ass:
        fonts = HERE / "fonts"
        filters.append("%ssubtitles=filename=%s:fontsdir=%s[cap]" % (current, str(ass).replace(":", "\\:"), str(fonts).replace(":", "\\:")))
        post = "[cap]"
    audio = mix_audio(project, clips, music, total, work / "audio.m4a")
    # chapters
    chapters = [(p["start"], project.scenes[p["index"]]["chapter"]) for p in plan if project.scenes[p["index"]].get("chapter")]
    meta_args = []
    if chapters:
        if chapters[0][0] > 0.5:
            chapters.insert(0, (0.0, project.data.get("title") or "Intro"))
        meta = [";FFMETADATA1", "title=" + str(project.data.get("title", ""))]
        for number, (start, title) in enumerate(chapters):
            end = chapters[number + 1][0] if number + 1 < len(chapters) else total
            meta += ["[CHAPTER]", "TIMEBASE=1/1000", "START=%d" % int(start * 1000), "END=%d" % int(end * 1000), "title=" + str(title)]
        (work / "chapters.meta").write_text("\n".join(meta) + "\n", encoding="utf-8")
        output.with_name(output.stem + "-chapters.txt").write_text("\n".join(stamp(s if n else 0) + " " + t for n, (s, t) in enumerate(chapters)) + "\n", encoding="utf-8")
        meta_args = ["-i", str(work / "chapters.meta"), "-map_metadata", str(len(plan) + 1), "-map_chapters", str(len(plan) + 1)]
    script = work / "video.filter"
    script.write_text(";".join(filters))
    command = ["ffmpeg", "-y", "-v", "error"] + inputs + ["-i", str(audio)] + meta_args + [
        "-filter_complex_script", str(script), "-map", post, "-map", "%d:a" % len(plan),
        "-c:v", "libx264", "-preset", "veryfast" if draft else ("slow" if total < 300 else "medium"), "-crf", "26" if draft else "18", "-pix_fmt", "yuv420p", "-r", str(fps),
        "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-t", "%.3f" % total, str(output)]
    run(command)
    return plan, total, bool(ass), chapters


_audio_cache = {}


def has_audio(path):
    key = str(path)
    if key not in _audio_cache:
        out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", str(path)], stdout=subprocess.PIPE, text=True).stdout.strip()
        _audio_cache[key] = bool(out)
    return _audio_cache[key]


def media_key(path):
    stat = Path(path).stat()
    return hashlib.sha1((Path(path).name + ":" + str(stat.st_size)).encode()).hexdigest()[:12]


def transcript_path(project, path):
    return project.build / "transcripts" / (Path(path).stem + "-" + media_key(path) + ".json")


def transcript_words(project, path):
    target = transcript_path(project, path)
    if not target.exists():
        return []
    data = json.loads(target.read_text(encoding="utf-8"))
    return data.get("words") or []


def zip_source(project, output):
    import zipfile
    target = output.with_name(output.stem + "-source.zip")
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(project.dir.rglob("*")):
            rel = path.relative_to(project.dir)
            if not path.is_file() or rel.parts[0] in ("build", "out") or path.resolve() == output.resolve() or path.suffix == ".zip":
                continue
            archive.write(path, str(Path(project.dir.name) / rel))
        archive.writestr(project.dir.name + "/README.txt", README_SOURCE)
    return target


README_SOURCE = """This is the full source of the video, made with Forkwise Motion.

project.json  - size, fps, voices, the list of scenes, music and caption settings
scenes/       - one HTML page per scene (HTML, CSS, SVG, canvas or WebGL). Open one in a browser to see it.
assets/       - images, sounds and other files used by the scenes

To change the video, edit these files and ask Forkwise to render it again.
"""


def command_render(args):
    project = Project(args.project)
    started = time.time()
    timing = ensure_timing(project)
    if timing.get("warning"):
        print("WARNING: " + timing["warning"])
    indexes = parse_range(args.scenes, len(project.scenes))
    print("Rendering %d scene(s) at %dx%d, %d fps%s..." % (len(indexes), project.width, project.height, project.fps, " (draft: half size, half fps)" if args.draft else ""), flush=True)
    results = asyncio.run(render_scenes(project, timing, args.draft, indexes, args.workers))
    output = Path(args.output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    plan, total, captions, chapters = assemble(project, timing, results, indexes, args.draft, output)
    print("Done: %s (%s, %.1f s) in %.0f s" % (output, stamp(total), total, time.time() - started))
    problems = 0
    for item in plan:
        info = results[item["index"]]
        line = "  %2d. %-34s %6.2fs at %s%s" % (item["index"] + 1, project.scenes[item["index"]]["file"][-34:], item["duration"], stamp(item["start"]), "  (cached)" if info.get("cached") else "")
        print(line)
        for error in info.get("errors") or []:
            problems += 1
            print("      ERROR: " + error[:400])
    if captions:
        print("Subtitles: burned in, also saved as " + output.with_suffix(".srt").name)
    if chapters:
        print("Chapters: " + output.with_name(output.stem + "-chapters.txt").name)
    if not args.draft:
        print("Source: " + zip_source(project, output).name)
    if timing.get("silent"):
        print("WARNING: some voice lines are silent (voice service not reachable).")
    if problems:
        print("There were %d page error(s). Fix them in the scene files and render again." % problems)


def command_scenes(args):
    """Lists or renders scene clips without assembling (used to spread work over cloud machines)."""
    project = Project(args.project)
    timing = ensure_timing(project)
    indexes = parse_range(args.scenes, len(project.scenes))
    folder = project.build / ("draft" if args.draft else "scenes")
    folder.mkdir(exist_ok=True)
    if args.list:
        assets = assets_signature(project)
        out = []
        for index in indexes:
            key = scene_key(project, index, timing, args.draft, assets)
            name = "%03d-%s.mp4" % (index + 1, key)
            out.append({"index": index, "key": key, "file": str((folder / name).relative_to(project.dir)), "cached": (folder / name).exists() and (folder / name).with_suffix(".json").exists()})
        print(json.dumps(out))
        return
    asyncio.run(render_scenes(project, timing, args.draft, indexes, args.workers))


FILLERS = {"um", "uh", "umm", "uhh", "uhm", "erm", "er", "ah", "ahh", "hmm", "mm", "mhm", "eh"}


def find_media(project, name):
    for candidate in (project.dir / name, Path(name)):
        if candidate.is_file():
            return candidate.resolve()
    fail("Media file not found: " + name)


def command_transcribe(args):
    project = Project(args.project)
    path = find_media(project, args.media)
    target = transcript_path(project, path)
    if target.exists() and not args.force:
        data = json.loads(target.read_text(encoding="utf-8"))
    else:
        try:
            from faster_whisper import WhisperModel
        except ImportError:
            fail("Speech recognition is not installed here. Transcription runs on the cloud renderer.")
        print("Transcribing %s with the %s model..." % (path.name, args.model), flush=True)
        model = WhisperModel(args.model, device="cpu", compute_type="int8", cpu_threads=os.cpu_count() or 4)
        segments, info = model.transcribe(str(path), language=args.language or None, word_timestamps=True, vad_filter=True, beam_size=5)
        words, segs = [], []
        for seg in segments:
            segs.append({"start": round(seg.start, 3), "end": round(seg.end, 3), "text": seg.text.strip()})
            for w in seg.words or []:
                text = w.word.strip()
                if text:
                    words.append({"text": text, "start": round(w.start, 3), "end": round(w.end, 3), "p": round(w.probability, 2)})
        data = {"file": path.relative_to(project.dir).as_posix() if project.dir in path.parents else str(path), "language": info.language,
                "duration": round(info.duration, 3), "words": words, "segments": segs}
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    print("Transcript of %s: language %s, %s, %d words. Saved to %s" % (path.name, data["language"], stamp(data["duration"]), len(data["words"]), target.relative_to(project.dir)))
    for seg in data["segments"]:
        print("[%7.2f-%7.2f] %s" % (seg["start"], seg["end"], seg["text"]))


def command_cuts(args):
    project = Project(args.project)
    path = find_media(project, args.media)
    words = transcript_words(project, path)
    if not words:
        fail("No transcript for " + args.media + " yet. Run transcribe first.")
    ranges, current = [], None
    for w in words:
        plain = re.sub(r"[^\w']", "", w["text"].lower())
        if args.fillers and plain in FILLERS:
            continue
        if current and w["start"] - current["to"] <= args.gap:
            current["to"] = w["end"]
            current["text"] += " " + w["text"]
        else:
            if current:
                ranges.append(current)
            current = {"from": w["start"], "to": w["end"], "text": w["text"]}
    if current:
        ranges.append(current)
    for i, r in enumerate(ranges):
        r["from"] = round(max(0, r["from"] - args.pad, ranges[i - 1]["to"] if i else 0), 3)
        r["to"] = round(r["to"] + args.pad, 3)
    kept = sum(r["to"] - r["from"] for r in ranges)
    total = words[-1]["end"]
    print(json.dumps(ranges, ensure_ascii=False))
    print("Kept %s of %s in %d pieces (gaps over %.2f s%s removed)." % (stamp(kept), stamp(total), len(ranges), args.gap, " and filler words" if args.fillers else ""))


def command_proxies(args):
    project = Project(args.project)
    made = prepare_media(project)
    print(json.dumps({rel: path.name for rel, path in made.items()}))


def command_beats(args):
    """Beat times of a music track, to cut and animate on the beat."""
    import numpy as np
    project = Project(args.project)
    path = find_media(project, args.media)
    rate = 22050
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(path), "-ac", "1", "-ar", str(rate), "-f", "f32le", "-"], stdout=subprocess.PIPE).stdout
    signal = np.frombuffer(raw, dtype=np.float32)
    if signal.size < rate:
        fail("Could not read audio from " + args.media)
    hop, size = 512, 2048
    frames = 1 + (signal.size - size) // hop
    window = np.hanning(size).astype(np.float32)
    spectra = np.abs(np.fft.rfft(np.lib.stride_tricks.sliding_window_view(signal, size)[::hop][:frames] * window, axis=1))
    flux = np.maximum(0, np.diff(np.log1p(spectra), axis=0)).sum(axis=1)
    flux = (flux - flux.mean()) / (flux.std() + 1e-9)
    fps = rate / hop
    # tempo from autocorrelation between 70 and 180 BPM
    ac = np.correlate(flux, flux, mode="full")[flux.size - 1:]
    lags = np.arange(ac.size)
    lo, hi = int(fps * 60 / 180), int(fps * 60 / 70)
    lag = lo + int(np.argmax(ac[lo:hi]))
    a, b, c = ac[lag - 1], ac[lag], ac[lag + 1]
    exact = lag + (0.5 * (a - c) / (a - 2 * b + c) if (a - 2 * b + c) != 0 else 0)
    bpm = 60 * fps / exact
    # beat phase: the offset with the strongest onsets on the grid
    best, phase = -1, 0
    for offset in range(lag):
        score = flux[offset::lag].sum()
        if score > best:
            best, phase = score, offset
    beats = [round((phase + i * exact) / fps, 3) for i in range(int((flux.size - phase) / exact) + 1)]
    strong = [round(i / fps, 3) for i in range(1, flux.size - 1) if flux[i] > 2.0 and flux[i] >= flux[i - 1] and flux[i] >= flux[i + 1]]
    print("Tempo about %.1f BPM, %d beats over %s." % (bpm, len(beats), stamp(signal.size / rate)))
    print("beats: " + json.dumps(beats[:400]))
    print("accents (strong hits): " + json.dumps(strong[:200]))


def command_voice(args):
    project = Project(args.project)
    timing = make_voices(project)
    if timing.get("warning"):
        print("WARNING: " + timing["warning"])
    total = 0
    for index, scene in enumerate(timing["scenes"]):
        print("Scene %d (%s): %.2f s" % (index + 1, project.scenes[index]["file"], scene["duration"]))
        for line in scene["lines"]:
            print("   %5.2f-%5.2f  %s: %s" % (line["start"], line["end"], line["who"], line["text"][:90]))
        total += scene["duration"]
    print("Total about %s before transitions. Timings are in build/timing.json and in FW.lines inside each scene." % stamp(total))


async def capture(project, timing, items, draft=False):
    """items: [(scene index, [times])] -> [(scene index, time, png bytes, errors)]"""
    server = FileServer(project, prepare_media(project))
    play, browser = await open_browser()
    out = []
    try:
        for index, times in items:
            context, page, errors, duration = await open_scene(browser, project, index, timing, draft, 0.5, server)
            cdp = await context.new_cdp_session(page)
            step = 1.0 / project.fps
            t = 0.0
            for want in sorted(min(x, max(0, duration - step)) for x in times):
                while t + step < want:
                    t += step
                    await seek(page, t)
                await seek(page, want)
                t = want
                out.append((index, want, await grab(page, cdp, 88), errors))
            errors.extend(await page.evaluate("window.__fwClock.errors()"))
            await context.close()
    finally:
        await browser.close()
        await play.stop()
        server.close()
    return out


def contact_sheet(shots, output, columns, labels):
    from PIL import Image, ImageDraw
    import io
    Path(output).parent.mkdir(parents=True, exist_ok=True)
    images = [Image.open(io.BytesIO(data)).convert("RGB") for (_, _, data, _) in shots]
    w, h = images[0].size
    scale = min(1.0, 2400 / (w * columns))
    tw, th = int(w * scale), int(h * scale)
    rows = math.ceil(len(images) / columns)
    sheet = Image.new("RGB", (columns * tw + (columns + 1) * 8, rows * (th + 30) + 8), (24, 24, 28))
    draw = ImageDraw.Draw(sheet)
    for number, image in enumerate(images):
        x = 8 + (number % columns) * (tw + 8)
        y = 8 + (number // columns) * (th + 30)
        sheet.paste(image.resize((tw, th)), (x, y))
        draw.text((x + 4, y + th + 6), labels[number], fill=(230, 230, 235))
    sheet.save(output)


def command_still(args):
    project = Project(args.project)
    timing = ensure_timing(project)
    index = int(args.scene) - 1
    if index < 0 or index >= len(project.scenes):
        fail("There is no scene " + str(args.scene))
    duration = timing["scenes"][index]["duration"]
    times = [float(x) for x in args.at.split(",")] if args.at else [round(duration * p, 2) for p in (0.05, 0.3, 0.55, 0.8, 0.98)]
    shots = asyncio.run(capture(project, timing, [(index, times)]))
    contact_sheet(shots, args.output, min(len(shots), 3 if project.height > project.width else 2) if len(shots) > 1 else 1, ["scene %d  t=%.2fs" % (index + 1, t) for (_, t, _, _) in shots])
    print("Saved %s (%d frame(s) of scene %d, %.2f s long)" % (args.output, len(shots), index + 1, duration))
    errors = dedupe(shots[0][3]) if shots else []
    for error in errors:
        print("ERROR in scene: " + error[:400])


def command_board(args):
    project = Project(args.project)
    timing = ensure_timing(project)
    items = [(i, [round(timing["scenes"][i]["duration"] * 0.55, 2)]) for i in range(len(project.scenes))]
    shots = asyncio.run(capture(project, timing, items))
    labels = []
    for (index, t, _, _) in shots:
        line = timing["scenes"][index]["lines"][0]["text"] if timing["scenes"][index]["lines"] else project.scenes[index].get("note", "")
        labels.append("%d. %.1fs  %s" % (index + 1, timing["scenes"][index]["duration"], re.sub(r"[^\x20-\x7e]", "", line)[:40]))
    contact_sheet(shots, args.output, 4 if project.height <= project.width else 6, labels)
    total = sum(s["duration"] for s in timing["scenes"])
    print("Storyboard saved to %s: %d scenes, about %s" % (args.output, len(shots), stamp(total)))
    for (index, t, _, errors) in shots:
        for error in dedupe(errors):
            print("ERROR in scene %d: %s" % (index + 1, error[:300]))


def command_check(args):
    video = Path(args.video)
    if not video.exists():
        fail("No video at " + str(video))
    info = json.loads(run(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(video)]))
    length = float(info["format"]["duration"])
    vstream = next((s for s in info["streams"] if s["codec_type"] == "video"), None)
    astream = next((s for s in info["streams"] if s["codec_type"] == "audio"), None)
    print("Length: %s (%.2f s)" % (stamp(length), length))
    if vstream:
        print("Picture: %sx%s, %s fps, %s" % (vstream["width"], vstream["height"], vstream.get("r_frame_rate"), vstream["codec_name"]))
    if astream:
        out = subprocess.run(["ffmpeg", "-v", "info", "-i", str(video), "-af", "volumedetect", "-vn", "-f", "null", "-"], stderr=subprocess.PIPE, text=True).stderr
        mean = re.search(r"mean_volume: (-?[\d.]+)", out)
        peak = re.search(r"max_volume: (-?[\d.]+)", out)
        mean_v = float(mean.group(1)) if mean else -91
        print("Sound: mean %.1f dB, peak %.1f dB%s" % (mean_v, float(peak.group(1)) if peak else -91, " (SILENT)" if mean_v < -60 else ""))
    else:
        print("Sound: none")
    count = max(4, int(args.count))
    step = length / count
    sheet_dir = Path(args.output).with_suffix("")
    sheet_dir.mkdir(parents=True, exist_ok=True)
    files = []
    for i in range(count):
        target = sheet_dir / ("f%02d.jpg" % i)
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", "%.3f" % (step * (i + 0.5)), "-i", str(video), "-frames:v", "1", "-q:v", "3", str(target)])
        if target.exists():
            files.append((0, step * (i + 0.5), target.read_bytes(), []))
    columns = 4 if vstream and int(vstream["width"]) >= int(vstream["height"]) else 6
    contact_sheet(files, args.output, columns, [stamp(t) + " (%.1fs)" % t for (_, t, _, _) in files])
    shutil.rmtree(sheet_dir, ignore_errors=True)
    print("Contact sheet: %s (%d frames in order)" % (args.output, len(files)))


EXAMPLE_SCENE = """<!doctype html>
<html lang="{lang}" dir="{dir}">
<head>
<meta charset="utf-8">
<style>
  #stage {{ position: absolute; inset: 0; overflow: hidden; background: #0f1020; }}
  .layer {{ position: absolute; inset: 0; }}
  h1 {{ position: absolute; inset: 0; display: grid; place-items: center; margin: 0; color: white; font-size: 120px; font-weight: 800; }}
</style>
</head>
<body>
<div id="stage">
  <div class="layer" data-depth="0.2" id="sky"></div>
  <div class="layer" data-depth="1" id="world"></div>
  <h1 id="title">{title}</h1>
</div>
<script>
  // Everything is driven by time. Use FW.tween / FW.keys / FW.onFrame (see the video skill).
  FW.sky("#sky", {{ time: "sunset" }})
  FW.fromTo("#title", {{ opacity: 0, y: 60, blur: 12 }}, {{ opacity: 1, y: 0, blur: 0 }}, 0.3, 0.9, "outQuart")
  FW.camera("#stage", [{{ t: 0, zoom: 1.1 }}, {{ t: FW.duration, zoom: 1 }}])
</script>
</body>
</html>
"""


def command_init(args):
    folder = Path(args.project)
    (folder / "scenes").mkdir(parents=True, exist_ok=True)
    (folder / "assets").mkdir(exist_ok=True)
    rtl = args.language in RTL
    if not (folder / "project.json").exists():
        project = {
            "title": "Untitled", "size": args.size, "fps": 30, "language": args.language,
            "voices": {"narrator": {"voice": DEFAULT_VOICES.get(args.language, DEFAULT_VOICES["en"]), "rate": "+0%"}},
            "transition": {"type": "fade", "duration": 0.4},
            "captions": {"style": "pop"},
            "music": [],
            "scenes": [{"file": "scenes/01-opening.html", "duration": 4, "lines": []}],
        }
        (folder / "project.json").write_text(json.dumps(project, ensure_ascii=False, indent=2), encoding="utf-8")
    scene = folder / "scenes" / "01-opening.html"
    if not scene.exists():
        scene.write_text(EXAMPLE_SCENE.format(lang=args.language, dir="rtl" if rtl else "ltr", title="عنوان" if rtl else "Title"), encoding="utf-8")
    print("Project ready in " + str(folder) + ". Edit project.json and the scene files.")


def main():
    parser = argparse.ArgumentParser(description="Forkwise Motion")
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("init")
    p.add_argument("project")
    p.add_argument("--size", default="16:9")
    p.add_argument("--language", default="en")
    p = sub.add_parser("voice")
    p.add_argument("project")
    p = sub.add_parser("still")
    p.add_argument("project")
    p.add_argument("--scene", required=True)
    p.add_argument("--at", default="")
    p.add_argument("-o", "--output", required=True)
    p = sub.add_parser("board")
    p.add_argument("project")
    p.add_argument("-o", "--output", required=True)
    p = sub.add_parser("render")
    p.add_argument("project")
    p.add_argument("-o", "--output", required=True)
    p.add_argument("--draft", action="store_true")
    p.add_argument("--scenes", default="")
    p.add_argument("--workers", type=int, default=max(1, min(8, (os.cpu_count() or 2) - 1)))
    p = sub.add_parser("scenes")
    p.add_argument("project")
    p.add_argument("--draft", action="store_true")
    p.add_argument("--scenes", default="")
    p.add_argument("--list", action="store_true")
    p.add_argument("--workers", type=int, default=max(1, min(8, (os.cpu_count() or 2) - 1)))
    p = sub.add_parser("transcribe")
    p.add_argument("project")
    p.add_argument("media")
    p.add_argument("--model", default=os.environ.get("FW_WHISPER_MODEL", "medium"))
    p.add_argument("--language", default="")
    p.add_argument("--force", action="store_true")
    p = sub.add_parser("cuts")
    p.add_argument("project")
    p.add_argument("media")
    p.add_argument("--gap", type=float, default=0.45)
    p.add_argument("--pad", type=float, default=0.08)
    p.add_argument("--fillers", action="store_true")
    p = sub.add_parser("proxies")
    p.add_argument("project")
    p = sub.add_parser("beats")
    p.add_argument("project")
    p.add_argument("media")
    p = sub.add_parser("check")
    p.add_argument("video")
    p.add_argument("-o", "--output", required=True)
    p.add_argument("-n", "--count", default=12)
    args = parser.parse_args()
    {"init": command_init, "voice": command_voice, "still": command_still, "board": command_board, "render": command_render, "check": command_check, "scenes": command_scenes, "transcribe": command_transcribe, "cuts": command_cuts, "proxies": command_proxies, "beats": command_beats}[args.command](args)


if __name__ == "__main__":
    main()

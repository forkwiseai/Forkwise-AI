"""Forkwise video rendering on Modal (https://modal.com). Videos are never rendered on the
Forkwise server: the server uploads the project, this app renders every scene on its own
cloud machine at the same time, puts the video together and hands the files back.

Deploy (done automatically by forkwise-update when MODAL_TOKEN_ID and MODAL_TOKEN_SECRET are set):
    modal deploy backend/cloud/modal_video.py
"""

import json
import os
import shutil
import subprocess
import tarfile
import time
from pathlib import Path

import modal

HERE = Path(__file__).resolve().parent
MOTION = HERE.parent / "sandbox" / "motion"
TOOL = "/opt/fwmotion/fwmotion.py"

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("ffmpeg", "fonts-noto-core", "fonts-noto-color-emoji", "fontconfig")
    .pip_install("playwright==1.49.1", "edge-tts==7.0.2", "pillow==11.1.0", "faster-whisper==1.1.1", "numpy")
    .run_commands("playwright install --with-deps chromium")
    .run_commands("python -c \"from faster_whisper import WhisperModel; WhisperModel('medium', device='cpu', compute_type='int8')\"")
    .env({"FW_WHISPER_MODEL": "medium"})
    .add_local_dir(MOTION, "/opt/fwmotion")
)

app = modal.App("forkwise-video")
store = modal.Volume.from_name("forkwise-video", create_if_missing=True)
ROOT = Path("/store")


def unpack(job, target):
    target.mkdir(parents=True, exist_ok=True)
    with tarfile.open(ROOT / "in" / (job + ".tar.gz")) as archive:
        archive.extractall(target, filter="data")
    # big media files are uploaded once by content and linked in
    manifest = target / ".fwmedia.json"
    if manifest.exists():
        for rel, stored in json.loads(manifest.read_text()).items():
            path = target / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            if not path.exists():
                os.symlink(ROOT / stored, path)
    return target


def media_names(work):
    manifest = work / ".fwmedia.json"
    return set(json.loads(manifest.read_text()).keys()) if manifest.exists() else set()


def tool(args, cwd, timeout=7000):
    done = subprocess.run(["python3", TOOL] + args, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=timeout)
    return done.returncode, done.stdout


def clean_cache(days=21):
    limit = time.time() - days * 86400
    for name in ("cache", "proxy", "media"):
        folder = ROOT / name
        if not folder.exists():
            continue
        for path in folder.iterdir():
            try:
                if path.stat().st_mtime < limit:
                    path.unlink()
            except OSError:
                pass


@app.function(image=image, cpu=4.0, memory=6144, timeout=3600, volumes={str(ROOT): store}, retries=1, max_containers=200)
def scene(job: str, index: int, key: str, draft: bool) -> str:
    """Render one scene clip and keep it in the shared cache."""
    return do_scene(job, index, key, draft)


def do_scene(job, index, key, draft):
    store.reload()
    cached = ROOT / "cache" / (key + ".mp4")
    if cached.exists():
        return "cached"
    work = unpack(job, Path("/tmp/work") / job)
    listed = work / "build" / "proxies.json"
    if listed.exists():
        (work / "build" / "proxy").mkdir(parents=True, exist_ok=True)
        for name in json.loads(listed.read_text()):
            link = work / "build" / "proxy" / name
            if not link.exists() and (ROOT / "proxy" / name).exists():
                os.symlink(ROOT / "proxy" / name, link)
    code, out = tool(["scenes", ".", "--scenes", str(index + 1), "--workers", "1"] + (["--draft"] if draft else []), work)
    if code != 0:
        return "ERROR scene %d: %s" % (index + 1, out[-1500:])
    folder = work / "build" / ("draft" if draft else "scenes")
    clip = next(folder.glob("%03d-%s.mp4" % (index + 1, key)), None)
    if not clip:
        return "ERROR scene %d: no clip was made\n%s" % (index + 1, out[-1500:])
    (ROOT / "cache").mkdir(exist_ok=True)
    shutil.copy(clip, cached)
    shutil.copy(clip.with_suffix(".json"), cached.with_suffix(".json"))
    store.commit()
    return "done"


@app.function(image=image, cpu=8.0, memory=8192, timeout=7200, volumes={str(ROOT): store}, max_containers=20)
def job(job_id: str, argv: list) -> dict:
    """Run one fwmotion command for a project uploaded to in/<job_id>.tar.gz.
    Results go to out/<job_id>/ in the volume (paths relative to the project)."""
    return do_job(job_id, argv, lambda items: scene.starmap(items, return_exceptions=True))


def do_job(job_id, argv, fan_out):
    store.reload()
    clean_cache()
    work = unpack(job_id, Path("/tmp/work") / job_id)
    log = []
    started = time.time()
    command = argv[0]
    if command == "render":
        draft = "--draft" in argv
        scenes = argv[argv.index("--scenes") + 1] if "--scenes" in argv else ""
        code, out = tool(["voice", "."], work)
        log.append(out)
        if code != 0:
            return {"ok": False, "log": "\n".join(log)}
        listing = ["scenes", ".", "--list"] + (["--draft"] if draft else []) + (["--scenes", scenes] if scenes else [])
        code, out = tool(listing, work)
        if code != 0:
            return {"ok": False, "log": out}
        plan = json.loads(out.strip().splitlines()[-1])
        # seek-friendly copies of the footage, made once and shared with every scene machine
        code, out = tool(["proxies", "."], work)
        if code != 0:
            return {"ok": False, "log": "\n".join(log + [out])}
        proxies = json.loads(out.strip().splitlines()[-1]) if out.strip() else {}
        (ROOT / "proxy").mkdir(exist_ok=True)
        for name in proxies.values():
            if not (ROOT / "proxy" / name).exists():
                shutil.copy(work / "build" / "proxy" / name, ROOT / "proxy" / name)
        (work / "build" / "proxies.json").write_text(json.dumps(sorted(set(proxies.values()))))
        # the scene machines need the voice timings, so send the project again with them
        skip = ("./build/scenes", "./build/draft", "./out", "./build/assemble", "./build/proxy")
        linked = {"./" + name for name in media_names(work)}
        with tarfile.open(ROOT / "in" / (job_id + ".tar.gz"), "w:gz") as archive:
            archive.add(work, arcname=".", filter=lambda info: None if info.name.startswith(skip) or info.name in linked or info.issym() else info)
        store.commit()
        missing = [item for item in plan if not (ROOT / "cache" / (item["key"] + ".mp4")).exists()]
        log.append("Rendering %d scene(s) on %d cloud machine(s), %d already made." % (len(plan), len(missing), len(plan) - len(missing)))
        errors = []
        if missing:
            for result in fan_out([(job_id, item["index"], item["key"], draft) for item in missing]):
                if isinstance(result, Exception) or str(result).startswith("ERROR"):
                    errors.append(str(result)[:1500])
        store.reload()
        for item in plan:
            cached = ROOT / "cache" / (item["key"] + ".mp4")
            if cached.exists():
                target = work / item["file"]
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy(cached, target)
                shutil.copy(cached.with_suffix(".json"), target.with_suffix(".json"))
        if errors:
            log.extend(errors)
        code, out = tool(argv, work)
        log.append(out)
        if code == 0:
            output = argv[argv.index("-o") + 1]
            code2, out2 = tool(["check", output, "-o", str(Path(output).with_suffix("")) + "-sheet.png", "-n", "12"], work)
            log.append(out2)
    else:
        code, out = tool(argv, work)
        log.append(out)
    # hand back what the command made
    target = ROOT / "out" / job_id
    if target.exists():
        shutil.rmtree(target)
    target.mkdir(parents=True)
    files = []
    for folder in ("out", "build/review", "build/transcripts"):
        for path in (work / folder).rglob("*") if (work / folder).exists() else []:
            if path.is_file() and path.stat().st_mtime >= started - 5:
                rel = path.relative_to(work)
                (target / rel).parent.mkdir(parents=True, exist_ok=True)
                shutil.copy(path, target / rel)
                files.append(str(rel))
    for extra in ["build/timing.json"] + [str(p.relative_to(work)) for p in (work / "build" / "voice").glob("*")] if (work / "build" / "voice").exists() else ["build/timing.json"]:
        path = work / extra
        if path.is_file():
            (target / extra).parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(path, target / extra)
            files.append(extra)
    (ROOT / "in" / (job_id + ".tar.gz")).unlink(missing_ok=True)
    store.commit()
    return {"ok": code == 0, "log": "\n".join(x for x in log if x).strip()[-12000:], "files": files, "seconds": round(time.time() - started, 1)}

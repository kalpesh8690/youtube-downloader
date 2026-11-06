import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from urllib.parse import urlparse

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

app = FastAPI(title="Downly yt-dlp worker", version="1.0.0")

TOKEN = os.getenv("WORKER_TOKEN", "")
ENABLE_YTDLP = os.getenv("ENABLE_YTDLP", "false").lower() == "true"
ALLOW_YOUTUBE = os.getenv("ALLOW_YOUTUBE", "false").lower() == "true"
MAX_FILE_BYTES = int(os.getenv("MAX_FILE_BYTES", str(2 * 1024 * 1024 * 1024)))
OUTPUT_DIR = Path(os.getenv("YTDLP_OUTPUT_DIR", "/tmp/downly"))
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

YOUTUBE_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "www.youtu.be"}

class MediaRequest(BaseModel):
    url: str = Field(min_length=10, max_length=4096)
    format: str = "best"
    audio_only: bool = False

def check_auth(value: str | None):
    if TOKEN and value != f"Bearer {TOKEN}":
        raise HTTPException(status_code=401, detail="Unauthorized worker request")

def is_youtube(url: str) -> bool:
    try:
        host = urlparse(url).hostname
        return bool(host and host.lower().removeprefix("www.") in {"youtube.com", "youtu.be"})
    except Exception:
        return False

def safe_url(url: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise HTTPException(status_code=400, detail="Only HTTP(S) URLs are supported")
    if is_youtube(url) and not ALLOW_YOUTUBE:
        raise HTTPException(status_code=403, detail="YouTube worker access is disabled")
    return url

def run_ytdlp(req: MediaRequest, out_dir: Path) -> Path:
    url = safe_url(req.url)
    if not ENABLE_YTDLP:
        raise HTTPException(status_code=503, detail="yt-dlp worker is disabled")

    output = str(out_dir / "%(title).120B [%(id)s].%(ext)s")
    fmt = "bestaudio/best" if req.audio_only else "bestvideo*+bestaudio/best"

    args = [
        "yt-dlp",
        "--no-playlist",
        "--no-part",
        "--no-warnings",
        "--restrict-filenames",
        "--format", fmt,
        "--output", output,
        "--print", "after_move:filepath",
        "--max-filesize", str(MAX_FILE_BYTES),
        url,
    ]

    if req.audio_only:
        args[args.index("--format") + 1] = "bestaudio/best"
        args.insert(-1, "--extract-audio")
        args.insert(-1, "--audio-format")
        args.insert(-1, "mp3")

    try:
        completed = subprocess.run(args, capture_output=True, text=True, timeout=300)
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Media processing timed out")

    if completed.returncode != 0:
        raise HTTPException(status_code=502, detail=(completed.stderr or "yt-dlp failed")[-2000:])

    candidates = [Path(line.strip()) for line in completed.stdout.splitlines() if line.strip()]
    candidates = [p for p in candidates if p.exists() and p.is_file()]
    if not candidates:
        candidates = [p for p in out_dir.iterdir() if p.is_file()]

    if not candidates:
        raise HTTPException(status_code=502, detail="yt-dlp produced no output file")

    file_path = max(candidates, key=lambda p: p.stat().st_mtime)
    if file_path.stat().st_size > MAX_FILE_BYTES:
        file_path.unlink(missing_ok=True)
        raise HTTPException(status_code=413, detail="Output file is too large")
    return file_path

@app.get("/health")
def health():
    return {
        "ok": True,
        "service": "downly-ytdlp-worker",
        "ytDlpEnabled": ENABLE_YTDLP,
        "youtubeEnabled": ALLOW_YOUTUBE,
    }

@app.post("/v1/media/download")
def download(
    req: MediaRequest,
    authorization: str | None = Header(default=None),
):
    check_auth(authorization)
    job_dir = Path(tempfile.mkdtemp(prefix="downly-", dir=OUTPUT_DIR))
    try:
        file_path = run_ytdlp(req, job_dir)
        return FileResponse(
            path=file_path,
            filename=file_path.name,
            media_type="application/octet-stream",
            headers={"Cache-Control": "no-store"},
            background=None,
        )
    except Exception:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise

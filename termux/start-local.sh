#!/data/data/com.termux/files/usr/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKER_ROOT="${DOWNLY_WORKER_ROOT:-$ROOT/../downly-worker}"

if [ ! -f "$WORKER_ROOT/server.py" ]; then
  echo "Downly worker not found: $WORKER_ROOT/server.py"
  echo "Clone kalpesh8690/downly-worker next to youtube-downloader or set DOWNLY_WORKER_ROOT."
  exit 1
fi

export WORKER_TOKEN="${WORKER_TOKEN:-local-downly}"
export HOST=127.0.0.1
export PORT=8080
export YTDLP_JS_RUNTIME="${YTDLP_JS_RUNTIME:-node}"

echo "[1/2] Starting local yt-dlp worker on 127.0.0.1:8080"
cd "$WORKER_ROOT"
python server.py &
WORKER_PID=$!

cleanup() {
  kill "$WORKER_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

sleep 1

echo "[2/2] Starting Downly on http://127.0.0.1:3000"
cd "$ROOT"
export YTDLP_WORKER_URL="http://127.0.0.1:8080"
export YTDLP_WORKER_TOKEN="$WORKER_TOKEN"
node termux/server.mjs

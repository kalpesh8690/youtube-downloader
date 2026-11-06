# Downly yt-dlp worker

Docker worker for authorized media processing.

## Environment

- WORKER_TOKEN: shared secret used by the API
- ENABLE_YTDLP: set true to enable yt-dlp
- ALLOW_YOUTUBE: set true only when your deployment/use case is authorized to process YouTube content
- MAX_FILE_BYTES: output size limit

The worker is intentionally separate from Vercel because yt-dlp + FFmpeg require a long-running/container environment.

## Run

docker build -t downly-ytdlp-worker ./worker

docker run --rm -p 8080:8080 \
  -e ENABLE_YTDLP=true \
  -e ALLOW_YOUTUBE=false \
  -e WORKER_TOKEN=change-me \
  downly-ytdlp-worker

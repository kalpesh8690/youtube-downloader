# Downly

Production-oriented React + Vite media downloader UI backed by a local Termux/Android yt-dlp worker.

## Architecture

```
Chrome / Android
   ↓
Downly React UI
   ↓
Termux API :3000
   ├── /api/media/info
   ├── /api/ytdlp/jobs
   ├── /api/ytdlp/jobs/:id
   ├── /api/ytdlp/jobs/:id/pause|resume|cancel
   └── /api/ytdlp/jobs/:id/file
              ↓
       Downly Worker :8080
              ↓
          yt-dlp + FFmpeg
```

The worker performs media inspection and preparation. Once a job is ready, the UI opens the same-origin file endpoint with an attachment response so Chrome handles the actual file transfer in its native Downloads manager instead of buffering the file in React memory. HTTP range requests remain supported by the file endpoint. citeturn889582search3turn889582search0

## Automatic inspection

When a valid HTTP(S) URL is pasted/entered, Downly automatically calls:

`POST /api/media/info`

The worker uses yt-dlp's metadata mode to discover:

- title, uploader/channel and thumbnail
- duration and upload date when available
- extractor/site
- available video/audio formats
- resolution, FPS, codec, container and approximate/exact size
- format IDs and safe selectors for downloading

yt-dlp documents `--dump-single-json` for metadata extraction and exposes format IDs and fields such as extension, codecs, resolution and filesize. citeturn301062search1turn620834search7

## API binding

### Termux API

- `POST /api/media/info` → worker `POST /v1/inspect`
- `POST /api/ytdlp/jobs` → worker `POST /v1/jobs`
- `GET /api/ytdlp/jobs/:id` → worker `GET /v1/jobs/:id`
- `POST /api/ytdlp/jobs/:id/pause` → worker pause
- `POST /api/ytdlp/jobs/:id/resume` → worker resume
- `POST /api/ytdlp/jobs/:id/cancel` → worker cancel
- `GET|HEAD /api/ytdlp/jobs/:id/file` → authenticated worker file proxy

The worker exposes structured progress including percent, downloaded bytes, total bytes, speed and ETA. yt-dlp's progress model includes downloaded bytes, total bytes, speed and ETA. citeturn301062search0

## Supported media

Downly uses yt-dlp's extractor ecosystem for public/authorized media URLs. yt-dlp maintains a large extractor list and also has a generic extractor for some URLs that are not explicitly listed. Support is not universal because sites change their delivery systems. citeturn620834search0turn620834search2

For YouTube and other sites, only media you own or are authorized to save should be downloaded. The project does not implement DRM or access-control bypassing.

## Termux setup

### Worker

```bash
cd ~/downly-worker
git pull origin main

export WORKER_TOKEN="test-downly-123"
python server.py
```

### Frontend/API

```bash
cd ~/youtube-downloader
git pull origin main
npm install
npm run build

export YTDLP_WORKER_URL="http://127.0.0.1:8080"
export YTDLP_WORKER_TOKEN="test-downly-123"

node termux/server.mjs
```

Open `http://127.0.0.1:3000`.

### Cloudflare Quick Tunnel

If remote phone access is required:

```bash
cloudflared tunnel --url http://127.0.0.1:3000
```

The generated tunnel hostname changes when a Quick Tunnel is restarted.

## Product features

- Automatic URL inspection
- Universal yt-dlp format discovery
- Quality/format selector
- Real-time worker progress, speed and ETA
- Native Chrome Downloads handoff
- HTTP range support
- Pause/resume/cancel while the worker is preparing media
- Local download history
- Clipboard paste
- Retry and actionable errors
- Responsive dark UI
- Bounded media discovery fallback for ordinary webpages

## Limitations

- A website may require login, cookies, special tokens, geographic access or other conditions.
- Some URLs are pages rather than downloadable media and may expose no public media URL.
- YouTube's available formats can vary by video and by current extractor/client requirements. yt-dlp's current documentation notes that some YouTube formats/features may require externally supplied proof-of-origin tokens. citeturn620834search11
- Chrome's native download manager owns the final file-transfer progress after the worker finishes preparing the file; the webpage shows real-time yt-dlp preparation progress.

## License / usage

Use Downly only for media you own or are authorized to save, and respect each site's terms and applicable law.

# Downly

A self-hosted, mobile-friendly media inspection and downloader interface. The React/Vite app runs in the browser, a same-origin Node API runs in Termux, and a local Python worker uses yt-dlp and FFmpeg.

## Architecture

```
Chrome / Android
    |
    v
React + Vite UI
    |
    v
Termux Node API (127.0.0.1:3000)
    |-- /api/media/info
    |-- /api/media/crawl
    |-- /api/detect
    |-- /api/health
    |-- /api/ytdlp/stream
    |
    v
Python Worker (127.0.0.1:8080)
    |-- metadata / format discovery
    |-- bounded same-origin crawler
    |-- direct-source byte proxy
    |-- yt-dlp + FFmpeg stream
    |
    v
Chrome Downloads Manager
```

## Native browser download behavior

The Download action submits a same-origin form POST to the Termux API. The API pipes the worker response to the browser with Content-Disposition: attachment. Chrome manages the actual download; the app does not buffer the entire file into a JavaScript Blob and the worker does not first save a completed media file.

The worker uses two paths:

1. Public single-file progressive sources are proxied byte-for-byte, including Range support when the upstream supports it.
2. HLS/DASH, extractor-only or conversion-required sources are processed with yt-dlp/FFmpeg and streamed to the browser.

MP3 requests are converted to MP3 at 192 kbps when a compatible audio source is available. Video streams that require separate audio/video tracks are muxed to MP4 while streaming. These conversion paths will be slower than a direct progressive source.

Chrome owns the final transfer progress. Downly shows inspection metadata and a hand-off status, not an invented progress bar for Chrome's download.

## Automatic inspection

When an HTTP(S) URL is entered, the frontend debounces input and calls POST /api/media/info. The worker uses yt-dlp metadata discovery to return title, uploader, thumbnail, duration, extractor, codecs, format IDs, resolution, FPS and file-size estimates where available.

The media page crawler is bounded to six pages on the same origin. It scans common HTML media attributes, iframe references, embedded configuration text and known media extensions, including MP4, WebM, MP3, HLS (.m3u8) and DASH (.mpd).

This cannot guarantee support for every website. JavaScript-only players, DRM, protected manifests, blob URLs, login-only content, geographic restrictions and site-specific controls may not be extractable. Only download media you own or are authorized to save.

## Termux setup

### 1. Worker

Install Python, FFmpeg and yt-dlp in Termux.

```bash
cd ~/downly-worker
git pull origin main

export WORKER_TOKEN='USE_A_LONG_RANDOM_SECRET'
export HOST='127.0.0.1'
export PORT='8080'
export MAX_STREAMS='2'
python server.py
```

Keep this terminal session running.

### 2. Frontend and API

In a second Termux session:

```bash
cd ~/youtube-downloader
git pull origin main
npm install
npm run build

export HOST='127.0.0.1'
export YTDLP_WORKER_URL='http://127.0.0.1:8080'
export YTDLP_WORKER_TOKEN='USE_THE_SAME_SECRET'

node termux/server.mjs
```

Open http://127.0.0.1:3000.

The Node server binds to loopback by default. That prevents unintended LAN exposure. Set HOST=0.0.0.0 only when you deliberately need LAN access and have firewall/access controls in place.

### 3. Optional remote access

For remote access, use a named Cloudflare Tunnel and protect it with Cloudflare Access. A Quick Tunnel hostname is temporary and should not be treated as a private access-control mechanism.

## API binding

| Browser-facing Termux API | Worker API | Purpose |
|---|---|---|
| POST /api/media/info | POST /v1/inspect | metadata + format discovery |
| GET /api/media/crawl | GET /v1/crawl | bounded media crawler |
| POST/GET /api/detect | GET /v1/crawl | legacy-compatible crawler response |
| GET /api/health | GET /health | worker health |
| POST /api/ytdlp/stream | POST /v1/stream | native browser attachment stream; source URLs stay out of request query strings |
| POST /api/ytdlp/jobs | POST /v1/jobs | persistent job creation |
| GET /api/ytdlp/jobs/:id | GET /v1/jobs/:id | persistent job status |
| POST /api/ytdlp/jobs/:id/pause | POST /v1/jobs/:id/pause | pause persistent job |
| POST /api/ytdlp/jobs/:id/resume | POST /v1/jobs/:id/resume | resume persistent job |
| POST /api/ytdlp/jobs/:id/cancel | POST /v1/jobs/:id/cancel | cancel persistent job |

Worker routes require Authorization: Bearer WORKER_TOKEN, except GET /health. The token is added by the Termux Node server and is never sent to browser JavaScript.

## Production safeguards

- Runtime secrets are read from environment variables; never commit a real worker token.
- The Node server binds to 127.0.0.1 by default.
- Worker URL validation rejects private/local destinations by default; set ALLOW_PRIVATE_URLS=true only for trusted local networks.
- The crawler is bounded by page count and per-page response size.
- Download streams have a configurable concurrency limit.
- The Termux API uses request-size limits, per-IP rate limits and security headers.
- Signed source URL query strings are redacted from worker and Termux request logs.
- Native download streaming uses backpressure and aborts upstream work when the browser disconnects.
- React has an error boundary, responsive dark UI, reduced-motion support and keyboard focus indicators.
- CI checks the frontend production build and Termux Node syntax; worker CI compiles the Python entry point.

## Dependency management

Direct dependencies are pinned to exact versions. Generate and commit package-lock.json before treating a release as reproducible:

```bash
npm install
git add package.json package-lock.json
git commit -m "chore: commit npm lockfile"
git push
```

CI currently installs from the exact direct versions because this repository did not contain a lockfile at the time of this update.

## Important security note

The Termux API is designed for a private self-hosted instance, not an unauthenticated public multi-tenant download service. Rate limits and worker-token separation are not a replacement for end-user authentication, per-user quotas or Cloudflare Access. Protect any publicly reachable tunnel with an access policy before sharing the URL.

## License / usage

Use Downly only for media you own or are authorized to download, and respect website terms and applicable law.

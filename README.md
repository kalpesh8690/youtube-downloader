# Downly

React + Vite frontend with secure Vercel Node API routes for inspecting public webpages and streaming direct media files.

## Run locally

npm install
npm run dev

## API

POST /api/detect
Body: { "url": "https://example.com/page" }

Scans the submitted page and up to 5 additional same-origin HTML pages (6 total), then returns public media URLs discovered in media tags, metadata, links and inline player configuration. A crawl is bounded by page count and response size.

GET /api/detect?url=...
Same scan operation using a query parameter.

GET /api/download?url=...
Streams a direct public media file to the browser using Content-Disposition. Browser downloads support range requests when the upstream host supports them.

POST /api/download
Body: { "url": "https://cdn.example.com/video.mp4" }

Streams the direct media file to the caller. The server validates public DNS/IP targets and blocks local/private network destinations.

## Media support

Recognizes common video types including MP4, M4V, MKV, WebM, MOV, AVI, MPG/MPEG, VOB, TS/MTS/M2TS, 3GP, FLV, WMV, ASF, OGV, RM/RMVB and MXF, plus common audio types including MP3, M4A, AAC, WAV, OGG, Opus, FLAC, AIFF, APE and WMA.

The download API preserves the source file and streams it without transcoding. It does not convert video/audio into another codec or container. Output conversion (for example, AVI to MP4 or video to MP3) requires an FFmpeg worker on a separate container host; Vercel's serverless API is not used as a long-running media transcoder.

## Platform limitations

- The service does not extract or bypass protected YouTube streams, DRM, login-only media, signed/private sessions, or player-internal blob URLs.
- JavaScript-only players may not expose media URLs in server-readable HTML.
- HLS/DASH manifests are detected and reported, but are not merged into an MP4 file by this API.
- Some hosts block server-side requests, require cookies or require geographic/session access; there is no universal downloader for every URL.
- Only download content that you own or are authorized to save.

## Configuration

Optional DOWNLOAD_MAX_BYTES sets the maximum streamed file size (default 500 MiB; hard cap 2 GiB). Vercel function duration is configured in vercel.json.


## yt-dlp worker

The repository now includes a separate Docker/Python worker under worker/. It uses yt-dlp and FFmpeg and is intended for authorized media processing.

Build:
docker build -t downly-ytdlp-worker ./worker

Run:
docker run --rm -p 8080:8080 -e ENABLE_YTDLP=true -e ALLOW_YOUTUBE=false -e WORKER_TOKEN=change-me downly-ytdlp-worker

Worker health:
GET /health

Worker media endpoint:
POST /v1/media/download

The Vercel proxy endpoint is POST /api/ytdlp/download. Configure YTDLP_WORKER_URL and YTDLP_WORKER_TOKEN in Vercel.

YouTube processing is disabled by default. Enable it only for content you own or are authorized to process. The worker does not implement DRM or access-control bypassing.

yt-dlp currently recommends Python 3.11+, FFmpeg/ffprobe, yt-dlp-ejs and a supported JavaScript runtime for full YouTube support.

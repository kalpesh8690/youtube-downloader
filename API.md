# Downly API

## Endpoints
- GET /api/health
- POST /api/youtube/info — accepts a YouTube URL and returns oEmbed metadata and thumbnail.
- POST /api/download — reserved for explicitly authorized direct media hosts.

The backend intentionally does not implement YouTube stream extraction or bypass platform restrictions. Use it for content you own or are authorized to download.

## GET/POST /api/detect
Inspects a public HTTP(S) webpage and returns direct video/audio URLs exposed in HTML (`video`, `source`, and common direct-media URL patterns). It does not bypass DRM, authentication, protected player streams, or YouTube stream extraction.

The frontend can fetch a detected CORS-enabled direct media URL, convert the response to a browser `Blob`, and trigger a local download. Browser cross-origin rules still apply; a remote server must permit the frontend origin with CORS for JavaScript to read the response. Blob/object URLs are created and revoked by the frontend.

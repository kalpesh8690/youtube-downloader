# Downly API

## Endpoints
- GET /api/health
- POST /api/youtube/info — accepts a YouTube URL and returns oEmbed metadata and thumbnail.
- POST /api/download — reserved for explicitly authorized direct media hosts.

The backend intentionally does not implement YouTube stream extraction or bypass platform restrictions. Use it for content you own or are authorized to download.
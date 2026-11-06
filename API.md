# Downly API

## Endpoints
- GET /api/health — service health.
- POST /api/youtube/info — returns YouTube oEmbed metadata only.
- POST /api/detect — finds public direct video/audio URLs exposed in webpage HTML.
- POST /api/download — streams an explicitly supplied public direct video/audio URL to the browser as an attachment.

## Download request

```json
{
  "url": "https://media.example.org/video.mp4"
}
```

The download endpoint accepts HTTPS URLs on standard port 443, follows a limited number of redirects, resolves and pins public IPv4 addresses, rejects private/reserved network destinations, and only streams direct audio/video responses. Maximum file size defaults to 500 MiB and can be changed with `DOWNLOAD_MAX_BYTES` (hard-capped at 2 GiB). Vercel's streaming response path is used so media bytes are not buffered by the function.

The frontend first detects public direct media, lets the user select a video/audio source, then calls `POST /api/download` and saves the returned attachment. This downloads the original file; format conversion and quality transcoding are not implemented by this endpoint.

The service does not extract YouTube streams or bypass DRM, authentication, paywalls, protected players, or access controls. Only download content you own or are authorized to save.

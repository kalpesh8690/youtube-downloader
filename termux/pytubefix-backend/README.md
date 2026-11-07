# pytubefix Termux Backend

Python/Flask backend for the React Native YouTube downloader.

## Features

- Video metadata and thumbnail
- All streams exposed by pytubefix
- Resolution, FPS, codecs and file size
- Direct preview URL for a selected stream
- Progressive video downloads
- Adaptive video + audio downloads merged with FFmpeg
- Audio extraction to MP3, M4A or WAV
- Background download jobs
- Progress polling
- Downloaded file endpoint
- CORS for React Native development
- Runs locally on Android through Termux

## Termux install

```bash
pkg update
pkg upgrade
pkg install python ffmpeg
cd youtube-downloader/termux/pytubefix-backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

Or:

```bash
bash start.sh
```

## Health

```bash
curl http://127.0.0.1:5000/api/health
```

## API

### POST /api/info

```json
{"url":"https://www.youtube.com/watch?v=VIDEO_ID"}
```

Returns video metadata and all available stream metadata including size.

### POST /api/preview

```json
{"url":"https://www.youtube.com/watch?v=VIDEO_ID","itag":18}
```

Returns a fresh direct stream URL. Stream URLs are temporary and should not be stored permanently.

### POST /api/download

Video:

```json
{"url":"https://www.youtube.com/watch?v=VIDEO_ID","itag":18,"mode":"video"}
```

Audio:

```json
{"url":"https://www.youtube.com/watch?v=VIDEO_ID","itag":140,"mode":"audio","output_format":"mp3"}
```

The response contains a `job_id`.

### GET /api/progress/:jobId

Poll until `status` is `completed` or `error`.

### GET /api/file/:jobId

Downloads the completed file.

### DELETE /api/job/:jobId

Removes the job and completed file.

## React Native base URL

Find the Android phone IP:

```bash
ip addr show wlan0
```

Then set:

```js
const API = "http://PHONE_IP:5000";
```

Do not use `localhost` from the React Native app when the backend is running on the same Android phone unless the app and Termux networking setup specifically routes localhost that way.

## Important stream behavior

Progressive streams contain audio and video together. Adaptive high-resolution streams can be video-only, so the backend downloads a compatible audio stream and uses FFmpeg to produce the final MP4.

Only download content you are authorized to download and comply with applicable platform terms and copyright law.

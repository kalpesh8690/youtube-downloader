const YOUTUBE_HOSTS = new Set(["youtube.com","www.youtube.com","m.youtube.com","youtu.be","www.youtu.be"]);

function errorBody(message, code, extra = {}) {
  return { ok: false, error: message, code, ...extra };
}

function getVideoId(input) {
  if (typeof input !== "string" || input.length > 2048) return null;
  try {
    const u = new URL(input.trim());
    const host = u.hostname.toLowerCase();
    if (!YOUTUBE_HOSTS.has(host)) return null;
    if (host.includes("youtu.be")) return u.pathname.split("/").filter(Boolean)[0] || null;
    if (u.pathname === "/watch") return u.searchParams.get("v");
    const match = u.pathname.match(/^\/(shorts|embed|live)\/([^/?#]+)/);
    return match?.[2] || null;
  } catch { return null; }
}

async function getInfo(url) {
  const id = getVideoId(url);
  if (!id) return { status: 400, body: errorBody("Valid YouTube URL required","INVALID_URL") };

  const canonicalUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch("https://www.youtube.com/oembed?url=" + encodeURIComponent(canonicalUrl) + "&format=json", {
      headers: { Accept: "application/json" },
      signal: controller.signal
    });

    if (response.status === 404) return { status: 404, body: errorBody("Video information unavailable","VIDEO_NOT_FOUND",{id}) };
    if (!response.ok) return { status: 502, body: errorBody("Video metadata service returned an error","UPSTREAM_ERROR",{id}) };

    const data = await response.json();
    return {
      status: 200,
      body: {
        ok: true, id, title: data.title, author: data.author_name,
        thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
        watchUrl: canonicalUrl,
        formats: [
          { format: "MP4", quality: "1080p", available: false },
          { format: "MP4", quality: "720p", available: false },
          { format: "MP3", quality: "audio", available: false }
        ],
        note: "Metadata only. YouTube media stream extraction or bypass is not provided."
      }
    };
  } catch (error) {
    return { status: 502, body: error?.name === "AbortError"
      ? errorBody("YouTube metadata request timed out","UPSTREAM_TIMEOUT")
      : errorBody("Unable to reach the video metadata service","UPSTREAM_UNAVAILABLE") };
  } finally { clearTimeout(timeout); }
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow","GET, POST, OPTIONS");
    return res.status(405).json(errorBody("Method not allowed","METHOD_NOT_ALLOWED"));
  }

  let url = req.query?.url;
  if (req.method === "POST") {
    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); }
      catch { return res.status(400).json(errorBody("Invalid JSON body","INVALID_JSON")); }
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return res.status(400).json(errorBody("Request body must be a JSON object","INVALID_BODY"));
    }
    url = body.url;
  }

  const result = await getInfo(url);
  return res.status(result.status).json(result.body);
}

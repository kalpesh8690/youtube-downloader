const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "youtu.be",
  "www.youtu.be"
]);

function getVideoId(input) {
  try {
    const u = new URL(input);
    if (!YOUTUBE_HOSTS.has(u.hostname.toLowerCase())) return null;

    if (u.hostname.toLowerCase().includes("youtu.be")) {
      return u.pathname.split("/").filter(Boolean)[0] || null;
    }

    if (u.pathname === "/watch") return u.searchParams.get("v");

    const match = u.pathname.match(/^\/(shorts|embed|live)\/([^/?#]+)/);
    return match?.[2] || null;
  } catch {
    return null;
  }
}

async function getInfo(url) {
  const id = getVideoId(url);
  if (!id) {
    return { status: 400, body: { ok: false, error: "Valid YouTube URL required" } };
  }

  const canonicalUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(
      "https://www.youtube.com/oembed?url=" +
        encodeURIComponent(canonicalUrl) +
        "&format=json",
      {
        headers: { Accept: "application/json" },
        signal: controller.signal
      }
    );

    if (!response.ok) {
      return {
        status: 404,
        body: { ok: false, error: "Video information unavailable", id }
      };
    }

    const data = await response.json();

    return {
      status: 200,
      body: {
        ok: true,
        id,
        title: data.title,
        author: data.author_name,
        thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
        watchUrl: canonicalUrl,
        formats: [
          { format: "MP4", quality: "1080p", available: false },
          { format: "MP4", quality: "720p", available: false },
          { format: "MP3", quality: "audio", available: false }
        ],
        note: "This API provides metadata only. It does not extract or bypass YouTube media streams."
      }
    };
  } catch (error) {
    return {
      status: 502,
      body: {
        ok: false,
        error: error?.name === "AbortError"
          ? "YouTube metadata request timed out"
          : "Unable to reach YouTube metadata service"
      }
    };
  } finally {
    clearTimeout(timeout);
  }
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  let url = req.query?.url;

  if (req.method === "POST") {
    if (typeof req.body === "string") {
      try {
        req.body = JSON.parse(req.body);
      } catch {
        return res.status(400).json({ ok: false, error: "Invalid JSON body" });
      }
    }
    url = req.body?.url;
  }

  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST, OPTIONS");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const result = await getInfo(url);
  return res.status(result.status).json(result.body);
}

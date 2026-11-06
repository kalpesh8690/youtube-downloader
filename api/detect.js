const VIDEO_EXTENSIONS = new Set([".mp4",".webm",".mov",".m4v",".mkv",".avi",".m3u8",".mpd"]);
const AUDIO_EXTENSIONS = new Set([".mp3",".m4a",".aac",".wav",".ogg",".opus"]);

function errorBody(message, code, extra = {}) {
  return { ok: false, error: message, code, ...extra };
}

function isHttpUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function classify(url, contentType = "") {
  const type = contentType.toLowerCase();
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  if (type.includes("mpegurl") || type.includes("dash")) return "stream";
  try {
    const path = new URL(url).pathname.toLowerCase();
    if ([...VIDEO_EXTENSIONS].some((x) => path.endsWith(x))) return "video";
    if ([...AUDIO_EXTENSIONS].some((x) => path.endsWith(x))) return "audio";
  } catch {}
  return "unknown";
}

function absoluteUrl(value, base) {
  try {
    const u = new URL(value, base);
    return isHttpUrl(u.href) ? u.href : null;
  } catch {
    return null;
  }
}

function decodeHtml(value) {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x2F;/gi, "/");
}

function extractMedia(html, pageUrl) {
  const found = new Map();
  const add = (raw, kind = "unknown") => {
    const decoded = decodeHtml(raw);
    const url = absoluteUrl(decoded, pageUrl);
    if (!url) return;
    const existing = found.get(url);
    found.set(url, { url, type: existing?.type !== "unknown" ? existing?.type : kind });
  };

  const patterns = [
    { re: /<(?:video|source)[^>]+src\s*=\s*["']([^"']+)["']/gi, kind: "video" },
    { re: /<(?:video|source)[^>]+src\s*=\s*([^\s>]+)/gi, kind: "video" },
    { re: /<iframe[^>]+src\s*=\s*["']([^"']+)["']/gi, kind: "embed" },
    { re: /["']((?:https?:)?\/\/[^"'\\\s]+\.(?:mp4|webm|mov|m4v)(?:\?[^"'\\\s]*)?)["']/gi, kind: "video" },
    { re: /["']((?:https?:)?\/\/[^"'\\\s]+\.(?:m3u8|mpd)(?:\?[^"'\\\s]*)?)["']/gi, kind: "stream" }
  ];

  for (const { re, kind } of patterns) {
    let match;
    while ((match = re.exec(html)) && found.size < 50) add(match[1], kind);
  }

  return [...found.values()].slice(0, 25);
}

async function fetchPage(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "Downly/1.0 media-detector"
      },
      signal: controller.signal
    });
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok) throw new Error("The website returned HTTP " + response.status);
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
      return { response, html: "" };
    }
    const html = await response.text();
    return { response, html: html.slice(0, 5_000_000) };
  } finally {
    clearTimeout(timeout);
  }
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST" && req.method !== "GET") {
    res.setHeader("Allow", "GET, POST, OPTIONS");
    return res.status(405).json(errorBody("Method not allowed", "METHOD_NOT_ALLOWED"));
  }

  const rawUrl = req.method === "GET" ? req.query?.url : (typeof req.body === "string" ? (() => {
    try { return JSON.parse(req.body)?.url; } catch { return null; }
  })() : req.body?.url);

  if (!isHttpUrl(rawUrl)) return res.status(400).json(errorBody("A valid HTTP(S) webpage URL is required.", "INVALID_URL"));

  try {
    const { response, html } = await fetchPage(rawUrl);
    if (!html) {
      const kind = classify(response.url, response.headers.get("content-type") || "");
      return res.status(200).json({
        ok: true,
        pageUrl: response.url,
        title: null,
        media: kind === "unknown" ? [] : [{ url: response.url, type: kind, contentType: response.headers.get("content-type") || "" }],
        note: "The supplied URL is a media resource rather than an HTML page."
      });
    }

    const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "")
      .replace(/\s+/g, " ").trim().slice(0, 300);

    const media = extractMedia(html, response.url);
    return res.status(200).json({
      ok: true,
      pageUrl: response.url,
      title,
      media,
      count: media.length,
      note: "Only public direct media URLs exposed by the webpage are detected. Protected, DRM, login-only, blob-only and player-internal streams are not bypassed."
    });
  } catch (error) {
    return res.status(502).json(errorBody(
      error?.name === "AbortError" ? "The website took too long to respond." : (error?.message || "Unable to inspect the website."),
      error?.name === "AbortError" ? "UPSTREAM_TIMEOUT" : "UPSTREAM_UNAVAILABLE"
    ));
  }
}

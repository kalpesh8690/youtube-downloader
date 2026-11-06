import { requestPublicUrl, readStreamBuffer } from "../lib/public-https.js";

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
  const { response, url: finalUrl } = await requestPublicUrl(url, {
    timeoutMs: 9000,
    maxRedirects: 3,
    accept: "text/html,application/xhtml+xml"
  });
  const contentType = response.headers["content-type"] || "";
  if (response.statusCode < 200 || response.statusCode >= 300) {
    response.resume();
    throw new Error("The website returned HTTP " + response.statusCode);
  }
  const responseView = {
    url: finalUrl,
    headers: { get: (name) => response.headers[String(name).toLowerCase()] || null }
  };
  if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
    response.destroy();
    return { response: responseView, html: "" };
  }
  const buffer = await readStreamBuffer(response, 5_000_000);
  return { response: responseView, html: buffer.toString("utf8") };
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

  if (typeof rawUrl !== "string" || rawUrl.length > 4096 || !isHttpUrl(rawUrl)) return res.status(400).json(errorBody("A valid HTTP(S) webpage URL is required.", "INVALID_URL"));

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

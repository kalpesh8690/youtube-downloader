import { requestPublicUrl, readStreamBuffer } from "../lib/public-https.js";

const MAX_PAGES = 6;
const MAX_PAGE_BYTES = 3_000_000;
const MAX_MEDIA = 60;
const PAGE_TIMEOUT_MS = 7000;

const VIDEO_EXTENSIONS = new Set([
  ".mp4", ".m4v", ".m4p", ".mkv", ".webm", ".mov", ".avi",
  ".mpg", ".mpeg", ".mpe", ".m1v", ".m2v", ".vob", ".ts",
  ".mts", ".m2ts", ".3gp", ".3g2", ".flv", ".f4v", ".wmv",
  ".asf", ".ogv", ".ogg", ".rm", ".rmvb", ".divx", ".mxf"
]);
const AUDIO_EXTENSIONS = new Set([
  ".mp3", ".m4a", ".m4b", ".m4p", ".aac", ".wav", ".wave",
  ".ogg", ".oga", ".opus", ".flac", ".aiff", ".aif", ".ape",
  ".wma", ".amr", ".mid", ".midi"
]);
const STREAM_EXTENSIONS = new Set([".m3u8", ".mpd"]);

function errorBody(message, code, extra = {}) {
  return { ok: false, error: message, code, ...extra };
}

function isHttpUrl(value) {
  try {
    const u = new URL(value);
    return (u.protocol === "http:" || u.protocol === "https:") && !u.username && !u.password;
  } catch {
    return false;
  }
}

function extensionOf(value) {
  try {
    const path = new URL(value).pathname.toLowerCase();
    const dot = path.lastIndexOf(".");
    return dot >= 0 ? path.slice(dot) : "";
  } catch {
    return "";
  }
}

function classify(value, contentType = "", fallback = "unknown") {
  const type = String(contentType).toLowerCase().split(";")[0].trim();
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  if (type.includes("mpegurl") || type.includes("dash+xml") || type.includes("dash")) return "stream";
  const ext = extensionOf(value);
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  if (AUDIO_EXTENSIONS.has(ext)) return "audio";
  if (STREAM_EXTENSIONS.has(ext)) return "stream";
  return fallback;
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#x3D;/gi, "=")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function attributes(tag) {
  const result = {};
  const re = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let match;
  while ((match = re.exec(tag))) {
    result[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return result;
}

function absoluteUrl(raw, base) {
  try {
    const value = decodeHtml(raw).trim();
    if (!value || value.startsWith("data:") || value.startsWith("blob:")) return null;
    const url = new URL(value, base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

function extractMedia(html, pageUrl) {
  const found = new Map();
  const add = (raw, fallback = "unknown") => {
    const url = absoluteUrl(raw, pageUrl);
    if (!url || !isHttpUrl(url)) return;
    const type = classify(url, "", fallback);
    const previous = found.get(url);
    const finalType = previous && previous.type !== "unknown" ? previous.type : type;
    found.set(url, { url, type: finalType, sourcePage: pageUrl });
  };

  const tagRe = /<(video|audio|source|iframe|meta|a)\b[^>]*>/gi;
  let match;
  while ((match = tagRe.exec(html)) && found.size < MAX_MEDIA) {
    const tagName = match[1].toLowerCase();
    const attrs = attributes(match[0]);
    if (tagName === "meta") {
      const marker = (attrs.property || attrs.name || "").toLowerCase();
      if (["og:video", "og:video:url", "og:audio", "twitter:player:stream"].includes(marker)) {
        add(attrs.content, "unknown");
      }
      continue;
    }
    if (tagName === "iframe") {
      add(attrs.src || attrs["data-src"], "embed");
      continue;
    }
    if (tagName === "a") {
      const href = attrs.href;
      if (href && classify(absoluteUrl(href, pageUrl) || "", "") !== "unknown") add(href);
      continue;
    }
    add(attrs.src || attrs["data-src"] || attrs["data-original"], tagName === "audio" ? "audio" : "video");
  }

  // Catch media URLs exposed in JSON-LD, inline scripts and player configuration.
  const looseUrlRe = /(?:https?:)?\/\/[^"'<>\\\s]+?\.(?:mp4|m4v|mkv|webm|mov|avi|mpg|mpeg|vob|ts|mts|m2ts|3gp|flv|f4v|wmv|asf|ogv|rmvb?|mp3|m4a|aac|wav|ogg|opus|flac|wma|aiff)(?:\?[^"'<>\\\s]*)?/gi;
  let loose;
  while ((loose = looseUrlRe.exec(html)) && found.size < MAX_MEDIA) add(loose[0]);

  return [...found.values()];
}

function extractPageLinks(html, pageUrl) {
  const links = [];
  const seen = new Set();
  const tagRe = /<a\b[^>]*>/gi;
  const currentOrigin = new URL(pageUrl).origin;
  let match;
  while ((match = tagRe.exec(html)) && links.length < 40) {
    const href = attributes(match[0]).href;
    if (!href) continue;
    const url = absoluteUrl(href, pageUrl);
    if (!url || seen.has(url)) continue;
    try {
      const parsed = new URL(url);
      if (parsed.origin !== currentOrigin) continue;
      if (/\.(?:css|js|json|xml|txt|pdf|zip|rar|7z|png|jpe?g|gif|webp|svg|ico|woff2?|ttf|eot)$/i.test(parsed.pathname)) continue;
      seen.add(url);
      links.push(url);
    } catch {}
  }
  return links;
}

async function fetchPage(url) {
  const result = await requestPublicUrl(url, {
    timeoutMs: PAGE_TIMEOUT_MS,
    maxRedirects: 3,
    accept: "text/html,application/xhtml+xml,video/*,audio/*,*/*;q=0.5"
  });
  const response = result.response;
  const contentType = String(response.headers["content-type"] || "").toLowerCase();
  if (response.statusCode < 200 || response.statusCode >= 300) {
    const status = response.statusCode;
    response.resume();
    throw new Error("The website returned HTTP " + status + ".");
  }
  if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
    response.resume();
    return {
      url: result.url,
      contentType,
      html: "",
      contentLength: Number(response.headers["content-length"]) || null
    };
  }
  const buffer = await readStreamBuffer(response, MAX_PAGE_BYTES);
  return {
    url: result.url,
    contentType,
    html: buffer.toString("utf8"),
    contentLength: buffer.length
  };
}

function sendJson(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json(body);
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST" && req.method !== "GET") {
    res.setHeader("Allow", "GET, POST, OPTIONS");
    return sendJson(res, 405, errorBody("Method not allowed.", "METHOD_NOT_ALLOWED"));
  }

  let rawUrl = req.method === "GET" ? req.query?.url : req.body?.url;
  if (typeof req.body === "string") {
    try { rawUrl = JSON.parse(req.body)?.url; }
    catch { rawUrl = null; }
  }
  if (typeof rawUrl !== "string" || rawUrl.length > 4096 || !isHttpUrl(rawUrl)) {
    return sendJson(res, 400, errorBody("Enter a valid public HTTP or HTTPS URL.", "INVALID_URL"));
  }

  const media = new Map();
  const queue = [rawUrl];
  const visited = new Set();
  let pagesScanned = 0;
  let pageTitle = "";
  let firstMediaInfo = null;
  let scanErrors = 0;

  while (queue.length && pagesScanned < MAX_PAGES && media.size < MAX_MEDIA) {
    const current = queue.shift();
    if (visited.has(current)) continue;
    visited.add(current);

    try {
      const page = await fetchPage(current);
      pagesScanned += 1;

      if (!page.html) {
        const type = classify(page.url, page.contentType);
        if (type !== "unknown") {
          media.set(page.url, {
            url: page.url,
            type,
            contentType: page.contentType,
            contentLength: page.contentLength,
            sourcePage: current
          });
        }
        if (current === rawUrl) firstMediaInfo = page;
        continue;
      }

      if (!pageTitle) {
        pageTitle = (page.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "")
          .replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
      }

      for (const item of extractMedia(page.html, page.url)) {
        if (!media.has(item.url)) media.set(item.url, item);
        if (media.size >= MAX_MEDIA) break;
      }

      if (pagesScanned < MAX_PAGES) {
        for (const link of extractPageLinks(page.html, page.url)) {
          if (!visited.has(link) && !queue.includes(link) && queue.length < 30) queue.push(link);
        }
      }
    } catch (error) {
      scanErrors += 1;
      if (pagesScanned === 0) {
        return sendJson(res, 502, errorBody(
          error?.message || "Unable to inspect this website.",
          "UPSTREAM_UNAVAILABLE",
          { pagesScanned: 0 }
        ));
      }
    }
  }

  const items = [...media.values()].slice(0, 25);
  const directCount = items.filter((item) => item.type === "video" || item.type === "audio").length;
  const streamCount = items.filter((item) => item.type === "stream").length;

  return sendJson(res, 200, {
    ok: true,
    pageUrl: firstMediaInfo?.url || rawUrl,
    title: pageTitle || null,
    media: items,
    count: items.length,
    directCount,
    streamCount,
    pagesScanned,
    scanLimit: MAX_PAGES,
    partial: scanErrors > 0,
    note: "Scanned the submitted page and up to " + MAX_PAGES + " same-site HTML pages. Public direct media links are downloadable; HLS/DASH manifests, embeds, login-only, DRM and player-internal sources are reported but not extracted."
  });
}

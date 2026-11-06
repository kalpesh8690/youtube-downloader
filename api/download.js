import { requestPublicUrl } from "../lib/public-https.js";

function fail(res, status, code, message) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json({ ok: false, error: message, code });
}

const DEFAULT_MAX_BYTES = 500 * 1024 * 1024;
const MEDIA_EXTENSIONS = /\.(mp4|m4v|m4p|mkv|webm|mov|avi|mpg|mpeg|mpe|m1v|m2v|vob|ts|mts|m2ts|3gp|3g2|flv|f4v|wmv|asf|ogv|ogg|rm|rmvb|divx|mxf|mp3|m4a|m4b|aac|wav|wave|opus|flac|aiff|aif|ape|wma|amr|mid|midi)$/i;
const MEDIA_MIME_PREFIXES = ["video/", "audio/"];
const MEDIA_MIME_TYPES = new Set([
  "application/mp4",
  "application/x-matroska",
  "application/ogg",
  "application/vnd.rn-realmedia",
  "application/x-shockwave-flash",
  "application/x-msvideo",
  "application/x-flv",
  "application/vnd.ms-asf",
  "application/octet-stream",
  "binary/octet-stream",
  "application/x-download"
]);

function safeFilename(value) {
  const clean = String(value || "")
    .replace(/[\\/]/g, "_")
    .replace(/[^\w.\-() ]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
  return clean || "downly-download.bin";
}

function getInput(req) {
  if (req.method === "GET") {
    return {
      url: typeof req.query?.url === "string" ? req.query.url : "",
      filename: typeof req.query?.filename === "string" ? req.query.filename : ""
    };
  }
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); }
    catch { return null; }
  }
  return body && typeof body === "object" && !Array.isArray(body) ? body : null;
}

function isValidHttpUrl(value) {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:")
      && !url.username && !url.password && value.length <= 4096;
  } catch {
    return false;
  }
}

function isSupportedMedia(contentType, pathname, upstreamFilename = "") {
  const mime = String(contentType || "").split(";")[0].trim().toLowerCase();
  if (MEDIA_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix))) return true;
  if (!MEDIA_MIME_TYPES.has(mime)) return false;
  return MEDIA_EXTENSIONS.test(pathname) || MEDIA_EXTENSIONS.test(upstreamFilename);
}

function parseUpstreamFilename(disposition) {
  const header = String(disposition || "");
  const star = header.match(/filename\*\s*=\s*UTF-8''([^;]+)/i)?.[1];
  if (star) {
    try { return decodeURIComponent(star.replace(/^"|"$/g, "")); } catch {}
  }
  const quoted = header.match(/filename\s*=\s*"([^"]+)"/i)?.[1];
  if (quoted) return quoted;
  return header.match(/filename\s*=\s*([^;]+)/i)?.[1]?.trim() || "";
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST" && req.method !== "GET") {
    res.setHeader("Allow", "GET, POST, OPTIONS");
    return fail(res, 405, "METHOD_NOT_ALLOWED", "Use GET or POST with a direct public media URL.");
  }

  const body = getInput(req);
  if (!body) return fail(res, 400, "INVALID_BODY", "A JSON object containing the media URL is required.");
  const rawUrl = body.url;
  if (typeof rawUrl !== "string" || !isValidHttpUrl(rawUrl)) {
    return fail(res, 400, "INVALID_URL", "A valid public HTTP or HTTPS media URL is required.");
  }

  const configuredLimit = Number(process.env.DOWNLOAD_MAX_BYTES);
  const maxBytes = Number.isFinite(configuredLimit) && configuredLimit > 0
    ? Math.min(configuredLimit, 2 * 1024 * 1024 * 1024)
    : DEFAULT_MAX_BYTES;

  let upstream;
  try {
    const range = typeof req.headers?.range === "string" && /^bytes=\d*-\d*(?:,\d*-\d*)*$/.test(req.headers.range)
      ? req.headers.range
      : null;

    const result = await requestPublicUrl(rawUrl, {
      timeoutMs: 60000,
      maxRedirects: 4,
      accept: "video/*,audio/*,application/octet-stream,application/mp4,application/x-matroska,*/*;q=0.4",
      headers: range ? { Range: range } : {}
    });
    upstream = result.response;

    if (upstream.statusCode !== 200 && upstream.statusCode !== 206) {
      const status = upstream.statusCode || 502;
      const contentRange = upstream.headers["content-range"];
      upstream.resume();
      if (status === 416 && contentRange) res.setHeader("Content-Range", contentRange);
      return fail(res, status === 404 ? 404 : (status === 416 ? 416 : 502), "MEDIA_UNAVAILABLE", "The media host returned HTTP " + status + ".");
    }

    const contentType = String(upstream.headers["content-type"] || "application/octet-stream").split(";")[0].trim().toLowerCase();
    let finalUrl;
    try { finalUrl = new URL(result.url); }
    catch { upstream.destroy(); return fail(res, 502, "INVALID_UPSTREAM_URL", "The media host returned an invalid final URL."); }

    const upstreamName = parseUpstreamFilename(upstream.headers["content-disposition"]);
    if (!isSupportedMedia(contentType, finalUrl.pathname, upstreamName)) {
      upstream.destroy();
      return fail(res, 415, "NOT_DIRECT_MEDIA", "This URL did not return a supported direct video/audio file. Webpages and HLS/DASH playlists must be scanned first.");
    }

    const contentLength = Number(upstream.headers["content-length"]);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      upstream.destroy();
      return fail(res, 413, "FILE_TOO_LARGE", "This file exceeds the configured download size limit.");
    }

    const pathName = finalUrl.pathname.split("/").filter(Boolean).pop() || "downly-download";
    const filename = safeFilename(body.filename || upstreamName || pathName);
    const asciiFilename = filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");

    res.statusCode = upstream.statusCode === 206 ? 206 : 200;
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", 'attachment; filename="' + asciiFilename + '"; filename*=UTF-8\'\'' + encodeURIComponent(filename));
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Downly-Source-Type", contentType);
    res.setHeader("Accept-Ranges", upstream.headers["accept-ranges"] || "bytes");
    if (upstream.headers["content-range"]) res.setHeader("Content-Range", upstream.headers["content-range"]);
    if (Number.isFinite(contentLength) && contentLength >= 0) res.setHeader("Content-Length", String(contentLength));

    let transferred = 0;
    upstream.on("data", (chunk) => {
      transferred += chunk.length;
      if (transferred > maxBytes) {
        upstream.destroy(new Error("Download size limit exceeded."));
        if (!res.destroyed) res.destroy();
      }
    });
    upstream.once("error", () => {
      if (!res.destroyed) res.destroy();
    });
    res.once("close", () => {
      if (!upstream.destroyed) upstream.destroy();
    });

    // Stream directly to the browser. Do not buffer the entire media file in memory.
    upstream.pipe(res);
  } catch (error) {
    if (upstream && !upstream.destroyed) upstream.destroy();
    if (!res.headersSent) {
      return fail(res, 502, "DOWNLOAD_FAILED", error?.message || "Unable to reach the direct media host.");
    }
    res.destroy();
  }
}

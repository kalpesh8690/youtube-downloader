import { requestPublicUrl } from "../lib/public-https.js";

function fail(res, status, code, message) {
  return res.status(status).json({ ok: false, error: message, code });
}

const DEFAULT_MAX_BYTES = 500 * 1024 * 1024;
const MEDIA_EXTENSIONS = /\.(mp4|webm|mov|m4v|mkv|avi|mp3|m4a|aac|wav|ogg|opus|flac)$/i;

function safeFilename(value) {
  const clean = String(value || "")
    .replace(/[\\/]/g, "_")
    .replace(/[^\w.\-() ]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
  return clean || "downly-download.bin";
}

function getBody(req) {
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); }
    catch { return null; }
  }
  return req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : null;
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return fail(res, 405, "METHOD_NOT_ALLOWED", "Use POST to download a direct media URL.");
  }

  const body = getBody(req);
  if (!body) return fail(res, 400, "INVALID_BODY", "A JSON object containing the media URL is required.");
  const rawUrl = body.url;
  if (typeof rawUrl !== "string" || rawUrl.length > 4096) {
    return fail(res, 400, "INVALID_URL", "A valid direct media URL is required.");
  }

  const configuredLimit = Number(process.env.DOWNLOAD_MAX_BYTES);
  const maxBytes = Number.isFinite(configuredLimit) && configuredLimit > 0
    ? Math.min(configuredLimit, 2 * 1024 * 1024 * 1024)
    : DEFAULT_MAX_BYTES;

  let upstream;
  try {
    const result = await requestPublicUrl(rawUrl, {
      httpsOnly: true,
      timeoutMs: 30000,
      maxRedirects: 4,
      accept: "video/*,audio/*,application/octet-stream,*/*;q=0.5"
    });
    upstream = result.response;

    if (upstream.statusCode !== 200 && upstream.statusCode !== 206) {
      const status = upstream.statusCode || 502;
      upstream.resume();
      return fail(res, status === 404 ? 404 : 502, "MEDIA_UNAVAILABLE", "The media host returned HTTP " + status + ".");
    }

    const contentType = String(upstream.headers["content-type"] || "application/octet-stream").split(";")[0].trim().toLowerCase();
    const finalPath = new URL(result.url).pathname;
    const hasMediaExtension = MEDIA_EXTENSIONS.test(finalPath);
    const mediaType = contentType.startsWith("video/") || contentType.startsWith("audio/")
      || contentType === "application/octet-stream" || contentType === "application/mp4"
      || contentType === "application/x-matroska";

    if (!mediaType || (contentType === "application/octet-stream" && !hasMediaExtension)) {
      upstream.destroy();
      return fail(res, 415, "NOT_DIRECT_MEDIA", "The URL did not return a supported direct video or audio file.");
    }

    const contentLength = Number(upstream.headers["content-length"]);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      upstream.destroy();
      return fail(res, 413, "FILE_TOO_LARGE", "This file exceeds the configured download size limit.");
    }

    let filename = safeFilename(body.filename);
    if (!body.filename) {
      const encoded = finalPath.split("/").filter(Boolean).pop() || "downly-download.bin";
      try { filename = safeFilename(decodeURIComponent(encoded)); }
      catch { filename = safeFilename(encoded); }
    }
    const asciiFilename = filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");

    res.statusCode = 200;
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", 'attachment; filename="' + asciiFilename + '"; filename*=UTF-8\'\'' + encodeURIComponent(filename));
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (Number.isFinite(contentLength) && contentLength >= 0) res.setHeader("Content-Length", String(contentLength));

    let transferred = 0;
    upstream.on("data", (chunk) => {
      transferred += chunk.length;
      if (transferred > maxBytes) {
        upstream.destroy(new Error("Download size limit exceeded."));
        if (!res.destroyed) res.destroy();
      }
    });
    upstream.on("error", () => {
      if (!res.destroyed) res.destroy();
    });
    res.on("close", () => {
      if (!upstream.destroyed) upstream.destroy();
    });
    upstream.pipe(res);
  } catch (error) {
    if (upstream && !upstream.destroyed) upstream.destroy();
    if (!res.headersSent) {
      const message = error?.message || "Unable to reach the direct media host.";
      return fail(res, 400, "DOWNLOAD_FAILED", message);
    }
    res.destroy();
  }
}

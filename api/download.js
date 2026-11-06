function fail(res, status, code, message) {
  return res.status(status).json({ ok: false, error: message, code });
}

const DIRECT_HOSTS = new Set(["cdn.example.com"]);

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    res.setHeader("Allow","POST, OPTIONS");
    return fail(res, 405, "METHOD_NOT_ALLOWED", "Method not allowed");
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const rawUrl = body?.url;
    if (typeof rawUrl !== "string" || !rawUrl.trim()) return fail(res, 400, "INVALID_URL", "Media URL is required.");

    const u = new URL(rawUrl.trim());
    if (u.protocol !== "https:") return fail(res, 400, "HTTPS_REQUIRED", "Only HTTPS media URLs are accepted.");
    if (!DIRECT_HOSTS.has(u.hostname.toLowerCase())) {
      return fail(res, 403, "HOST_NOT_ALLOWED", "This endpoint accepts only explicitly authorized direct media hosts. YouTube stream extraction is not provided.");
    }

    const upstream = await fetch(u, { headers: { Accept: "*/*" } });
    if (!upstream.ok || !upstream.body) return fail(res, 502, "UPSTREAM_UNAVAILABLE", "The authorized media source is unavailable.");

    const contentType = upstream.headers.get("content-type") || "application/octet-stream";
    const contentLength = upstream.headers.get("content-length");
    res.statusCode = 200;
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", 'attachment; filename="downly-download"');
    res.setHeader("Cache-Control", "no-store");
    if (contentLength) res.setHeader("Content-Length", contentLength);

    const { Readable } = await import("node:stream");
    Readable.fromWeb(upstream.body).on("error", () => res.destroy()).pipe(res);
  } catch (error) {
    if (!res.headersSent) {
      return fail(res, 400, "INVALID_REQUEST", error?.message === "Unexpected end of JSON input" ? "Invalid JSON body." : "Invalid or unavailable authorized media URL.");
    }
    res.destroy();
  }
}

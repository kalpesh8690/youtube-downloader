function workerUrl() {
  return process.env.YTDLP_WORKER_URL?.replace(/\/$/, "");
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const base = workerUrl();
  if (!base) return res.status(503).json({ ok: false, error: "yt-dlp worker is not configured" });

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); }
    catch { return res.status(400).json({ ok: false, error: "Invalid JSON body" }); }
  }

  if (!body || typeof body.url !== "string") {
    return res.status(400).json({ ok: false, error: "url is required" });
  }

  try {
    const upstream = await fetch(base + "/v1/media/download", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.YTDLP_WORKER_TOKEN
          ? { Authorization: "Bearer " + process.env.YTDLP_WORKER_TOKEN }
          : {})
      },
      body: JSON.stringify({
        url: body.url,
        format: typeof body.format === "string" ? body.format : "best",
        audio_only: Boolean(body.audio_only)
      })
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      return res.status(upstream.status).json({
        ok: false,
        error: text || "yt-dlp worker failed"
      });
    }

    res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/octet-stream");
    const disposition = upstream.headers.get("content-disposition");
    if (disposition) res.setHeader("Content-Disposition", disposition);
    res.setHeader("Cache-Control", "no-store");

    const bodyStream = upstream.body;
    if (!bodyStream) return res.status(502).json({ ok: false, error: "Worker returned an empty response" });

    const reader = bodyStream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
      res.end();
    } finally {
      reader.releaseLock();
    }
  } catch (error) {
    return res.status(502).json({ ok: false, error: error?.message || "Worker unavailable" });
  }
}

function sendError(res, status, code, message) {
  return res.status(status).json({ ok: false, error: message, code });
}

export default function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET, OPTIONS");
    return sendError(res, 405, "METHOD_NOT_ALLOWED", "Method not allowed");
  }

  return res.status(200).json({
    ok: true,
    service: "downly-api",
    version: "1.2.0",
    timestamp: new Date().toISOString()
  });
}

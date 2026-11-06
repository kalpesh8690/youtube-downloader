export default function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET, OPTIONS");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  return res.status(200).json({
    ok: true,
    service: "downly-api",
    version: "1.1.0",
    timestamp: new Date().toISOString()
  });
}

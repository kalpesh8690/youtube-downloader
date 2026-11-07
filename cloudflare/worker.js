const DEFAULT_BACKEND = "https://downly-worker.onrender.com";

function backendPath(pathname) {
  if (pathname === "/api/health") return "/health";
  if (pathname === "/api/media/info") return "/v1/info";
  if (pathname === "/api/media/crawl") return "/v1/crawl";
  if (pathname === "/api/media/stream") return "/v1/stream";
  if (pathname === "/api/media/jobs") return "/v1/jobs";
  if (pathname.startsWith("/api/media/jobs/")) return "/v1/jobs/" + pathname.slice("/api/media/jobs/".length);
  return null;
}

function copyHeaders(request) {
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("content-length");
  return headers;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (!url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    const targetPath = backendPath(url.pathname);
    if (!targetPath) return new Response("Not found", { status: 404 });

    const backend = String(env.RENDER_WORKER_URL || DEFAULT_BACKEND).replace(/\/$/, "");
    const target = new URL(backend + targetPath);
    target.search = url.search;

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET,POST,HEAD,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization, Range",
          "Access-Control-Expose-Headers": "Content-Length, Content-Disposition, Content-Type, Content-Range, Accept-Ranges"
        }
      });
    }

    const headers = copyHeaders(request);
    if (targetPath !== "/health") {
      if (!env.RENDER_WORKER_TOKEN) {
        return new Response(JSON.stringify({ ok: false, error: "Backend authentication is not configured." }), {
          status: 503,
          headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
        });
      }
      headers.set("Authorization", "Bearer " + env.RENDER_WORKER_TOKEN);
    }

    const upstream = await fetch(new Request(target.toString(), {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
      redirect: "follow"
    }));

    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.set("Cache-Control", "no-store");
    responseHeaders.set("X-Downly-Backend", "render-worker");
    responseHeaders.set("Access-Control-Allow-Origin", "*");
    responseHeaders.set("Access-Control-Expose-Headers", "Content-Length, Content-Disposition, Content-Type, Content-Range, Accept-Ranges");

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders
    });
  }
};

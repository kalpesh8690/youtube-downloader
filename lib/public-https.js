import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";

function isPublicIPv4(address) {
  const p = address.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b, c] = p;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0) return false;
  if (a === 192 && b === 2) return false;
  if (a === 192 && b === 88 && c === 99) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

async function resolvePublicIPv4(hostname) {
  const host = hostname.replace(/\.$/, "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("Local and private network addresses are not allowed.");
  }

  const family = net.isIP(host);
  if (family === 4) {
    if (!isPublicIPv4(host)) throw new Error("Private or reserved IP addresses are not allowed.");
    return host;
  }
  if (family === 6 || host.includes(":")) throw new Error("IPv6 media hosts are not supported by this proxy.");

  const records = await dns.lookup(host, { all: true, verbatim: true });
  const ipv4 = records.filter((record) => record.family === 4);
  if (!ipv4.length || ipv4.some((record) => !isPublicIPv4(record.address))) {
    throw new Error("The media host does not resolve only to public IPv4 addresses.");
  }
  return ipv4[0].address;
}

export async function requestPublicUrl(rawUrl, options = {}) {
  const maxRedirects = options.maxRedirects ?? 3;
  const timeoutMs = options.timeoutMs ?? 15000;
  const redirects = options.redirects ?? 0;
  const url = new URL(rawUrl);

  if (url.username || url.password) throw new Error("URLs containing credentials are not allowed.");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && options.httpsOnly !== true)) {
    throw new Error("Only public HTTP(S) URLs are supported.");
  }
  const expectedPort = url.protocol === "https:" ? "443" : "80";
  if (url.port && url.port !== expectedPort) throw new Error("Only standard HTTP and HTTPS ports are supported.");

  const hostname = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  const ip = await resolvePublicIPv4(hostname);
  const transport = url.protocol === "https:" ? https : http;

  const result = await new Promise((resolve, reject) => {
    const request = transport.request({
      protocol: url.protocol,
      hostname,
      port: expectedPort,
      method: "GET",
      path: url.pathname + url.search,
      headers: {
        "User-Agent": "Downly/1.0",
        Accept: options.accept || "*/*",
        ...options.headers
      },
      servername: net.isIP(hostname) ? undefined : hostname,
      lookup: (_host, _lookupOptions, callback) => callback(null, ip, 4)
    }, (response) => resolve(response));

    request.setTimeout(timeoutMs, () => request.destroy(new Error("The media host timed out.")));
    request.once("error", reject);
    request.end();
  });

  const status = result.statusCode || 0;
  if ([301, 302, 303, 307, 308].includes(status)) {
    const location = result.headers.location;
    result.resume();
    if (!location) throw new Error("The media host returned an invalid redirect.");
    if (redirects >= maxRedirects) throw new Error("The media host redirected too many times.");
    const next = new URL(location, url);
    if (options.httpsOnly === true && next.protocol !== "https:") {
      throw new Error("HTTPS redirects are required for downloads.");
    }
    return requestPublicUrl(next.href, { ...options, redirects: redirects + 1 });
  }

  return { response: result, url: url.href };
}

export async function readStreamBuffer(stream, maxBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of stream) {
    total += chunk.length;
    if (total > maxBytes) {
      stream.destroy();
      throw new Error("The webpage is larger than the inspection limit.");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

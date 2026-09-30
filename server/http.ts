import net from "node:net";
import type { OutgoingHttpHeaders } from "node:http";
import type { Req, Res } from "./types";

export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

export class HttpError extends Error {
  status: number;
  headers: Record<string, string>;

  constructor(status: number, message: string, headers?: Record<string, string>) {
    super(message);
    this.status = status;
    this.headers = headers || {};
  }
}

export function firstHeader(value: string | string[] | undefined) {
  return String(Array.isArray(value) ? value[0] : value || "").split(",")[0].trim();
}

/** True when the browser reached us over HTTPS (directly or through Railway's proxy). */
export function isSecure(req: Req) {
  // `encrypted` is only set on TLS sockets.
  return Boolean(req.socket && (req.socket as { encrypted?: boolean }).encrypted) || firstHeader(req.headers["x-forwarded-proto"]).toLowerCase() === "https";
}

export function securityHeaders(req: Req, res: Res) {
  res.setHeader("Content-Security-Policy", CSP);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  if (isSecure(req)) res.setHeader("Strict-Transport-Security", "max-age=31536000");
}

/** Client IP. X-Forwarded-For is only honored when trustProxy is set (number of trusted hops). */
export function clientIp(req: Req, trustProxy: number) {
  const socketIp = (req.socket && req.socket.remoteAddress) || "unknown";
  if (!trustProxy) return normalizeIp(socketIp);
  const raw = req.headers["x-forwarded-for"];
  const hops = String(Array.isArray(raw) ? raw.join(",") : raw || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!hops.length) return normalizeIp(socketIp);
  const idx = trustProxy === Infinity ? 0 : Math.max(0, hops.length - trustProxy);
  return normalizeIp(hops[idx]);
}

function normalizeIp(ip: string) {
  ip = String(ip).replace(/^\[|\]$/g, "");
  if (ip.startsWith("::ffff:") && net.isIPv4(ip.slice(7))) ip = ip.slice(7);
  return ip;
}

export function sendJson(res: Res, status: number, body: unknown, headers: OutgoingHttpHeaders = {}) {
  const buf = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": buf.length,
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(buf);
}

export function sendError(res: Res, status: number, message: string, headers?: OutgoingHttpHeaders) {
  sendJson(res, status, { error: message }, headers);
}

/**
 * Read and parse a JSON body, enforcing a byte limit. The result is unvalidated.
 * @param limit bytes
 */
export function readJson(req: Req, limit: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > limit) {
      req.resume();
      return reject(new HttpError(413, "Request body too large.", { Connection: "close" }));
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    req.on("data", (chunk: Buffer) => {
      if (done) return;
      size += chunk.length;
      if (size > limit) {
        done = true;
        chunks.length = 0;
        req.resume();
        reject(new HttpError(413, "Request body too large.", { Connection: "close" }));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (done) return;
      done = true;
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text.trim()) return resolve({});
      try { resolve(JSON.parse(text)); }
      catch (_) { reject(new HttpError(400, "Request body must be valid JSON.")); }
    });
    req.on("error", (err) => {
      if (done) return;
      done = true;
      reject(err);
    });
  });
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of String(header || "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k || k in out) continue;
    let v = part.slice(i + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    try { out[k] = decodeURIComponent(v); } catch (_) { out[k] = v; }
  }
  return out;
}

export function serializeCookie(
  name: string,
  value: string,
  { maxAge, secure, httpOnly = true, sameSite = "Lax", path = "/" }: { maxAge?: number; secure?: boolean; httpOnly?: boolean; sameSite?: string; path?: string } = {},
) {
  let c = `${name}=${encodeURIComponent(value)}; Path=${path}; SameSite=${sameSite}`;
  if (maxAge !== undefined) c += `; Max-Age=${Math.floor(maxAge)}`;
  if (maxAge === 0) c += "; Expires=Thu, 01 Jan 1970 00:00:00 GMT";
  if (httpOnly) c += "; HttpOnly";
  if (secure) c += "; Secure";
  return c;
}

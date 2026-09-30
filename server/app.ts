import http from "node:http";
import * as auth from "./auth";
import { createStaticHandler } from "./static";
import {
  HttpError, securityHeaders, isSecure, clientIp, sendJson, sendError, readJson,
  parseCookies, serializeCookie, firstHeader,
} from "./http";
import type { JsonFields, Req, Res, Route, ServerConfig, Store, WithApp } from "./types";

export const COOKIE = "ib_session";
const DAY = 24 * 60 * 60 * 1000;
const AUTH_LIMIT = 10 * 1024; // bytes
const STATE_LIMIT = 1024 * 1024; // bytes
const MUTATING = new Set<string | undefined>(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Build the request handler.
 *   config: see loadConfig() in ./config.ts
 *   store:  see ./store.ts
 */
export function createApp({ config, store }: { config: ServerConfig; store: Store }) {
  const serveStatic = createStaticHandler(config.root);
  const limiter = new auth.RateLimiter(config.rateLimit);
  const sessionMs = config.sessionDays * DAY;

  // ---------- helpers ----------

  function sessionCookie(req: Req, token: string) {
    return serializeCookie(COOKIE, token, { maxAge: sessionMs / 1000, secure: isSecure(req) });
  }
  function clearCookie(req: Req) {
    return serializeCookie(COOKIE, "", { maxAge: 0, secure: isSecure(req) });
  }

  async function startSession(req: Req, res: Res, userId: string) {
    const token = auth.newToken();
    await store.createSession(auth.hashToken(token), userId, new Date(Date.now() + sessionMs));
    res.setHeader("Set-Cookie", sessionCookie(req, token));
  }

  /** Current user from the session cookie (sliding expiry), or null. */
  async function currentUser(req: Req, res: Res) {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (!token || token.length > 200) return null;
    const tokenHash = auth.hashToken(token);
    const session = await store.getSession(tokenHash);
    if (!session) return null;
    const now = Date.now();
    if (new Date(session.expiresAt).getTime() <= now) {
      await store.deleteSession(tokenHash);
      res.setHeader("Set-Cookie", clearCookie(req));
      return null;
    }
    const user = await store.getUserById(session.userId);
    if (!user) return null;
    // Slide the expiry forward, at most once an hour per session.
    if (new Date(session.expiresAt).getTime() - now < sessionMs - 60 * 60 * 1000) {
      await store.touchSession(tokenHash, new Date(now + sessionMs));
      res.setHeader("Set-Cookie", sessionCookie(req, token));
    }
    return { user, tokenHash };
  }

  async function requireUser(req: Req, res: Res) {
    const s = await currentUser(req, res);
    if (!s) throw new HttpError(401, "Not signed in.");
    return s;
  }

  /** CSRF: same-origin JSON only for anything that changes data. */
  function checkMutation(req: Req) {
    const origin = req.headers.origin;
    if (origin !== undefined) {
      let host = null;
      try { host = new URL(origin).host; } catch (_) { /* "null" or garbage */ }
      const allowed = new Set([String(req.headers.host || "").toLowerCase()]);
      if (config.trustProxy && req.headers["x-forwarded-host"]) allowed.add(firstHeader(req.headers["x-forwarded-host"]).toLowerCase());
      if (!host || !allowed.has(host.toLowerCase())) throw new HttpError(403, "Cross-origin request blocked.");
    }
    const type = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
    if (type !== "application/json") throw new HttpError(415, "Content-Type must be application/json.");
  }

  function rateLimited(keys: string[]) {
    const wait = Math.max(0, ...keys.map((k) => limiter.retryAfter(k)));
    if (wait) {
      const mins = Math.ceil(wait / 60);
      throw new HttpError(429, `Too many attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"}.`, { "Retry-After": String(wait) });
    }
  }

  function credentials(body: JsonFields) {
    const email = auth.normalizeEmail(body && body.email);
    const password = body && typeof body.password === "string" ? body.password : "";
    return { email, password };
  }

  // ---------- routes ----------

  const routes: Record<string, Route> = {
    "GET /api/health": async (req, res) => sendJson(res, 200, { ok: true }),

    "POST /api/signup": async (req, res, ip) => {
      const body = (await readJson(req, AUTH_LIMIT)) as JsonFields;
      if (!config.allowSignup) throw new HttpError(403, "New sign-ups are turned off on this server.");
      const { email, password } = credentials(body);
      rateLimited([`ip:${ip}`, `email:${email}`]);
      limiter.hit(`ip:${ip}`);
      const bad = auth.validateEmail(email) || auth.validatePassword(password);
      if (bad) throw new HttpError(400, bad);
      const user = await store.createUser(email, await auth.hashPassword(password));
      if (!user) throw new HttpError(409, "An account with that email already exists. Sign in instead.");
      await startSession(req, res, user.id);
      sendJson(res, 201, { email: user.email });
    },

    "POST /api/login": async (req, res, ip) => {
      const body = (await readJson(req, AUTH_LIMIT)) as JsonFields;
      const { email, password } = credentials(body);
      rateLimited([`ip:${ip}`, `email:${email}`]);
      if (!email || !password) throw new HttpError(400, "Enter your email and password.");
      const user = auth.validateEmail(email) ? null : await store.getUserByEmail(email);
      const ok = user ? await auth.verifyPassword(password, user.passwordHash) : await auth.burnPasswordCheck(password);
      if (!ok || !user) { // (user is always set when ok is true; this just narrows its type)
        limiter.hit(`ip:${ip}`);
        limiter.hit(`email:${email}`);
        throw new HttpError(401, "Incorrect email or password.");
      }
      limiter.reset(`email:${email}`);
      await startSession(req, res, user.id);
      sendJson(res, 200, { email: user.email });
    },

    "POST /api/logout": async (req, res) => {
      const token = parseCookies(req.headers.cookie)[COOKIE];
      if (token) await store.deleteSession(auth.hashToken(token));
      res.setHeader("Set-Cookie", clearCookie(req));
      sendJson(res, 200, { ok: true });
    },

    // 200 either way, so a signed-out visitor doesn't log a console error on every page load.
    "GET /api/me": async (req, res) => {
      const s = await currentUser(req, res);
      sendJson(res, 200, { email: s ? s.user.email : null });
    },

    "GET /api/state": async (req, res) => {
      const { user } = await requireUser(req, res);
      const s = await store.getState(user.id);
      sendJson(res, 200, s
        ? { data: s.data, version: s.version, updatedAt: new Date(s.updatedAt).toISOString() }
        : { data: null, version: 0, updatedAt: null });
    },

    "PUT /api/state": async (req, res) => {
      const { user } = await requireUser(req, res);
      const body = (await readJson(req, STATE_LIMIT)) as JsonFields;
      const { data, baseVersion } = body || {};
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new HttpError(400, "Body needs a data object.");
      // (typeof is implied by Number.isInteger; it narrows baseVersion to a number.)
      if (typeof baseVersion !== "number" || !Number.isInteger(baseVersion) || baseVersion < 0) throw new HttpError(400, "Body needs baseVersion, a whole number.");
      let r;
      try {
        r = await store.putState(user.id, data, baseVersion);
      } catch (err) {
        const e = err as { code?: unknown } | null | undefined;
        if (e && (e.code === "22P05" || e.code === "22P02")) throw new HttpError(400, "Data contains characters that can't be stored.");
        throw err;
      }
      if (!r.ok) {
        const c = r.current;
        return sendJson(res, 409, {
          error: "Your account has newer data.",
          data: c.data,
          version: c.version,
          updatedAt: c.updatedAt ? new Date(c.updatedAt).toISOString() : null,
        });
      }
      sendJson(res, 200, { version: r.version, updatedAt: new Date(r.updatedAt).toISOString() });
    },

    "DELETE /api/account": async (req, res, ip) => {
      const { user } = await requireUser(req, res);
      const body = (await readJson(req, AUTH_LIMIT)) as JsonFields;
      const key = `delete:${user.id}`;
      rateLimited([key, `ip:${ip}`]);
      const password = body && typeof body.password === "string" ? body.password : "";
      if (!password || !(await auth.verifyPassword(password, user.passwordHash))) {
        limiter.hit(key);
        throw new HttpError(403, "Incorrect password.");
      }
      await store.deleteUser(user.id);
      res.setHeader("Set-Cookie", clearCookie(req));
      sendJson(res, 200, { ok: true });
    },
  };

  const apiPaths = new Set(Object.keys(routes).map((k) => k.split(" ")[1]));

  async function handle(req: Req, res: Res) {
    securityHeaders(req, res);
    // Take the path as sent (no URL normalization), so "//x" or "/css/../x" can't be reinterpreted.
    let pathname = String(req.url || "").split(/[?#]/)[0];
    if (!pathname.startsWith("/")) {
      try { pathname = new URL(pathname).pathname; } catch (_) { return sendError(res, 400, "Bad request."); }
    }

    if (pathname === "/api" || pathname.startsWith("/api/")) {
      const route = routes[`${req.method} ${pathname}`];
      if (!route) {
        if (apiPaths.has(pathname)) return sendError(res, 405, "Method not allowed.");
        return sendError(res, 404, "Not found.");
      }
      if (MUTATING.has(req.method)) checkMutation(req);
      return route(req, res, clientIp(req, config.trustProxy));
    }

    if (await serveStatic(req, res, pathname)) return;
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" });
    res.end("Not found");
  }

  function handler(req: Req, res: Res) {
    handle(req, res).catch((err: unknown) => {
      if (res.headersSent) { res.destroy(); return; }
      if (err instanceof HttpError) return sendError(res, err.status, err.message, err.headers);
      // req.url is always set on requests an http.Server receives.
      console.error("[server]", req.method, req.url!.split("?")[0], err);
      sendError(res, 500, "Something went wrong on the server.");
    });
  }

  // Drop expired sessions once an hour.
  const sweeper = setInterval(() => {
    store.deleteExpiredSessions(new Date()).catch((err: Error) => console.error("[server] session sweep failed:", err.message));
  }, 60 * 60 * 1000);
  sweeper.unref();

  return {
    handler,
    limiter,
    close() {
      clearInterval(sweeper);
      limiter.close();
    },
  };
}

/** Create (but don't start) an http.Server around the app. */
export function createServer({ config, store }: Parameters<typeof createApp>[0]) {
  const app = createApp({ config, store });
  // `app` is attached just below.
  const server = http.createServer(app.handler) as WithApp<typeof app>;
  server.keepAliveTimeout = 65 * 1000; // outlive typical proxy idle timeouts
  server.headersTimeout = 66 * 1000;
  server.requestTimeout = 30 * 1000;
  server.on("close", () => app.close());
  server.app = app;
  return server;
}

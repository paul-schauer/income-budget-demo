import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import { loadConfig, parseTrustProxy, ROOT } from "../server/config";
import { MemoryStore, FileStore, PgStore, pgOptions } from "../server/store";
import { createServer, COOKIE } from "../server/app";
import { resolveStaticPath } from "../server/static";
import * as authLib from "../server/auth";
import type { ServerConfig, Store } from "../server/types";

// ---------- helpers ----------

async function start({ config: overrides = {}, store = new MemoryStore() }: { config?: Partial<ServerConfig>; store?: MemoryStore } = {}) {
  // A generous rate limit so unrelated tests don't trip it; the rate-limit tests pass the real one.
  const config: ServerConfig = { ...loadConfig({ NODE_ENV: "test" }), rateLimit: { max: 1000, windowMs: 60000 }, ...overrides };
  await store.init();
  const server = createServer({ config, store });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    port,
    store,
    server,
    close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}
type Running = Awaited<ReturnType<typeof start>>;

/** The API's JSON bodies, loosely: each test reads the fields it expects. */
interface ApiJson {
  ok?: boolean;
  email?: string | null;
  error?: string;
  data?: Record<string, unknown> | null;
  version?: number;
  updatedAt?: string | null;
}

interface TestResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  text: string;
  /** The parsed body, or {} when it isn't JSON. */
  json: ApiJson;
}

/** A value the test needs to be there. */
function must<T>(value: T | null | undefined, what = "value"): T {
  assert.ok(value, `${what} is missing`);
  return value;
}

/** /api/me answers 200 with email null when nobody is signed in. */
function assertSignedOut(res: TestResponse) {
  assert.equal(res.status, 200);
  assert.equal(res.json.email, null);
}

/** Raw HTTP request with full control over the path and headers. */
function request(
  port: number,
  method: string,
  rawPath: string,
  { body, headers = {}, cookie }: { body?: unknown; headers?: Record<string, string>; cookie?: string } = {},
): Promise<TestResponse> {
  return new Promise((resolve, reject) => {
    const h: http.OutgoingHttpHeaders = { ...headers };
    let payload: Buffer | undefined;
    if (body !== undefined) {
      payload = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
      if (!Object.keys(h).some((k) => k.toLowerCase() === "content-type")) h["Content-Type"] = "application/json";
      h["Content-Length"] = payload.length;
    }
    if (cookie) h.Cookie = `${COOKIE}=${cookie}`;
    const req = http.request({ host: "127.0.0.1", port, method, path: rawPath, headers: h, agent: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json: ApiJson = {};
        try { json = JSON.parse(text); } catch (_) { /* not json */ }
        resolve({ status: res.statusCode!, headers: res.headers, text, json });
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function sessionFrom(res: TestResponse) {
  const set = (res.headers["set-cookie"] || []).find((c) => c.startsWith(`${COOKIE}=`));
  if (!set) return null;
  return decodeURIComponent(set.split(";")[0].slice(COOKIE.length + 1));
}

/** The first Set-Cookie header of a response that must have one. */
const setCookie = (res: TestResponse) => must(res.headers["set-cookie"], "Set-Cookie")[0];

async function signup(port: number, email = "user@example.com", password = "correct horse", headers: Record<string, string> = {}) {
  const res = await request(port, "POST", "/api/signup", { body: { email, password }, headers });
  assert.equal(res.status, 201, res.text);
  return must(sessionFrom(res), "session cookie");
}

// ---------- static files ----------

describe("static files", () => {
  // A stand-in for the repository: the server serves public/, and secrets sit both next to
  // it and inside it (files that must never be served even from the static root).
  let repo: string;
  let srv: Running;

  before(async () => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "ib-static-"));
    const w = (rel: string, text: string) => {
      fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
      fs.writeFileSync(path.join(repo, rel), text);
    };
    // The allowlist.
    w("public/index.html", "<!doctype html><title>t</title>");
    w("public/styles.css", "body{}");
    w("public/app.js", `console.log(${JSON.stringify("x".repeat(3000))})`);
    w("public/app.js.map", '{"version":3}');
    w("public/manifest.webmanifest", '{"name":"t"}');
    w("public/sw.js", "self.addEventListener('fetch',()=>{})");
    w("public/css/sync.css", ".a{}");
    w("public/css/lib/nested.css", ".b{}");
    w("public/icons/icon.svg", "<svg xmlns='http://www.w3.org/2000/svg'/>");
    w("public/icons/icon-192.png", "\x89PNG");
    // Inside public/ but not allowlisted.
    w("public/icons/README", "no extension");
    w("public/css/.hidden.css", "secret");
    w("public/README.md", "readme");
    w("public/package.json", "secret");
    w("public/main.ts", "secret");
    w("public/js/app.js", "secret");
    w("public/src/app/core.ts", "secret");
    w("public/server/app.ts", "secret");
    w("public/dist/server.js", "secret");
    w("public/test/x.test.ts", "secret");
    w("public/.env", "SECRET=1");
    w("public/.git/config", "secret");
    w("public/data/dev-db.json", "secret");
    w("public/node_modules/pg/package.json", "secret");
    // The rest of the repository.
    w("package.json", "secret");
    w("src/app/core.ts", "secret");
    w("server/app.ts", "secret");
    w("dist/server.js", "secret");
    w("test/x.test.ts", "secret");
    w(".env", "SECRET=1");
    w("data/dev-db.json", "secret");
    fs.symlinkSync(path.join(repo, "public", "package.json"), path.join(repo, "public", "css", "link.css"));
    fs.symlinkSync(path.join(repo, "package.json"), path.join(repo, "public", "css", "outside.css"));
    srv = await start({ config: { root: path.join(repo, "public") } });
  });

  after(async () => {
    await srv.close();
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it("serves the allowlist with the right content types", async () => {
    const cases = [
      ["/", "text/html; charset=utf-8"],
      ["/index.html", "text/html; charset=utf-8"],
      ["/styles.css", "text/css; charset=utf-8"],
      ["/app.js", "text/javascript; charset=utf-8"],
      ["/app.js.map", "application/json; charset=utf-8"],
      ["/manifest.webmanifest", "application/manifest+json; charset=utf-8"],
      ["/sw.js", "text/javascript; charset=utf-8"],
      ["/css/sync.css", "text/css; charset=utf-8"],
      ["/css/lib/nested.css", "text/css; charset=utf-8"],
      ["/icons/icon.svg", "image/svg+xml"],
      ["/icons/icon-192.png", "image/png"],
    ];
    for (const [p, type] of cases) {
      const res = await request(srv.port, "GET", p);
      assert.equal(res.status, 200, p);
      assert.equal(res.headers["content-type"], type, p);
    }
  });

  it("uses no-cache for html, sw.js and the manifest, max-age plus validators for assets", async () => {
    for (const p of ["/", "/sw.js", "/manifest.webmanifest"]) {
      assert.equal((await request(srv.port, "GET", p)).headers["cache-control"], "no-cache", p);
    }
    for (const p of ["/app.js", "/css/sync.css", "/icons/icon.svg", "/styles.css"]) {
      const res = await request(srv.port, "GET", p);
      assert.match(must(res.headers["cache-control"], p), /max-age=\d+/, p);
      assert.ok(res.headers.etag, p);
      assert.ok(res.headers["last-modified"], p);
    }
  });

  it("answers conditional requests with 304", async () => {
    const first = await request(srv.port, "GET", "/app.js");
    const again = await request(srv.port, "GET", "/app.js", { headers: { "If-None-Match": must(first.headers.etag, "ETag") } });
    assert.equal(again.status, 304);
    assert.equal(again.text, "");
  });

  it("gzips text when asked", async () => {
    const res = await request(srv.port, "GET", "/app.js", { headers: { "Accept-Encoding": "gzip, br" } });
    assert.equal(res.headers["content-encoding"], "gzip");
    assert.equal(res.headers.vary, "Accept-Encoding");
  });

  it("supports HEAD and rejects other methods", async () => {
    const head = await request(srv.port, "HEAD", "/");
    assert.equal(head.status, 200);
    assert.equal(head.text, "");
    const post = await request(srv.port, "POST", "/", { body: "x", headers: { "Content-Type": "text/plain" } });
    assert.equal(post.status, 405);
  });

  it("never serves files outside the allowlist", async () => {
    const blocked = [
      "/package.json", "/main.ts", "/js/app.js", "/src/app/core.ts", "/server/app.ts", "/dist/server.js",
      "/test/x.test.ts", "/.env", "/.git/config", "/data/dev-db.json", "/node_modules/pg/package.json",
      "/README.md", "/icons/README", "/css/.hidden.css", "/css/", "/css", "/icons", "/nope.html",
      "/css/missing.css", "/css/link.css", "/css/outside.css",
    ];
    for (const p of blocked) assert.equal((await request(srv.port, "GET", p)).status, 404, p);
  });

  it("blocks path traversal", async () => {
    const attempts = [
      "/css/../package.json", "/css/../../package.json", "/css/..%2f..%2fpackage.json", "/css/%2e%2e/%2e%2e/package.json",
      "/css/%2e%2e%2f%2e%2e%2fsrc/app/core.ts", "/css/..%5c..%5cpackage.json", "/css/%00.css", "//package.json",
      "/css//sync.css", "/icons/../../etc/passwd", "/%2e%2e/%2e%2e/etc/passwd", "/%2e%2e/package.json",
      "/..%2fdist%2fserver.js", "/%2e%2e/server/app.ts", "/css/.hidden.css", "/css/%E0%A4%A.css",
    ];
    for (const p of attempts) {
      const res = await request(srv.port, "GET", p);
      assert.ok(res.status === 404 || res.status === 400, `${p} -> ${res.status}`);
      assert.doesNotMatch(res.text, /secret|"name"/i, p);
    }
  });

  it("resolveStaticPath maps only allowlisted paths", () => {
    assert.equal(resolveStaticPath("/"), "index.html");
    assert.equal(resolveStaticPath("/app.js"), "app.js");
    assert.equal(resolveStaticPath("/app.js.map"), "app.js.map");
    assert.equal(resolveStaticPath("/sw.js"), "sw.js");
    assert.equal(resolveStaticPath("/css/sync.css"), "css/sync.css");
    assert.equal(resolveStaticPath("/css/../server/app.ts"), null);
    assert.equal(resolveStaticPath("/server/app.ts"), null);
    assert.equal(resolveStaticPath("/src/app/core.ts"), null);
    assert.equal(resolveStaticPath("/dist/server.js"), null);
    assert.equal(resolveStaticPath("/js/app.js"), null);
    assert.equal(resolveStaticPath("/css/a%2Fb.css"), null);
  });
});

describe("the real app folder", () => {
  let srv: Running;
  before(async () => { srv = await start(); });
  after(() => srv.close());

  it("serves public/ by default", () => {
    assert.equal(loadConfig({}).root, path.join(ROOT, "public"));
  });

  it("serves the built app but not source, server, test or package files", async () => {
    const home = await request(srv.port, "GET", "/");
    assert.equal(home.status, 200);
    assert.match(home.text, /<div id="syncSlot"/);
    // app.js and app.js.map come from npm run build.
    for (const p of ["/app.js", "/app.js.map", "/styles.css", "/css/sync.css", "/icons/icon.svg", "/manifest.webmanifest"]) {
      assert.equal((await request(srv.port, "GET", p)).status, 200, p);
    }
    for (const p of [
      "/src/app/core.ts", "/src/app/main.ts", "/server/app.ts", "/server/index.ts", "/dist/server.js", "/test/server.test.ts",
      "/package.json", "/package-lock.json", "/tsconfig.json", "/scripts/build.mjs", "/.gitignore", "/railway.json",
      "/server.js", "/js/app.js", "/css/../../package.json", "/%2e%2e/src/app/core.ts",
    ]) {
      assert.equal((await request(srv.port, "GET", p)).status, 404, p);
    }
  });

  it("stamps the built sw.js with a content hash so deploys trigger an update", async () => {
    const sw = await request(srv.port, "GET", "/sw.js");
    assert.equal(sw.status, 200);
    // esbuild may emit the const as var; either way the server stamps it.
    const m = /\b(?:const|var) VERSION = "([0-9a-f]{12})";/.exec(sw.text);
    assert.ok(m, "VERSION is stamped");
    assert.equal(sw.headers.etag, `W/"sw-${m[1]}"`);
    assert.equal(sw.headers["cache-control"], "no-cache");
    const again = await request(srv.port, "GET", "/sw.js", { headers: { "If-None-Match": sw.headers.etag } });
    assert.equal(again.status, 304);
  });
});

// ---------- headers ----------

describe("security headers", () => {
  let srv: Running;
  before(async () => { srv = await start(); });
  after(() => srv.close());

  it("sets CSP, nosniff and referrer policy on every response", async () => {
    for (const p of ["/", "/api/health", "/api/me", "/nope"]) {
      const res = await request(srv.port, "GET", p);
      assert.equal(res.headers["content-security-policy"],
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'", p);
      assert.equal(res.headers["x-content-type-options"], "nosniff", p);
      assert.equal(res.headers["referrer-policy"], "same-origin", p);
    }
  });

  it("adds HSTS and Secure cookies only behind HTTPS", async () => {
    const plain = await request(srv.port, "GET", "/");
    assert.equal(plain.headers["strict-transport-security"], undefined);
    const https = await request(srv.port, "GET", "/", { headers: { "X-Forwarded-Proto": "https" } });
    assert.match(must(https.headers["strict-transport-security"], "HSTS"), /max-age=\d+/);

    const res = await request(srv.port, "POST", "/api/signup", {
      body: { email: "secure@example.com", password: "password123" },
      headers: { "X-Forwarded-Proto": "https" },
    });
    assert.match(setCookie(res), /; Secure/);
    const res2 = await request(srv.port, "POST", "/api/signup", { body: { email: "plain@example.com", password: "password123" } });
    assert.doesNotMatch(setCookie(res2), /Secure/);
  });

  it("API responses are JSON and not cached", async () => {
    const res = await request(srv.port, "GET", "/api/health");
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { ok: true });
    assert.equal(res.headers["cache-control"], "no-store");
    const missing = await request(srv.port, "GET", "/api/nope");
    assert.equal(missing.status, 404);
    assert.ok(missing.json.error);
    const wrongMethod = await request(srv.port, "GET", "/api/login");
    assert.equal(wrongMethod.status, 405);
  });
});

// ---------- auth ----------

describe("accounts", () => {
  let srv: Running;
  before(async () => { srv = await start(); });
  after(() => srv.close());

  it("signs up, reads /me, logs out and logs back in", async () => {
    const res = await request(srv.port, "POST", "/api/signup", { body: { email: "  Pat@Example.COM ", password: "hunter2hunter2" } });
    assert.equal(res.status, 201);
    assert.deepEqual(res.json, { email: "pat@example.com" });
    const cookie = setCookie(res);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.match(cookie, /Path=\//);
    assert.match(cookie, /Max-Age=2592000/);
    const token = must(sessionFrom(res), "session cookie");
    assert.equal(Buffer.from(token, "base64url").length, 32);

    const me = await request(srv.port, "GET", "/api/me", { cookie: token });
    assert.equal(me.status, 200);
    assert.deepEqual(me.json, { email: "pat@example.com" });

    const out = await request(srv.port, "POST", "/api/logout", { body: {}, cookie: token });
    assert.equal(out.status, 200);
    assert.match(setCookie(out), /Max-Age=0/);
    assertSignedOut(await request(srv.port, "GET", "/api/me", { cookie: token }));

    const login = await request(srv.port, "POST", "/api/login", { body: { email: "PAT@example.com", password: "hunter2hunter2" } });
    assert.equal(login.status, 200);
    assert.deepEqual(login.json, { email: "pat@example.com" });
    const token2 = must(sessionFrom(login), "session cookie");
    assert.notEqual(token2, token);
    assert.equal((await request(srv.port, "GET", "/api/me", { cookie: token2 })).status, 200);
  });

  it("stores only a SHA-256 hash of the session token and a scrypt password hash", async () => {
    const token = await signup(srv.port, "hash@example.com", "some password");
    const hash = crypto.createHash("sha256").update(token).digest("hex");
    assert.ok(srv.store.sessions.has(hash));
    assert.ok(![...srv.store.sessions.keys()].includes(token));
    const user = must(await srv.store.getUserByEmail("hash@example.com"), "user");
    assert.match(user.passwordHash, /^scrypt\$/);
    assert.ok(!user.passwordHash.includes("some password"));
  });

  it("rejects a wrong password and unknown emails the same way", async () => {
    await signup(srv.port, "wrong@example.com", "right password");
    const bad = await request(srv.port, "POST", "/api/login", { body: { email: "wrong@example.com", password: "wrong password" } });
    assert.equal(bad.status, 401);
    assert.equal(bad.headers["set-cookie"], undefined);
    const unknown = await request(srv.port, "POST", "/api/login", { body: { email: "nobody@example.com", password: "wrong password" } });
    assert.equal(unknown.status, 401);
    assert.equal(unknown.json.error, bad.json.error);
  });

  it("rejects duplicate emails regardless of case", async () => {
    await signup(srv.port, "dupe@example.com", "password123");
    const again = await request(srv.port, "POST", "/api/signup", { body: { email: "DUPE@example.com", password: "password456" } });
    assert.equal(again.status, 409);
    assert.ok(again.json.error);
  });

  it("validates email and password", async () => {
    const short = await request(srv.port, "POST", "/api/signup", { body: { email: "short@example.com", password: "1234567" } });
    assert.equal(short.status, 400);
    assert.match(must(short.json.error, "error"), /8 characters/);
    const bad = await request(srv.port, "POST", "/api/signup", { body: { email: "not-an-email", password: "password123" } });
    assert.equal(bad.status, 400);
    const missing = await request(srv.port, "POST", "/api/login", { body: {} });
    assert.equal(missing.status, 400);
    const badJson = await request(srv.port, "POST", "/api/login", { body: "{nope" });
    assert.equal(badJson.status, 400);
  });

  it("ignores garbage and expired session cookies, and slides the expiry", async () => {
    assertSignedOut(await request(srv.port, "GET", "/api/me", { cookie: "garbage" }));

    const token = await signup(srv.port, "expiry@example.com", "password123");
    const hash = authLib.hashToken(token);

    // Sliding: an older session gets pushed back out to 30 days.
    const session = must(srv.store.sessions.get(hash), "session");
    session.expiresAt = new Date(Date.now() + 5 * 86400000);
    const me = await request(srv.port, "GET", "/api/me", { cookie: token });
    assert.equal(me.status, 200);
    assert.match(setCookie(me), /Max-Age=2592000/);
    assert.ok(session.expiresAt.getTime() > Date.now() + 29 * 86400000);

    // A fresh session isn't rewritten on every request.
    const again = await request(srv.port, "GET", "/api/me", { cookie: token });
    assert.equal(again.headers["set-cookie"], undefined);

    session.expiresAt = new Date(Date.now() - 1000);
    assertSignedOut(await request(srv.port, "GET", "/api/me", { cookie: token }));
    assert.equal(srv.store.sessions.has(hash), false);
  });
});

describe("config", () => {
  it("picks the store from the environment", () => {
    assert.equal(loadConfig({}).dataFile, null);
    assert.equal(loadConfig({}).databaseUrl, null);
    assert.equal(loadConfig({ NODE_ENV: "development" }).dataFile, path.join(ROOT, "data", "dev-db.json"));
    assert.equal(loadConfig({ DATA_FILE: "tmp/x.json" }).dataFile, path.join(ROOT, "tmp", "x.json"));
    assert.equal(loadConfig({ DATABASE_URL: "postgres://x/y" }).databaseUrl, "postgres://x/y");
    assert.equal(loadConfig({}).port, 3000);
    assert.equal(loadConfig({ PORT: "8080" }).port, 8080);
  });
});

describe("ALLOW_SIGNUP", () => {
  it("parses from the environment", () => {
    assert.equal(loadConfig({}).allowSignup, true);
    assert.equal(loadConfig({ ALLOW_SIGNUP: "true" }).allowSignup, true);
    assert.equal(loadConfig({ ALLOW_SIGNUP: "false" }).allowSignup, false);
    assert.equal(loadConfig({ ALLOW_SIGNUP: "0" }).allowSignup, false);
  });

  it("returns 403 for sign-ups when false, but existing users can still log in", async () => {
    const store = new MemoryStore();
    await store.createUser("old@example.com", await authLib.hashPassword("password123"));
    const srv = await start({ config: { allowSignup: false }, store });
    try {
      const res = await request(srv.port, "POST", "/api/signup", { body: { email: "new@example.com", password: "password123" } });
      assert.equal(res.status, 403);
      assert.ok(res.json.error);
      const login = await request(srv.port, "POST", "/api/login", { body: { email: "old@example.com", password: "password123" } });
      assert.equal(login.status, 200);
    } finally {
      await srv.close();
    }
  });
});

describe("rate limiting", () => {
  const DEFAULT_LIMIT = loadConfig({}).rateLimit;

  it("defaults to 10 attempts per 15 minutes", () => {
    assert.deepEqual(DEFAULT_LIMIT, { max: 10, windowMs: 15 * 60 * 1000 });
  });

  it("limits failed logins per email, even across IPs", async () => {
    const srv = await start({ config: { trustProxy: 1, rateLimit: DEFAULT_LIMIT } });
    try {
      await signup(srv.port, "target@example.com", "the real password", { "X-Forwarded-For": "10.0.0.1" });
      for (let i = 0; i < 10; i++) {
        const res = await request(srv.port, "POST", "/api/login", {
          body: { email: "target@example.com", password: `guess ${i}` },
          headers: { "X-Forwarded-For": `10.0.1.${i}` },
        });
        assert.equal(res.status, 401);
      }
      const blocked = await request(srv.port, "POST", "/api/login", {
        body: { email: "target@example.com", password: "the real password" },
        headers: { "X-Forwarded-For": "10.0.2.1" },
      });
      assert.equal(blocked.status, 429);
      assert.ok(Number(blocked.headers["retry-after"]) > 0);
      assert.ok(blocked.json.error);
    } finally {
      await srv.close();
    }
  });

  it("limits attempts per IP, across emails", async () => {
    const srv = await start({ config: { trustProxy: 1, rateLimit: DEFAULT_LIMIT } });
    try {
      const ip = { "X-Forwarded-For": "203.0.113.9" };
      for (let i = 0; i < 10; i++) {
        const res = await request(srv.port, "POST", "/api/login", { body: { email: `x${i}@example.com`, password: "password123" }, headers: ip });
        assert.equal(res.status, 401);
      }
      const blocked = await request(srv.port, "POST", "/api/signup", { body: { email: "fresh@example.com", password: "password123" }, headers: ip });
      assert.equal(blocked.status, 429);
      // Another IP is unaffected.
      const other = await request(srv.port, "POST", "/api/signup", { body: { email: "fresh@example.com", password: "password123" }, headers: { "X-Forwarded-For": "203.0.113.10" } });
      assert.equal(other.status, 201);
    } finally {
      await srv.close();
    }
  });

  it("limits sign-ups per IP", async () => {
    const srv = await start({ config: { rateLimit: DEFAULT_LIMIT } });
    try {
      for (let i = 0; i < 10; i++) await signup(srv.port, `many${i}@example.com`, "password123");
      const res = await request(srv.port, "POST", "/api/signup", { body: { email: "many10@example.com", password: "password123" } });
      assert.equal(res.status, 429);
    } finally {
      await srv.close();
    }
  });

  it("ignores X-Forwarded-For unless TRUST_PROXY is set", async () => {
    const srv = await start({ config: { trustProxy: 0, rateLimit: DEFAULT_LIMIT } });
    try {
      for (let i = 0; i < 10; i++) {
        await request(srv.port, "POST", "/api/login", { body: { email: `s${i}@example.com`, password: "password123" }, headers: { "X-Forwarded-For": `198.51.100.${i}` } });
      }
      const res = await request(srv.port, "POST", "/api/login", { body: { email: "s99@example.com", password: "password123" }, headers: { "X-Forwarded-For": "198.51.100.200" } });
      assert.equal(res.status, 429);
    } finally {
      await srv.close();
    }
  });

  it("parses TRUST_PROXY", () => {
    assert.equal(parseTrustProxy({}), 0);
    assert.equal(parseTrustProxy({ TRUST_PROXY: "1" }), 1);
    assert.equal(parseTrustProxy({ TRUST_PROXY: "0" }), 0);
    assert.equal(parseTrustProxy({ TRUST_PROXY: "true" }), Infinity);
    assert.equal(parseTrustProxy({ RAILWAY_ENVIRONMENT_NAME: "production" }), 1);
    assert.equal(parseTrustProxy({ RAILWAY_ENVIRONMENT_NAME: "production", TRUST_PROXY: "0" }), 0);
  });
});

// ---------- CSRF ----------

describe("CSRF protection", () => {
  let srv: Running;
  let token: string;
  before(async () => {
    srv = await start();
    token = await signup(srv.port, "csrf@example.com", "password123");
  });
  after(() => srv.close());

  it("requires application/json on mutating requests", async () => {
    const form = await request(srv.port, "POST", "/api/login", {
      body: "email=csrf%40example.com&password=password123",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    assert.equal(form.status, 415);
    const text = await request(srv.port, "POST", "/api/logout", { body: "{}", headers: { "Content-Type": "text/plain" }, cookie: token });
    assert.equal(text.status, 415);
    const none = await request(srv.port, "PUT", "/api/state", { body: Buffer.from('{"data":{},"baseVersion":0}'), headers: { "Content-Type": "" }, cookie: token });
    assert.equal(none.status, 415);
    const del = await request(srv.port, "DELETE", "/api/account", { body: "password=password123", headers: { "Content-Type": "multipart/form-data; boundary=x" }, cookie: token });
    assert.equal(del.status, 415);
    // Still signed in: none of those did anything.
    assert.equal((await request(srv.port, "GET", "/api/me", { cookie: token })).status, 200);
  });

  it("rejects a foreign Origin", async () => {
    const res = await request(srv.port, "PUT", "/api/state", {
      body: { data: { x: 1 }, baseVersion: 0 },
      headers: { Origin: "https://evil.example" },
      cookie: token,
    });
    assert.equal(res.status, 403);
    const nullOrigin = await request(srv.port, "POST", "/api/logout", { body: {}, headers: { Origin: "null" }, cookie: token });
    assert.equal(nullOrigin.status, 403);
    assert.equal((await request(srv.port, "GET", "/api/state", { cookie: token })).json.version, 0);
  });

  it("accepts a matching Origin", async () => {
    const res = await request(srv.port, "PUT", "/api/state", {
      body: { data: { x: 1 }, baseVersion: 0 },
      headers: { Origin: `http://127.0.0.1:${srv.port}` },
      cookie: token,
    });
    assert.equal(res.status, 200);
  });
});

// ---------- state ----------

describe("state sync", () => {
  let srv: Running;
  let token: string;
  before(async () => {
    srv = await start();
    token = await signup(srv.port, "state@example.com", "password123");
  });
  after(() => srv.close());

  it("requires a session", async () => {
    assert.equal((await request(srv.port, "GET", "/api/state")).status, 401);
    assert.equal((await request(srv.port, "PUT", "/api/state", { body: { data: {}, baseVersion: 0 } })).status, 401);
  });

  it("starts empty, then stores versions", async () => {
    const empty = await request(srv.port, "GET", "/api/state", { cookie: token });
    assert.equal(empty.status, 200);
    assert.deepEqual(empty.json, { data: null, version: 0, updatedAt: null });

    const doc = { updatedAt: 123, items: [{ id: "a", name: "Rent", amount: 1250 }], income: { salary: 60000 } };
    const put = await request(srv.port, "PUT", "/api/state", { body: { data: doc, baseVersion: 0 }, cookie: token });
    assert.equal(put.status, 200);
    assert.equal(put.json.version, 1);
    assert.ok(!Number.isNaN(Date.parse(must(put.json.updatedAt, "updatedAt"))));

    const got = await request(srv.port, "GET", "/api/state", { cookie: token });
    assert.deepEqual(got.json.data, doc);
    assert.equal(got.json.version, 1);

    const put2 = await request(srv.port, "PUT", "/api/state", { body: { data: { ...doc, updatedAt: 456 }, baseVersion: 1 }, cookie: token });
    assert.equal(put2.json.version, 2);
  });

  it("returns 409 with the current copy when baseVersion is stale", async () => {
    const res = await request(srv.port, "PUT", "/api/state", { body: { data: { stale: true }, baseVersion: 1 }, cookie: token });
    assert.equal(res.status, 409);
    assert.equal(res.json.version, 2);
    assert.equal(must(res.json.data, "data").updatedAt, 456);
    const ahead = await request(srv.port, "PUT", "/api/state", { body: { data: { stale: true }, baseVersion: 7 }, cookie: token });
    assert.equal(ahead.status, 409);
    const fresh = await request(srv.port, "GET", "/api/state", { cookie: token });
    assert.equal(fresh.json.version, 2);
    assert.equal(must(fresh.json.data, "data").stale, undefined);
  });

  it("keeps each user's data separate", async () => {
    const other = await signup(srv.port, "other@example.com", "password123");
    const res = await request(srv.port, "GET", "/api/state", { cookie: other });
    assert.equal(res.json.data, null);
  });

  it("validates the body", async () => {
    for (const body of [{ data: [], baseVersion: 2 }, { data: null, baseVersion: 2 }, { data: {} }, { data: {}, baseVersion: -1 }, { data: {}, baseVersion: 1.5 }, { data: {}, baseVersion: "2" }]) {
      const res = await request(srv.port, "PUT", "/api/state", { body, cookie: token });
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.ok(res.json.error);
    }
  });

  it("enforces a 1 MB limit on state and 10 KB on auth", async () => {
    const big = { data: { blob: "x".repeat(1024 * 1024) }, baseVersion: 2 };
    const res = await request(srv.port, "PUT", "/api/state", { body: big, cookie: token });
    assert.equal(res.status, 413);
    const ok = await request(srv.port, "PUT", "/api/state", { body: { data: { blob: "x".repeat(900 * 1024) }, baseVersion: 2 }, cookie: token });
    assert.equal(ok.status, 200);

    const auth = await request(srv.port, "POST", "/api/login", { body: { email: "a@example.com", password: "x".repeat(11 * 1024) } });
    assert.equal(auth.status, 413);
  });

  it("enforces the limit on chunked bodies without a Content-Length", async () => {
    const res = await new Promise<http.IncomingMessage>((resolve, reject) => {
      const req = http.request({
        host: "127.0.0.1", port: srv.port, method: "PUT", path: "/api/state", agent: false,
        headers: { "Content-Type": "application/json", Cookie: `${COOKIE}=${token}`, "Transfer-Encoding": "chunked" },
      }, (r) => { r.resume(); r.on("end", () => resolve(r)); });
      req.on("error", reject);
      req.write('{"data":{"blob":"');
      for (let i = 0; i < 12; i++) req.write("y".repeat(100 * 1024));
      req.end('"},"baseVersion":3}');
    });
    assert.equal(res.statusCode, 413);
  });
});

// ---------- account deletion ----------

describe("account deletion", () => {
  it("needs the password, then removes the user, sessions and data", async () => {
    const srv = await start();
    try {
      const token = await signup(srv.port, "bye@example.com", "password123");
      const login2 = await request(srv.port, "POST", "/api/login", { body: { email: "bye@example.com", password: "password123" } });
      const token2 = must(sessionFrom(login2), "session cookie");
      await request(srv.port, "PUT", "/api/state", { body: { data: { a: 1 }, baseVersion: 0 }, cookie: token });

      assert.equal((await request(srv.port, "DELETE", "/api/account", { body: { password: "nope nope" }, cookie: token })).status, 403);
      assert.equal((await request(srv.port, "DELETE", "/api/account", { body: {}, cookie: token })).status, 403);
      assert.equal((await request(srv.port, "DELETE", "/api/account", { body: { password: "password123" } })).status, 401);

      const res = await request(srv.port, "DELETE", "/api/account", { body: { password: "password123" }, cookie: token });
      assert.equal(res.status, 200);
      assert.match(setCookie(res), /Max-Age=0/);

      assertSignedOut(await request(srv.port, "GET", "/api/me", { cookie: token }));
      assertSignedOut(await request(srv.port, "GET", "/api/me", { cookie: token2 }));
      assert.equal((await request(srv.port, "POST", "/api/login", { body: { email: "bye@example.com", password: "password123" } })).status, 401);
      assert.equal(srv.store.states.size, 0);
      assert.equal(srv.store.sessions.size, 0);

      const again = await signup(srv.port, "bye@example.com", "password456");
      assert.equal((await request(srv.port, "GET", "/api/state", { cookie: again })).json.data, null);
    } finally {
      await srv.close();
    }
  });
});

// ---------- store implementations ----------

function storeContract(name: string, makeStore: () => Store | Promise<Store>, { skip }: { skip?: boolean | string } = {}) {
  describe(`${name} store`, { skip }, () => {
    let store: Store;
    before(async () => { store = await makeStore(); await store.init(); });
    after(async () => { if (store) await store.close(); });

    it("creates users with unique emails", async () => {
      const u = must(await store.createUser("contract@example.com", "hash1"), "user");
      assert.equal(typeof u.id, "string");
      assert.equal(u.email, "contract@example.com");
      assert.equal(await store.createUser("contract@example.com", "hash2"), null);
      assert.equal(must(await store.getUserByEmail("contract@example.com"), "user").passwordHash, "hash1");
      assert.equal(must(await store.getUserById(u.id), "user").email, "contract@example.com");
      assert.equal(await store.getUserByEmail("missing@example.com"), null);
    });

    it("handles sessions", async () => {
      const u = must(await store.createUser("sess@example.com", "h"), "user");
      const exp = new Date(Date.now() + 60000);
      await store.createSession("tok1", u.id, exp);
      const s = must(await store.getSession("tok1"), "session");
      assert.equal(s.userId, u.id);
      assert.equal(new Date(s.expiresAt).getTime(), exp.getTime());
      const later = new Date(Date.now() + 120000);
      await store.touchSession("tok1", later);
      assert.equal(new Date(must(await store.getSession("tok1"), "session").expiresAt).getTime(), later.getTime());
      await store.createSession("tok2", u.id, new Date(Date.now() - 1000));
      assert.ok((await store.deleteExpiredSessions(new Date())) >= 1);
      assert.equal(await store.getSession("tok2"), null);
      await store.deleteSession("tok1");
      assert.equal(await store.getSession("tok1"), null);
    });

    it("compares and sets state versions", async () => {
      const u = must(await store.createUser("cas@example.com", "h"), "user");
      assert.equal(await store.getState(u.id), null);
      const r1 = await store.putState(u.id, { n: 1, nested: { list: [1, 2] } }, 0);
      assert.equal(r1.ok, true);
      assert.equal(r1.version, 1);
      const stale = await store.putState(u.id, { n: 99 }, 0);
      assert.equal(stale.ok, false);
      assert.deepEqual(stale.current.data, { n: 1, nested: { list: [1, 2] } });
      assert.equal(stale.current.version, 1);
      const r2 = await store.putState(u.id, { n: 2 }, 1);
      assert.equal(r2.ok, true);
      assert.equal(r2.version, 2);
      const got = must(await store.getState(u.id), "state");
      assert.deepEqual(got.data, { n: 2 });
      assert.equal(got.version, 2);
      assert.ok(got.updatedAt instanceof Date);
      const none = await store.putState(must(await store.createUser("cas2@example.com", "h"), "user").id, { n: 1 }, 3);
      assert.equal(none.ok, false);
      assert.equal(none.current.version, 0);
    });

    it("deletes a user with their sessions and state", async () => {
      const u = must(await store.createUser("gone@example.com", "h"), "user");
      await store.createSession("tok-gone", u.id, new Date(Date.now() + 60000));
      await store.putState(u.id, { a: 1 }, 0);
      assert.equal(await store.deleteUser(u.id), true);
      assert.equal(await store.getUserByEmail("gone@example.com"), null);
      assert.equal(await store.getSession("tok-gone"), null);
      assert.equal(await store.getState(u.id), null);
    });
  });
}

storeContract("memory", () => new MemoryStore());

const tmpFile = path.join(os.tmpdir(), `ib-store-${process.pid}-${Date.now()}.json`);
storeContract("file", () => new FileStore(tmpFile));

describe("file store persistence", () => {
  it("reloads users, sessions and state from disk", async () => {
    const file = path.join(os.tmpdir(), `ib-persist-${process.pid}-${Date.now()}.json`);
    try {
      const a = new FileStore(file);
      await a.init();
      const u = must(await a.createUser("disk@example.com", "h"), "user");
      await a.createSession("tok", u.id, new Date(Date.now() + 60000));
      await a.putState(u.id, { saved: true }, 0);
      await a.close();

      const b = new FileStore(file);
      await b.init();
      assert.equal(must(await b.getUserByEmail("disk@example.com"), "user").id, u.id);
      assert.equal(must(await b.getSession("tok"), "session").userId, u.id);
      assert.deepEqual(must(await b.getState(u.id), "state").data, { saved: true });
      const u2 = must(await b.createUser("disk2@example.com", "h"), "user");
      assert.notEqual(u2.id, u.id);
      await b.close();
    } finally {
      fs.rmSync(file, { force: true });
      fs.rmSync(tmpFile, { force: true });
    }
  });
});

// Set TEST_DATABASE_URL to run the same contract against Postgres (tables are dropped first).
const pgUrl = process.env.TEST_DATABASE_URL;
storeContract("postgres", async () => {
  const s = new PgStore(must(pgUrl, "TEST_DATABASE_URL"));
  await s.pool.query("DROP TABLE IF EXISTS user_state, sessions, users");
  return s;
}, { skip: pgUrl ? false : "set TEST_DATABASE_URL to run" });

describe("postgres options", () => {
  it("only uses TLS when the URL or PGSSLMODE asks for it", () => {
    assert.equal(pgOptions("postgresql://u:p@postgres.railway.internal:5432/railway").ssl, false);
    assert.deepEqual(pgOptions("postgresql://u:p@host:5432/db?sslmode=require").ssl, { rejectUnauthorized: false });
    assert.deepEqual(pgOptions("postgresql://u:p@host:5432/db?sslmode=verify-full").ssl, { rejectUnauthorized: true });
    assert.deepEqual(pgOptions("postgresql://u:p@host:5432/db", { pgSslMode: "require" }).ssl, { rejectUnauthorized: false });
    assert.equal(pgOptions("postgresql://u:p@host:5432/db?sslmode=require", { pgSslMode: "disable" }).ssl, false);
    const { connectionString } = pgOptions("postgresql://u:p%40ss@host:5432/db?sslmode=require&application_name=x");
    assert.equal(connectionString, "postgresql://u:p%40ss@host:5432/db?application_name=x");
  });
});

// ---------- the real entry point ----------

describe("node dist/server.js", () => {
  it("reads the environment, serves, and exits cleanly on SIGTERM", async () => {
    // The bundle npm start runs (npm test builds it first).
    const entry = path.join(ROOT, "dist", "server.js");
    assert.ok(fs.existsSync(entry), "dist/server.js is missing: run npm run build first");
    const child = spawn(process.execPath, [entry], {
      env: { ...process.env, PORT: "0", ALLOW_SIGNUP: "false", DATABASE_URL: "", DATA_FILE: "", NODE_ENV: "test" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d: Buffer) => { out += d; });
    child.stderr.on("data", (d: Buffer) => { out += d; });
    const port = await new Promise<number>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`server did not start: ${out}`)), 10000);
      child.stdout.on("data", () => {
        const m = out.match(/listening on http:\/\/localhost:(\d+)/);
        if (m) { clearTimeout(t); resolve(Number(m[1])); }
      });
      child.on("exit", (code) => reject(new Error(`exited early (${code}): ${out}`)));
    });
    try {
      assert.equal((await request(port, "GET", "/api/health")).status, 200);
      assert.equal((await request(port, "GET", "/")).status, 200);
      assert.equal((await request(port, "GET", "/app.js")).status, 200, "serves public/ from the bundle");
      assert.equal((await request(port, "POST", "/api/signup", { body: { email: "a@example.com", password: "password123" } })).status, 403);
    } finally {
      const code = await new Promise<number | null>((resolve) => {
        child.removeAllListeners("exit");
        child.on("exit", (c) => resolve(c));
        child.kill("SIGTERM");
      });
      assert.equal(code, 0, out);
    }
  });
});

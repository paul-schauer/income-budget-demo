"use strict";

const test = require("node:test");
const { describe, it, before, after } = test;
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const { loadConfig, parseTrustProxy, ROOT } = require("../server/config");
const { MemoryStore, FileStore, PgStore, pgOptions } = require("../server/store");
const { createServer, COOKIE } = require("../server/app");
const { resolveStaticPath } = require("../server/static");
const authLib = require("../server/auth");

// ---------- helpers ----------

async function start({ config: overrides = {}, store = new MemoryStore() } = {}) {
  // A generous rate limit so unrelated tests don't trip it; the rate-limit tests pass the real one.
  const config = { ...loadConfig({ NODE_ENV: "test" }), rateLimit: { max: 1000, windowMs: 60000 }, ...overrides };
  await store.init();
  const server = createServer({ config, store });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    port,
    store,
    server,
    close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }),
  };
}

/** Raw HTTP request with full control over the path and headers. */
/** /api/me answers 200 with email null when nobody is signed in. */
function assertSignedOut(res) {
  assert.equal(res.status, 200);
  assert.equal(res.json.email, null);
}

function request(port, method, rawPath, { body, headers = {}, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const h = { ...headers };
    let payload;
    if (body !== undefined) {
      payload = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
      if (!Object.keys(h).some((k) => k.toLowerCase() === "content-type")) h["Content-Type"] = "application/json";
      h["Content-Length"] = payload.length;
    }
    if (cookie) h.Cookie = `${COOKIE}=${cookie}`;
    const req = http.request({ host: "127.0.0.1", port, method, path: rawPath, headers: h, agent: false }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try { json = JSON.parse(text); } catch (_) { /* not json */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function sessionFrom(res) {
  const set = [].concat(res.headers["set-cookie"] || []).find((c) => c.startsWith(`${COOKIE}=`));
  if (!set) return null;
  return decodeURIComponent(set.split(";")[0].slice(COOKIE.length + 1));
}

async function signup(port, email = "user@example.com", password = "correct horse", headers = {}) {
  const res = await request(port, "POST", "/api/signup", { body: { email, password }, headers });
  assert.equal(res.status, 201, res.text);
  return sessionFrom(res);
}

// ---------- static files ----------

describe("static files", () => {
  let fixture;
  let srv;

  before(async () => {
    fixture = fs.mkdtempSync(path.join(os.tmpdir(), "ib-static-"));
    const w = (rel, text) => {
      fs.mkdirSync(path.dirname(path.join(fixture, rel)), { recursive: true });
      fs.writeFileSync(path.join(fixture, rel), text);
    };
    w("index.html", "<!doctype html><title>t</title>");
    w("styles.css", "body{}");
    w("manifest.webmanifest", '{"name":"t"}');
    w("sw.js", "self.addEventListener('fetch',()=>{})");
    w("js/app.js", `console.log(${JSON.stringify("x".repeat(3000))})`);
    w("js/lib/nested.js", "1");
    w("css/sync.css", ".a{}");
    w("icons/icon.svg", "<svg xmlns='http://www.w3.org/2000/svg'/>");
    w("icons/icon-192.png", "\x89PNG");
    w("icons/README", "no extension");
    w("package.json", "{}");
    w("server.js", "secret");
    w("server/app.js", "secret");
    w("test/x.test.js", "secret");
    w(".env", "SECRET=1");
    w(".git/config", "secret");
    w("data/dev-db.json", "{}");
    w("node_modules/pg/package.json", "{}");
    w("README.md", "readme");
    fs.symlinkSync(path.join(fixture, "package.json"), path.join(fixture, "js", "link.js"));
    srv = await start({ config: { root: fixture } });
  });

  after(async () => {
    await srv.close();
    fs.rmSync(fixture, { recursive: true, force: true });
  });

  it("serves the allowlist with the right content types", async () => {
    const cases = [
      ["/", "text/html; charset=utf-8"],
      ["/index.html", "text/html; charset=utf-8"],
      ["/styles.css", "text/css; charset=utf-8"],
      ["/manifest.webmanifest", "application/manifest+json; charset=utf-8"],
      ["/sw.js", "text/javascript; charset=utf-8"],
      ["/js/app.js", "text/javascript; charset=utf-8"],
      ["/js/lib/nested.js", "text/javascript; charset=utf-8"],
      ["/css/sync.css", "text/css; charset=utf-8"],
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
    for (const p of ["/js/app.js", "/css/sync.css", "/icons/icon.svg", "/styles.css"]) {
      const res = await request(srv.port, "GET", p);
      assert.match(res.headers["cache-control"], /max-age=\d+/, p);
      assert.ok(res.headers.etag, p);
      assert.ok(res.headers["last-modified"], p);
    }
  });

  it("answers conditional requests with 304", async () => {
    const first = await request(srv.port, "GET", "/js/app.js");
    const again = await request(srv.port, "GET", "/js/app.js", { headers: { "If-None-Match": first.headers.etag } });
    assert.equal(again.status, 304);
    assert.equal(again.text, "");
  });

  it("gzips text when asked", async () => {
    const res = await request(srv.port, "GET", "/js/app.js", { headers: { "Accept-Encoding": "gzip, br" } });
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
      "/package.json", "/server.js", "/server/app.js", "/test/x.test.js", "/.env", "/.git/config",
      "/data/dev-db.json", "/node_modules/pg/package.json", "/README.md", "/icons/README", "/js/",
      "/js", "/nope.html", "/js/missing.js", "/js/link.js",
    ];
    for (const p of blocked) assert.equal((await request(srv.port, "GET", p)).status, 404, p);
  });

  it("blocks path traversal", async () => {
    const attempts = [
      "/js/../server.js", "/js/../package.json", "/js/..%2fserver.js", "/js/%2e%2e/server.js",
      "/js/%2e%2e%2fpackage.json", "/css/..%5cserver.js", "/js/%00.js", "//server.js", "/js//app.js",
      "/icons/../../etc/passwd", "/%2e%2e/%2e%2e/etc/passwd", "/js/.hidden.js", "/js/%E0%A4%A.js",
    ];
    for (const p of attempts) {
      const res = await request(srv.port, "GET", p);
      assert.ok(res.status === 404 || res.status === 400, `${p} -> ${res.status}`);
      assert.doesNotMatch(res.text, /secret|"name"/, p);
    }
  });

  it("resolveStaticPath maps only allowlisted paths", () => {
    assert.equal(resolveStaticPath("/"), "index.html");
    assert.equal(resolveStaticPath("/js/app.js"), "js/app.js");
    assert.equal(resolveStaticPath("/js/../server.js"), null);
    assert.equal(resolveStaticPath("/server/app.js"), null);
    assert.equal(resolveStaticPath("/js/a%2Fb.js"), null);
  });
});

describe("the real app folder", () => {
  let srv;
  before(async () => { srv = await start(); });
  after(() => srv.close());

  it("serves index.html and scripts but not server files", async () => {
    const home = await request(srv.port, "GET", "/");
    assert.equal(home.status, 200);
    assert.match(home.text, /<div id="syncSlot"/);
    assert.equal((await request(srv.port, "GET", "/js/app.js")).status, 200);
    assert.equal((await request(srv.port, "GET", "/js/sync.js")).status, 200);
    for (const p of ["/package.json", "/package-lock.json", "/server.js", "/server/store.js", "/test/server.test.js", "/.gitignore", "/railway.json"]) {
      assert.equal((await request(srv.port, "GET", p)).status, 404, p);
    }
  });

  it("stamps sw.js with a content hash so deploys trigger an update", async () => {
    const sw = await request(srv.port, "GET", "/sw.js");
    assert.equal(sw.status, 200);
    const m = /const VERSION = "([0-9a-f]{12})";/.exec(sw.text);
    assert.ok(m, "VERSION is stamped");
    assert.equal(sw.headers.etag, `W/"sw-${m[1]}"`);
    assert.equal(sw.headers["cache-control"], "no-cache");
    const again = await request(srv.port, "GET", "/sw.js", { headers: { "If-None-Match": sw.headers.etag } });
    assert.equal(again.status, 304);
  });
});

// ---------- headers ----------

describe("security headers", () => {
  let srv;
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
    assert.match(https.headers["strict-transport-security"], /max-age=\d+/);

    const res = await request(srv.port, "POST", "/api/signup", {
      body: { email: "secure@example.com", password: "password123" },
      headers: { "X-Forwarded-Proto": "https" },
    });
    assert.match(res.headers["set-cookie"][0], /; Secure/);
    const res2 = await request(srv.port, "POST", "/api/signup", { body: { email: "plain@example.com", password: "password123" } });
    assert.doesNotMatch(res2.headers["set-cookie"][0], /Secure/);
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
  let srv;
  before(async () => { srv = await start(); });
  after(() => srv.close());

  it("signs up, reads /me, logs out and logs back in", async () => {
    const res = await request(srv.port, "POST", "/api/signup", { body: { email: "  Pat@Example.COM ", password: "hunter2hunter2" } });
    assert.equal(res.status, 201);
    assert.deepEqual(res.json, { email: "pat@example.com" });
    const cookie = res.headers["set-cookie"][0];
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.match(cookie, /Path=\//);
    assert.match(cookie, /Max-Age=2592000/);
    const token = sessionFrom(res);
    assert.equal(Buffer.from(token, "base64url").length, 32);

    const me = await request(srv.port, "GET", "/api/me", { cookie: token });
    assert.equal(me.status, 200);
    assert.deepEqual(me.json, { email: "pat@example.com" });

    const out = await request(srv.port, "POST", "/api/logout", { body: {}, cookie: token });
    assert.equal(out.status, 200);
    assert.match(out.headers["set-cookie"][0], /Max-Age=0/);
    assertSignedOut(await request(srv.port, "GET", "/api/me", { cookie: token }));

    const login = await request(srv.port, "POST", "/api/login", { body: { email: "PAT@example.com", password: "hunter2hunter2" } });
    assert.equal(login.status, 200);
    assert.deepEqual(login.json, { email: "pat@example.com" });
    const token2 = sessionFrom(login);
    assert.notEqual(token2, token);
    assert.equal((await request(srv.port, "GET", "/api/me", { cookie: token2 })).status, 200);
  });

  it("stores only a SHA-256 hash of the session token and a scrypt password hash", async () => {
    const token = await signup(srv.port, "hash@example.com", "some password");
    const hash = crypto.createHash("sha256").update(token).digest("hex");
    assert.ok(srv.store.sessions.has(hash));
    assert.ok(![...srv.store.sessions.keys()].includes(token));
    const user = await srv.store.getUserByEmail("hash@example.com");
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
    assert.match(short.json.error, /8 characters/);
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
    srv.store.sessions.get(hash).expiresAt = new Date(Date.now() + 5 * 86400000);
    const me = await request(srv.port, "GET", "/api/me", { cookie: token });
    assert.equal(me.status, 200);
    assert.match(me.headers["set-cookie"][0], /Max-Age=2592000/);
    assert.ok(srv.store.sessions.get(hash).expiresAt.getTime() > Date.now() + 29 * 86400000);

    // A fresh session isn't rewritten on every request.
    const again = await request(srv.port, "GET", "/api/me", { cookie: token });
    assert.equal(again.headers["set-cookie"], undefined);

    srv.store.sessions.get(hash).expiresAt = new Date(Date.now() - 1000);
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
  let srv;
  let token;
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
  let srv;
  let token;
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
    assert.ok(!Number.isNaN(Date.parse(put.json.updatedAt)));

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
    assert.equal(res.json.data.updatedAt, 456);
    const ahead = await request(srv.port, "PUT", "/api/state", { body: { data: { stale: true }, baseVersion: 7 }, cookie: token });
    assert.equal(ahead.status, 409);
    const fresh = await request(srv.port, "GET", "/api/state", { cookie: token });
    assert.equal(fresh.json.version, 2);
    assert.equal(fresh.json.data.stale, undefined);
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
    const res = await new Promise((resolve, reject) => {
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
      const token2 = sessionFrom(login2);
      await request(srv.port, "PUT", "/api/state", { body: { data: { a: 1 }, baseVersion: 0 }, cookie: token });

      assert.equal((await request(srv.port, "DELETE", "/api/account", { body: { password: "nope nope" }, cookie: token })).status, 403);
      assert.equal((await request(srv.port, "DELETE", "/api/account", { body: {}, cookie: token })).status, 403);
      assert.equal((await request(srv.port, "DELETE", "/api/account", { body: { password: "password123" } })).status, 401);

      const res = await request(srv.port, "DELETE", "/api/account", { body: { password: "password123" }, cookie: token });
      assert.equal(res.status, 200);
      assert.match(res.headers["set-cookie"][0], /Max-Age=0/);

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

function storeContract(name, makeStore, { skip } = {}) {
  describe(`${name} store`, { skip }, () => {
    let store;
    before(async () => { store = await makeStore(); await store.init(); });
    after(async () => { if (store) await store.close(); });

    it("creates users with unique emails", async () => {
      const u = await store.createUser("contract@example.com", "hash1");
      assert.equal(typeof u.id, "string");
      assert.equal(u.email, "contract@example.com");
      assert.equal(await store.createUser("contract@example.com", "hash2"), null);
      assert.equal((await store.getUserByEmail("contract@example.com")).passwordHash, "hash1");
      assert.equal((await store.getUserById(u.id)).email, "contract@example.com");
      assert.equal(await store.getUserByEmail("missing@example.com"), null);
    });

    it("handles sessions", async () => {
      const u = await store.createUser("sess@example.com", "h");
      const exp = new Date(Date.now() + 60000);
      await store.createSession("tok1", u.id, exp);
      const s = await store.getSession("tok1");
      assert.equal(s.userId, u.id);
      assert.equal(new Date(s.expiresAt).getTime(), exp.getTime());
      const later = new Date(Date.now() + 120000);
      await store.touchSession("tok1", later);
      assert.equal(new Date((await store.getSession("tok1")).expiresAt).getTime(), later.getTime());
      await store.createSession("tok2", u.id, new Date(Date.now() - 1000));
      assert.ok((await store.deleteExpiredSessions(new Date())) >= 1);
      assert.equal(await store.getSession("tok2"), null);
      await store.deleteSession("tok1");
      assert.equal(await store.getSession("tok1"), null);
    });

    it("compares and sets state versions", async () => {
      const u = await store.createUser("cas@example.com", "h");
      assert.equal(await store.getState(u.id), null);
      const r1 = await store.putState(u.id, { n: 1, nested: { list: [1, 2] } }, 0);
      assert.deepEqual([r1.ok, r1.version], [true, 1]);
      const stale = await store.putState(u.id, { n: 99 }, 0);
      assert.equal(stale.ok, false);
      assert.deepEqual(stale.current.data, { n: 1, nested: { list: [1, 2] } });
      assert.equal(stale.current.version, 1);
      const r2 = await store.putState(u.id, { n: 2 }, 1);
      assert.deepEqual([r2.ok, r2.version], [true, 2]);
      const got = await store.getState(u.id);
      assert.deepEqual(got.data, { n: 2 });
      assert.equal(got.version, 2);
      assert.ok(got.updatedAt instanceof Date);
      const none = await store.putState((await store.createUser("cas2@example.com", "h")).id, { n: 1 }, 3);
      assert.equal(none.ok, false);
      assert.equal(none.current.version, 0);
    });

    it("deletes a user with their sessions and state", async () => {
      const u = await store.createUser("gone@example.com", "h");
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
      const u = await a.createUser("disk@example.com", "h");
      await a.createSession("tok", u.id, new Date(Date.now() + 60000));
      await a.putState(u.id, { saved: true }, 0);
      await a.close();

      const b = new FileStore(file);
      await b.init();
      assert.equal((await b.getUserByEmail("disk@example.com")).id, u.id);
      assert.equal((await b.getSession("tok")).userId, u.id);
      assert.deepEqual((await b.getState(u.id)).data, { saved: true });
      const u2 = await b.createUser("disk2@example.com", "h");
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
  const s = new PgStore(pgUrl);
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

describe("node server.js", () => {
  it("reads the environment, serves, and exits cleanly on SIGTERM", async () => {
    const child = spawn(process.execPath, [path.join(ROOT, "server.js")], {
      env: { ...process.env, PORT: "0", ALLOW_SIGNUP: "false", DATABASE_URL: "", DATA_FILE: "", NODE_ENV: "test" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { out += d; });
    const port = await new Promise((resolve, reject) => {
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
      assert.equal((await request(port, "POST", "/api/signup", { body: { email: "a@example.com", password: "password123" } })).status, 403);
    } finally {
      const code = await new Promise((resolve) => {
        child.removeAllListeners("exit");
        child.on("exit", (c) => resolve(c));
        child.kill("SIGTERM");
      });
      assert.equal(code, 0, out);
    }
  });
});

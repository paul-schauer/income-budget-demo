import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

// The static files as served, including the build output (npm test builds first).
const PUBLIC = path.join(import.meta.dirname, "..", "public");
const read = (rel: string) => fs.readFileSync(path.join(PUBLIC, rel), "utf8");
const exists = (rel: string) => fs.existsSync(path.join(PUBLIC, rel)) && fs.statSync(path.join(PUBLIC, rel)).isFile();
const stripUrl = (href: string) => href.split(/[?#]/)[0].replace(/^\.\//, "");

interface ManifestIcon { src: string; sizes: string; type?: string; purpose?: string }
interface Manifest {
  name: string;
  short_name: string;
  description?: string;
  start_url: string;
  scope: string;
  display: string;
  background_color: string;
  theme_color: string;
  categories: string[];
  icons: ManifestIcon[];
  shortcuts: { name: string; url: string; icons?: ManifestIcon[] }[];
}
const manifest = (): Manifest => JSON.parse(read("manifest.webmanifest"));

/** Width and height from a PNG's IHDR chunk. */
function pngSize(rel: string) {
  const buf = fs.readFileSync(path.join(PUBLIC, rel));
  assert.equal(buf.toString("latin1", 1, 4), "PNG", `${rel} is not a PNG`);
  return `${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}`;
}

/** An event listener the worker registered; each test passes the event shape that type needs. */
type Listener = (event: object) => void;

/**
 * Load the built sw.js in a sandbox with a stub `self`, as if registered at `scope`.
 * Returns the recorded event listeners and what the stub cache storage saw.
 */
function loadServiceWorker(scope = "https://example.test/") {
  assert.ok(exists("sw.js"), "public/sw.js is missing: run npm run build first");
  const listeners: Record<string, Listener> = {};
  const self = {
    location: new URL("sw.js", scope),
    registration: { scope },
    addEventListener: (type: string, fn: Listener) => { listeners[type] = fn; },
    skipWaiting: () => { self.skipped = true; },
    skipped: false,
  };
  const store = { names: ["incomebudget-shell-old", "someone-else"], opened: [] as string[], put: [] as string[], deleted: [] as string[] };
  const cacheStub = {
    match: async () => undefined,
    put: async (req: string | Request) => { store.put.push(typeof req === "string" ? req : req.url); },
  };
  const context = vm.createContext({
    self, URL, Request, Response, Headers, Promise, console,
    // The navigation timeout shouldn't keep the test process alive.
    setTimeout: (fn: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) => setTimeout(fn, ms, ...args).unref(),
    caches: {
      open: async (name: string) => { store.opened.push(name); if (!store.names.includes(name)) store.names.push(name); return cacheStub; },
      keys: async () => store.names.slice(),
      delete: async (name: string) => { store.deleted.push(name); return true; },
      match: async () => undefined,
    },
    fetch: async () => new Response("ok", { headers: { "content-type": "text/html" } }),
  });
  vm.runInContext(read("sw.js"), context, { filename: "sw.js" });
  return { self, listeners, store };
}

/** Run a lifecycle listener and wait for everything it passed to waitUntil. */
async function lifecycle(listener: Listener) {
  const pending: Promise<unknown>[] = [];
  listener({ waitUntil: (p: Promise<unknown>) => pending.push(p) });
  await Promise.all(pending);
}

/**
 * The worker's PRECACHE list, relative to the scope: install it under a sub-path and
 * record what it caches. (The bundle keeps PRECACHE private.)
 */
async function precacheList() {
  const scope = "https://example.test/app/";
  const { listeners, store } = loadServiceWorker(scope);
  await lifecycle(listeners.install);
  return store.put.map((url) => {
    assert.ok(url.startsWith(scope), `${url} should be under the scope (a relative path in PRECACHE)`);
    return url.slice(scope.length);
  });
}

/** Dispatch a fake fetch event; returns true if the worker called respondWith. */
function intercepts(listeners: Record<string, Listener>, url: string, init: RequestInit & { navigate?: boolean } = {}) {
  let responded = false;
  const request = new Request(url, init);
  // Request can't be constructed with mode "navigate"; fake it when asked.
  const req = init.navigate ? new Proxy(request, { get: (t, k) => (k === "mode" ? "navigate" : Reflect.get(t, k)) }) : request;
  listeners.fetch({
    request: req,
    respondWith: (p: Promise<Response> | Response) => { responded = true; Promise.resolve(p).catch(() => {}); },
    waitUntil: (p: Promise<unknown>) => { Promise.resolve(p).catch(() => {}); },
  });
  return responded;
}

function indexAssets() {
  const html = read("index.html");
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]);
  const links = [...html.matchAll(/<link\b[^>]*>/g)].map((m) => m[0])
    .filter((tag) => /\brel="(?:stylesheet|manifest|icon|apple-touch-icon)"/.test(tag))
    .map((tag) => tag.match(/\bhref="([^"]+)"/)![1]);
  return [...scripts, ...links].filter((u) => !/^[a-z]+:|^\/\//i.test(u)).map(stripUrl);
}

test("manifest parses and has the required fields", () => {
  const m = manifest();
  assert.equal(m.name, "Take-Home & Budget");
  assert.equal(m.short_name, "Take-Home");
  assert.equal(m.start_url, "./#paycheck");
  assert.equal(m.scope, "./");
  assert.equal(m.display, "standalone");
  assert.match(m.background_color, /^#[0-9a-f]{6}$/i);
  assert.match(m.theme_color, /^#[0-9a-f]{6}$/i);
  assert.ok(m.description && m.description.length > 10, "description");
  assert.deepEqual(m.categories, ["finance"]);
  const shortcutUrls = m.shortcuts.map((s) => s.url);
  for (const hash of ["#budget", "#calendar", "#spending"]) {
    assert.ok(shortcutUrls.includes(`./${hash}`), `shortcut to ${hash}`);
  }
  for (const s of m.shortcuts) assert.ok(s.name, "shortcut name");
});

test("manifest icons exist and match their declared sizes", () => {
  const m = manifest();
  const icons = [...m.icons, ...m.shortcuts.flatMap((s) => s.icons || [])];
  for (const icon of icons) {
    assert.ok(exists(icon.src), `missing ${icon.src}`);
    if (icon.type === "image/png") assert.equal(pngSize(icon.src), icon.sizes, icon.src);
  }
  const has = (purpose: string, size: string) => m.icons.some((i) => (i.purpose || "any").split(" ").includes(purpose) && i.sizes === size);
  assert.ok(has("any", "192x192"), "192px icon");
  assert.ok(has("any", "512x512"), "512px icon");
  assert.ok(has("maskable", "512x512"), "512px maskable icon");
});

test("icons linked from index.html exist with the expected sizes", () => {
  assert.equal(pngSize("icons/apple-touch-icon.png"), "180x180");
  assert.equal(pngSize("icons/favicon-32.png"), "32x32");
  assert.ok(exists("icons/icon.svg"));
  assert.ok(exists("icons/icon-maskable.svg"));
});

test("the built sw.js keeps one VERSION line for the server to stamp", () => {
  // The same pattern server/static.ts replaces (esbuild may emit the const as var).
  const found = read("sw.js").match(/\b(?:const|let|var) VERSION = "[^"]*";/g) || [];
  assert.equal(found.length, 1);
});

test("every precached asset exists on disk", async () => {
  const precache = await precacheList();
  assert.ok(precache.length > 10, "precache list found");
  assert.equal(new Set(precache).size, precache.length, "no duplicates");
  for (const entry of precache) {
    assert.ok(exists(stripUrl(entry)), `precached file missing on disk: ${entry}`);
  }
});

test("every script, stylesheet and icon in index.html is precached", async () => {
  const precache = new Set((await precacheList()).map(stripUrl));
  const assets = indexAssets();
  assert.ok(assets.includes("app.js") && assets.includes("styles.css"), "index.html parsed");
  for (const asset of assets) assert.ok(precache.has(asset), `index.html uses ${asset} but sw.js doesn't precache it`);
  assert.ok(precache.has("index.html"), "index.html is precached");
  for (const icon of manifest().icons) assert.ok(precache.has(icon.src), `manifest icon ${icon.src} is precached`);
});

test("service worker precaches under the scope, cleans old caches, and only skips waiting on request", async () => {
  const precache = await precacheList();
  const { self, listeners, store } = loadServiceWorker("https://example.test/app/");
  for (const type of ["install", "activate", "fetch", "message"]) assert.equal(typeof listeners[type], "function", type);

  await lifecycle(listeners.install);
  assert.deepEqual(store.put.sort(), precache.map((p) => `https://example.test/app/${p}`).sort());
  const current = store.opened[0];
  assert.match(current, /^incomebudget-/);
  await lifecycle(listeners.activate);
  assert.deepEqual(store.deleted, ["incomebudget-shell-old"], "deletes only this app's old caches");

  assert.equal(self.skipped, false, "no automatic skipWaiting");
  listeners.message({ data: { type: "SOMETHING_ELSE" } });
  assert.equal(self.skipped, false);
  listeners.message({ data: { type: "SKIP_WAITING" } });
  assert.equal(self.skipped, true);
});

test("service worker leaves /api and non-GET requests alone", () => {
  for (const scope of ["https://example.test/", "https://example.test/app/"]) {
    const { listeners } = loadServiceWorker(scope);
    const at = (p: string) => new URL(p, scope).href;
    assert.equal(intercepts(listeners, "https://example.test/api/health"), false, `${scope}: /api GET`);
    assert.equal(intercepts(listeners, "https://example.test/api/auth/callback?code=x", { navigate: true }), false, `${scope}: /api navigation`);
    assert.equal(intercepts(listeners, at("api/data")), false, `${scope}: scoped api`);
    assert.equal(intercepts(listeners, at("app.js"), { method: "POST", body: "x" }), false, `${scope}: POST`);
    assert.equal(intercepts(listeners, at("app.js"), { method: "HEAD" }), false, `${scope}: HEAD`);
    assert.equal(intercepts(listeners, "https://other.test/app.js"), false, `${scope}: cross-origin`);
    // ...while the shell and its assets are handled.
    assert.equal(intercepts(listeners, at("app.js")), true, `${scope}: static asset`);
    assert.equal(intercepts(listeners, at("icons/icon-192.png")), true, `${scope}: icon`);
    assert.equal(intercepts(listeners, at(""), { navigate: true }), true, `${scope}: navigation`);
  }
});

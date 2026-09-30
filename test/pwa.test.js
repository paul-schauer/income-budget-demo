const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(ROOT, rel)) && fs.statSync(path.join(ROOT, rel)).isFile();
const stripUrl = (href) => href.split(/[?#]/)[0].replace(/^\.\//, "");

/** Width and height from a PNG's IHDR chunk. */
function pngSize(rel) {
  const buf = fs.readFileSync(path.join(ROOT, rel));
  assert.equal(buf.toString("latin1", 1, 4), "PNG", `${rel} is not a PNG`);
  return `${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}`;
}

/**
 * Load sw.js in a sandbox with a stub `self`, as if registered at `scope`.
 * Returns the recorded event listeners and the PRECACHE list.
 */
function loadServiceWorker(scope = "https://example.test/") {
  const listeners = {};
  const self = {
    location: new URL("sw.js", scope),
    registration: { scope },
    addEventListener: (type, fn) => { listeners[type] = fn; },
    skipWaiting: () => { self.skipped = true; },
    skipped: false,
  };
  const store = { names: ["incomebudget-shell-old", "someone-else"], opened: [], put: [], deleted: [] };
  const cacheStub = { match: async () => undefined, put: async (req) => { store.put.push(String(req.url || req)); } };
  const context = vm.createContext({
    self, URL, Request, Response, Headers, Promise, console,
    // The navigation timeout shouldn't keep the test process alive.
    setTimeout: (fn, ms, ...args) => setTimeout(fn, ms, ...args).unref(),
    caches: {
      open: async (name) => { store.opened.push(name); if (!store.names.includes(name)) store.names.push(name); return cacheStub; },
      keys: async () => store.names.slice(),
      delete: async (name) => { store.deleted.push(name); return true; },
      match: async () => undefined,
    },
    fetch: async () => new Response("ok", { headers: { "content-type": "text/html" } }),
  });
  vm.runInContext(read("sw.js"), context, { filename: "sw.js" });
  const precache = vm.runInContext("PRECACHE", context);
  return { self, listeners, store, precache: Array.from(precache) };
}

/** Run a lifecycle listener and wait for everything it passed to waitUntil. */
async function lifecycle(listener) {
  const pending = [];
  listener({ waitUntil: (p) => pending.push(p) });
  await Promise.all(pending);
}

/** Dispatch a fake fetch event; returns true if the worker called respondWith. */
function intercepts(listeners, url, init = {}) {
  let responded = false;
  const request = new Request(url, init);
  // Request can't be constructed with mode "navigate"; fake it when asked.
  const req = init.navigate ? new Proxy(request, { get: (t, k) => (k === "mode" ? "navigate" : Reflect.get(t, k)) }) : request;
  listeners.fetch({
    request: req,
    respondWith: (p) => { responded = true; Promise.resolve(p).catch(() => {}); },
    waitUntil: (p) => { Promise.resolve(p).catch(() => {}); },
  });
  return responded;
}

function indexAssets() {
  const html = read("index.html");
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]);
  const links = [...html.matchAll(/<link\b[^>]*>/g)].map((m) => m[0])
    .filter((tag) => /\brel="(?:stylesheet|manifest|icon|apple-touch-icon)"/.test(tag))
    .map((tag) => tag.match(/\bhref="([^"]+)"/)[1]);
  return [...scripts, ...links].filter((u) => !/^[a-z]+:|^\/\//i.test(u)).map(stripUrl);
}

test("manifest parses and has the required fields", () => {
  const m = JSON.parse(read("manifest.webmanifest"));
  assert.equal(m.name, "Michigan Take-Home & Budget");
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
  const m = JSON.parse(read("manifest.webmanifest"));
  const icons = [...m.icons, ...m.shortcuts.flatMap((s) => s.icons || [])];
  for (const icon of icons) {
    assert.ok(exists(icon.src), `missing ${icon.src}`);
    if (icon.type === "image/png") assert.equal(pngSize(icon.src), icon.sizes, icon.src);
  }
  const has = (purpose, size) => m.icons.some((i) => (i.purpose || "any").split(" ").includes(purpose) && i.sizes === size);
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

test("every precached asset exists on disk", () => {
  const { precache } = loadServiceWorker();
  assert.ok(precache.length > 10, "precache list found");
  assert.equal(new Set(precache).size, precache.length, "no duplicates");
  for (const entry of precache) {
    assert.ok(!entry.startsWith("/"), `${entry} should be relative to the scope`);
    assert.ok(exists(stripUrl(entry)), `precached file missing on disk: ${entry}`);
  }
});

test("every script, stylesheet and icon in index.html is precached", () => {
  const precache = new Set(loadServiceWorker().precache.map(stripUrl));
  const assets = indexAssets();
  assert.ok(assets.includes("js/app.js") && assets.includes("styles.css"), "index.html parsed");
  for (const asset of assets) assert.ok(precache.has(asset), `index.html uses ${asset} but sw.js doesn't precache it`);
  assert.ok(precache.has("index.html"), "index.html is precached");
  const m = JSON.parse(read("manifest.webmanifest"));
  for (const icon of m.icons) assert.ok(precache.has(icon.src), `manifest icon ${icon.src} is precached`);
});

test("service worker precaches under the scope, cleans old caches, and only skips waiting on request", async () => {
  const { self, listeners, store, precache } = loadServiceWorker("https://example.test/app/");
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
    const at = (p) => new URL(p, scope).href;
    assert.equal(intercepts(listeners, "https://example.test/api/health"), false, `${scope}: /api GET`);
    assert.equal(intercepts(listeners, "https://example.test/api/auth/callback?code=x", { navigate: true }), false, `${scope}: /api navigation`);
    assert.equal(intercepts(listeners, at("api/data")), false, `${scope}: scoped api`);
    assert.equal(intercepts(listeners, at("js/app.js"), { method: "POST", body: "x" }), false, `${scope}: POST`);
    assert.equal(intercepts(listeners, at("js/app.js"), { method: "HEAD" }), false, `${scope}: HEAD`);
    assert.equal(intercepts(listeners, "https://other.test/js/app.js"), false, `${scope}: cross-origin`);
    // ...while the shell and its assets are handled.
    assert.equal(intercepts(listeners, at("js/app.js")), true, `${scope}: static asset`);
    assert.equal(intercepts(listeners, at("icons/icon-192.png")), true, `${scope}: icon`);
    assert.equal(intercepts(listeners, at(""), { navigate: true }), true, `${scope}: navigation`);
  }
});

/*
 * Service worker: offline app shell.
 *
 * - Precaches the shell (PRECACHE below) into a versioned cache on install.
 *   server.js stamps VERSION with a hash of the app's files on every request, so
 *   any deploy that changes an asset triggers an update prompt (js/pwa.js shows
 *   it and replies with a "SKIP_WAITING" message). On a plain static host, bump
 *   VERSION by hand when you ship.
 * - Navigations: network first with a short timeout, then the cached index.html.
 * - Static assets (js, css, images, manifest): stale-while-revalidate.
 * - /api/* and non-GET requests are never intercepted or cached.
 *
 * Every URL is resolved against the registration scope, so the app also works
 * from a sub-path (e.g. https://host/budget/).
 */
"use strict";

const VERSION = "v1";
const CACHE_PREFIX = "incomebudget-";
const CACHE = `${CACHE_PREFIX}shell-${VERSION}`;
const NAV_TIMEOUT_MS = 3000;

// Paths relative to the scope. test/pwa.test.js checks that each one exists and
// that every script and stylesheet in index.html is listed here.
const PRECACHE = [
  "index.html",
  "styles.css",
  "css/sync.css",
  "css/bonus.css",
  "css/calendar.css",
  "css/goals.css",
  "css/spending.css",
  "js/state-tax.js",
  "js/states/no-tax-flat.js",
  "js/states/west-plains.js",
  "js/states/northeast.js",
  "js/states/south-central.js",
  "js/tax.js",
  "js/app.js",
  "js/schedule.js",
  "js/bonus.js",
  "js/calendar.js",
  "js/goals.js",
  "js/spending.js",
  "js/sync.js",
  "js/pwa.js",
  "manifest.webmanifest",
  "icons/icon.svg",
  "icons/icon-maskable.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "icons/apple-touch-icon.png",
  "icons/favicon-32.png",
];

const STATIC_EXT = /\.(?:js|mjs|css|png|svg|ico|webp|jpe?g|gif|woff2?|webmanifest)$/i;

const scopeUrl = () => new URL(self.registration ? self.registration.scope : "./", self.location.href);
const toUrl = (path) => new URL(path, scopeUrl()).href;
const shellUrl = () => toUrl("index.html");

/** True for /api and /api/... at the origin root or under the scope. */
function isApi(url) {
  const scopePath = scopeUrl().pathname;
  return [`/api`, `${scopePath}api`].some((p) => url.pathname === p || url.pathname.startsWith(`${p}/`));
}

function isCacheable(response) {
  return Boolean(response) && response.ok && response.type === "basic";
}

/** A redirected response can't answer a navigation, so store a clean copy. */
async function cleanResponse(response) {
  if (!response.redirected) return response;
  const body = await response.blob();
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

// ---------- Lifecycle ----------

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Fetch everything fresh (bypass the HTTP cache); fail the install if any asset is missing.
    await Promise.all(PRECACHE.map(async (path) => {
      const url = toUrl(path);
      const response = await fetch(new Request(url, { cache: "reload", credentials: "same-origin" }));
      if (!response.ok) throw new Error(`Precache failed for ${url}: ${response.status}`);
      await cache.put(url, await cleanResponse(response));
    }));
  })());
  // No skipWaiting() here: the page asks for it (SKIP_WAITING) when the user chooses to reload.
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE)
      .map((key) => caches.delete(key)));
  })());
});

self.addEventListener("message", (event) => {
  const data = event.data;
  if (data === "SKIP_WAITING" || (data && data.type === "SKIP_WAITING")) self.skipWaiting();
});

// ---------- Fetch ----------

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return; // writes always go straight to the network

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isApi(url)) return; // auth + sync: never cached, never intercepted

  if (request.mode === "navigate") {
    event.respondWith(networkFirstShell(event));
    return;
  }

  if (!url.href.startsWith(scopeUrl().href)) return;
  if (!STATIC_EXT.test(url.pathname) || request.headers.has("range")) return;
  event.respondWith(staleWhileRevalidate(event));
});

async function cachedShell() {
  const cache = await caches.open(CACHE);
  return (await cache.match(shellUrl(), { ignoreVary: true })) || null;
}

/** The app is one page, so a fresh copy of the scope root or index.html refreshes the shell. */
function isShellResponse(request, response) {
  if (!isCacheable(response) || response.redirected) return false;
  if (!(response.headers.get("content-type") || "").includes("text/html")) return false;
  const path = new URL(request.url).pathname;
  const scopePath = scopeUrl().pathname;
  return path === scopePath || path === `${scopePath}index.html`;
}

function networkFirstShell(event) {
  const request = event.request;
  const fromNetwork = fetch(request);

  // Keep the cached shell current. This reaction is attached before the race below,
  // so it clones the response before the page starts reading the body.
  event.waitUntil(fromNetwork.then((response) => {
    if (!isShellResponse(request, response)) return undefined;
    const copy = response.clone();
    return caches.open(CACHE).then((cache) => cache.put(shellUrl(), copy));
  }).catch(() => {}));

  const timedOut = new Promise((resolve) => setTimeout(resolve, NAV_TIMEOUT_MS, null));
  const usable = fromNetwork.then((response) => (response.status >= 500 ? null : response), () => null);

  return Promise.race([usable, timedOut]).then(async (response) => {
    if (response) return response;
    // Offline, too slow, or a server error: serve the shell, else keep waiting on the network.
    return (await cachedShell()) || fromNetwork;
  });
}

function staleWhileRevalidate(event) {
  const request = event.request;
  let stored = Promise.resolve();
  const fromNetwork = fetch(request).then((response) => {
    if (isCacheable(response) && !response.redirected) {
      const copy = response.clone();
      stored = caches.open(CACHE).then((cache) => cache.put(request, copy));
    }
    return response;
  });
  event.waitUntil(fromNetwork.then(() => stored).catch(() => {}));

  return caches.open(CACHE)
    .then((cache) => cache.match(request, { ignoreVary: true }))
    .then((cached) => cached || fromNetwork);
}

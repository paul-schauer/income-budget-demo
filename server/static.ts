/*
 * Static files from an allowlist, served out of public/ (the built app). Everything
 * else is a 404: source, server code, tests, package files, dotfiles, node_modules
 * and data/ are never reachable.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import type { OutgoingHttpHeaders } from "node:http";
import type { Req, Res, StaticFile } from "./types";

const ROOT_FILES = new Set(["index.html", "styles.css", "app.js", "app.js.map", "sw.js", "manifest.webmanifest"]);
const DIRS = new Set(["css", "icons"]);

export const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};
const COMPRESSIBLE = new Set([".html", ".css", ".js", ".mjs", ".json", ".map", ".webmanifest", ".svg", ".txt"]);
const NO_CACHE = new Set(["index.html", "sw.js", "manifest.webmanifest"]);
const MAX_AGE = 300; // seconds, for app.js, css and icons

// The cache version in the built sw.js. esbuild turns a bundle's top-level `const` into `var`,
// so accept any declaration keyword and keep the one that's there.
const SW_VERSION = /\b(const|let|var) VERSION = "[^"]*";/;

/** Map a URL pathname to a relative file path from the allowlist, or null. */
export function resolveStaticPath(pathname: string): string | null {
  if (pathname === "/") return "index.html";
  if (typeof pathname !== "string" || !pathname.startsWith("/")) return null;
  const segments = [];
  for (const raw of pathname.slice(1).split("/")) {
    let seg;
    try { seg = decodeURIComponent(raw); } catch (_) { return null; }
    // No empty, dot, hidden or separator-smuggling segments.
    if (!seg || seg.startsWith(".") || /[\\/\0:]/.test(seg)) return null;
    segments.push(seg);
  }
  if (segments.length === 1) return ROOT_FILES.has(segments[0]) ? segments[0] : null;
  if (!DIRS.has(segments[0])) return null;
  if (!TYPES[path.extname(segments[segments.length - 1]).toLowerCase()]) return null;
  return segments.join("/");
}

export function createStaticHandler(root: string) {
  const rootDir = path.resolve(root);
  let realRoot: string | null = null;
  const cache = new Map<string, StaticFile>(); // rel -> { mtimeMs, size, body, gzip }

  async function load(rel: string): Promise<StaticFile | null> {
    if (!realRoot) realRoot = await fs.promises.realpath(rootDir);
    const abs = path.join(rootDir, rel);
    let real;
    try { real = await fs.promises.realpath(abs); } catch (_) { return null; }
    // Symlinks must land on another allowlisted file inside the app folder.
    if (!real.startsWith(realRoot + path.sep)) return null;
    if (!resolveStaticPath(`/${path.relative(realRoot, real).split(path.sep).join("/")}`)) return null;
    let stat;
    try { stat = await fs.promises.stat(real); } catch (_) { return null; }
    if (!stat.isFile()) return null;
    const hit = cache.get(rel);
    if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) return hit;
    const body = await fs.promises.readFile(real);
    const ext = path.extname(rel).toLowerCase();
    const entry: StaticFile = {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      mtime: stat.mtime,
      body,
      gzip: COMPRESSIBLE.has(ext) && body.length > 1024 ? zlib.gzipSync(body, { level: 6 }) : null,
      etag: `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`,
      type: TYPES[ext],
    };
    if (cache.size > 500) cache.clear();
    cache.set(rel, entry);
    return entry;
  }

  // A hash of every servable file, stamped into sw.js as its cache VERSION, so each
  // deploy that changes any asset makes browsers see a new service worker.
  let build: { signature: string | null; id: string | null } = { signature: null, id: null };
  async function buildId() {
    const files: string[] = [];
    for (const f of ROOT_FILES) files.push(f);
    for (const dir of DIRS) {
      let names: string[] = [];
      try { names = await fs.promises.readdir(path.join(rootDir, dir)); } catch (_) { continue; }
      for (const n of names) if (resolveStaticPath(`/${dir}/${n}`)) files.push(`${dir}/${n}`);
    }
    files.sort();
    const stats = await Promise.all(files.map((f) => fs.promises.stat(path.join(rootDir, f)).catch(() => null)));
    const signature = files.map((f, i) => (stats[i] ? `${f}:${stats[i].size}:${stats[i].mtimeMs}` : "")).join("|");
    if (signature === build.signature) return build.id;
    const hash = crypto.createHash("sha256");
    for (const f of files) {
      if (f === "sw.js") continue;
      try { hash.update(f).update(await fs.promises.readFile(path.join(rootDir, f))); } catch (_) { /* skip */ }
    }
    build = { signature, id: hash.digest("hex").slice(0, 12) };
    return build.id;
  }

  async function loadServiceWorker() {
    const file = await load("sw.js");
    if (!file) return null;
    const id = await buildId();
    if (file.stampedId === id) return file.stamped;
    const body = Buffer.from(file.body.toString("utf8").replace(SW_VERSION, `$1 VERSION = "${id}";`));
    file.stampedId = id;
    file.stamped = { ...file, body, gzip: body.length > 1024 ? zlib.gzipSync(body, { level: 6 }) : null, etag: `W/"sw-${id}"` };
    return file.stamped;
  }

  /** Returns true when it handled the request. */
  return async function serveStatic(req: Req, res: Res, pathname: string): Promise<boolean> {
    const rel = resolveStaticPath(pathname);
    if (!rel) return false;
    const file = rel === "sw.js" ? await loadServiceWorker() : await load(rel);
    if (!file || !file.type) return false;
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD", "Content-Type": "text/plain; charset=utf-8" });
      res.end("Method not allowed");
      return true;
    }

    const headers: OutgoingHttpHeaders = {
      "Content-Type": file.type,
      "Cache-Control": NO_CACHE.has(rel) ? "no-cache" : `public, max-age=${MAX_AGE}`,
      ETag: file.etag,
      "Last-Modified": file.mtime.toUTCString(),
      Vary: "Accept-Encoding",
    };

    const inm = req.headers["if-none-match"];
    const ims = req.headers["if-modified-since"];
    const notModified = inm
      ? inm.split(",").some((t) => t.trim().replace(/^W\//, "") === file.etag.replace(/^W\//, "") || t.trim() === "*")
      : ims ? Math.floor(file.mtimeMs / 1000) <= Math.floor(Date.parse(ims) / 1000) : false;
    if (notModified) {
      res.writeHead(304, headers);
      res.end();
      return true;
    }

    const wantsGzip = file.gzip && /\bgzip\b/i.test(String(req.headers["accept-encoding"] || ""));
    const body = wantsGzip ? file.gzip : file.body;
    if (wantsGzip) headers["Content-Encoding"] = "gzip";
    headers["Content-Length"] = body.length;
    res.writeHead(200, headers);
    res.end(req.method === "HEAD" ? undefined : body);
    return true;
  };
}

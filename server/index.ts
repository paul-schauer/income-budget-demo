"use strict";

/*
 * Michigan take-home & budget: static app + optional accounts and cloud sync.
 *
 *   node server.js            production (Postgres when DATABASE_URL is set)
 *   npm run dev               local dev, data kept in data/dev-db.json
 *
 * Environment: see .env.example.
 */

const { loadConfig } = require("./server/config");
const { createStore } = require("./server/store");
const { createServer } = require("./server/app");

async function main() {
  const config = loadConfig();
  const store = createStore(config);
  // The database may still be starting (e.g. right after a Railway deploy): retry for ~30s.
  for (let attempt = 1; ; attempt++) {
    try {
      await store.init();
      break;
    } catch (err) {
      if (attempt >= 6) throw err;
      console.error(`[server] storage not ready (${/** @type {Error} */ (err).message}); retrying in ${attempt * 2}s`);
      await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
    }
  }

  if (store.kind === "memory" && config.nodeEnv === "production") {
    console.warn("[server] DATABASE_URL is not set: accounts and synced data are kept in memory and lost on restart.");
  }

  const server = createServer({ config, store });
  await /** @type {Promise<void>} */ (new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, resolve);
  }));
  // Listening on a TCP port, so address() is an AddressInfo (not a pipe name or null).
  const { port } = /** @type {import("node:net").AddressInfo} */ (server.address());
  console.log(`[server] listening on http://localhost:${port} (store: ${store.kind}, sign-ups ${config.allowSignup ? "open" : "closed"})`);

  let stopping = false;
  /** @param {string} signal */
  async function shutdown(signal) {
    if (stopping) return;
    stopping = true;
    console.log(`[server] ${signal} received, shutting down`);
    const force = setTimeout(() => {
      console.error("[server] forced exit after timeout");
      process.exit(1);
    }, 10000);
    force.unref();
    // Stop accepting connections, let in-flight requests finish, then drop stragglers.
    /** @type {Promise<void>} */
    const closed = new Promise((resolve) => server.close(() => resolve()));
    server.closeIdleConnections();
    setTimeout(() => server.closeAllConnections(), 5000).unref();
    await closed;
    try { await store.close(); } catch (err) { console.error("[server] store close failed:", /** @type {Error} */ (err).message); }
    process.exit(0);
  }
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[server] failed to start:", err);
    process.exit(1);
  });
}

module.exports = { main };

/*
 * Michigan take-home & budget: static app + optional accounts and cloud sync.
 * This is the server's entry point; npm run build bundles it into dist/server.js.
 *
 *   npm run build && npm start   production (Postgres when DATABASE_URL is set)
 *   npm run dev                  local dev: rebuilds on change, data kept in data/dev-db.json
 *
 * Environment: see .env.example.
 */

import type { AddressInfo } from "node:net";
import { loadConfig } from "./config";
import { createStore } from "./store";
import { createServer } from "./app";

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
      console.error(`[server] storage not ready (${(err as Error).message}); retrying in ${attempt * 2}s`);
      await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
    }
  }

  if (store.kind === "memory" && config.nodeEnv === "production") {
    console.warn("[server] DATABASE_URL is not set: accounts and synced data are kept in memory and lost on restart.");
  }

  const server = createServer({ config, store });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, resolve);
  });
  // Listening on a TCP port, so address() is an AddressInfo (not a pipe name or null).
  const { port } = server.address() as AddressInfo;
  console.log(`[server] listening on http://localhost:${port} (store: ${store.kind}, sign-ups ${config.allowSignup ? "open" : "closed"})`);

  let stopping = false;
  async function shutdown(signal: string) {
    if (stopping) return;
    stopping = true;
    console.log(`[server] ${signal} received, shutting down`);
    const force = setTimeout(() => {
      console.error("[server] forced exit after timeout");
      process.exit(1);
    }, 10000);
    force.unref();
    // Stop accepting connections, let in-flight requests finish, then drop stragglers.
    const closed = new Promise<void>((resolve) => server.close(() => resolve()));
    server.closeIdleConnections();
    setTimeout(() => server.closeAllConnections(), 5000).unref();
    await closed;
    try { await store.close(); } catch (err) { console.error("[server] store close failed:", (err as Error).message); }
    process.exit(0);
  }
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err: unknown) => {
  console.error("[server] failed to start:", err);
  process.exit(1);
});

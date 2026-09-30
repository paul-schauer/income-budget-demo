"use strict";

const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

/**
 * @param {string | undefined} value
 * @param {boolean} fallback
 * @returns {boolean}
 */
function flag(value, fallback) {
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  return !/^(0|false|no|off)$/i.test(String(value).trim());
}

/**
 * TRUST_PROXY follows Express semantics:
 *   unset / "0" / "false"  -> ignore X-Forwarded-For, use the socket address
 *   "1" (or another number n) -> n trusted proxy hops; the client is the nth entry from the right
 *   "true"                 -> trust every hop; the client is the leftmost entry
 * On Railway (RAILWAY_ENVIRONMENT* is set) it defaults to 1, because every request
 * arrives through Railway's edge proxy.
 * @param {NodeJS.ProcessEnv} env
 * @returns {number}
 */
function parseTrustProxy(env) {
  const raw = env.TRUST_PROXY;
  if (raw === undefined || String(raw).trim() === "") {
    const onRailway = Boolean(env.RAILWAY_ENVIRONMENT_NAME || env.RAILWAY_ENVIRONMENT || env.RAILWAY_PROJECT_ID);
    return onRailway ? 1 : 0;
  }
  const v = String(raw).trim().toLowerCase();
  if (v === "true" || v === "yes" || v === "on") return Infinity;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {import("../types/server").ServerConfig}
 */
function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || "production";
  const port = Number.parseInt(String(env.PORT), 10);
  /** @type {string | null} */
  let dataFile = null;
  if (env.DATA_FILE) dataFile = path.resolve(ROOT, env.DATA_FILE);
  else if (nodeEnv === "development") dataFile = path.join(ROOT, "data", "dev-db.json");

  return {
    root: ROOT,
    port: Number.isInteger(port) && port >= 0 ? port : 3000,
    host: env.HOST || undefined,
    nodeEnv,
    databaseUrl: env.DATABASE_URL || null,
    pgSslMode: env.PGSSLMODE || null,
    dataFile,
    allowSignup: flag(env.ALLOW_SIGNUP, true),
    trustProxy: parseTrustProxy(env),
    sessionDays: 30,
    rateLimit: { max: 10, windowMs: 15 * 60 * 1000 },
  };
}

module.exports = { loadConfig, parseTrustProxy, ROOT };

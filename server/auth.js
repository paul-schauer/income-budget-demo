"use strict";

const crypto = require("node:crypto");

// scrypt parameters: N=2^15, r=8, p=1 needs 32 MiB, so raise maxmem above Node's default.
const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 64, maxmem: 64 * 1024 * 1024 };
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 1024;
const EMAIL_MAX = 254;

/**
 * @param {string} password
 * @param {Buffer} salt
 * @param {{ N: number, r: number, p: number, keylen: number }} params
 * @returns {Promise<Buffer>}
 */
function scrypt(password, salt, { N, r, p, keylen }) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, keylen, { N, r, p, maxmem: SCRYPT.maxmem }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/**
 * Returns "scrypt$N$r$p$salt$hash" (salt and hash base64url).
 * @param {string} password
 * @returns {Promise<string>}
 */
async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(String(password).normalize("NFC"), salt, SCRYPT);
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64url"), key.toString("base64url")].join("$");
}

/**
 * @param {string} password
 * @param {unknown} stored a hash from hashPassword()
 * @returns {Promise<boolean>}
 */
async function verifyPassword(password, stored) {
  const parts = typeof stored === "string" ? stored.split("$") : [];
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [N, r, p] = parts.slice(1, 4).map(Number);
  if (![N, r, p].every(Number.isInteger) || N > 1 << 20 || r > 32 || p > 16) return false;
  const salt = Buffer.from(parts[4], "base64url");
  const expected = Buffer.from(parts[5], "base64url");
  if (!expected.length) return false;
  const key = await scrypt(String(password).normalize("NFC"), salt, { N, r, p, keylen: expected.length });
  return crypto.timingSafeEqual(key, expected);
}

// Compared against when the email is unknown, so a miss costs as much time as a wrong password.
/** @type {string | null} */
let dummyHash = null;
/**
 * @param {string} password
 * @returns {Promise<false>}
 */
async function burnPasswordCheck(password) {
  if (!dummyHash) dummyHash = await hashPassword("not-a-real-password");
  await verifyPassword(password, dummyHash);
  return false;
}

const newToken = () => crypto.randomBytes(32).toString("base64url");
/** @param {string} token */
const hashToken = (token) => crypto.createHash("sha256").update(String(token)).digest("hex");

/**
 * @param {unknown} email
 * @returns {string}
 */
function normalizeEmail(email) {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

/**
 * @param {string} email normalized
 * @returns {string | null} an error message, or null when valid
 */
function validateEmail(email) {
  if (!email) return "Enter your email address.";
  if (email.length > EMAIL_MAX || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Enter a valid email address.";
  return null;
}

/**
 * @param {unknown} password
 * @returns {string | null} an error message, or null when valid
 */
function validatePassword(password) {
  if (typeof password !== "string" || password.length < PASSWORD_MIN) return `Password must be at least ${PASSWORD_MIN} characters.`;
  if (password.length > PASSWORD_MAX) return "Password is too long.";
  return null;
}

/** Fixed-window counter per key, kept in memory. */
class RateLimiter {
  /** @param {{ max?: number, windowMs?: number }} [opts] */
  constructor({ max = 10, windowMs = 15 * 60 * 1000 } = {}) {
    this.max = max;
    this.windowMs = windowMs;
    /** @type {Map<string, { count: number, reset: number }>} */
    this.hits = new Map();
    this.timer = setInterval(() => this.prune(), Math.min(windowMs, 60 * 1000));
    this.timer.unref();
  }

  /**
   * @param {string} key
   * @param {number} now
   */
  entry(key, now) {
    const e = this.hits.get(key);
    if (e && e.reset > now) return e;
    return null;
  }

  /**
   * Seconds until `key` may try again, or 0 when it isn't limited.
   * @param {string} key
   * @param {number} [now]
   * @returns {number}
   */
  retryAfter(key, now = Date.now()) {
    const e = this.entry(key, now);
    return e && e.count >= this.max ? Math.max(1, Math.ceil((e.reset - now) / 1000)) : 0;
  }

  /**
   * @param {string} key
   * @param {number} [now]
   */
  hit(key, now = Date.now()) {
    const e = this.entry(key, now);
    if (e) e.count += 1;
    else this.hits.set(key, { count: 1, reset: now + this.windowMs });
  }

  /** @param {string} key */
  reset(key) {
    this.hits.delete(key);
  }

  /** @param {number} [now] */
  prune(now = Date.now()) {
    for (const [key, e] of this.hits) if (e.reset <= now) this.hits.delete(key);
  }

  close() {
    clearInterval(this.timer);
  }
}

module.exports = {
  hashPassword,
  verifyPassword,
  burnPasswordCheck,
  newToken,
  hashToken,
  normalizeEmail,
  validateEmail,
  validatePassword,
  RateLimiter,
  PASSWORD_MIN,
};

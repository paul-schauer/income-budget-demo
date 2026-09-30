"use strict";

/*
 * Storage behind one async interface:
 *
 *   init()                                  create tables / load file
 *   createUser(email, passwordHash)         -> user, or null when the email is taken
 *   getUserByEmail(email), getUserById(id)  -> user | null   (user = { id, email, passwordHash, createdAt })
 *   deleteUser(id)                          removes the user, their sessions and their data
 *   createSession(tokenHash, userId, expiresAt)
 *   getSession(tokenHash)                   -> { tokenHash, userId, expiresAt } | null
 *   touchSession(tokenHash, expiresAt)
 *   deleteSession(tokenHash)
 *   deleteExpiredSessions(now)
 *   getState(userId)                        -> { data, version, updatedAt } | null
 *   putState(userId, data, baseVersion)     -> { ok: true, version, updatedAt }
 *                                            | { ok: false, current: { data, version, updatedAt } }
 *   close()
 *
 * Ids are strings. Dates are Date objects. Version 0 means "no data yet".
 */

const fs = require("node:fs");
const path = require("node:path");

const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

class MemoryStore {
  constructor() {
    this.kind = "memory";
    this.nextId = 1;
    this.users = new Map(); // id -> user
    this.byEmail = new Map(); // email -> id
    this.sessions = new Map(); // tokenHash -> session
    this.states = new Map(); // userId -> { data, version, updatedAt }
  }

  async init() {}

  changed() {}

  async createUser(email, passwordHash) {
    if (this.byEmail.has(email)) return null;
    const user = { id: String(this.nextId++), email, passwordHash, createdAt: new Date() };
    this.users.set(user.id, user);
    this.byEmail.set(email, user.id);
    this.changed();
    return { ...user };
  }

  async getUserByEmail(email) {
    const id = this.byEmail.get(email);
    return id ? { ...this.users.get(id) } : null;
  }

  async getUserById(id) {
    const u = this.users.get(String(id));
    return u ? { ...u } : null;
  }

  async deleteUser(id) {
    id = String(id);
    const u = this.users.get(id);
    if (!u) return false;
    this.users.delete(id);
    this.byEmail.delete(u.email);
    this.states.delete(id);
    for (const [k, s] of this.sessions) if (s.userId === id) this.sessions.delete(k);
    this.changed();
    return true;
  }

  async createSession(tokenHash, userId, expiresAt) {
    this.sessions.set(tokenHash, { tokenHash, userId: String(userId), createdAt: new Date(), expiresAt: new Date(expiresAt) });
    this.changed();
  }

  async getSession(tokenHash) {
    const s = this.sessions.get(tokenHash);
    return s ? { tokenHash: s.tokenHash, userId: s.userId, expiresAt: new Date(s.expiresAt) } : null;
  }

  async touchSession(tokenHash, expiresAt) {
    const s = this.sessions.get(tokenHash);
    if (s) { s.expiresAt = new Date(expiresAt); this.changed(); }
  }

  async deleteSession(tokenHash) {
    if (this.sessions.delete(tokenHash)) this.changed();
  }

  async deleteExpiredSessions(now = new Date()) {
    let n = 0;
    for (const [k, s] of this.sessions) if (s.expiresAt <= now) { this.sessions.delete(k); n++; }
    if (n) this.changed();
    return n;
  }

  async getState(userId) {
    const s = this.states.get(String(userId));
    return s ? { data: clone(s.data), version: s.version, updatedAt: new Date(s.updatedAt) } : null;
  }

  async putState(userId, data, baseVersion) {
    userId = String(userId);
    const cur = this.states.get(userId);
    const curVersion = cur ? cur.version : 0;
    if (baseVersion !== curVersion) {
      return { ok: false, current: cur ? await this.getState(userId) : { data: null, version: 0, updatedAt: null } };
    }
    const next = { data: clone(data), version: curVersion + 1, updatedAt: new Date() };
    this.states.set(userId, next);
    this.changed();
    return { ok: true, version: next.version, updatedAt: next.updatedAt };
  }

  async close() {}
}

/** MemoryStore that persists to a JSON file (local development only). */
class FileStore extends MemoryStore {
  constructor(file) {
    super();
    this.kind = "file";
    this.file = file;
    this.writing = Promise.resolve();
    this.dirty = false;
    this.timer = null;
  }

  async init() {
    let raw;
    try {
      raw = JSON.parse(await fs.promises.readFile(this.file, "utf8"));
    } catch (err) {
      if (err.code === "ENOENT") return;
      throw new Error(`Could not read ${this.file}: ${err.message}`);
    }
    this.nextId = Number(raw.nextId) || 1;
    for (const u of raw.users || []) {
      const user = { id: String(u.id), email: u.email, passwordHash: u.passwordHash, createdAt: new Date(u.createdAt) };
      this.users.set(user.id, user);
      this.byEmail.set(user.email, user.id);
      this.nextId = Math.max(this.nextId, Number(user.id) + 1);
    }
    for (const s of raw.sessions || []) {
      this.sessions.set(s.tokenHash, { tokenHash: s.tokenHash, userId: String(s.userId), createdAt: new Date(s.createdAt), expiresAt: new Date(s.expiresAt) });
    }
    for (const s of raw.states || []) {
      this.states.set(String(s.userId), { data: s.data, version: s.version, updatedAt: new Date(s.updatedAt) });
    }
  }

  changed() {
    this.dirty = true;
    if (!this.timer) this.timer = setTimeout(() => { this.timer = null; this.flush(); }, 50);
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    if (!this.dirty) return this.writing;
    this.dirty = false;
    const snapshot = JSON.stringify({
      nextId: this.nextId,
      users: [...this.users.values()],
      sessions: [...this.sessions.values()],
      states: [...this.states.entries()].map(([userId, s]) => ({ userId, ...s })),
    });
    this.writing = this.writing.then(async () => {
      await fs.promises.mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      await fs.promises.writeFile(tmp, snapshot, { mode: 0o600 });
      await fs.promises.rename(tmp, this.file);
    }).catch((err) => console.error("[store] could not write data file:", err.message));
    return this.writing;
  }

  async close() {
    await this.flush();
  }
}

/** Decide the pg `ssl` option from PGSSLMODE or ?sslmode= in the URL (no TLS when neither asks for it). */
function pgOptions(databaseUrl, { pgSslMode } = {}) {
  let connectionString = databaseUrl;
  let mode = null;
  try {
    const url = new URL(databaseUrl);
    mode = url.searchParams.get("sslmode");
    // Strip TLS params so pg's URL parser doesn't override the ssl option below.
    for (const k of ["sslmode", "ssl", "sslrootcert", "sslcert", "sslkey", "uselibpqcompat"]) url.searchParams.delete(k);
    connectionString = url.toString();
  } catch (_) { /* not a URL; let pg parse it */ }
  if (pgSslMode) mode = pgSslMode;
  mode = (mode || "disable").toLowerCase();
  let ssl = false;
  if (mode === "verify-ca" || mode === "verify-full") ssl = { rejectUnauthorized: true };
  else if (mode === "require" || mode === "prefer" || mode === "allow" || mode === "no-verify") ssl = { rejectUnauthorized: false };
  return { connectionString, ssl };
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE CHECK (email = lower(email)),
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions (expires_at);
CREATE TABLE IF NOT EXISTS user_state (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data JSONB NOT NULL,
  version INTEGER NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

const rowUser = (r) => (r ? { id: String(r.id), email: r.email, passwordHash: r.password_hash, createdAt: r.created_at } : null);
const rowState = (r) => (r ? { data: r.data, version: r.version, updatedAt: r.updated_at } : null);

class PgStore {
  constructor(databaseUrl, opts = {}) {
    this.kind = "postgres";
    const { Pool } = require("pg");
    this.pool = new Pool({ ...pgOptions(databaseUrl, opts), max: opts.max || 10, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000 });
    this.pool.on("error", (err) => console.error("[store] idle client error:", err.message));
  }

  async init() {
    // Several instances may start at once; serialize schema creation with an advisory lock.
    const client = await this.pool.connect();
    try {
      await client.query("SELECT pg_advisory_lock(7461001)");
      try { await client.query(SCHEMA); }
      finally { await client.query("SELECT pg_advisory_unlock(7461001)"); }
    } finally {
      client.release();
    }
  }

  async createUser(email, passwordHash) {
    const { rows } = await this.pool.query(
      "INSERT INTO users (email, password_hash) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING RETURNING *",
      [email, passwordHash],
    );
    return rowUser(rows[0]);
  }

  async getUserByEmail(email) {
    const { rows } = await this.pool.query("SELECT * FROM users WHERE email = $1", [email]);
    return rowUser(rows[0]);
  }

  async getUserById(id) {
    const { rows } = await this.pool.query("SELECT * FROM users WHERE id = $1", [id]);
    return rowUser(rows[0]);
  }

  async deleteUser(id) {
    const { rowCount } = await this.pool.query("DELETE FROM users WHERE id = $1", [id]);
    return rowCount > 0;
  }

  async createSession(tokenHash, userId, expiresAt) {
    await this.pool.query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)", [tokenHash, userId, expiresAt]);
  }

  async getSession(tokenHash) {
    const { rows } = await this.pool.query("SELECT token_hash, user_id, expires_at FROM sessions WHERE token_hash = $1", [tokenHash]);
    const r = rows[0];
    return r ? { tokenHash: r.token_hash, userId: String(r.user_id), expiresAt: r.expires_at } : null;
  }

  async touchSession(tokenHash, expiresAt) {
    await this.pool.query("UPDATE sessions SET expires_at = $2 WHERE token_hash = $1", [tokenHash, expiresAt]);
  }

  async deleteSession(tokenHash) {
    await this.pool.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash]);
  }

  async deleteExpiredSessions(now = new Date()) {
    const { rowCount } = await this.pool.query("DELETE FROM sessions WHERE expires_at <= $1", [now]);
    return rowCount;
  }

  async getState(userId) {
    const { rows } = await this.pool.query("SELECT data, version, updated_at FROM user_state WHERE user_id = $1", [userId]);
    return rowState(rows[0]);
  }

  async putState(userId, data, baseVersion) {
    const json = JSON.stringify(data);
    const { rows } = baseVersion === 0
      ? await this.pool.query(
        `INSERT INTO user_state (user_id, data, version, updated_at) VALUES ($1, $2::jsonb, 1, now())
         ON CONFLICT (user_id) DO NOTHING RETURNING version, updated_at`, [userId, json])
      : await this.pool.query(
        `UPDATE user_state SET data = $2::jsonb, version = version + 1, updated_at = now()
         WHERE user_id = $1 AND version = $3 RETURNING version, updated_at`, [userId, json, baseVersion]);
    if (rows[0]) return { ok: true, version: rows[0].version, updatedAt: rows[0].updated_at };
    const current = (await this.getState(userId)) || { data: null, version: 0, updatedAt: null };
    return { ok: false, current };
  }

  async close() {
    await this.pool.end();
  }
}

function createStore(config) {
  if (config.databaseUrl) return new PgStore(config.databaseUrl, { pgSslMode: config.pgSslMode });
  if (config.dataFile) return new FileStore(config.dataFile);
  return new MemoryStore();
}

module.exports = { createStore, MemoryStore, FileStore, PgStore, pgOptions };

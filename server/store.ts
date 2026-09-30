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

import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import type {
  DataFileContents, EmptyState, PutStateResult, ServerConfig, Session, SessionRow, StateRow, Store, StoredSession,
  StoredState, User, UserRow,
} from "./types";

const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

export class MemoryStore implements Store {
  kind: Store["kind"] = "memory";
  nextId = 1;
  users = new Map<string, User>(); // id -> user
  byEmail = new Map<string, string>(); // email -> id
  sessions = new Map<string, StoredSession>(); // tokenHash -> session
  states = new Map<string, StoredState>(); // userId -> { data, version, updatedAt }

  async init() {}

  changed() {}

  async createUser(email: string, passwordHash: string): Promise<User | null> {
    if (this.byEmail.has(email)) return null;
    const user = { id: String(this.nextId++), email, passwordHash, createdAt: new Date() };
    this.users.set(user.id, user);
    this.byEmail.set(email, user.id);
    this.changed();
    return { ...user };
  }

  async getUserByEmail(email: string): Promise<User | null> {
    const id = this.byEmail.get(email);
    // byEmail and users are updated together, so the user exists.
    return id ? { ...this.users.get(id)! } : null;
  }

  async getUserById(id: string): Promise<User | null> {
    const u = this.users.get(String(id));
    return u ? { ...u } : null;
  }

  async deleteUser(id: string): Promise<boolean> {
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

  async createSession(tokenHash: string, userId: string, expiresAt: Date): Promise<void> {
    this.sessions.set(tokenHash, { tokenHash, userId: String(userId), createdAt: new Date(), expiresAt: new Date(expiresAt) });
    this.changed();
  }

  async getSession(tokenHash: string): Promise<Session | null> {
    const s = this.sessions.get(tokenHash);
    return s ? { tokenHash: s.tokenHash, userId: s.userId, expiresAt: new Date(s.expiresAt) } : null;
  }

  async touchSession(tokenHash: string, expiresAt: Date): Promise<void> {
    const s = this.sessions.get(tokenHash);
    if (s) { s.expiresAt = new Date(expiresAt); this.changed(); }
  }

  async deleteSession(tokenHash: string): Promise<void> {
    if (this.sessions.delete(tokenHash)) this.changed();
  }

  async deleteExpiredSessions(now = new Date()): Promise<number> {
    let n = 0;
    for (const [k, s] of this.sessions) if (s.expiresAt <= now) { this.sessions.delete(k); n++; }
    if (n) this.changed();
    return n;
  }

  async getState(userId: string): Promise<StoredState | null> {
    const s = this.states.get(String(userId));
    return s ? { data: clone(s.data), version: s.version, updatedAt: new Date(s.updatedAt) } : null;
  }

  async putState(userId: string, data: unknown, baseVersion: number): Promise<PutStateResult> {
    userId = String(userId);
    const cur = this.states.get(userId);
    const curVersion = cur ? cur.version : 0;
    if (baseVersion !== curVersion) {
      // With `cur` set, getState() finds it.
      return { ok: false, current: cur ? (await this.getState(userId))! : { data: null, version: 0, updatedAt: null } };
    }
    const next = { data: clone(data), version: curVersion + 1, updatedAt: new Date() };
    this.states.set(userId, next);
    this.changed();
    return { ok: true, version: next.version, updatedAt: next.updatedAt };
  }

  async close() {}
}

/** MemoryStore that persists to a JSON file (local development only). */
export class FileStore extends MemoryStore {
  kind: Store["kind"] = "file";
  file: string;
  writing: Promise<void> = Promise.resolve();
  dirty = false;
  timer: NodeJS.Timeout | null = null;

  constructor(file: string) {
    super();
    this.file = file;
  }

  async init() {
    let raw: DataFileContents;
    try {
      raw = JSON.parse(await fs.promises.readFile(this.file, "utf8"));
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === "ENOENT") return;
      throw new Error(`Could not read ${this.file}: ${e.message}`);
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
    if (this.timer) clearTimeout(this.timer);
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
    }).catch((err: Error) => console.error("[store] could not write data file:", err.message));
    return this.writing;
  }

  async close() {
    await this.flush();
  }
}

/** Decide the pg `ssl` option from PGSSLMODE or ?sslmode= in the URL (no TLS when neither asks for it). */
export function pgOptions(
  databaseUrl: string,
  { pgSslMode }: { pgSslMode?: string | null } = {},
): { connectionString: string; ssl: false | { rejectUnauthorized: boolean } } {
  let connectionString = databaseUrl;
  let mode: string | null = null;
  try {
    const url = new URL(databaseUrl);
    mode = url.searchParams.get("sslmode");
    // Strip TLS params so pg's URL parser doesn't override the ssl option below.
    for (const k of ["sslmode", "ssl", "sslrootcert", "sslcert", "sslkey", "uselibpqcompat"]) url.searchParams.delete(k);
    connectionString = url.toString();
  } catch (_) { /* not a URL; let pg parse it */ }
  if (pgSslMode) mode = pgSslMode;
  mode = (mode || "disable").toLowerCase();
  let ssl: false | { rejectUnauthorized: boolean } = false;
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

const rowUser = (r: UserRow | undefined): User | null => (r ? { id: String(r.id), email: r.email, passwordHash: r.password_hash, createdAt: r.created_at } : null);
const rowState = (r: StateRow | undefined): StoredState | null => (r ? { data: r.data, version: r.version, updatedAt: r.updated_at } : null);

export class PgStore implements Store {
  kind: Store["kind"] = "postgres";
  pool: pg.Pool;

  constructor(databaseUrl: string, opts: { pgSslMode?: string | null; max?: number } = {}) {
    this.pool = new pg.Pool({ ...pgOptions(databaseUrl, opts), max: opts.max || 10, idleTimeoutMillis: 30000, connectionTimeoutMillis: 10000 });
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

  async createUser(email: string, passwordHash: string): Promise<User | null> {
    const { rows } = await this.pool.query<UserRow>(
      "INSERT INTO users (email, password_hash) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING RETURNING *",
      [email, passwordHash],
    );
    return rowUser(rows[0]);
  }

  async getUserByEmail(email: string): Promise<User | null> {
    const { rows } = await this.pool.query<UserRow>("SELECT * FROM users WHERE email = $1", [email]);
    return rowUser(rows[0]);
  }

  async getUserById(id: string): Promise<User | null> {
    const { rows } = await this.pool.query<UserRow>("SELECT * FROM users WHERE id = $1", [id]);
    return rowUser(rows[0]);
  }

  // rowCount is always a number for the INSERT/UPDATE/DELETE/SELECT statements run here.
  async deleteUser(id: string): Promise<boolean> {
    const { rowCount } = await this.pool.query("DELETE FROM users WHERE id = $1", [id]);
    return rowCount! > 0;
  }

  async createSession(tokenHash: string, userId: string, expiresAt: Date): Promise<void> {
    await this.pool.query("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)", [tokenHash, userId, expiresAt]);
  }

  async getSession(tokenHash: string): Promise<Session | null> {
    const { rows } = await this.pool.query<SessionRow>("SELECT token_hash, user_id, expires_at FROM sessions WHERE token_hash = $1", [tokenHash]);
    const r = rows[0];
    return r ? { tokenHash: r.token_hash, userId: String(r.user_id), expiresAt: r.expires_at } : null;
  }

  async touchSession(tokenHash: string, expiresAt: Date): Promise<void> {
    await this.pool.query("UPDATE sessions SET expires_at = $2 WHERE token_hash = $1", [tokenHash, expiresAt]);
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.pool.query("DELETE FROM sessions WHERE token_hash = $1", [tokenHash]);
  }

  async deleteExpiredSessions(now = new Date()): Promise<number> {
    const { rowCount } = await this.pool.query("DELETE FROM sessions WHERE expires_at <= $1", [now]);
    return rowCount!;
  }

  async getState(userId: string): Promise<StoredState | null> {
    const { rows } = await this.pool.query<StateRow>("SELECT data, version, updated_at FROM user_state WHERE user_id = $1", [userId]);
    return rowState(rows[0]);
  }

  async putState(userId: string, data: unknown, baseVersion: number): Promise<PutStateResult> {
    const json = JSON.stringify(data);
    const { rows } = baseVersion === 0
      ? await this.pool.query<Pick<StateRow, "version" | "updated_at">>(
        `INSERT INTO user_state (user_id, data, version, updated_at) VALUES ($1, $2::jsonb, 1, now())
         ON CONFLICT (user_id) DO NOTHING RETURNING version, updated_at`, [userId, json])
      : await this.pool.query<Pick<StateRow, "version" | "updated_at">>(
        `UPDATE user_state SET data = $2::jsonb, version = version + 1, updated_at = now()
         WHERE user_id = $1 AND version = $3 RETURNING version, updated_at`, [userId, json, baseVersion]);
    if (rows[0]) return { ok: true, version: rows[0].version, updatedAt: rows[0].updated_at };
    const current: StoredState | EmptyState = (await this.getState(userId)) || { data: null, version: 0, updatedAt: null };
    return { ok: false, current };
  }

  async close() {
    await this.pool.end();
  }
}

export function createStore(config: ServerConfig): Store {
  if (config.databaseUrl) return new PgStore(config.databaseUrl, { pgSslMode: config.pgSslMode });
  if (config.dataFile) return new FileStore(config.dataFile);
  return new MemoryStore();
}

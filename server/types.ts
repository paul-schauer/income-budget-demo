/**
 * Types for the Node server (server/*.ts). Type-only: nothing here exists at runtime.
 */
import type { IncomingMessage, Server, ServerResponse } from "node:http";

export type Req = IncomingMessage;
export type Res = ServerResponse;

/** What loadConfig() returns (server/config.ts). */
export interface ServerConfig {
  /** The folder static files are served from (public/, which holds the built app). */
  root: string;
  port: number;
  host: string | undefined;
  nodeEnv: string;
  databaseUrl: string | null;
  pgSslMode: string | null;
  dataFile: string | null;
  allowSignup: boolean;
  /** Number of trusted proxy hops: 0 = ignore X-Forwarded-For, Infinity = trust every hop. */
  trustProxy: number;
  sessionDays: number;
  rateLimit: { max: number; windowMs: number };
}

// ---------- Storage (server/store.ts) ----------

export interface User {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: Date;
}

export interface Session {
  tokenHash: string;
  userId: string;
  expiresAt: Date;
}

/** A session as MemoryStore/FileStore keep it. */
export interface StoredSession extends Session {
  createdAt: Date;
}

/** A user's synced document. `data` is whatever object the client sent (not validated further). */
export interface StoredState {
  data: unknown;
  version: number;
  updatedAt: Date;
}

/** "No data yet", reported as the current copy on a version conflict. */
export interface EmptyState {
  data: null;
  version: 0;
  updatedAt: null;
}

export type PutStateResult =
  | { ok: true; version: number; updatedAt: Date }
  | { ok: false; current: StoredState | EmptyState };

/** The async interface every store implements (see the comment at the top of server/store.ts). */
export interface Store {
  kind: "memory" | "file" | "postgres";
  init(): Promise<void>;
  createUser(email: string, passwordHash: string): Promise<User | null>;
  getUserByEmail(email: string): Promise<User | null>;
  getUserById(id: string): Promise<User | null>;
  deleteUser(id: string): Promise<boolean>;
  createSession(tokenHash: string, userId: string, expiresAt: Date): Promise<void>;
  getSession(tokenHash: string): Promise<Session | null>;
  touchSession(tokenHash: string, expiresAt: Date): Promise<void>;
  deleteSession(tokenHash: string): Promise<void>;
  deleteExpiredSessions(now?: Date): Promise<number>;
  getState(userId: string): Promise<StoredState | null>;
  putState(userId: string, data: unknown, baseVersion: number): Promise<PutStateResult>;
  close(): Promise<void>;
}

/** The development data file as FileStore writes it (dates come back as ISO strings). */
export interface DataFileContents {
  nextId?: unknown;
  users?: { id: string | number; email: string; passwordHash: string; createdAt: string }[];
  sessions?: { tokenHash: string; userId: string | number; createdAt: string; expiresAt: string }[];
  states?: { userId: string | number; data: unknown; version: number; updatedAt: string }[];
}

// ---------- Postgres (server/store.ts) ----------

/** Table rows as pg returns them (BIGINT ids arrive as strings). */
export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  created_at: Date;
}

export interface SessionRow {
  token_hash: string;
  user_id: string;
  expires_at: Date;
}

export interface StateRow {
  data: unknown;
  version: number;
  updated_at: Date;
}

// ---------- Static files (server/static.ts) ----------

export interface StaticFile {
  mtimeMs: number;
  size: number;
  mtime: Date;
  readonly body: Buffer;
  /** Gzipped body, for compressible files over 1 KB. */
  readonly gzip: Buffer | null;
  etag: string;
  type: string | undefined;
  /** sw.js only: the build id last stamped into it, and the stamped copy. */
  stampedId?: string | null;
  stamped?: StaticFile;
}

// ---------- App (server/app.ts) ----------

/**
 * A parsed JSON request body before validation (readJson() itself returns unknown).
 * Reading a property is safe on any non-null JSON value, so every field is unknown until checked.
 */
export type JsonFields = { readonly [key: string]: unknown } | null | undefined;

/** An API route handler; `ip` is the client address from clientIp(). */
export type Route = (req: Req, res: Res, ip: string) => Promise<void>;

/** The http.Server that createServer() returns, with the app attached for tests. */
export type WithApp<A> = Server & { app: A };

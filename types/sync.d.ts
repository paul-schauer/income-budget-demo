/**
 * Types for accounts and cloud sync (js/sync.js). Type-only: nothing here exists at runtime.
 */

export type SyncStatus = "synced" | "syncing" | "offline" | "error" | "paused";

/** Sync bookkeeping, kept in its own localStorage key (never in the app state). */
export interface SyncMeta {
  /** Signed-in account. */
  email?: string;
  /** Server version this device last matched. */
  version?: number;
  /** App.state().updatedAt when this device last matched the server. */
  syncedAt?: number;
  lastSync?: number;
  lastPull?: number;
  /** Signed out while offline: finish logging out with the server next time. */
  pendingLogout?: boolean;
}

/**
 * A state document from the server or another device: normally an AppState, but nothing
 * has validated it, so only the fields sync reads are named and each is unknown.
 */
export interface SyncDoc {
  updatedAt?: unknown;
  items?: unknown;
  goals?: unknown;
  [key: string]: unknown;
}

/** A budget item inside a SyncDoc, as far as sync looks at it. */
export type LooseItem = { id?: unknown; name?: unknown } | null | undefined;

/**
 * A JSON object from the sync API (server/app.js). Only checked to be an object; each route
 * fills in its own fields.
 */
export interface SyncApiBody {
  ok?: boolean;
  email?: string | null;
  error?: string;
  data?: SyncDoc | null;
  version?: number;
  updatedAt?: string | null;
}

export interface SyncApiResult {
  /** HTTP status, or 0 when the request failed (offline, DNS, timeout...). */
  status: number;
  ok: boolean;
  json: SyncApiBody;
}

/** The server copy waiting for the user to choose, when both sides changed. */
export interface SyncConflict {
  data: SyncDoc | null | undefined;
  version: number;
  updatedAt: string | null | undefined;
}

/** The sign-in / create-account form. */
export type AuthForm = HTMLFormElement & { email: HTMLInputElement; password: HTMLInputElement };

/** The delete-account form. */
export type DeleteForm = HTMLFormElement & { password: HTMLInputElement };

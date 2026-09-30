/*
 * Optional accounts and cloud sync (local-first).
 *
 * The app always works from localStorage. When the page is served by server.js,
 * a "Sign in" button appears; signing in syncs the whole state document with
 * the account:
 *
 *   - Local saves are pushed ~1.2 s later (PUT api/state with baseVersion).
 *   - The server copy is pulled on sign-in, page load, reconnect and on focus
 *     (at most every 30 s).
 *   - When both sides changed, the user picks which copy to keep.
 *
 * Sync bookkeeping lives in its own localStorage key (META_KEY), never in the
 * app state: { email, version, syncedAt, lastSync, lastPull }.
 *   version  = server version this device last matched
 *   syncedAt = App.state().updatedAt at that moment; if the state's updatedAt
 *              differs, this device has unsynced changes.
 */
(function () {
  "use strict";

  if (!window.App) return;

  const META_KEY = "incomebudget:sync";
  const PUSH_DELAY = 1200;
  const PULL_AFTER = 30 * 1000;
  const REQUEST_TIMEOUT = 15 * 1000;
  const KEEPALIVE_MAX = 60 * 1024;
  const MIN_PASSWORD = 8;
  const OFFLINE_DETAIL = "Changes are saved on this device and will sync when you're back online.";

  const LABELS = {
    synced: "Synced",
    syncing: "Syncing…",
    offline: "Offline, will sync",
    error: "Sync error",
    paused: "Sync paused",
  };

  const ICON_USER = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>';
  const ICON_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ---------- Sync metadata ----------

  function readMeta() {
    try {
      const m = JSON.parse(localStorage.getItem(META_KEY) || "null");
      return m && typeof m === "object" ? m : {};
    } catch (_) {
      return {};
    }
  }
  function writeMeta() {
    try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch (_) { /* storage unavailable */ }
  }
  function clearMeta(keep = {}) {
    meta = { ...keep };
    try {
      if (Object.keys(meta).length) localStorage.setItem(META_KEY, JSON.stringify(meta));
      else localStorage.removeItem(META_KEY);
    } catch (_) { /* storage unavailable */ }
  }

  let meta = readMeta();

  // ---------- Runtime state ----------

  let enabled = false; // the sync server exists (or we were signed in and are offline)
  let email = null; // signed-in account
  let confirmed = false; // session checked with the server this page load
  let status = "synced";
  let statusDetail = "";
  let conflict = null; // server copy waiting for the user's choice
  let pushTimer = null;
  let retryTimer = null;
  let retryDelay = 0;
  let chain = Promise.resolve();

  let slot = null;
  let dialogRoot = null;
  let dialog = null;
  let opener = null;
  let noteEl = null;
  let noteText = "";

  /** Run network sync steps one at a time. */
  function serial(fn) {
    const p = chain.then(fn, fn);
    chain = p.catch(() => {});
    return p;
  }

  // ---------- HTTP ----------

  async function api(method, path, body, { keepalive = false } = {}) {
    const ctrl = typeof AbortController === "function" ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT) : null;
    try {
      const res = await fetch(`api/${path}`, {
        method,
        headers: body === undefined ? { Accept: "application/json" } : { Accept: "application/json", "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: "same-origin",
        cache: "no-store",
        keepalive,
        signal: ctrl ? ctrl.signal : undefined,
      });
      let json = null;
      try { json = await res.json(); } catch (_) { /* not JSON */ }
      return { status: res.status, ok: res.ok, json: json && typeof json === "object" ? json : {} };
    } catch (_) {
      return { status: 0, ok: false, json: {} }; // offline, DNS, timeout...
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  // ---------- Helpers ----------

  const hasLocalChanges = () => Number(App.state().updatedAt) !== Number(meta.syncedAt);
  const isUntouched = (doc) => !doc || !Number(doc.updatedAt);

  /** JSON with sorted keys, ignoring updatedAt, to compare two state documents. */
  function fingerprint(doc) {
    const walk = (v) => {
      if (Array.isArray(v)) return v.map(walk);
      if (v && typeof v === "object") {
        const out = {};
        for (const k of Object.keys(v).sort()) if (v[k] !== undefined) out[k] = walk(v[k]);
        return out;
      }
      return v;
    };
    const copy = JSON.parse(JSON.stringify(doc || {}));
    delete copy.updatedAt;
    return JSON.stringify(walk(copy));
  }
  const sameData = (a, b) => fingerprint(a) === fingerprint(b);

  function ago(ms) {
    if (!ms) return "";
    const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 45) return "just now";
    const m = Math.round(s / 60);
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} hr ago`;
    return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }

  function when(value) {
    const d = new Date(value);
    if (!value || Number.isNaN(d.getTime())) return "Not changed yet";
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }

  function summary(doc) {
    const count = (v) => (Array.isArray(v) ? v.length : 0);
    const items = count(doc && doc.items);
    const goals = count(doc && doc.goals);
    const parts = [`${items} budget item${items === 1 ? "" : "s"}`];
    if (goals) parts.push(`${goals} goal${goals === 1 ? "" : "s"}`);
    return parts.join(", ");
  }

  /** Names of budget items in `doc` that `other` doesn't have (by id), for the conflict prompt. */
  function onlyIn(doc, other) {
    const ids = new Set((Array.isArray(other && other.items) ? other.items : []).map((i) => i && i.id));
    const names = (Array.isArray(doc && doc.items) ? doc.items : [])
      .filter((i) => i && !ids.has(i.id) && typeof i.name === "string")
      .map((i) => i.name);
    if (!names.length) return "";
    const shown = names.slice(0, 3).join(", ");
    return names.length > 3 ? `${shown} and ${names.length - 3} more` : shown;
  }

  // ---------- Status & header ----------

  function setStatus(next, detail = "") {
    status = next;
    statusDetail = detail;
    renderSlot();
    if (dialog && dialog.open && dialog.dataset.view === "account") refreshAccountStatus();
  }

  function renderSlot() {
    if (!slot) return;
    if (!enabled) { slot.innerHTML = ""; updateNote(); return; }
    const kind = email ? "status" : "signin";
    let btn = slot.querySelector("button");
    if (!btn || btn.dataset.kind !== kind) {
      slot.innerHTML = kind === "signin"
        ? `<button type="button" class="btn ghost sync-btn" data-kind="signin" aria-haspopup="dialog">${ICON_USER}<span>Sign in</span></button>`
        : `<button type="button" class="btn ghost sync-btn" data-kind="status" aria-haspopup="dialog"><span class="sync-dot" aria-hidden="true"></span><span class="sync-label"></span></button>`;
      btn = slot.querySelector("button");
    }
    if (kind === "status") {
      const label = LABELS[status] || LABELS.synced;
      btn.dataset.status = status;
      btn.querySelector(".sync-label").textContent = label;
      btn.title = statusDetail || `Signed in as ${email}`;
      btn.setAttribute("aria-label", `${label}. Account menu for ${email}`);
    } else {
      btn.title = "Optional: sign in to sync across devices";
    }
    updateNote();
  }

  function updateNote() {
    if (!noteEl) return;
    const text = email && enabled ? "Synced to your account." : noteText;
    if (noteEl.textContent !== text) noteEl.textContent = text;
  }

  function onSlotClick(e) {
    const btn = e.target.closest("button");
    if (!btn) return;
    if (btn.dataset.kind === "signin") openAuth("signin");
    else if (conflict) openConflict();
    else openAccount();
  }

  // ---------- Session ----------

  function becomeSignedIn(addr) {
    if (meta.email !== addr) clearMeta({ email: addr }); // different account: start fresh
    email = addr;
    confirmed = true;
    writeMeta();
    renderSlot();
  }

  function becomeSignedOut(message) {
    clearTimeout(pushTimer);
    clearTimeout(retryTimer);
    pushTimer = retryTimer = null;
    retryDelay = 0;
    email = null;
    confirmed = false;
    conflict = null;
    status = "synced";
    clearMeta();
    if (dialog && dialog.open && dialog.dataset.view !== "auth") closeDialog();
    renderSlot();
    if (message) App.showToast(message);
  }

  /** Ask the server who we are. Run inside serial(). */
  async function checkSession({ announce = false } = {}) {
    const me = await api("GET", "me");
    if (me.status === 200 && me.json.email) {
      becomeSignedIn(me.json.email);
      await pullAndDecide({ announce });
    } else if (me.status === 401 || (me.status === 200 && !me.json.email)) {
      const was = email || meta.email;
      becomeSignedOut(was ? "You were signed out. Sign in again to keep syncing." : "");
    } else if (meta.email) {
      email = meta.email;
      if (me.status === 0) setStatus("offline", OFFLINE_DETAIL);
      else setStatus("error", me.json.error || `The server answered ${me.status}.`);
      scheduleRetry();
    } else {
      renderSlot();
    }
  }

  // ---------- Sync ----------

  /** Pull the server copy and decide what to do with it. Run inside serial(). */
  async function pullAndDecide({ announce = false, quiet = false } = {}) {
    if (!email || conflict) return;
    if (!quiet) setStatus("syncing");
    const res = await api("GET", "state");
    if (!res.ok) return failed(res);
    meta.lastPull = Date.now();
    writeMeta();
    await decide(res.json, { announce, fromPull: !announce });
  }

  /** Given the server copy {data, version, updatedAt}, push, pull or ask. */
  async function decide(server, { announce = false, fromPull = false } = {}) {
    const local = App.state();
    const version = Number(server.version) || 0;

    if (!server.data) {
      meta.version = 0;
      await pushNow({ force: true });
      if (announce && status === "synced") App.showToast("Signed in. This device's data is now saved to your account.");
      return;
    }
    if (version === meta.version) {
      if (hasLocalChanges()) await pushNow();
      else { markSynced(); if (announce) App.showToast(`Signed in as ${email}.`); }
      return;
    }
    if (sameData(local, server.data)) {
      takeServer(server);
      if (announce) App.showToast(`Signed in as ${email}.`);
      return;
    }
    if (isUntouched(server.data) && !isUntouched(local)) {
      // The account only has an untouched blank state: keep this device's real data.
      meta.version = version;
      await pushNow({ force: true });
      return;
    }
    if (!hasLocalChanges() || isUntouched(local)) {
      takeServer(server);
      if (announce) App.showToast("Signed in. Loaded the data from your account.");
      else if (fromPull) App.showToast("Updated with changes from your account.");
      return;
    }
    askConflict(server);
  }

  function takeServer(server) {
    App.replaceState(server.data);
    meta.version = Number(server.version) || 0;
    meta.syncedAt = Number(App.state().updatedAt) || 0;
    conflict = null;
    markSynced();
  }

  function markSynced() {
    meta.lastSync = Date.now();
    writeMeta();
    retryDelay = 0;
    clearTimeout(retryTimer);
    setStatus("synced");
  }

  function askConflict(server) {
    conflict = { data: server.data, version: Number(server.version) || 0, updatedAt: server.updatedAt };
    clearTimeout(pushTimer);
    setStatus("paused", "Choose which data to keep");
    openConflict();
  }

  /** PUT the local state. Run inside serial(). */
  async function pushNow({ force = false, keepalive = false } = {}) {
    clearTimeout(pushTimer);
    pushTimer = null;
    if (!email || conflict) return;
    if (!force && !hasLocalChanges()) { setStatus("synced"); return; }
    setStatus("syncing");
    const doc = App.state();
    const sentAt = Number(doc.updatedAt) || 0;
    const res = await api("PUT", "state", { data: doc, baseVersion: Number(meta.version) || 0 }, { keepalive });
    if (res.status === 200) {
      meta.version = Number(res.json.version) || 0;
      meta.syncedAt = sentAt;
      meta.lastPull = Date.now();
      markSynced();
      if (hasLocalChanges()) schedulePush();
      return;
    }
    if (res.status === 409) {
      if (!res.json.data) { meta.version = Number(res.json.version) || 0; return pushNow({ force: true }); }
      return decide(res.json, { fromPull: true });
    }
    failed(res);
  }

  function failed(res) {
    if (res.status === 401) return becomeSignedOut("You were signed out. Sign in again to keep syncing.");
    if (res.status === 413) return setStatus("error", "Your data is too large to sync (1 MB limit).");
    if (res.status === 0) setStatus("offline", OFFLINE_DETAIL);
    else setStatus("error", res.json.error || `The server answered ${res.status}.`);
    scheduleRetry();
  }

  function scheduleRetry() {
    clearTimeout(retryTimer);
    retryDelay = Math.min(Math.max(5000, retryDelay * 2), 5 * 60 * 1000);
    retryTimer = setTimeout(syncNow, retryDelay);
  }

  function schedulePush(delay = PUSH_DELAY) {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => { pushTimer = null; serial(() => pushNow()); }, delay);
  }

  /** Full round trip: confirm the session if needed, then pull (which pushes if needed). */
  function syncNow() {
    clearTimeout(retryTimer);
    if (!enabled || !email || conflict) return Promise.resolve();
    if (!confirmed) return serial(() => checkSession());
    return serial(() => pullAndDecide({ quiet: status === "offline" }));
  }

  function onLocalSave() {
    if (!email || conflict) return;
    if (navigator.onLine === false) { setStatus("offline", OFFLINE_DETAIL); return; }
    setStatus("syncing");
    schedulePush();
  }

  function maybePull() {
    if (!email || conflict || document.visibilityState === "hidden") return;
    if (Date.now() - (Number(meta.lastPull) || 0) < PULL_AFTER) return;
    if (pushTimer) return; // a push is about to happen anyway
    meta.lastPull = Date.now(); // focus and visibilitychange often fire together
    syncNow();
  }

  /** Page is being hidden: send a pending push right away. */
  function flushPush() {
    if (!pushTimer || !email || conflict) return;
    clearTimeout(pushTimer);
    pushTimer = null;
    let small = false;
    try { small = JSON.stringify(App.state()).length < KEEPALIVE_MAX; } catch (_) { /* ignore */ }
    serial(() => pushNow({ keepalive: small }));
  }

  // ---------- Dialog ----------

  function ensureDialog() {
    if (dialog) return dialog;
    dialog = document.createElement("dialog");
    dialog.className = "sync-dialog";
    dialog.setAttribute("aria-labelledby", "syncDlgTitle");
    dialogRoot.appendChild(dialog);
    dialog.addEventListener("click", onDialogClick);
    dialog.addEventListener("submit", onDialogSubmit);
    dialog.addEventListener("close", () => {
      if (dialog.open) return; // reopened before this event fired
      dialog.dataset.view = "";
      const back = opener && document.contains(opener) ? opener : slot.querySelector("button");
      opener = null;
      if (back && (document.activeElement === document.body || dialog.contains(document.activeElement))) back.focus();
    });
    // Clicking the backdrop closes the dialog.
    dialog.addEventListener("mousedown", (e) => { dialog.dataset.downOnBackdrop = String(e.target === dialog); });
    return dialog;
  }

  function showDialog(view, html, focusSel) {
    ensureDialog();
    if (!dialog.open) opener = document.activeElement;
    dialog.dataset.view = view;
    dialog.innerHTML = `<div class="sync-dlg">${html}</div>`;
    if (!dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
    const target = focusSel && dialog.querySelector(focusSel);
    if (target) target.focus();
  }

  function closeDialog() {
    if (!dialog || !dialog.open) return;
    if (typeof dialog.close === "function") dialog.close();
    else { dialog.removeAttribute("open"); dialog.dispatchEvent(new Event("close")); }
  }

  const head = (title) => `
    <div class="sync-dlg-head">
      <h2 id="syncDlgTitle" tabindex="-1">${esc(title)}</h2>
      <button type="button" class="icon-btn" data-sync-act="close" aria-label="Close">${ICON_X}</button>
    </div>`;

  function openAuth(mode, { emailValue = "" } = {}) {
    const signup = mode === "signup";
    showDialog("auth", `
      ${head(signup ? "Create account" : "Sign in")}
      <p class="sync-lede" id="syncLede">Optional. An account keeps your budget in sync across your devices. Without one, everything stays saved in this browser.</p>
      <div class="seg sync-mode" role="group" aria-label="Choose">
        <button type="button" data-mode="signin" aria-pressed="${!signup}">Sign in</button>
        <button type="button" data-mode="signup" aria-pressed="${signup}">Create account</button>
      </div>
      <form class="sync-form" data-form="auth" data-mode="${signup ? "signup" : "signin"}" novalidate>
        <div class="field">
          <label for="syncEmail">Email</label>
          <input id="syncEmail" name="email" type="email" inputmode="email" autocomplete="username" autocapitalize="off" spellcheck="false" maxlength="254" required value="${esc(emailValue)}" aria-describedby="syncError">
        </div>
        <div class="field">
          <label for="syncPassword">Password</label>
          <input id="syncPassword" name="password" type="password" autocomplete="${signup ? "new-password" : "current-password"}" minlength="${MIN_PASSWORD}" maxlength="1024" required aria-describedby="${signup ? "syncPwHint " : ""}syncError">
        </div>
        <p class="hint" id="syncPwHint"${signup ? "" : " hidden"}>At least ${MIN_PASSWORD} characters.</p>
        <p class="sync-error" id="syncError" role="alert"></p>
        <button class="btn primary sync-wide" type="submit">${signup ? "Create account" : "Sign in"}</button>
      </form>`, emailValue ? "#syncPassword" : "#syncEmail");
    dialog.setAttribute("aria-describedby", "syncLede");
  }

  /** Switch between Sign in and Create account without losing what was typed. */
  function setAuthMode(mode) {
    const form = dialog.querySelector("form[data-form=auth]");
    if (!form) return;
    const signup = mode === "signup";
    form.dataset.mode = signup ? "signup" : "signin";
    for (const b of dialog.querySelectorAll("button[data-mode]")) b.setAttribute("aria-pressed", String(b.dataset.mode === form.dataset.mode));
    dialog.querySelector("#syncDlgTitle").textContent = signup ? "Create account" : "Sign in";
    form.querySelector("button[type=submit]").textContent = signup ? "Create account" : "Sign in";
    form.password.setAttribute("autocomplete", signup ? "new-password" : "current-password");
    form.password.setAttribute("aria-describedby", signup ? "syncPwHint syncError" : "syncError");
    dialog.querySelector("#syncPwHint").hidden = !signup;
    showError("");
  }

  function openAccount() {
    showDialog("account", `
      ${head("Your account")}
      <p class="sync-lede">Signed in as <strong class="sync-email">${esc(email)}</strong></p>
      <div class="sync-status-box" id="syncStatusBox"></div>
      <div class="sync-actions">
        <button type="button" class="btn" data-sync-act="sync-now">Sync now</button>
        <button type="button" class="btn" data-sync-act="signout">Sign out</button>
      </div>
      <div class="sync-danger-zone">
        <button type="button" class="linklike sync-danger-link" data-sync-act="delete">Delete account…</button>
      </div>`, "[data-sync-act=sync-now]");
    dialog.removeAttribute("aria-describedby");
    refreshAccountStatus();
  }

  function refreshAccountStatus() {
    const box = dialog && dialog.querySelector("#syncStatusBox");
    if (!box) return;
    const last = meta.lastSync ? `Last synced ${ago(meta.lastSync)}.` : "";
    const detail = status === "synced" ? last : statusDetail || last;
    box.innerHTML = `<span class="sync-dot" data-status="${esc(status)}" aria-hidden="true"></span>
      <span><strong>${esc(LABELS[status] || "")}</strong>${detail ? ` <span class="muted">${esc(detail)}</span>` : ""}</span>`;
  }

  function openDelete() {
    showDialog("delete", `
      ${head("Delete account")}
      <p class="sync-lede" id="syncLede">This permanently deletes <strong>${esc(email)}</strong> and the copy of your data stored with it. The data on this device stays here.</p>
      <form class="sync-form" data-form="delete" novalidate>
        <input type="email" name="username" autocomplete="username" value="${esc(email)}" hidden>
        <div class="field">
          <label for="syncDeletePassword">Enter your password to confirm</label>
          <input id="syncDeletePassword" name="password" type="password" autocomplete="current-password" required aria-describedby="syncError">
        </div>
        <p class="sync-error" id="syncError" role="alert"></p>
        <div class="sync-actions">
          <button type="button" class="btn" data-sync-act="account">Cancel</button>
          <button type="submit" class="btn danger">Delete account</button>
        </div>
      </form>`, "#syncDeletePassword");
    dialog.setAttribute("aria-describedby", "syncLede");
  }

  function openConflict() {
    if (!conflict) return;
    const local = App.state();
    const onlyServer = onlyIn(conflict.data, local);
    const onlyLocal = onlyIn(local, conflict.data);
    const extra = (names) => (names ? `<div class="sync-only">Only here: ${esc(names)}</div>` : "");
    showDialog("conflict", `
      ${head("Which data should we keep?")}
      <p class="sync-lede" id="syncLede">Your account and this device both have changes. Pick one copy. The other is replaced.</p>
      <div class="sync-compare">
        <div class="stat">
          <div class="k">Your account</div>
          <div class="sync-compare-v">${esc(summary(conflict.data))}</div>
          <div class="k">Saved ${esc(when(conflict.updatedAt))}</div>
          ${extra(onlyServer)}
        </div>
        <div class="stat">
          <div class="k">This device</div>
          <div class="sync-compare-v">${esc(summary(local))}</div>
          <div class="k">Changed ${esc(when(Number(local.updatedAt) || 0))}</div>
          ${extra(onlyLocal)}
        </div>
      </div>
      <div class="sync-actions sync-stack">
        <button type="button" class="btn primary sync-wide" data-sync-act="use-server">Use data from your account</button>
        <button type="button" class="btn sync-wide" data-sync-act="use-local">Replace account data with this device's data</button>
      </div>
      <p class="hint sync-note">Want a backup first? Close this and use Export. Sync stays paused until you choose.</p>`, "#syncDlgTitle");
    dialog.setAttribute("aria-describedby", "syncLede");
  }

  function showError(msg, field) {
    const box = dialog && dialog.querySelector("#syncError");
    if (box) box.textContent = msg || "";
    for (const input of dialog.querySelectorAll("input")) {
      const bad = Boolean(msg) && (!field || input.name === field);
      input.classList.toggle("invalid", bad);
      if (bad) input.setAttribute("aria-invalid", "true");
      else input.removeAttribute("aria-invalid");
    }
    const first = field && dialog.querySelector(`input[name="${field}"]`);
    if (first) first.focus();
  }

  function setBusy(form, busy, label) {
    const btn = form.querySelector("button[type=submit]");
    if (!btn) return;
    if (busy) { btn.dataset.label = btn.textContent; btn.textContent = label; }
    else if (btn.dataset.label) btn.textContent = btn.dataset.label;
    btn.disabled = busy;
    form.setAttribute("aria-busy", String(busy));
  }

  function onDialogClick(e) {
    if (e.target === dialog && dialog.dataset.downOnBackdrop === "true") { closeDialog(); return; }
    const mode = e.target.closest("button[data-mode]");
    if (mode) { setAuthMode(mode.dataset.mode); return; }
    const act = e.target.closest("[data-sync-act]");
    if (!act) return;
    switch (act.dataset.syncAct) {
      case "close": closeDialog(); break;
      case "sync-now": syncNow(); break;
      case "signout": signOut(); break;
      case "delete": openDelete(); break;
      case "account": openAccount(); break;
      case "use-server": chooseServer(); break;
      case "use-local": chooseLocal(); break;
      default: break;
    }
  }

  async function onDialogSubmit(e) {
    e.preventDefault();
    const form = e.target;
    if (form.dataset.form === "auth") await submitAuth(form);
    else if (form.dataset.form === "delete") await submitDelete(form);
  }

  async function submitAuth(form) {
    const signup = form.dataset.mode === "signup";
    const addr = form.email.value.trim();
    const password = form.password.value;
    if (!addr) return showError("Enter your email address.", "email");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) return showError("Enter a valid email address.", "email");
    if (!password) return showError("Enter your password.", "password");
    if (signup && password.length < MIN_PASSWORD) return showError(`Password must be at least ${MIN_PASSWORD} characters.`, "password");
    showError("");
    setBusy(form, true, signup ? "Creating account…" : "Signing in…");
    const res = await api("POST", signup ? "signup" : "login", { email: addr, password });
    setBusy(form, false);
    if (res.ok && res.json.email) {
      closeDialog();
      becomeSignedIn(res.json.email);
      await serial(() => pullAndDecide({ announce: true }));
      return;
    }
    if (res.status === 0) return showError("Can't reach the server. Check your connection and try again.");
    const field = res.status === 400 && /password/i.test(res.json.error || "") ? "password"
      : res.status === 400 || res.status === 409 ? "email" : null;
    showError(res.json.error || "Something went wrong. Try again.", field);
  }

  async function submitDelete(form) {
    const password = form.password.value;
    if (!password) return showError("Enter your password.", "password");
    showError("");
    setBusy(form, true, "Deleting…");
    const res = await api("DELETE", "account", { password });
    setBusy(form, false);
    if (res.ok) {
      closeDialog();
      becomeSignedOut("Account deleted. Your data stays on this device.");
      return;
    }
    if (res.status === 401) { closeDialog(); becomeSignedOut("You were signed out. Sign in again to keep syncing."); return; }
    if (res.status === 0) return showError("Can't reach the server. Check your connection and try again.");
    showError(res.json.error || "Couldn't delete the account.", "password");
  }

  async function signOut() {
    closeDialog();
    // Send any unsynced changes first so the account is current.
    if (!conflict && hasLocalChanges() && confirmed) await serial(() => pushNow());
    await chain;
    const res = await api("POST", "logout", {});
    becomeSignedOut("Signed out. Your data stays on this device.");
    // Offline: the session cookie is still set, so finish logging out next time.
    if (!res.ok) clearMeta({ pendingLogout: true });
  }

  function chooseServer() {
    if (!conflict) return;
    const prev = JSON.parse(JSON.stringify(App.state()));
    takeServer(conflict);
    closeDialog();
    App.showToast("Loaded the data from your account.", () => App.replaceState(prev, { markDirty: true }));
  }

  async function chooseLocal() {
    if (!conflict) return;
    const prevServer = conflict.data;
    meta.version = conflict.version;
    conflict = null;
    closeDialog();
    await serial(() => pushNow({ force: true }));
    if (status === "synced") {
      App.showToast("Your account now has this device's data.", () => App.replaceState(prevServer, { markDirty: true }));
    }
  }

  // ---------- Module ----------

  async function start() {
    slot = document.getElementById("syncSlot");
    dialogRoot = document.getElementById("syncDialogRoot");
    noteEl = document.getElementById("saveNote");
    noteText = noteEl ? noteEl.textContent : "";
    if (!slot || !dialogRoot || location.protocol === "file:") return;

    slot.addEventListener("click", onSlotClick);
    App.on("save", onLocalSave);
    window.addEventListener("online", () => (enabled ? syncNow() : probe()));
    window.addEventListener("offline", () => { if (email) setStatus("offline", OFFLINE_DETAIL); });
    window.addEventListener("focus", maybePull);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") maybePull();
      else flushPush();
    });
    window.addEventListener("pagehide", flushPush);
    window.addEventListener("storage", (e) => {
      if (e.key !== META_KEY) return;
      const other = (() => { try { return JSON.parse(e.newValue || "null") || {}; } catch (_) { return {}; } })();
      if (email && !other.email) {
        // Signed out in another tab (keep its note to finish an offline logout).
        becomeSignedOut("");
        if (other.pendingLogout) clearMeta({ pendingLogout: true });
      }
      else if (!email && other.email && enabled) serial(() => checkSession()); // signed in in another tab
    });
    await probe();
  }

  /** Look for the sync server; show the account UI only when it's there. */
  async function probe() {
    const health = await api("GET", "health");
    if (health.status === 0) {
      // Offline or the server is down. Keep showing the account if we had one.
      if (meta.email) {
        enabled = true;
        email = meta.email;
        setStatus("offline", OFFLINE_DETAIL);
        scheduleRetry();
      }
      return;
    }
    if (!health.ok || !health.json.ok) return; // static hosting without the sync server
    enabled = true;

    if (meta.pendingLogout) {
      const out = await api("POST", "logout", {});
      if (out.ok) clearMeta();
    }
    if (meta.pendingLogout) { renderSlot(); return; }
    await serial(() => checkSession());
  }

  App.register({
    id: "sync",
    init() {
      start().catch((err) => console.error("[sync]", err));
    },
    render() {
      updateNote();
    },
  });
})();

/*
 * PWA glue: service worker registration and update prompt, install button,
 * iOS "Add to Home Screen" hint, and the offline indicator.
 *
 * Adds class "offline" to <html> while the browser reports no connection.
 * Owns its own DOM (install button, offline badge, notices); styles are
 * injected below and use the app's CSS variables.
 */
(function () {
  "use strict";

  const root = document.documentElement;
  const IOS_HINT_KEY = "incomebudget:pwa:iosHintDismissed";
  const UPDATE_CHECK_MS = 60 * 60 * 1000;

  const X_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  const SHARE_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M7.5 7.5 12 3l4.5 4.5"/><path d="M8 11H6a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-2"/></svg>';

  const CSS = `
.pwa-offline-badge { margin-left: 6px; background: var(--soft); color: var(--muted); border: 1px solid var(--line); }
.pwa-offline-badge::before { content: ""; display: inline-block; width: 7px; height: 7px; margin-right: 6px; border-radius: 50%; background: currentColor; vertical-align: 1px; }
.pwa-offline-badge[hidden], .pwa-install[hidden], .pwa-notice[hidden] { display: none; }
.pwa-notices { position: fixed; left: 50%; transform: translateX(-50%); bottom: calc(24px + env(safe-area-inset-bottom, 0px)); z-index: 11; display: flex; flex-direction: column; gap: 8px; width: min(440px, calc(100% - 32px)); pointer-events: none; }
body:has(#toast:not([hidden])) .pwa-notices { bottom: calc(88px + env(safe-area-inset-bottom, 0px)); }
/* Phones: keep clear of the bottom edge, where iPhone Safari's toolbar takes taps. */
@media (max-width: 560px) {
  .pwa-notices { top: calc(12px + env(safe-area-inset-top, 0px)); bottom: auto; }
  body:has(#toast:not([hidden])) .pwa-notices { top: calc(76px + env(safe-area-inset-top, 0px)); bottom: auto; }
}
.pwa-notice { pointer-events: auto; display: flex; align-items: center; gap: 10px; padding: 10px 8px 10px 16px; background: var(--card); color: var(--ink); border: 1px solid var(--line); border-radius: 12px; box-shadow: var(--shadow); font-size: 14px; }
.pwa-notice-text { flex: 1; min-width: 0; }
.pwa-notice-icon { flex: none; display: flex; color: var(--accent); }
.pwa-notice .btn { height: 34px; padding: 0 14px; flex: none; }
.pwa-x { flex: none; display: grid; place-items: center; width: 32px; height: 32px; border: 0; border-radius: 8px; background: transparent; color: var(--muted); cursor: pointer; }
.pwa-x:hover { background: var(--soft); color: var(--ink); }
`;

  function injectStyles() {
    const style = document.createElement("style");
    style.id = "pwaStyles";
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  let noticesEl = null;
  function notices() {
    if (!noticesEl) {
      noticesEl = document.createElement("div");
      noticesEl.className = "pwa-notices";
      document.body.appendChild(noticesEl);
    }
    return noticesEl;
  }

  /** A small card at the bottom of the screen. Returns { el, close }. */
  function showNotice({ id, text, icon, action, onAction, onDismiss, dismissLabel = "Dismiss" }) {
    const old = document.getElementById(id);
    if (old) old.remove();
    const el = document.createElement("div");
    el.className = "pwa-notice";
    el.id = id;
    el.setAttribute("role", "status");
    if (icon) {
      const i = document.createElement("span");
      i.className = "pwa-notice-icon";
      i.innerHTML = icon;
      el.appendChild(i);
    }
    const t = document.createElement("span");
    t.className = "pwa-notice-text";
    t.textContent = text;
    el.appendChild(t);
    const close = () => el.remove();
    if (action) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn primary";
      b.textContent = action;
      b.addEventListener("click", () => onAction(close, b));
      el.appendChild(b);
    }
    const x = document.createElement("button");
    x.type = "button";
    x.className = "pwa-x";
    x.setAttribute("aria-label", dismissLabel);
    x.title = dismissLabel;
    x.innerHTML = X_ICON;
    x.addEventListener("click", () => { close(); if (onDismiss) onDismiss(); });
    el.appendChild(x);
    notices().appendChild(el);
    return { el, close };
  }

  function isStandalone() {
    try {
      if (window.matchMedia("(display-mode: standalone)").matches) return true;
    } catch (_) { /* ignore */ }
    return navigator.standalone === true;
  }

  // ---------- Offline indicator ----------

  let offlineBadge = null;
  function setupOffline() {
    const anchor = document.getElementById("taxYearBadge");
    if (anchor) {
      offlineBadge = document.createElement("span");
      offlineBadge.className = "badge pwa-offline-badge";
      offlineBadge.id = "offlineBadge";
      offlineBadge.textContent = "Offline";
      offlineBadge.title = "You're offline. Changes are still saved on this device.";
      offlineBadge.hidden = true;
      anchor.insertAdjacentElement("afterend", offlineBadge);
    }
    const update = () => {
      const offline = navigator.onLine === false;
      root.classList.toggle("offline", offline);
      if (offlineBadge) offlineBadge.hidden = !offline;
    };
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    update();
  }

  // ---------- Install ----------

  let installPrompt = null;
  let installBtn = null;
  let iosHint = null;

  function setupInstall() {
    const actions = document.querySelector(".top-actions");
    if (actions) {
      installBtn = document.createElement("button");
      installBtn.type = "button";
      installBtn.className = "btn ghost pwa-install";
      installBtn.id = "installBtn";
      installBtn.textContent = "Install";
      installBtn.title = "Install this app on your device";
      installBtn.hidden = true;
      const exportBtn = document.getElementById("exportBtn");
      actions.insertBefore(installBtn, exportBtn && exportBtn.parentNode === actions ? exportBtn : null);
      installBtn.addEventListener("click", async () => {
        const prompt = installPrompt;
        if (!prompt) return;
        installPrompt = null; // a prompt can only be used once
        showInstall();
        try {
          await prompt.prompt();
          await prompt.userChoice;
        } catch (_) { /* ignore */ }
      });
    }

    showInstall();
    maybeShowIosHint();
  }

  function showInstall() {
    if (installBtn) installBtn.hidden = !installPrompt || isStandalone();
  }

  // Listen right away (not after DOMContentLoaded) so an early event isn't missed.
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // show our own button instead of the browser's banner
    installPrompt = e;
    showInstall();
  });

  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    showInstall();
    if (iosHint) iosHint.close();
  });

  function isIosSafari() {
    const ua = navigator.userAgent || "";
    const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    return ios && /Safari\//.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\/|FBAN|FBAV|Instagram|Line\//.test(ua);
  }

  function maybeShowIosHint() {
    if (!isIosSafari() || isStandalone() || "onbeforeinstallprompt" in window) return;
    try {
      if (localStorage.getItem(IOS_HINT_KEY)) return;
    } catch (_) { /* storage blocked: still show it, just can't remember */ }
    iosHint = showNotice({
      id: "pwaIosHint",
      icon: SHARE_ICON,
      text: "Install: tap Share, then Add to Home Screen",
      dismissLabel: "Dismiss install hint",
      onDismiss: () => {
        iosHint = null;
        try { localStorage.setItem(IOS_HINT_KEY, "1"); } catch (_) { /* ignore */ }
      },
    });
  }

  // ---------- Service worker ----------

  function setupServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    if (location.protocol !== "http:" && location.protocol !== "https:") return; // never on file:

    let reloading = false;
    let wantReload = false;
    const reload = () => {
      if (reloading) return;
      reloading = true;
      location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      // Only reload when the user asked for the new version (not on first install).
      if (wantReload) reload();
    });

    function promptUpdate(reg) {
      showNotice({
        id: "pwaUpdate",
        text: "A new version is available",
        action: "Reload",
        dismissLabel: "Not now",
        onAction: (close, button) => {
          const waiting = reg.waiting;
          if (!waiting) { reload(); return; } // another tab already switched to it
          button.disabled = true;
          wantReload = true;
          waiting.postMessage({ type: "SKIP_WAITING" });
          setTimeout(reload, 5000); // in case controllerchange never arrives
        },
      });
    }

    function watch(reg) {
      if (!reg) return;
      // An update installed during an earlier visit is already waiting.
      if (reg.waiting && navigator.serviceWorker.controller) promptUpdate(reg);
      reg.addEventListener("updatefound", () => {
        const worker = reg.installing;
        if (!worker) return;
        worker.addEventListener("statechange", () => {
          // With no controller this is the first install, not an update.
          if (worker.state === "installed" && navigator.serviceWorker.controller) promptUpdate(reg);
        });
      });

      // Long-lived tabs and installed apps: look for a new version now and then.
      let lastCheck = Date.now();
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState !== "visible" || Date.now() - lastCheck < UPDATE_CHECK_MS) return;
        lastCheck = Date.now();
        reg.update().catch(() => { /* offline */ });
      });
    }

    const register = () => {
      navigator.serviceWorker.register("sw.js", { scope: "./", updateViaCache: "none" })
        .then(watch)
        .catch((err) => console.warn("Service worker registration failed:", err));
    };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }

  // ---------- Theme color ----------

  // The <meta name="theme-color"> tags follow the OS theme; keep the browser/app
  // title bar in step when the user picks light or dark with the theme toggle.
  function setupThemeColor() {
    const metas = Array.from(document.querySelectorAll('meta[name="theme-color"]'));
    if (!metas.length) return;
    const original = metas.map((m) => m.getAttribute("content"));
    const colorFor = (theme) => {
      const i = theme ? metas.findIndex((el) => (el.getAttribute("media") || "").includes(`: ${theme}`)) : -1;
      return i >= 0 ? original[i] : null;
    };
    const apply = () => {
      const color = colorFor(root.dataset.theme);
      metas.forEach((m, i) => m.setAttribute("content", color || original[i]));
    };
    new MutationObserver(apply).observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    apply();
  }

  function init() {
    injectStyles();
    setupThemeColor();
    setupOffline();
    setupInstall();
    setupServiceWorker();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();

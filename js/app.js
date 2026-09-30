/*
 * Core app: pay inputs, take-home results, budget items, tabs, persistence.
 *
 * Feature modules (calendar, goals, spending, sync, ...) plug in through
 * window.App.register(). See the "Module API" section below.
 */
(function () {
  "use strict";

  const { PERIODS, PAY_PERIODS, CITIES, FILING_STATUSES } = Tax;
  const STORAGE_KEY = "incomebudget:v1";
  const TAB_KEY = "incomebudget:tab";
  const RECURRENCES = ["weekly", "biweekly", "semimonthly", "monthly", "quarterly", "annual"];
  const VIEW_PERIODS = ["weekly", "biweekly", "semimonthly", "monthly", "annual"];
  const TABS = ["paycheck", "budget", "calendar", "goals", "spending"];

  const CATEGORIES = [
    { id: "housing", name: "Housing", color: "#3b7dd8" },
    { id: "transport", name: "Transportation", color: "#d99a2b" },
    { id: "food", name: "Food", color: "#2f9e6e" },
    { id: "utilities", name: "Utilities", color: "#16a3b5" },
    { id: "debt", name: "Debt", color: "#d0685a" },
    { id: "savings", name: "Savings & investing", color: "#1f6f54" },
    { id: "subscriptions", name: "Subscriptions", color: "#8a63c9" },
    { id: "personal", name: "Personal & fun", color: "#d45c9a" },
    { id: "other", name: "Other", color: "#8b9690" },
  ];

  const uid = () => Math.random().toString(36).slice(2, 10);

  // A brand-new visitor starts blank. Real data lives in the browser (and the server when signed in).
  const DEFAULT_INCOME = {
    mode: "salary",
    salary: 0,
    hourlyRate: 0,
    hoursPerWeek: 40,
    filingStatus: "single",
    payPeriod: "biweekly",
    nextPayday: "",
    k401Percent: 0,
    k401Type: "traditional",
    preTaxBenefits: 0,
    dependents: 0,
    otherDependents: 0,
    extraWithholding: 0,
    cityId: "none",
    cityResident: true,
  };

  // One-tap starters on the Budget tab: they fill the add form, never add amounts on their own.
  const BILL_IDEAS = [
    { name: "Rent", category: "housing", recurrence: "monthly" },
    { name: "Mortgage", category: "housing", recurrence: "monthly" },
    { name: "Groceries", category: "food", recurrence: "weekly" },
    { name: "Car payment", category: "transport", recurrence: "monthly" },
    { name: "Gas", category: "transport", recurrence: "weekly" },
    { name: "Car insurance", category: "transport", recurrence: "monthly" },
    { name: "Electric", category: "utilities", recurrence: "monthly" },
    { name: "Phone", category: "utilities", recurrence: "monthly" },
    { name: "Internet", category: "utilities", recurrence: "monthly" },
    { name: "Student loan", category: "debt", recurrence: "monthly" },
    { name: "Credit card", category: "debt", recurrence: "monthly" },
    { name: "Streaming", category: "subscriptions", recurrence: "monthly" },
    { name: "Savings", category: "savings", recurrence: "monthly" },
  ];

  // ---------- Module API ----------
  //
  // App.register({
  //   id: "goals",                    // unique; also the tab name if it owns a tab
  //   stateKey: "goals",              // optional top-level key in state this module owns
  //   defaults: () => [],             // initial (empty) value for state[stateKey]
  //   sanitize: (raw) => clean,       // validate state[stateKey] from storage / import / server
  //   init: (ctx) => {},              // once, after state loads; attach event listeners here
  //   render: (ctx) => {},            // on every change; ctx described in buildContext()
  //   budgetLines: (ctx) => [],       // optional read-only budget rows:
  //                                   //   [{ id, name, annual, category, tab, note }]
  // });
  //
  // App.state()           current state object (mutate, then App.commit())
  // App.commit()          save + re-render after mutating state
  // App.replaceState(obj, { markDirty }) load a whole state (used by sync/import)
  // App.on(event, fn)     events: "save" (state), "render" (ctx)
  // App.util              helpers: money, pct, esc, parseNum, uid, options, category, ...

  const modules = [];
  const listeners = { save: [], render: [] };
  let state = null;
  let ready = false;

  function emit(event, arg) {
    for (const fn of listeners[event]) {
      try { fn(arg); } catch (err) { console.error(`[${event} listener]`, err); }
    }
  }

  function defaultState() {
    const s = {
      updatedAt: 0,
      income: { ...DEFAULT_INCOME },
      view: null, // budget view period; null = follow pay frequency
      sort: { key: null, dir: "asc" },
      items: [],
    };
    for (const m of modules) if (m.stateKey) s[m.stateKey] = m.defaults ? m.defaults() : null;
    return s;
  }

  // ---------- State & persistence ----------

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return sanitize(JSON.parse(raw));
    } catch (_) { /* storage unavailable or corrupt */ }
    return defaultState();
  }

  function clampDay(v) {
    const n = Math.floor(Number(v));
    return Number.isFinite(n) && n >= 1 && n <= 31 ? n : null;
  }

  function sanitize(data) {
    const s = defaultState();
    if (data && typeof data === "object") {
      Object.assign(s.income, pick(data.income, Object.keys(s.income)));
      if (Number.isFinite(Number(data.updatedAt))) s.updatedAt = Number(data.updatedAt);
      if (VIEW_PERIODS.includes(data.view)) s.view = data.view;
      if (data.sort && typeof data.sort === "object") s.sort = { key: data.sort.key || null, dir: data.sort.dir === "desc" ? "desc" : "asc" };
      if (Array.isArray(data.items)) {
        s.items = data.items
          .filter((i) => i && typeof i.name === "string")
          .map((i) => ({
            id: String(i.id || uid()),
            name: i.name.slice(0, 60),
            amount: Math.max(0, Number(i.amount) || 0),
            recurrence: RECURRENCES.includes(i.recurrence) ? i.recurrence : "monthly",
            category: CATEGORIES.some((c) => c.id === i.category) ? i.category : "other",
            dueDay: clampDay(i.dueDay),
          }));
      }
      for (const m of modules) {
        if (!m.stateKey || !(m.stateKey in data)) continue;
        try { s[m.stateKey] = m.sanitize ? m.sanitize(data[m.stateKey]) : data[m.stateKey]; }
        catch (err) { console.error(`[${m.id} sanitize]`, err); }
      }
    }
    if (!PAY_PERIODS.includes(s.income.payPeriod)) s.income.payPeriod = "biweekly";
    if (!CITIES.some((c) => c.id === s.income.cityId)) s.income.cityId = "none";
    if (typeof s.income.nextPayday !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s.income.nextPayday)) s.income.nextPayday = "";
    return s;
  }

  function pick(obj, keys) {
    const out = {};
    if (obj && typeof obj === "object") for (const k of keys) if (k in obj) out[k] = obj[k];
    return out;
  }

  let saveTimer = null;
  function persistLocal() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) { /* ignore */ }
  }
  function save() {
    state.updatedAt = Date.now();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persistLocal, 150);
    emit("save", state);
  }

  // ---------- Helpers ----------

  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
  const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
  const usd0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const money = (n) => usd.format(Math.abs(n) < 0.005 ? 0 : n);
  const pct = (n, d = 1) => `${(n * 100).toFixed(d)}%`;
  const parseNum = (v) => {
    const n = parseFloat(String(v).replace(/[$,\s]/g, ""));
    return Number.isFinite(n) ? n : NaN;
  };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const category = (id) => CATEGORIES.find((c) => c.id === id) || CATEGORIES[CATEGORIES.length - 1];
  const viewPeriod = () => state.view || state.income.payPeriod;
  const annualOf = (item) => item.amount * PERIODS[item.recurrence].perYear;
  const ordinal = (n) => {
    const s = ["th", "st", "nd", "rd"], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  };

  function grossAnnual() {
    const inc = state.income;
    return inc.mode === "hourly" ? (Number(inc.hourlyRate) || 0) * (Number(inc.hoursPerWeek) || 0) * 52 : Number(inc.salary) || 0;
  }

  function taxInput() {
    const inc = state.income;
    return {
      grossAnnual: grossAnnual(),
      filingStatus: inc.filingStatus,
      k401Percent: Number(inc.k401Percent) || 0,
      k401Type: inc.k401Type,
      preTaxBenefits: Number(inc.preTaxBenefits) || 0,
      dependents: Number(inc.dependents) || 0,
      otherDependents: Number(inc.otherDependents) || 0,
      extraWithholdingAnnual: (Number(inc.extraWithholding) || 0) * PERIODS[inc.payPeriod].perYear,
      cityId: inc.cityId,
      cityResident: inc.cityResident,
    };
  }

  const ICONS = {
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
    del: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>',
    ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  };

  function options(list, selected) {
    return list.map(([v, label]) => `<option value="${esc(v)}"${String(v) === String(selected) ? " selected" : ""}>${esc(label)}</option>`).join("");
  }

  // ---------- Tabs ----------

  let activeTab = "paycheck";
  function switchTab(tab, { focus = false } = {}) {
    if (!TABS.includes(tab)) tab = "paycheck";
    activeTab = tab;
    for (const b of $$(".tabs [data-tab]")) {
      const on = b.dataset.tab === tab;
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus();
    }
    for (const p of $$("[data-panel]")) p.hidden = p.dataset.panel !== tab;
    try { localStorage.setItem(TAB_KEY, tab); } catch (_) { /* ignore */ }
    if (location.hash.slice(1) !== tab) history.replaceState(null, "", `#${tab}`);
  }

  function setupTabs() {
    const nav = $(".tabs");
    nav.addEventListener("click", (e) => {
      const b = e.target.closest("[data-tab]");
      if (b) switchTab(b.dataset.tab);
    });
    nav.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      const i = TABS.indexOf(activeTab) + (e.key === "ArrowRight" ? 1 : -1);
      switchTab(TABS[(i + TABS.length) % TABS.length], { focus: true });
    });
    document.addEventListener("click", (e) => {
      const link = e.target.closest("[data-goto]");
      if (!link) return;
      e.preventDefault();
      switchTab(link.dataset.goto);
      window.scrollTo({ top: 0 });
      // data-goto-focus="<selector>" puts the cursor where the user needs to type next.
      const target = link.dataset.gotoFocus && document.querySelector(link.dataset.gotoFocus);
      if (target) target.focus({ preventScroll: true });
    });
    window.addEventListener("hashchange", () => switchTab(location.hash.slice(1)));
    let initial = location.hash.slice(1);
    if (!TABS.includes(initial)) { try { initial = localStorage.getItem(TAB_KEY) || ""; } catch (_) { initial = ""; } }
    switchTab(initial);
  }

  // ---------- Inputs ----------

  function setupInputs() {
    $("#taxYearBadge").textContent = `Tax year ${Tax.TAX_YEAR}`;
    $("#filingStatus").innerHTML = options(FILING_STATUSES.map((f) => [f.id, f.name]));
    $("#payPeriod").innerHTML = options(PAY_PERIODS.map((p) => [p, `${PERIODS[p].label} (${PERIODS[p].perYear}/yr)`]));
    $("#cityId").innerHTML = options(CITIES.map((c) => [c.id, c.id === "none" ? c.name : `${c.name} (${+(c.resident * 100).toFixed(2)}% / ${+(c.nonresident * 100).toFixed(2)}%)`]));
    $("#newRecurrence").innerHTML = options(RECURRENCES.map((r) => [r, PERIODS[r].label]), "monthly");
    $("#newCategory").innerHTML = options(CATEGORIES.map((c) => [c.id, c.name]), "other");
    $("#viewSeg").innerHTML = VIEW_PERIODS.map((p) => `<button type="button" data-value="${p}">${PERIODS[p].label}</button>`).join("");

    refreshInputs();

    for (const el of $$("input[data-field], select[data-field]")) {
      el.addEventListener("input", () => {
        const f = el.dataset.field;
        if (el.tagName === "SELECT") {
          state.income[f] = el.value;
          if (f === "payPeriod") state.view = null;
        } else if (el.type === "date") {
          state.income[f] = el.value || "";
        } else {
          const n = parseNum(el.value);
          const bad = el.value.trim() !== "" && (!Number.isFinite(n) || n < 0 || (f === "k401Percent" && n > 100));
          el.classList.toggle("invalid", bad);
          if (bad) return;
          state.income[f] = el.value.trim() === "" ? 0 : n;
        }
        commit();
      });
    }

    for (const seg of $$(".seg[data-field]")) {
      seg.addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-value]");
        if (!btn) return;
        const f = seg.dataset.field;
        state.income[f] = f === "cityResident" ? btn.dataset.value === "true" : btn.dataset.value;
        commit();
      });
    }

    $("#viewSeg").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-value]");
      if (!btn) return;
      state.view = btn.dataset.value === state.income.payPeriod ? null : btn.dataset.value;
      commit();
    });

    $("#periodChips").addEventListener("click", (e) => {
      const chip = e.target.closest("[data-period]");
      if (!chip) return;
      const p = chip.dataset.period;
      if (PAY_PERIODS.includes(p)) {
        state.income.payPeriod = p;
        state.view = null;
        $("#payPeriod").value = p;
      } else {
        state.view = p;
      }
      commit();
    });
  }

  function syncSegments() {
    for (const seg of $$(".seg[data-field]")) {
      const val = String(state.income[seg.dataset.field]);
      for (const b of $$("button", seg)) {
        b.setAttribute("role", "radio");
        b.setAttribute("aria-checked", String(b.dataset.value === val));
      }
    }
    for (const el of $$("[data-show]")) el.hidden = el.dataset.show !== state.income.mode;
    $("#residencySeg").hidden = state.income.cityId === "none";
  }

  function refreshInputs() {
    for (const el of $$("input[data-field], select[data-field]")) {
      if (document.activeElement === el) continue;
      const v = state.income[el.dataset.field];
      // Blank instead of "0" so a new visitor sees empty fields with a 0 placeholder.
      el.value = v === 0 && el.dataset.field !== "hoursPerWeek" ? "" : v ?? "";
      el.classList.remove("invalid");
    }
    const adv = $("#moreOptions");
    if (adv && (state.income.extraWithholding > 0 || state.income.otherDependents > 0)) adv.open = true;
    syncSegments();
  }

  // ---------- Rendering ----------

  function buildContext() {
    const r = Tax.calculate(taxInput());
    const pay = state.income.payPeriod;
    const base = {
      state,
      result: r,
      taxInput: taxInput(),
      payPeriod: pay,
      perYear: PERIODS[pay].perYear,
      viewPeriod: viewPeriod(),
      viewPerYear: PERIODS[viewPeriod()].perYear,
      netAnnual: r.net,
      itemsAnnual: state.items.reduce((s, i) => s + annualOf(i), 0),
      activeTab,
    };
    const extras = [];
    for (const m of modules) {
      if (!m.budgetLines) continue;
      try {
        for (const line of m.budgetLines(base) || []) {
          if (line && Number.isFinite(line.annual) && line.annual > 0) extras.push({ source: m.id, ...line });
        }
      } catch (err) { console.error(`[${m.id} budgetLines]`, err); }
    }
    base.extras = extras;
    base.extrasAnnual = extras.reduce((s, l) => s + l.annual, 0);
    base.budgetAnnual = base.itemsAnnual + base.extrasAnnual;
    base.leftAnnual = r.net - base.budgetAnnual;
    return base;
  }

  function render() {
    if (!ready) return;
    syncSegments();
    const ctx = buildContext();
    renderPaycheck(ctx);
    renderBudget(ctx);
    for (const m of modules) {
      if (!m.render) continue;
      try { m.render(ctx); } catch (err) { console.error(`[${m.id} render]`, err); }
    }
    emit("render", ctx);
  }

  function renderPaycheck(ctx) {
    const r = ctx.result;
    const pay = ctx.payPeriod;
    const per = ctx.perYear;
    const p = (annual) => annual / per;

    // No pay entered yet: show the getting-started panel instead of a page of $0.00.
    const empty = r.gross <= 0;
    $("#welcome").hidden = !empty;
    $("#resultsBody").hidden = empty;
    $("#bonusRoot").hidden = empty;
    if (empty) { $("#k401Hint").textContent = ""; return; }

    $("#takeHomeLabel").textContent = `${PERIODS[pay].label} take-home`;
    $("#takeHome").textContent = money(p(r.net));
    $("#paychecksNote").textContent = `${per} paychecks a year · ${money(p(r.gross))} gross each`;

    const raise = Tax.raiseImpact(ctx.taxInput, 1000);
    $("#raiseNote").innerHTML = r.gross > 0
      ? `A <strong>$1,000</strong> raise adds <strong>${money(raise)}</strong>/yr to take-home, or <strong>${money(raise / per)}</strong> per paycheck.`
      : "Enter your pay to see your take-home.";

    const stats = [
      ["Annual take-home", money(r.net)],
      ["Annual taxes", money(r.taxes)],
      ["Effective tax rate", pct(r.effectiveRate)],
      ["Federal bracket", pct(r.federalMarginal, 0)],
    ];
    $("#stats").innerHTML = stats.map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`).join("");

    const flow = [
      ["Taxes", r.taxes + r.extraWithholding, "var(--c-tax)"],
      [r.isRoth ? "Roth 401(k)" : "401(k)", r.k401, "var(--c-ret)"],
      ["Benefits", r.benefits, "var(--c-ben)"],
      ["Budget", Math.min(ctx.budgetAnnual, Math.max(0, r.net)), "var(--c-bud)"],
      ["Left over", Math.max(0, ctx.leftAnnual), "var(--c-left)"],
    ].filter(([, v]) => v > 0.005);
    const total = r.gross || 1;
    $("#flowBar").innerHTML = flow.map(([k, v, c]) => `<span style="width:${(v / total) * 100}%;background:${c}" title="${k}: ${money(p(v))}"></span>`).join("");
    $("#flowBar").setAttribute("aria-label", flow.map(([k, v]) => `${k} ${pct(v / total, 0)}`).join(", "));
    $("#flowLegend").innerHTML = flow.map(([k, v, c]) => `<li><span class="dot" style="background:${c}"></span>${k} <b>${money(p(v))}</b> <span>${pct(v / total, 0)}</span></li>`).join("");

    $("#bdPeriodHead").textContent = PERIODS[pay].label;
    const city = Tax.findCity(state.income.cityId);
    const credits = r.childCredit > 0 ? `after ${money(r.childCredit)} in credits` : null;
    const rows = [
      ["Gross pay", r.gross, false],
      r.benefits > 0 && ["Pre-tax benefits", -r.benefits, true],
      r.k401 > 0 && [`${r.isRoth ? "Roth 401(k)" : "401(k)"}${r.k401Capped ? ' <span class="rate">capped at limit</span>' : ""}`, -r.k401, true],
      ["Federal income tax", -r.federal, true, credits],
      r.extraWithholding > 0 && ["Extra federal withholding", -r.extraWithholding, true, "W-4 4(c)"],
      ["Social Security", -r.socialSecurity, true, "6.2%"],
      ["Medicare", -r.medicare, true, "1.45%"],
      ["Michigan income tax", -r.michigan, true, `${+(Tax.MICHIGAN.rate * 100).toFixed(2)}%`],
      city.id !== "none" && [`${esc(city.name)} city tax`, -r.city, true, `${+(r.cityRate * 100).toFixed(2)}%`],
    ].filter(Boolean);
    $("#breakdown tbody").innerHTML = rows.map(([label, v, minus, note]) =>
      `<tr class="${minus ? "minus" : ""}"><td>${label}${note ? `<span class="rate">${note}</span>` : ""}</td><td class="num">${money(p(v))}</td><td class="num">${money(v)}</td></tr>`
    ).join("");
    $("#breakdown tfoot").innerHTML = `<tr><td>Take-home pay</td><td class="num">${money(p(r.net))}</td><td class="num">${money(r.net)}</td></tr>`;

    const chipPeriods = ["weekly", "biweekly", "semimonthly", "monthly", "annual"];
    $("#periodChips").innerHTML = chipPeriods.map((cp) =>
      `<button type="button" class="chip" data-period="${cp}" aria-pressed="${cp === ctx.viewPeriod}"><div class="k">${PERIODS[cp].label}</div><div class="v">${money(r.net / PERIODS[cp].perYear)}</div></button>`
    ).join("");

    const hint = $("#k401Hint");
    if (r.k401 > 0) {
      hint.textContent = `${money(r.k401)}/yr · ${money(p(r.k401))} per paycheck` +
        (r.k401Capped ? ` · capped at the ${usd0.format(Tax.FEDERAL.k401Limit)} limit` : "");
      hint.classList.toggle("warn", r.k401Capped);
    } else {
      hint.textContent = "";
    }
  }

  // ---------- Budget ----------

  let editingId = null;

  function sortedItems() {
    const items = state.items.slice();
    const { key, dir } = state.sort;
    if (!key) return items;
    const cmp = {
      name: (a, b) => a.name.localeCompare(b.name),
      recurrence: (a, b) => RECURRENCES.indexOf(a.recurrence) - RECURRENCES.indexOf(b.recurrence),
      amount: (a, b) => a.amount - b.amount,
      per: (a, b) => annualOf(a) - annualOf(b),
    }[key];
    if (!cmp) return items;
    items.sort(cmp);
    if (dir === "desc") items.reverse();
    return items;
  }

  function renderBudget(ctx) {
    const r = ctx.result;
    const vp = ctx.viewPeriod;
    const vper = ctx.viewPerYear;
    const netV = r.net / vper;
    const budgetV = ctx.budgetAnnual / vper;
    const leftV = netV - budgetV;
    const used = r.net > 0 ? ctx.budgetAnnual / r.net : 0;

    for (const b of $$("#viewSeg button")) {
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(b.dataset.value === vp));
    }

    const hasPay = r.net > 0;
    $("#budgetPayNotice").hidden = hasPay;
    $("#budgetSummary").innerHTML = hasPay ? `
      <div class="stat"><div class="k">Take-home / ${PERIODS[vp].noun}</div><div class="v">${money(netV)}</div></div>
      <div class="stat"><div class="k">Budgeted / ${PERIODS[vp].noun}</div><div class="v">${money(budgetV)}</div></div>
      <div class="stat"><div class="k">${leftV >= 0 ? "Left over" : "Over budget"}</div><div class="v ${leftV >= 0 ? "good" : "bad"}">${money(Math.abs(leftV))}</div></div>`
      : `<div class="stat"><div class="k">Budgeted / ${PERIODS[vp].noun}</div><div class="v">${money(budgetV)}</div></div>`;

    const meter = $("#budgetMeter");
    meter.hidden = !hasPay;
    meter.classList.toggle("over", used > 1);
    $(".meter-fill", meter).style.width = `${Math.min(100, used * 100)}%`;
    meter.title = `${pct(used, 0)} of take-home budgeted`;

    const byCat = new Map();
    for (const i of state.items) byCat.set(i.category, (byCat.get(i.category) || 0) + annualOf(i));
    for (const l of ctx.extras) byCat.set(l.category || "other", (byCat.get(l.category || "other") || 0) + l.annual);
    $("#categoryBreakdown").innerHTML = [...byCat.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id, annual]) => {
        const c = category(id);
        return `<span class="cat-pill"><span class="dot" style="background:${c.color}"></span>${esc(c.name)} <b>${money(annual / vper)}</b><span class="pct">${r.net > 0 ? pct(annual / r.net, 0) : ""}</span></span>`;
      }).join("");

    const have = new Set(state.items.map((i) => i.name.trim().toLowerCase()));
    const ideas = state.items.length < 8 ? BILL_IDEAS.filter((b) => !have.has(b.name.toLowerCase())) : [];
    $("#billIdeas").hidden = !ideas.length;
    $("#billIdeas .ideas").innerHTML = ideas.map((b) =>
      `<button type="button" class="idea" data-idea="${esc(b.name)}"><span class="dot" style="background:${category(b.category).color}"></span>${esc(b.name)}</button>`).join("");

    $("#perHead").textContent = `Per ${PERIODS[vp].noun}`;
    for (const b of $$(".sort")) {
      if (b.dataset.sort === state.sort.key) b.dataset.dir = state.sort.dir;
      else delete b.dataset.dir;
    }

    const shares = [...state.items.map(annualOf), ...ctx.extras.map((l) => l.annual)].map((a) => a / (r.net || 1));
    const maxShare = Math.max(0.0001, ...shares);
    const bar = (share) => `<span class="pctbar"><i style="width:${Math.round((share / maxShare) * 48)}px"></i>${pct(share)}</span>`;

    const itemRows = sortedItems().map((i) => {
      const annual = annualOf(i);
      const share = r.net > 0 ? annual / r.net : 0;
      const c = category(i.category);
      if (i.id === editingId) {
        return `<tr data-id="${esc(i.id)}" class="editing">
          <td><input data-edit="name" value="${esc(i.name)}" maxlength="60" aria-label="Item name">
              <select data-edit="category" aria-label="Category" class="mt">${options(CATEGORIES.map((x) => [x.id, x.name]), i.category)}</select></td>
          <td class="hide-sm"><select data-edit="recurrence" aria-label="Recurrence">${options(RECURRENCES.map((x) => [x, PERIODS[x].label]), i.recurrence)}</select>
              <input data-edit="dueDay" value="${i.dueDay ?? ""}" inputmode="numeric" placeholder="Due day" aria-label="Due day of month" class="mt"></td>
          <td class="num hide-sm"><input data-edit="amount" value="${i.amount}" inputmode="decimal" aria-label="Amount" class="right"></td>
          <td class="num">${money(annual / vper)}</td>
          <td class="num hide-sm">${pct(share)}</td>
          <td><div class="row-actions">
            <button type="button" class="icon-btn" data-act="save" title="Save" aria-label="Save">${ICONS.ok}</button>
            <button type="button" class="icon-btn" data-act="cancel" title="Cancel" aria-label="Cancel">${ICONS.x}</button>
          </div></td></tr>`;
      }
      const due = i.dueDay ? ` · due ${ordinal(i.dueDay)}` : "";
      return `<tr data-id="${esc(i.id)}">
        <td><div class="item-name"><span class="dot" style="background:${c.color}"></span><span class="txt">${esc(i.name)}<span class="tag">${esc(c.name)}${due}</span></span></div></td>
        <td class="hide-sm">${PERIODS[i.recurrence].label}</td>
        <td class="num hide-sm">${money(i.amount)}</td>
        <td class="num">${money(annual / vper)}</td>
        <td class="num hide-sm">${bar(share)}</td>
        <td><div class="row-actions">
          <button type="button" class="icon-btn" data-act="edit" title="Edit" aria-label="Edit ${esc(i.name)}">${ICONS.edit}</button>
          <button type="button" class="icon-btn danger" data-act="delete" title="Delete" aria-label="Delete ${esc(i.name)}">${ICONS.del}</button>
        </div></td></tr>`;
    });

    const extraRows = ctx.extras.map((l) => {
      const c = category(l.category);
      const share = r.net > 0 ? l.annual / r.net : 0;
      return `<tr class="extra">
        <td><div class="item-name"><span class="dot" style="background:${c.color}"></span><span class="txt">${esc(l.name)}<span class="tag">${esc(l.note || c.name)}</span></span></div></td>
        <td class="hide-sm">${esc(PERIODS[ctx.payPeriod].label)}</td>
        <td class="num hide-sm">${money(l.annual / ctx.perYear)}</td>
        <td class="num">${money(l.annual / vper)}</td>
        <td class="num hide-sm">${bar(share)}</td>
        <td><div class="row-actions">${l.tab ? `<button type="button" class="icon-btn" data-goto="${esc(l.tab)}" title="Open ${esc(l.tab)}" aria-label="Open ${esc(l.tab)}">${ICONS.arrow}</button>` : ""}</div></td></tr>`;
    });

    $("#itemsTable tbody").innerHTML = itemRows.join("") + extraRows.join("");

    const count = state.items.length + ctx.extras.length;
    $("#itemsTable").hidden = count === 0;
    $("#itemsTable tfoot").innerHTML = count
      ? `<tr><td>Total budget</td><td class="hide-sm"></td><td class="hide-sm"></td><td class="num">${money(budgetV)}</td><td class="num hide-sm">${pct(used)}</td><td></td></tr>`
      : "";
    $("#emptyState").hidden = count > 0;

    if (editingId) {
      const first = $(`#itemsTable tr.editing input[data-edit="name"]`);
      if (first && !first.dataset.focused) { first.dataset.focused = "1"; first.focus(); first.select(); }
    }
  }

  function setupBudget() {
    const form = $("#addForm");
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const nameEl = $("#newName");
      const amtEl = $("#newAmount");
      const dueEl = $("#newDueDay");
      const name = nameEl.value.trim();
      const amount = parseNum(amtEl.value);
      const badAmt = !Number.isFinite(amount) || amount < 0;
      const badDue = dueEl.value.trim() !== "" && clampDay(dueEl.value) === null;
      amtEl.classList.toggle("invalid", badAmt);
      nameEl.classList.toggle("invalid", !name);
      dueEl.classList.toggle("invalid", badDue);
      if (!name || badAmt || badDue) return;
      state.items.push({
        id: uid(), name: name.slice(0, 60), amount,
        recurrence: $("#newRecurrence").value, category: $("#newCategory").value,
        dueDay: clampDay(dueEl.value),
      });
      nameEl.value = "";
      amtEl.value = "";
      dueEl.value = "";
      nameEl.focus();
      commit();
    });
    for (const el of [$("#newName"), $("#newAmount"), $("#newDueDay")]) el.addEventListener("input", () => el.classList.remove("invalid"));

    $("#billIdeas").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-idea]");
      const idea = btn && BILL_IDEAS.find((b) => b.name === btn.dataset.idea);
      if (!idea) return;
      $("#newName").value = idea.name;
      $("#newRecurrence").value = idea.recurrence;
      $("#newCategory").value = idea.category;
      $("#newAmount").focus();
    });

    const tbody = $("#itemsTable tbody");
    tbody.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-act]");
      if (!btn) return;
      const id = btn.closest("tr").dataset.id;
      const act = btn.dataset.act;
      if (act === "edit") { editingId = id; render(); }
      else if (act === "cancel") { editingId = null; render(); }
      else if (act === "save") commitEdit(id);
      else if (act === "delete") removeItem(id);
    });
    tbody.addEventListener("keydown", (e) => {
      const tr = e.target.closest("tr.editing");
      if (!tr) return;
      if (e.key === "Enter") { e.preventDefault(); commitEdit(tr.dataset.id); }
      if (e.key === "Escape") { editingId = null; render(); }
    });

    $("#itemsTable thead").addEventListener("click", (e) => {
      const b = e.target.closest(".sort");
      if (!b) return;
      const key = b.dataset.sort;
      const textual = key === "name" || key === "recurrence";
      if (state.sort.key !== key) state.sort = { key, dir: textual ? "asc" : "desc" };
      else if ((state.sort.dir === "asc") === textual) state.sort.dir = state.sort.dir === "asc" ? "desc" : "asc";
      else state.sort = { key: null, dir: "asc" };
      commit();
    });
  }

  function commitEdit(id) {
    const tr = $(`#itemsTable tr[data-id="${CSS.escape(id)}"]`);
    const item = state.items.find((i) => i.id === id);
    if (!tr || !item) return;
    const nameEl = $('[data-edit="name"]', tr);
    const amtEl = $('[data-edit="amount"]', tr);
    const dueEl = $('[data-edit="dueDay"]', tr);
    const name = nameEl.value.trim();
    const amount = parseNum(amtEl.value);
    const badAmt = !Number.isFinite(amount) || amount < 0;
    const badDue = dueEl.value.trim() !== "" && clampDay(dueEl.value) === null;
    nameEl.classList.toggle("invalid", !name);
    amtEl.classList.toggle("invalid", badAmt);
    dueEl.classList.toggle("invalid", badDue);
    if (!name || badAmt || badDue) return;
    Object.assign(item, {
      name: name.slice(0, 60),
      amount,
      recurrence: $('[data-edit="recurrence"]', tr).value,
      category: $('[data-edit="category"]', tr).value,
      dueDay: clampDay(dueEl.value),
    });
    editingId = null;
    commit();
  }

  function removeItem(id) {
    const idx = state.items.findIndex((i) => i.id === id);
    if (idx < 0) return;
    const [item] = state.items.splice(idx, 1);
    if (editingId === id) editingId = null;
    commit();
    showToast(`Removed “${item.name}”`, () => {
      state.items.splice(Math.min(idx, state.items.length), 0, item);
      commit();
    });
  }

  // ---------- Toast ----------

  let undo = null;
  let toastTimer = null;
  function showToast(text, onUndo) {
    undo = onUndo || null;
    $("#toastText").textContent = text;
    $("#toastUndo").hidden = !onUndo;
    $("#toast").hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { $("#toast").hidden = true; undo = null; }, 6000);
  }

  // ---------- Header actions ----------

  function setupHeader() {
    $("#toastUndo").addEventListener("click", () => {
      if (undo) undo();
      undo = null;
      $("#toast").hidden = true;
    });

    $("#exportBtn").addEventListener("click", () => {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `incomebudget-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });

    $("#importBtn").addEventListener("click", () => $("#importFile").click());
    $("#importFile").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      e.target.value = "";
      if (!file) return;
      try {
        const prev = state;
        const data = JSON.parse(await file.text());
        replaceState(data, { markDirty: true });
        showToast("Data imported", () => replaceState(prev, { markDirty: true }));
      } catch (_) {
        showToast("That file couldn't be read as an export.");
      }
    });

    $("#resetBtn").addEventListener("click", () => {
      const prev = state;
      replaceState(defaultState(), { markDirty: true });
      showToast("Everything reset", () => replaceState(prev, { markDirty: true }));
    });

    const THEME_KEY = "incomebudget:theme";
    const applyTheme = (t) => { if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme; };
    try { applyTheme(localStorage.getItem(THEME_KEY)); } catch (_) { /* ignore */ }
    $("#themeBtn").addEventListener("click", () => {
      const current = document.documentElement.dataset.theme ||
        (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
      const next = current === "dark" ? "light" : "dark";
      applyTheme(next);
      try { localStorage.setItem(THEME_KEY, next); } catch (_) { /* ignore */ }
    });
  }

  // ---------- Public API ----------

  function commit() {
    save();
    render();
  }

  /**
   * Swap in a whole state object (import, reset, server sync).
   * markDirty: true bumps updatedAt and fires "save" (so sync pushes it);
   * false keeps the incoming updatedAt and only persists locally.
   */
  function replaceState(data, { markDirty = false } = {}) {
    state = sanitize(data);
    editingId = null;
    if (markDirty) save();
    else { clearTimeout(saveTimer); persistLocal(); }
    refreshInputs();
    render();
  }

  function register(mod) {
    if (!mod || !mod.id) throw new Error("App.register: module needs an id");
    if (modules.some((m) => m.id === mod.id)) throw new Error(`App.register: duplicate module ${mod.id}`);
    modules.push(mod);
    if (ready) {
      if (mod.stateKey && !(mod.stateKey in state)) state[mod.stateKey] = mod.defaults ? mod.defaults() : null;
      if (mod.init) mod.init(buildContext());
      render();
    }
  }

  function init() {
    state = load();
    setupTabs();
    setupInputs();
    setupBudget();
    setupHeader();
    ready = true;
    // Flush a pending local save if the tab closes inside the debounce window.
    window.addEventListener("pagehide", () => { clearTimeout(saveTimer); persistLocal(); });
    const ctx = buildContext();
    for (const m of modules) {
      if (!m.init) continue;
      try { m.init(ctx); } catch (err) { console.error(`[${m.id} init]`, err); }
    }
    render();
    if (!state.updatedAt && activeTab === "paycheck" && matchMedia("(min-width: 881px)").matches) {
      $(state.income.mode === "hourly" ? "#hourlyRate" : "#salary").focus();
    }
  }

  window.App = {
    register,
    state: () => state,
    commit,
    render,
    replaceState,
    on: (event, fn) => { (listeners[event] || (listeners[event] = [])).push(fn); },
    context: () => buildContext(),
    switchTab,
    showToast,
    util: {
      $, $$, money, usd0, pct, esc, parseNum, uid, options, category, annualOf, ordinal, clampDay,
      CATEGORIES, RECURRENCES, VIEW_PERIODS, PERIODS, PAY_PERIODS, ICONS,
    },
  };

  // Module scripts load after this file; start once they've all registered.
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else setTimeout(init, 0);
})();

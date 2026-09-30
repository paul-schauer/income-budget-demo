/*
 * Savings goals: planning math plus the Goals tab.
 *
 * The pure part (sanitize, plan, summarize, budgetLines, templates, ...) has no DOM
 * access and runs in Node for tests (module.exports). In the browser it is window.Goals,
 * and the Goals tab registers with App when window.App exists.
 *
 * Goal: { id, name, target, saved, mode: "date" | "amount", targetDate, perPaycheck,
 *         includeInBudget, createdAt }
 *   "date"    spread what's left over the paydays from today through targetDate
 *   "amount"  set perPaycheck aside each payday and project the finish date
 *
 * A schedule is { anchor, payPeriod, today, perYear }: anchor is the user's next payday
 * ("" = Schedule's default), dates are ISO "YYYY-MM-DD". Pass `today` explicitly in tests.
 */
(function (root) {
  "use strict";

  const isNode = typeof module !== "undefined" && module.exports;
  const S = isNode ? require("./schedule.js") : root.Schedule;

  const MODES = ["date", "amount"];
  const MAX_GOALS = 100;
  const MAX_AMOUNT = 1e9;
  const NAME_MAX = 60;
  const MAX_YEARS = 50; // planning horizon
  const PER_YEAR = { weekly: 52, biweekly: 26, semimonthly: 24, monthly: 12 };

  const uid = () => Math.random().toString(36).slice(2, 10);
  const cents = (n) => Math.round(n * 100);
  const round2 = (n) => Math.round(n * 100) / 100;

  // ---------- Validation ----------

  /** Numbers and numeric strings only; booleans, null, arrays etc. are NaN. */
  function toNum(v) {
    if (typeof v === "number") return v;
    if (typeof v === "string" && v.trim() !== "") return Number(v.replace(/[$,\s]/g, ""));
    return NaN;
  }

  /** A dollar amount in [0, MAX_AMOUNT], rounded to cents, or `fallback`. */
  function money(v, fallback) {
    const n = toNum(v);
    return Number.isFinite(n) && n >= 0 && n <= MAX_AMOUNT ? round2(n) : fallback;
  }

  /** A real calendar date ("2026-02-31" is not) in a sane range. */
  function isISODate(s) {
    if (typeof s !== "string") return false;
    const d = S.parse(s);
    return !!d && S.fmt(d) === s && s >= "1900-01-01" && s <= "2200-12-31";
  }

  /** Same day `n` months later, clamped to the month's length. */
  function addMonths(iso, n) {
    const d = S.parse(iso);
    const total = d.getUTCMonth() + n;
    const y = d.getUTCFullYear() + Math.floor(total / 12);
    const m = ((total % 12) + 12) % 12;
    return S.onDay(y, m, d.getUTCDate());
  }

  function cleanName(v) {
    if (typeof v !== "string") return "";
    // eslint-disable-next-line no-control-regex
    return v.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX);
  }

  /** Validate goals from storage, import or the server. Anything unusable is dropped. */
  function sanitize(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    const seen = new Set();
    for (const g of raw) {
      if (out.length >= MAX_GOALS) break;
      if (!g || typeof g !== "object" || Array.isArray(g)) continue;
      const target = money(g.target, NaN);
      if (!(target > 0)) continue;

      let id = typeof g.id === "string" || (typeof g.id === "number" && Number.isFinite(g.id)) ? String(g.id).trim().slice(0, 40) : "";
      while (!id || seen.has(id)) id = uid();
      seen.add(id);

      const targetDate = isISODate(g.targetDate) ? g.targetDate : "";
      const perPaycheck = money(g.perPaycheck, 0);
      const mode = MODES.includes(g.mode) ? g.mode : !targetDate && perPaycheck > 0 ? "amount" : "date";
      out.push({
        id,
        name: cleanName(g.name) || "Savings goal",
        target,
        saved: money(g.saved, 0),
        mode,
        targetDate,
        perPaycheck,
        includeInBudget: typeof g.includeInBudget === "boolean" ? g.includeInBudget : true,
        createdAt: typeof g.createdAt === "number" && Number.isFinite(g.createdAt) && g.createdAt > 0 ? Math.floor(g.createdAt) : 0,
      });
    }
    return out;
  }

  // ---------- Planning ----------

  function normSched(s) {
    s = s || {};
    const payPeriod = PER_YEAR[s.payPeriod] ? s.payPeriod : "biweekly";
    return {
      anchor: isISODate(s.anchor) ? s.anchor : "",
      payPeriod,
      today: isISODate(s.today) ? s.today : S.todayISO(),
      perYear: Number(s.perYear) > 0 ? Number(s.perYear) : PER_YEAR[payPeriod],
    };
  }

  /** Paydays from `from` through `to`, inclusive. */
  function paychecksBetween(s, from, to) {
    const days = S.daysBetween(from, to);
    if (days <= 3650) return S.countPaydays(s.anchor, s.payPeriod, from, to);
    // countPaydays only looks a limited number of paydays ahead; walk far-off dates here.
    const est = Math.min(20000, Math.ceil(days / 7) + 2); // weekly is the densest schedule
    return S.paydays(s.anchor, s.payPeriod, from, est).filter((d) => d <= to).length;
  }

  function planWith(goal, s) {
    const target = Number(goal.target) || 0;
    const saved = Number(goal.saved) || 0;
    const remaining = Math.max(0, round2(target - saved));
    const out = {
      status: "active", // active | complete | overdue | unset
      remaining,
      progress: target > 0 ? Math.min(1, Math.max(0, saved / target)) : 0,
      perPaycheck: null,
      paychecksLeft: null,
      monthly: null,
      finishDate: null,
      pastDate: false,
      tooFar: false,
    };
    if (remaining <= 0) return Object.assign(out, { status: "complete", remaining: 0, progress: 1 });

    if (goal.mode === "amount") {
      const per = cents(Number(goal.perPaycheck) || 0);
      if (!(per > 0)) return Object.assign(out, { status: "unset" });
      const n = Math.ceil(cents(remaining) / per);
      Object.assign(out, { perPaycheck: per / 100, paychecksLeft: n, monthly: ((per / 100) * s.perYear) / 12 });
      if (n > s.perYear * MAX_YEARS) return Object.assign(out, { tooFar: true });
      out.finishDate = S.paydays(s.anchor, s.payPeriod, s.today, n)[n - 1];
      return out;
    }

    if (!isISODate(goal.targetDate)) return Object.assign(out, { status: "unset" });
    const pastDate = goal.targetDate < s.today;
    const n = pastDate ? 0 : paychecksBetween(s, s.today, goal.targetDate);
    if (n === 0) return Object.assign(out, { status: "overdue", pastDate });
    const per = Math.ceil(cents(remaining) / n) / 100; // round up so the last payday gets there
    return Object.assign(out, { perPaycheck: per, paychecksLeft: n, monthly: (per * s.perYear) / 12 });
  }

  /**
   * What a goal needs from each paycheck.
   * @returns {{status, remaining, progress, perPaycheck, paychecksLeft, monthly, finishDate, pastDate, tooFar}}
   *   status "complete" (saved >= target), "overdue" (date mode, date passed or no paydays left),
   *   "unset" (no date / no amount yet) or "active". finishDate is the projected payday (amount mode).
   */
  function plan(goal, sched) {
    return planWith(goal || {}, normSched(sched));
  }

  /** Totals across goals. perPaycheck counts every active goal; budgeted only those in the budget. */
  function summarize(goals, sched) {
    const s = normSched(sched);
    const sum = { saved: 0, target: 0, progress: 0, perPaycheck: 0, budgeted: 0, monthly: 0, counts: { active: 0, complete: 0, overdue: 0, unset: 0 }, plans: new Map() };
    let counted = 0;
    for (const g of goals || []) {
      const p = planWith(g, s);
      sum.plans.set(g.id, p);
      sum.counts[p.status]++;
      sum.saved += g.saved;
      sum.target += g.target;
      counted += Math.min(g.saved, g.target);
      if (p.status === "active") {
        sum.perPaycheck += p.perPaycheck;
        if (g.includeInBudget) sum.budgeted += p.perPaycheck;
      }
    }
    sum.progress = sum.target > 0 ? counted / sum.target : 0;
    sum.monthly = (sum.perPaycheck * s.perYear) / 12;
    return sum;
  }

  /** Budget rows for unfinished, on-schedule goals that are included in the budget. */
  function budgetLines(goals, sched) {
    const s = normSched(sched);
    const lines = [];
    for (const g of Array.isArray(goals) ? goals : []) {
      if (!g || !g.includeInBudget) continue;
      const p = planWith(g, s);
      if (p.status !== "active" || !(p.perPaycheck > 0)) continue;
      lines.push({ id: g.id, name: g.name, annual: p.perPaycheck * s.perYear, category: "savings", tab: "goals", note: "Savings goal" });
    }
    return lines;
  }

  // ---------- Templates ----------

  /** Three months of budgeted expenses, rounded up to $100; a $1,000 starter fund with no budget. */
  function emergencyFundTarget(itemsAnnual) {
    const threeMonths = (Number(itemsAnnual) / 12) * 3;
    return Number.isFinite(threeMonths) && threeMonths > 0 ? Math.ceil(threeMonths / 100) * 100 : 1000;
  }

  /** This year's Dec 15, or next year's once it's less than a month away. */
  function holidayDate(today) {
    const y = S.parse(today).getUTCFullYear();
    const d = `${y}-12-15`;
    return S.daysBetween(today, d) >= 30 ? d : `${y + 1}-12-15`;
  }

  function templates({ itemsAnnual = 0, today } = {}) {
    const hasBudget = Number(itemsAnnual) > 0;
    return [
      {
        key: "emergency", name: "Emergency fund", target: emergencyFundTarget(itemsAnnual), mode: "date", targetDate: addMonths(today, 12),
        note: hasBudget ? "3 months of budgeted expenses" : "A starter fund. Add budget items for a 3-month target.",
      },
      { key: "vacation", name: "Vacation", target: 2000, mode: "date", targetDate: addMonths(today, 9), note: "Travel, lodging and fun money" },
      { key: "car", name: "Car", target: 6000, mode: "date", targetDate: addMonths(today, 24), note: "A down payment or big repairs" },
      { key: "holiday", name: "Holiday gifts", target: 800, mode: "date", targetDate: holidayDate(today), note: "Gifts and travel by Dec 15" },
    ];
  }

  const api = {
    MODES, MAX_GOALS, MAX_AMOUNT, MAX_YEARS,
    isISODate, addMonths, sanitize, plan, summarize, budgetLines,
    templates, emergencyFundTarget, holidayDate,
  };

  if (isNode) { module.exports = api; return; }
  root.Goals = api;
  if (root.App && S) mountUI(root.App);

  // ---------- Browser UI ----------

  function mountUI(App) {
    const doc = root.document;
    const { esc, money: fmtMoney, pct, parseNum, ICONS } = App.util;
    const whole = (n) => App.util.usd0.format(n);
    const DATE_FMT = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
    const fmtDate = (iso) => DATE_FMT.format(S.parse(iso));
    const plural = (n, word) => `${n} ${n === 1 ? word : `${word}s`}`;
    const plain = (n) => (n ? (Number.isInteger(n) ? String(n) : n.toFixed(2)) : "");
    const byId = (id) => doc.getElementById(id);
    const reduceMotion = () => root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const svg = (d, w = 2) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
    const ICON = {
      plus: svg('<path d="M12 5v14M5 12h14"/>', 2.5),
      star: svg('<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9Z"/>'),
      warn: svg('<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>'),
    };

    let rootEl = null;
    let lastCtx = null;
    const ui = { formOpen: false, editingId: null, mode: "date", addingId: null, celebrateId: null, focus: null };

    // Only touch the DOM when markup changes, so typing elsewhere doesn't reset focus.
    const painted = new WeakMap();
    function paint(el, html) {
      if (el && painted.get(el) !== html) { painted.set(el, html); el.innerHTML = html; }
    }

    const list = () => {
      const st = App.state();
      if (!Array.isArray(st.goals)) st.goals = [];
      return st.goals;
    };
    const find = (id) => list().find((g) => g.id === id) || null;
    const cardEl = (id) => rootEl.querySelector(`.goal-card[data-id="${CSS.escape(id)}"]`);
    const schedOf = (ctx) => ({ anchor: ctx.state.income.nextPayday || "", payPeriod: ctx.payPeriod, perYear: ctx.perYear, today: S.todayISO() });
    const switchHTML = (act, on, label, attrs = "") =>
      `<button type="button" class="goals-switch" role="switch" aria-checked="${on}" data-g="${act}" ${attrs}><span class="goals-switch-track" aria-hidden="true"><span class="goals-switch-knob"></span></span><span>${label}</span></button>`;

    // ----- Skeleton (built once; the form is never re-rendered while open) -----

    function skeleton() {
      const err = (key) => `<span class="goals-err" id="goalErr-${key}" data-err="${key}" hidden></span>`;
      return `
      <section class="card goals-top" aria-labelledby="goalsTitle">
        <div class="goals-head">
          <div>
            <h2 class="card-title" id="goalsTitle">Savings goals</h2>
            <p class="goals-sub">Pick a target and see what to set aside from each paycheck.</p>
          </div>
          <button type="button" class="btn primary" data-g="new">${ICON.plus}Add goal</button>
        </div>
        <div id="goalsSummary"></div>
      </section>
      <section class="card goals-form-card" id="goalsFormCard" aria-labelledby="goalsFormTitle" hidden>
        <form id="goalsForm" novalidate autocomplete="off">
          <h3 class="goals-form-title" id="goalsFormTitle">New goal</h3>
          <div class="field">
            <label for="goalName">Goal name</label>
            <input id="goalName" maxlength="${NAME_MAX}" placeholder="e.g. New laptop" aria-describedby="goalErr-name">
            ${err("name")}
          </div>
          <div class="row">
            <div class="field">
              <label for="goalTarget">Target amount</label>
              <div class="money"><span>$</span><input id="goalTarget" inputmode="decimal" placeholder="0.00" aria-describedby="goalErr-target"></div>
              ${err("target")}
            </div>
            <div class="field">
              <label for="goalSaved">Already saved</label>
              <div class="money"><span>$</span><input id="goalSaved" inputmode="decimal" placeholder="0.00" aria-describedby="goalErr-saved"></div>
              ${err("saved")}
            </div>
          </div>
          <span class="label goals-mode-label" id="goalModeLabel">How do you want to save?</span>
          <div class="seg goals-mode" role="radiogroup" aria-labelledby="goalModeLabel">
            <button type="button" role="radio" data-mode="date">Reach it by a date</button>
            <button type="button" role="radio" data-mode="amount">Save a set amount each paycheck</button>
          </div>
          <div class="field" data-for-mode="date">
            <label for="goalDate">Target date</label>
            <input id="goalDate" type="date" aria-describedby="goalErr-date">
            ${err("date")}
          </div>
          <div class="field" data-for-mode="amount" hidden>
            <label for="goalPer">Amount each paycheck</label>
            <div class="money"><span>$</span><input id="goalPer" inputmode="decimal" placeholder="0.00" aria-describedby="goalErr-per"></div>
            ${err("per")}
          </div>
          <p class="goals-preview" id="goalPreview" aria-live="polite"></p>
          ${switchHTML("form-include", true, "Include in budget", 'id="goalInclude"')}
          <p class="goals-fine">Goals in the budget show up on the Budget tab as savings.</p>
          <div class="goals-form-actions">
            <button type="submit" class="btn primary" id="goalSubmit">Add goal</button>
            <button type="button" class="btn" data-g="cancel">Cancel</button>
          </div>
        </form>
      </section>
      <div class="goals-list" id="goalsList"></div>
      <div id="goalsMore"></div>`;
    }

    // ----- Rendering -----

    function render(ctx) {
      if (!rootEl) return;
      lastCtx = ctx;
      const sched = schedOf(ctx);
      const goals = list();
      if (ui.addingId && !find(ui.addingId)) ui.addingId = null;
      const sum = summarize(goals, sched);
      paint(byId("goalsSummary"), goals.length ? summaryHTML(ctx, sched, sum) : emptyHTML(ctx, sched));
      paint(byId("goalsList"), cardsHTML(goals, sum));
      paint(byId("goalsMore"), goals.length ? moreHTML(ctx, sched) : "");
      if (ui.formOpen) {
        if (ui.editingId && !find(ui.editingId)) closeForm(false);
        else updatePreview();
      }
      ui.celebrateId = null;
      restoreFocus();
    }

    function summaryHTML(ctx, sched, sum) {
      const takeHome = ctx.result.net / ctx.perYear;
      const c = sum.counts;
      const open = c.active + c.overdue + c.unset;
      const status = [open ? `${plural(open, "goal")} in progress` : "", c.complete ? `${c.complete} reached` : ""].filter(Boolean).join(" · ");
      const pctSaved = Math.round(sum.progress * 100);

      const notes = [];
      if (ctx.leftAnnual < 0) {
        notes.push(`<div class="goals-alert">${ICON.warn}<div>Your budget and goals come to <strong>${fmtMoney(-ctx.leftAnnual / ctx.perYear)}</strong> more than your take-home each paycheck. Push a date back, lower an amount, or leave a goal out of the budget. <button type="button" class="linklike" data-goto="budget">Review budget</button></div></div>`);
      } else if (takeHome > 0 && sum.budgeted > 0) {
        notes.push(`<p class="goals-note">After your budget and goals, <strong class="good">${fmtMoney(ctx.leftAnnual / ctx.perYear)}</strong> of each paycheck is left over. <button type="button" class="linklike" data-goto="budget">See budget</button></p>`);
      }
      const outside = sum.perPaycheck - sum.budgeted;
      if (outside > 0.005) notes.push(`<p class="goals-note">${fmtMoney(outside)} per paycheck for goals isn't counted in your budget.</p>`);
      if (c.overdue) notes.push(`<p class="goals-note bad">${plural(c.overdue, "goal")} ${c.overdue === 1 ? "is" : "are"} past due and not in your budget. Pick a new date to get back on track.</p>`);
      if (!sched.anchor) notes.push(`<p class="goals-note">Paydays are estimated. <button type="button" class="linklike" data-goto="paycheck" data-goto-focus="#nextPayday">Set your next payday</button> for exact dates.</p>`);

      return `
        <div class="goals-stats">
          <div class="stat"><div class="k">Saved so far</div><div class="v">${fmtMoney(sum.saved)}</div><div class="goals-stat-sub">of ${fmtMoney(sum.target)} · ${pctSaved}%</div></div>
          <div class="stat"><div class="k">To goals per paycheck</div><div class="v">${fmtMoney(sum.perPaycheck)}</div><div class="goals-stat-sub">${takeHome > 0 ? `${pct(sum.perPaycheck / takeHome)} of take-home` : "Add your pay to compare"}</div></div>
          <div class="stat"><div class="k">About per month</div><div class="v">${fmtMoney(sum.monthly)}</div><div class="goals-stat-sub">${status}</div></div>
        </div>
        <div class="meter goals-meter" role="progressbar" aria-label="Saved toward all goals" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pctSaved}"><div class="meter-fill" style="width:${pctSaved}%"></div></div>
        ${notes.join("")}`;
    }

    function emptyHTML(ctx, sched) {
      const cards = templates({ itemsAnnual: ctx.itemsAnnual, today: sched.today }).map((t) => {
        const p = plan({ ...t, saved: 0 }, sched);
        return `<button type="button" class="goals-tpl" data-tpl="${t.key}">
          <span class="goals-tpl-name">${esc(t.name)}</span>
          <span class="goals-tpl-amt">${whole(t.target)}</span>
          <span class="goals-tpl-note">${esc(t.note)}</span>
          <span class="goals-tpl-plan">By ${fmtDate(t.targetDate)}${p.perPaycheck ? ` · ${fmtMoney(p.perPaycheck)}/paycheck` : ""}</span>
        </button>`;
      }).join("");
      return `<div class="goals-empty">
        <p class="goals-empty-lead">No goals yet. Start from one of these and change anything you like.</p>
        <div class="goals-tpls">${cards}</div>
        <button type="button" class="linklike" data-g="new">Or start from scratch</button>
      </div>`;
    }

    function moreHTML(ctx, sched) {
      const chips = templates({ itemsAnnual: ctx.itemsAnnual, today: sched.today })
        .map((t) => `<button type="button" class="goals-chip" data-tpl="${t.key}">${ICON.plus}${esc(t.name)}</button>`).join("");
      return `<div class="goals-more"><span class="goals-more-k">Add from template</span>${chips}</div>`;
    }

    function cardsHTML(goals, sum) {
      // Keep the user's order, with reached goals at the end.
      const order = [...goals.filter((g) => sum.plans.get(g.id).status !== "complete"), ...goals.filter((g) => sum.plans.get(g.id).status === "complete")];
      return order.map((g, i) => cardHTML(g, sum.plans.get(g.id), i)).join("");
    }

    function cardHTML(g, p, i) {
      const name = esc(g.name);
      const done = p.status === "complete";
      const pctDone = done ? 100 : Math.min(99, Math.floor(p.progress * 100));
      const sub = g.mode === "amount"
        ? (g.perPaycheck > 0 ? `${fmtMoney(g.perPaycheck)} each paycheck` : "Set amount each paycheck")
        : (g.targetDate ? `By ${fmtDate(g.targetDate)}` : "No target date yet");
      const celebrate = ui.celebrateId === g.id;

      let foot = "";
      if (!done && ui.addingId === g.id) {
        const suggest = p.perPaycheck > 0 ? Math.min(p.perPaycheck, p.remaining) : 0;
        foot = `<form class="goal-addform" data-g-form="add" novalidate autocomplete="off">
          <label class="sr" for="goalAdd-${i}">Amount to add to ${name}</label>
          <div class="money"><span>$</span><input id="goalAdd-${i}" inputmode="decimal" placeholder="0.00" value="${plain(suggest)}"></div>
          <button type="submit" class="btn primary">Add</button>
          <button type="button" class="btn" data-g="add-cancel">Cancel</button>
          <p class="goal-addhint">Use a minus sign to take money out.</p>
        </form>`;
      } else if (!done) {
        foot = `<div class="goal-foot">
          <button type="button" class="btn goal-add-btn" data-g="add">${ICON.plus}Add money</button>
          ${switchHTML("toggle", g.includeInBudget, "In budget", `aria-label="Include ${name} in budget"`)}
        </div>`;
      }

      return `<article class="card goal-card is-${p.status}${celebrate ? " celebrate" : ""}" data-id="${esc(g.id)}" aria-labelledby="goalTitle-${i}">
        <div class="goal-head">
          <div class="goal-title">
            <h3 class="goal-name" id="goalTitle-${i}">${name}</h3>
            <span class="tag">${sub}</span>
          </div>
          <div class="row-actions">
            <button type="button" class="icon-btn" data-g="edit" title="Edit" aria-label="Edit ${name}">${ICONS.edit}</button>
            <button type="button" class="icon-btn danger" data-g="delete" title="Delete" aria-label="Delete ${name}">${ICONS.del}</button>
          </div>
        </div>
        <div class="goal-amounts">
          <span><strong>${fmtMoney(g.saved)}</strong> <span class="goal-of">of ${fmtMoney(g.target)}</span></span>
          <span class="goal-pct">${pctDone}%</span>
        </div>
        <div class="meter goal-meter" role="progressbar" aria-label="${name} progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pctDone}"><div class="meter-fill" style="width:${pctDone}%"></div></div>
        ${planHTML(g, p)}
        ${foot}
        ${celebrate ? `<div class="goal-confetti" aria-hidden="true">${"<i></i>".repeat(12)}</div>` : ""}
      </article>`;
    }

    function planHTML(g, p) {
      const toGo = `${fmtMoney(p.remaining)} to go`;
      switch (p.status) {
        case "complete":
          return `<div class="goal-done"><span class="goal-badge">${ICON.star}Goal reached</span><span class="goal-meta">You saved ${fmtMoney(g.saved)}. Nice work!</span></div>`;
        case "overdue": {
          const why = p.pastDate ? `The target date passed with ${toGo}.` : `No paydays left before ${fmtDate(g.targetDate)}, with ${toGo}.`;
          return `<div class="goal-plan"><div class="goal-need bad">${ICON.warn}Overdue</div><div class="goal-meta">${why} <button type="button" class="linklike" data-g="edit">Pick a new date</button></div></div>`;
        }
        case "unset":
          return `<div class="goal-plan"><div class="goal-meta">${g.mode === "amount" ? "Set an amount per paycheck to see when you'll finish." : "Pick a target date to see what to save each paycheck."} <button type="button" class="linklike" data-g="edit">Edit goal</button></div></div>`;
      }
      if (p.tooFar) {
        return `<div class="goal-plan"><div class="goal-need bad">More than ${MAX_YEARS} years away</div><div class="goal-meta">${toGo} at ${fmtMoney(p.perPaycheck)} a paycheck. Raise the amount to finish sooner.</div></div>`;
      }
      const meta = `${plural(p.paychecksLeft, "paycheck")}${g.mode === "date" ? " left" : ""} · about ${fmtMoney(p.monthly)} a month · ${toGo}`;
      const need = g.mode === "amount"
        ? `<span class="goal-k">Done around</span> <span class="goal-big">${fmtDate(p.finishDate)}</span>`
        : `<span class="goal-big">${fmtMoney(p.perPaycheck)}</span> <span class="goal-k">per paycheck</span>`;
      return `<div class="goal-plan"><div class="goal-need">${need}</div><div class="goal-meta">${meta}</div></div>`;
    }

    function restoreFocus() {
      if (!ui.focus) return;
      const { id, sel } = ui.focus;
      ui.focus = null;
      const scope = id ? cardEl(id) : rootEl;
      const el = scope && scope.querySelector(sel);
      if (el) {
        el.focus();
        if (el.select) el.select();
      }
    }

    // ----- Add / edit form -----

    const F = () => ({
      card: byId("goalsFormCard"), form: byId("goalsForm"), title: byId("goalsFormTitle"), submit: byId("goalSubmit"),
      name: byId("goalName"), target: byId("goalTarget"), saved: byId("goalSaved"), date: byId("goalDate"), per: byId("goalPer"),
      include: byId("goalInclude"), preview: byId("goalPreview"),
    });
    const FIELDS = { name: "name", target: "target", saved: "saved", date: "date", per: "per" };

    function openForm(src) {
      const f = F();
      const today = S.todayISO();
      const editing = src && src.id && find(src.id) ? src.id : null;
      ui.formOpen = true;
      ui.editingId = editing;
      ui.mode = src && src.mode === "amount" ? "amount" : "date";
      f.name.value = src ? src.name : "";
      f.target.value = src ? plain(src.target) : "";
      f.saved.value = src ? plain(src.saved) : "";
      f.date.value = src && isISODate(src.targetDate) ? src.targetDate : addMonths(today, 12);
      f.date.min = S.addDays(today, 1);
      f.per.value = src ? plain(src.perPaycheck) : "";
      f.include.setAttribute("aria-checked", String(src ? src.includeInBudget !== false : true));
      f.title.textContent = editing ? "Edit goal" : src ? `New goal: ${src.name}` : "New goal";
      f.submit.textContent = editing ? "Save changes" : "Add goal";
      showErrors({});
      syncMode();
      updatePreview();
      f.card.hidden = false;
      f.card.scrollIntoView({ block: "start", behavior: reduceMotion() ? "auto" : "smooth" });
      (src && !editing ? f.saved : f.name).focus({ preventScroll: true });
    }

    function closeForm(restore = true) {
      const id = ui.editingId;
      ui.formOpen = false;
      ui.editingId = null;
      F().card.hidden = true;
      if (!restore) return;
      const card = id && cardEl(id);
      const el = card ? card.querySelector('[data-g="edit"]') : rootEl.querySelector('.goals-head [data-g="new"]');
      if (el) el.focus();
    }

    function syncMode() {
      const f = F();
      for (const b of f.form.querySelectorAll("[data-mode]")) b.setAttribute("aria-checked", String(b.dataset.mode === ui.mode));
      for (const el of f.form.querySelectorAll("[data-for-mode]")) el.hidden = el.dataset.forMode !== ui.mode;
    }

    function readForm() {
      const f = F();
      const today = S.todayISO();
      const errors = {};
      const name = cleanName(f.name.value);
      if (!name) errors.name = "Give the goal a name.";

      const target = parseNum(f.target.value);
      if (!Number.isFinite(target) || round2(target) <= 0) errors.target = "Enter a target above $0.";
      else if (target > MAX_AMOUNT) errors.target = "That's more than this can track.";

      const savedText = f.saved.value.trim();
      const saved = savedText === "" ? 0 : parseNum(savedText);
      if (!Number.isFinite(saved) || saved < 0) errors.saved = "Enter $0 or more.";
      else if (saved > MAX_AMOUNT) errors.saved = "That's more than this can track.";

      const date = f.date.value;
      const per = parseNum(f.per.value);
      const perOk = Number.isFinite(per) && round2(per) > 0 && per <= MAX_AMOUNT;
      const goal = {
        name, target: round2(target), saved: round2(saved), mode: ui.mode,
        targetDate: isISODate(date) ? date : "",
        perPaycheck: perOk ? round2(per) : 0,
        includeInBudget: f.include.getAttribute("aria-checked") === "true",
      };

      const reached = !errors.target && !errors.saved && goal.saved >= goal.target;
      if (ui.mode === "date" && !reached) {
        if (!isISODate(date)) errors.date = "Pick a target date.";
        else if (date <= today) errors.date = "Pick a date after today.";
        else if (date > addMonths(today, 12 * MAX_YEARS)) errors.date = `Pick a date within ${MAX_YEARS} years.`;
        else if (lastCtx && !errors.target && !errors.saved && plan(goal, schedOf(lastCtx)).status === "overdue") errors.date = "There's no payday before that date. Pick a later one.";
      }
      if (ui.mode === "amount" && !reached && !perOk) {
        errors.per = Number.isFinite(per) && per > MAX_AMOUNT ? "That's more than this can track." : "Enter an amount above $0.";
      }
      return { goal, errors };
    }

    function showErrors(errors) {
      const f = F();
      for (const key of Object.keys(FIELDS)) {
        const msg = errors[key] || "";
        f[key].classList.toggle("invalid", !!msg);
        if (msg) f[key].setAttribute("aria-invalid", "true");
        else f[key].removeAttribute("aria-invalid");
        const el = byId(`goalErr-${key}`);
        el.textContent = msg;
        el.hidden = !msg;
      }
    }

    function clearError(key) {
      const f = F();
      if (!f[key]) return;
      f[key].classList.remove("invalid");
      f[key].removeAttribute("aria-invalid");
      const el = byId(`goalErr-${key}`);
      el.textContent = "";
      el.hidden = true;
    }

    function updatePreview() {
      const f = F();
      if (!lastCtx) return;
      const { goal, errors } = readForm();
      let html = "";
      let warn = false;
      if (!errors.target && !errors.saved) {
        const p = plan(goal, schedOf(lastCtx));
        const takeHome = lastCtx.result.net / lastCtx.perYear;
        const extra = (x) => `about ${fmtMoney(x.monthly)} a month${takeHome > 0 ? `, ${pct(x.perPaycheck / takeHome)} of take-home` : ""}`;
        if (p.status === "complete") html = "You've already saved enough. This goal will show as reached.";
        else if (p.status === "overdue") { warn = true; html = p.pastDate ? "That date has already passed." : "There's no payday before that date."; }
        else if (p.status === "active" && p.tooFar) { warn = true; html = `At that pace it would take more than ${MAX_YEARS} years.`; }
        else if (p.status === "active" && goal.mode === "amount") html = `You'd reach it around <strong>${fmtDate(p.finishDate)}</strong>, after ${plural(p.paychecksLeft, "paycheck")} (${extra(p)}).`;
        else if (p.status === "active") html = `That's <strong>${fmtMoney(p.perPaycheck)}</strong> from each of your next ${plural(p.paychecksLeft, "paycheck")} (${extra(p)}).`;
      }
      f.preview.classList.toggle("warn", warn);
      paint(f.preview, html);
    }

    function saveForm() {
      const { goal, errors } = readForm();
      showErrors(errors);
      const first = Object.keys(errors)[0];
      if (first) { F()[first].focus(); return; }

      const existing = ui.editingId && find(ui.editingId);
      let id;
      if (existing) {
        const wasDone = existing.saved >= existing.target;
        Object.assign(existing, goal);
        id = existing.id;
        if (!wasDone && existing.saved >= existing.target) ui.celebrateId = id;
      } else {
        const goals = list();
        do id = uid(); while (goals.some((g) => g.id === id));
        goals.push({ id, ...goal, createdAt: Date.now() });
        if (goal.saved >= goal.target) ui.celebrateId = id;
      }
      closeForm(false);
      ui.focus = { id, sel: '[data-g="edit"]' };
      App.commit();
      if (!existing) {
        App.showToast(`Added “${goal.name}”`, () => {
          const goals = list();
          const idx = goals.findIndex((g) => g.id === id);
          if (idx >= 0) { goals.splice(idx, 1); App.commit(); }
        });
      }
    }

    // ----- Card actions -----

    function removeGoal(id) {
      const goals = list();
      const idx = goals.findIndex((g) => g.id === id);
      if (idx < 0) return;
      const [goal] = goals.splice(idx, 1);
      if (ui.editingId === id) closeForm(false);
      if (ui.addingId === id) ui.addingId = null;
      const neighbor = goals[idx] || goals[idx - 1];
      ui.focus = neighbor ? { id: neighbor.id, sel: '[data-g="edit"]' } : { sel: '.goals-head [data-g="new"]' };
      App.commit();
      App.showToast(`Removed “${goal.name}”`, () => {
        const now = list();
        if (now.some((g) => g.id === goal.id)) return;
        now.splice(Math.min(idx, now.length), 0, goal);
        App.commit();
      });
    }

    function addMoney(form) {
      const card = form.closest(".goal-card");
      const goal = card && find(card.dataset.id);
      if (!goal) return;
      const input = form.querySelector("input");
      const amt = round2(parseNum(input.value));
      if (!Number.isFinite(amt) || amt === 0 || Math.abs(amt) > MAX_AMOUNT) {
        input.classList.add("invalid");
        input.focus();
        return;
      }
      const prev = goal.saved;
      const wasDone = prev >= goal.target;
      goal.saved = Math.min(MAX_AMOUNT, Math.max(0, round2(prev + amt)));
      const reached = !wasDone && goal.saved >= goal.target;
      ui.addingId = null;
      if (reached) ui.celebrateId = goal.id;
      ui.focus = { id: goal.id, sel: reached ? '[data-g="edit"]' : '[data-g="add"]' };
      App.commit();
      const text = reached ? `Goal reached: ${goal.name}!`
        : amt > 0 ? `Added ${fmtMoney(amt)} to ${goal.name}` : `Took ${fmtMoney(-amt)} out of ${goal.name}`;
      App.showToast(text, () => {
        const g = find(goal.id);
        if (g) { g.saved = prev; App.commit(); }
      });
    }

    function templateGoal(key) {
      const ctx = lastCtx || App.context();
      const t = templates({ itemsAnnual: ctx.itemsAnnual, today: S.todayISO() }).find((x) => x.key === key);
      return t && { name: t.name, target: t.target, saved: 0, mode: t.mode, targetDate: t.targetDate, perPaycheck: 0, includeInBudget: true };
    }

    // ----- Events -----

    function onClick(e) {
      const tpl = e.target.closest("[data-tpl]");
      if (tpl) { const t = templateGoal(tpl.dataset.tpl); if (t) openForm(t); return; }

      const modeBtn = e.target.closest("#goalsForm [data-mode]");
      if (modeBtn) {
        ui.mode = modeBtn.dataset.mode === "amount" ? "amount" : "date";
        clearError("date");
        clearError("per");
        syncMode();
        updatePreview();
        return;
      }

      const btn = e.target.closest("[data-g]");
      if (!btn) return;
      const card = btn.closest(".goal-card");
      const id = card && card.dataset.id;
      switch (btn.dataset.g) {
        case "new": openForm(null); break;
        case "cancel": closeForm(); break;
        case "form-include":
          btn.setAttribute("aria-checked", String(btn.getAttribute("aria-checked") !== "true"));
          break;
        case "edit": { const g = find(id); if (g) openForm(g); break; }
        case "delete": removeGoal(id); break;
        case "add":
          ui.addingId = id;
          ui.focus = { id, sel: ".goal-addform input" };
          App.render();
          break;
        case "add-cancel":
          ui.addingId = null;
          ui.focus = { id, sel: '[data-g="add"]' };
          App.render();
          break;
        case "toggle": {
          const g = find(id);
          if (!g) break;
          g.includeInBudget = !g.includeInBudget;
          ui.focus = { id, sel: '[data-g="toggle"]' };
          App.commit();
          break;
        }
      }
    }

    function onSubmit(e) {
      const form = e.target;
      if (form.id === "goalsForm") { e.preventDefault(); saveForm(); }
      else if (form.dataset.gForm === "add") { e.preventDefault(); addMoney(form); }
    }

    function onInput(e) {
      const el = e.target;
      if (el.closest("#goalsForm")) {
        const key = Object.keys(FIELDS).find((k) => F()[k] === el);
        if (key) clearError(key);
        updatePreview();
      } else if (el.closest(".goal-addform")) {
        el.classList.remove("invalid");
      }
    }

    function onKeydown(e) {
      if (e.key !== "Escape") return;
      if (e.target.closest("#goalsForm")) { e.preventDefault(); closeForm(); }
      else if (e.target.closest(".goal-addform")) {
        e.preventDefault();
        const id = e.target.closest(".goal-card").dataset.id;
        ui.addingId = null;
        ui.focus = { id, sel: '[data-g="add"]' };
        App.render();
      }
    }

    function init(ctx) {
      rootEl = byId("goalsRoot");
      if (!rootEl) return;
      lastCtx = ctx;
      rootEl.innerHTML = skeleton();
      rootEl.addEventListener("click", onClick);
      rootEl.addEventListener("submit", onSubmit);
      rootEl.addEventListener("input", onInput);
      rootEl.addEventListener("keydown", onKeydown);
    }

    App.register({
      id: "goals",
      stateKey: "goals",
      defaults: () => [],
      sanitize,
      init,
      render,
      budgetLines: (ctx) => budgetLines(ctx.state.goals, schedOf(ctx)),
    });
  }
})(typeof window !== "undefined" ? window : globalThis);

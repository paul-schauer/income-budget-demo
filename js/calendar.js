/*
 * Paycheck calendar: which bills come out of which paycheck.
 *
 * Pure planning logic (plan, suggestMove, month, ...) works in Node for tests
 * (module.exports). In the browser it also registers the "calendar" tab with
 * window.App and renders into #calendarRoot.
 *
 * Rules:
 * - A pay window runs from a payday up to the day before the next payday.
 * - Monthly items with a due day are "dated": each occurrence (due day clamped
 *   to the month's length) is paid by the latest payday on or before it.
 *   Occurrences between today and the first upcoming payday come out of money
 *   already received, so they're listed separately (beforeFirst).
 * - Everything else (no due day, or weekly/biweekly/semimonthly/quarterly/annual)
 *   and read-only budget lines from other modules are spread evenly:
 *   annual / paychecks per year.
 */
/**
 * @typedef {import("../types/app").AppContext} AppContext
 * @typedef {import("../types/app").BudgetItem} BudgetItem
 * @typedef {import("../types/tax").PayPeriod} PayPeriod
 * @typedef {import("../types/tax").ScheduleApi} ScheduleApi
 * @typedef {import("../types/tax").TaxApi} TaxApi
 * @typedef {import("../types/calendar-goals").PlanInput} PlanInput
 * @typedef {import("../types/calendar-goals").CalendarPlan} CalendarPlan
 * @typedef {import("../types/calendar-goals").Paycheck} Paycheck
 * @typedef {import("../types/calendar-goals").BillOccurrence} BillOccurrence
 * @typedef {import("../types/calendar-goals").SpreadLine} SpreadLine
 * @typedef {import("../types/calendar-goals").MoveSuggestion} MoveSuggestion
 * @typedef {import("../types/calendar-goals").MonthInput} MonthInput
 * @typedef {import("../types/calendar-goals").MonthGrid} MonthGrid
 * @typedef {import("../types/calendar-goals").MonthDay} MonthDay
 * @typedef {import("../types/calendar-goals").CalendarApi} CalendarApi
 */
(function (root) {
  "use strict";

  const isNode = typeof module !== "undefined" && module.exports;
  /** @type {ScheduleApi} */
  const Schedule = isNode ? require("./schedule.js") : root.Schedule;
  /** @type {TaxApi} */
  const Tax = isNode ? require("./tax.js") : root.Tax;
  const { PERIODS, PAY_PERIODS } = Tax;

  // Upcoming paychecks shown: about three months.
  /** @type {Record<PayPeriod, number>} */
  const HORIZON = { weekly: 13, biweekly: 7, semimonthly: 6, monthly: 4 };

  // ---------- Pure planning logic ----------

  /**
   * @template T
   * @param {T[]} list
   * @param {(x: T) => number} f
   */
  const sum = (list, f) => list.reduce((s, x) => s + f(x), 0);
  /** @param {number[]} list */
  const mean = (list) => (list.length ? list.reduce((s, x) => s + x, 0) / list.length : 0);
  /** @param {unknown} v */
  const finite = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  /**
   * @param {unknown} v
   * @returns {v is PayPeriod}
   */
  const isPayPeriod = (v) => PAY_PERIODS.includes(/** @type {PayPeriod} */ (v));

  /** @param {BudgetItem | null | undefined} item */
  function dueDayOf(item) {
    const d = Number(item && item.dueDay);
    return Number.isInteger(d) && d >= 1 && d <= 31 ? d : null;
  }

  /** @param {BudgetItem | null | undefined} item */
  function amountOf(item) {
    const a = Number(item && item.amount);
    return Number.isFinite(a) && a > 0 ? a : 0;
  }

  /**
   * A bill that lands on a specific day each month.
   * @param {BudgetItem | null | undefined} item
   */
  function isDated(item) {
    return !!item && item.recurrence === "monthly" && dueDayOf(item) !== null;
  }

  /**
   * Dated bill occurrences between fromIso and toIso (inclusive), sorted by date.
   * @param {BudgetItem[] | null | undefined} items
   * @param {string} fromIso
   * @param {string} toIso
   * @returns {BillOccurrence[]}
   */
  function occurrences(items, fromIso, toIso) {
    /** @type {BillOccurrence[]} */
    const out = [];
    const from = Schedule.parse(fromIso);
    const to = Schedule.parse(toIso);
    if (!from || !to || toIso < fromIso) return out;
    const endKey = to.getUTCFullYear() * 12 + to.getUTCMonth();
    (items || []).forEach((item, index) => {
      const amount = amountOf(item);
      const dueDay = dueDayOf(item);
      if (!amount || !isDated(item) || dueDay === null) return;
      let y = from.getUTCFullYear();
      let m = from.getUTCMonth();
      while (y * 12 + m <= endKey) {
        const due = Schedule.onDay(y, m, dueDay);
        if (due >= fromIso && due <= toIso) {
          out.push({ index, id: item.id, name: String(item.name || ""), category: item.category, amount, dueDay, due });
        }
        if (++m > 11) { m = 0; y++; }
      }
    });
    out.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : b.amount - a.amount));
    return out;
  }

  /**
   * Mark paychecks in the lowest quartile of left over as tight. A paycheck
   * has to sit clearly below the average too (by $1 or 2% of take-home), so
   * evenly spread paychecks aren't flagged.
   * @template {{ left: number, tight?: boolean }} T
   * @param {T[]} paychecks
   * @param {number} [net]
   * @returns {T[]}
   */
  function flagTight(paychecks, net = 0) {
    for (const p of paychecks) p.tight = false;
    const n = paychecks.length;
    if (n < 2) return paychecks;
    const sorted = paychecks.map((p) => p.left).sort((a, b) => a - b);
    const cutoff = sorted[Math.ceil(n / 4) - 1];
    const avg = mean(sorted);
    const margin = Math.max(1, Math.abs(finite(net)) * 0.02);
    for (const p of paychecks) p.tight = p.left <= cutoff + 1e-9 && p.left < avg - margin;
    return paychecks;
  }

  /**
   * Upcoming paychecks with the bills each one pays.
   * @param {PlanInput} [o]  budget items, read-only budget lines, income ({ payPeriod, nextPayday }),
   *   take-home per paycheck, today (ISO date) and the paychecks to plan (default: about three months)
   * @returns {CalendarPlan}
   */
  function plan(o = {}) {
    const items = Array.isArray(o.items) ? o.items : [];
    const extras = Array.isArray(o.extras) ? o.extras : [];
    const income = o.income || {};
    const payPeriod = isPayPeriod(income.payPeriod) ? income.payPeriod : "biweekly";
    const perYear = PERIODS[payPeriod].perYear;
    const net = finite(o.netPerPaycheck);
    const count = Math.max(1, Math.floor(finite(o.count)) || HORIZON[payPeriod]);
    const today = o.today && Schedule.parse(o.today) ? o.today : Schedule.todayISO();
    const estimated = !Schedule.parse(income.nextPayday);

    const days = Schedule.paydays(estimated ? "" : income.nextPayday, payPeriod, today, count + 1);
    // Without a known payday, weekly/biweekly default to the next Friday; pin that
    // down so other date ranges (the month grid) use the same schedule.
    // (nextPayday parses when not estimated)
    const anchor = !estimated ? /** @type {string} */ (income.nextPayday) : (payPeriod === "weekly" || payPeriod === "biweekly") ? days[0] : "";
    const horizonEnd = Schedule.addDays(days[count], -1);

    /** @type {SpreadLine[]} */
    const spread = [];
    items.forEach((item, index) => {
      const amount = amountOf(item);
      if (!amount || isDated(item)) return;
      const recurrence = PERIODS[item.recurrence] ? item.recurrence : "monthly";
      const annual = amount * PERIODS[recurrence].perYear;
      spread.push({
        kind: "item", index, id: item.id, name: String(item.name || ""), category: item.category,
        recurrence, amount, annual, perPaycheck: annual / perYear, noDueDay: recurrence === "monthly",
      });
    });
    for (const x of extras) {
      const annual = Number(x && x.annual);
      if (!Number.isFinite(annual) || annual <= 0) continue;
      spread.push({
        kind: "extra", id: x.id, source: x.source, name: String(x.name || ""), category: x.category,
        note: x.note, tab: x.tab, annual, perPaycheck: annual / perYear, noDueDay: false,
      });
    }
    const spreadTotal = sum(spread, (s) => s.perPaycheck);

    /** @type {Paycheck[]} */
    const paychecks = days.slice(0, count).map((date, i) => ({
      index: i, date, end: Schedule.addDays(days[i + 1], -1), net,
      bills: [], billsTotal: 0, spreadTotal, total: 0, left: 0, over: false, tight: false,
    }));

    /** @type {BillOccurrence[]} */
    const beforeFirst = [];
    for (const occ of occurrences(items, today, horizonEnd)) {
      if (occ.due < days[0]) { beforeFirst.push(occ); continue; }
      let i = paychecks.length - 1;
      while (i > 0 && paychecks[i].date > occ.due) i--;
      paychecks[i].bills.push(occ);
    }

    for (const p of paychecks) {
      p.billsTotal = sum(p.bills, (b) => b.amount);
      p.total = p.billsTotal + spreadTotal;
      p.left = net - p.total;
      p.over = p.left < -0.005;
    }
    flagTight(paychecks, net);

    let tightest = paychecks[0];
    for (const p of paychecks) if (p.left < tightest.left - 1e-9) tightest = p;

    return {
      today, payPeriod, perYear, net, count, estimated, anchor, horizonEnd,
      paychecks, beforeFirst, spread, spreadTotal,
      undated: spread.filter((s) => s.noDueDay),
      avgLeft: mean(paychecks.map((p) => p.left)),
      tightest,
      daysUntilNext: Schedule.daysBetween(today, days[0]),
    };
  }

  /**
   * Left over per paycheck of plan `p` if item `idx` were due on `day` instead.
   * @param {CalendarPlan} p
   * @param {BudgetItem[]} items
   * @param {number} idx
   * @param {number} day
   */
  function leftsWithMove(p, items, idx, day) {
    const dates = p.paychecks.map((pc) => pc.date);
    const lefts = p.paychecks.map((pc) => pc.left + sum(pc.bills.filter((b) => b.index === idx), (b) => b.amount));
    for (const occ of occurrences([Object.assign({}, items[idx], { dueDay: day })], p.today, p.horizonEnd)) {
      if (occ.due < dates[0]) continue;
      let i = dates.length - 1;
      while (i > 0 && dates[i] > occ.due) i--;
      lefts[i] -= occ.amount;
    }
    return lefts;
  }

  /**
   * When one paycheck is much tighter than the rest, suggest moving one of its
   * dated bills to another due day (1st-28th). Picks the move that evens out a
   * year of paychecks the most (lowest variance), preferring the smallest change
   * of date among near-equal options. The move has to lift the tightest upcoming
   * paycheck noticeably without leaving any shown paycheck worse off than that one
   * is now. Housing is skipped: rent and mortgage dates rarely move.
   * Returns null when nothing helps enough.
   * @param {PlanInput} [o]
   * @param {CalendarPlan} [base]
   * @returns {MoveSuggestion | null}
   */
  function suggestMove(o = {}, base = plan(o)) {
    const ps = base.paychecks;
    if (ps.length < 2) return null;
    const t = base.tightest;
    const ti = ps.indexOf(t);
    const avgOthers = mean(ps.filter((p) => p !== t).map((p) => p.left));
    if (avgOthers - t.left < Math.max(50, Math.abs(base.net) * 0.1)) return null;

    const items = Array.isArray(o.items) ? o.items : [];
    const candidates = [...new Set(t.bills.map((b) => b.index))]
      .filter((i) => items[i] && items[i].category !== "housing");
    if (!candidates.length) return null;

    /** @param {number[]} lefts */
    const variance = (lefts) => {
      const avg = mean(lefts);
      return mean(lefts.map((l) => (l - avg) ** 2));
    };
    const minGain = Math.max(25, Math.abs(base.net) * 0.05);
    const year = plan(Object.assign({}, o, { today: base.today, count: Math.max(12, base.perYear) }));
    const v0 = variance(year.paychecks.map((p) => p.left));

    const options = [];
    for (const idx of candidates) {
      // Candidates come from the tightest paycheck's bills, which are all dated.
      const from = /** @type {number} */ (dueDayOf(items[idx]));
      for (let day = 1; day <= 28; day++) {
        if (day === from) continue;
        const shown = leftsWithMove(base, items, idx, day);
        const gain = shown[ti] - t.left;
        if (gain < minGain || Math.min(...shown) < t.left - 0.005) continue;
        const v = variance(leftsWithMove(year, items, idx, day));
        if (v > v0 * 0.95) continue;
        options.push({ index: idx, fromDay: from, toDay: day, gain, after: shown[ti], v, dist: Math.abs(day - from) });
      }
    }
    if (!options.length) return null;
    const bestV = Math.min(...options.map((x) => x.v));
    const best = options
      .filter((x) => x.v <= bestV * 1.02 + 0.01)
      .sort((a, b) => a.dist - b.dist || a.v - b.v || a.toDay - b.toDay)[0];

    const item = items[best.index];
    return {
      index: best.index, id: item.id, name: String(item.name || ""), amount: amountOf(item),
      fromDay: best.fromDay, toDay: best.toDay, date: t.date, before: t.left, after: best.after, gain: best.gain,
    };
  }

  /**
   * The latest payday on or before `iso`.
   * @param {string | null | undefined} anchor
   * @param {string} payPeriod
   * @param {string} iso
   * @returns {string | null}
   */
  function payingPayday(anchor, payPeriod, iso) {
    const list = Schedule.paydays(anchor, payPeriod, Schedule.addDays(iso, -40), 12);
    /** @type {string | null} */
    let found = null;
    for (const d of list) { if (d > iso) break; found = d; }
    return found;
  }

  /**
   * One calendar month: paydays and dated bills per day.
   * lead = weekday of the 1st (0 = Sunday), for blank cells before it.
   * @param {MonthInput} input
   * @returns {MonthGrid}
   */
  function month({ items, payPeriod, anchor, year, month: m }) {
    const pp = isPayPeriod(payPeriod) ? payPeriod : "biweekly";
    const len = Schedule.daysInMonth(year, m);
    const first = Schedule.onDay(year, m, 1);
    const last = Schedule.onDay(year, m, len);
    const paydays = new Set(Schedule.paydays(anchor || "", pp, first, 6).filter((d) => d <= last));
    /** @type {Map<string, BillOccurrence[]>} */
    const byDay = new Map();
    for (const occ of occurrences(items, first, last)) {
      if (!byDay.has(occ.due)) byDay.set(occ.due, []);
      /** @type {BillOccurrence[]} */ (byDay.get(occ.due)).push(occ);
    }
    const days = [];
    for (let d = 1; d <= len; d++) {
      const iso = Schedule.onDay(year, m, d);
      days.push({ iso, day: d, dow: /** @type {Date} */ (Schedule.parse(iso)).getUTCDay(), payday: paydays.has(iso), bills: byDay.get(iso) || [] });
    }
    return { year, month: m, lead: /** @type {Date} */ (Schedule.parse(first)).getUTCDay(), days };
  }

  /** @type {CalendarApi} */
  const api = { HORIZON, plan, occurrences, flagTight, suggestMove, payingPayday, month, isDated };

  if (isNode) { module.exports = api; return; }
  root.PayCalendar = api;
  if (!root.App || typeof document === "undefined") return;

  // ---------- Browser UI ----------

  const App = root.App;
  const { esc, money, category, ordinal, PERIODS: P } = App.util;

  /** @param {Intl.DateTimeFormatOptions} opts */
  const fmt = (opts) => new Intl.DateTimeFormat("en-US", Object.assign({ timeZone: "UTC" }, opts));
  const F = {
    short: fmt({ weekday: "short", month: "short", day: "numeric" }),
    md: fmt({ month: "short", day: "numeric" }),
    long: fmt({ weekday: "long", month: "long", day: "numeric" }),
    monthYear: fmt({ month: "long", year: "numeric" }),
  };
  /**
   * @param {keyof typeof F} f
   * @param {string} iso  a valid ISO date
   */
  const dt = (f, iso) => F[f].format(/** @type {Date} */ (Schedule.parse(iso)));
  /**
   * @param {number} n
   * @param {string} one
   * @param {string} [many]
   */
  const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  /** @param {number} n */
  const signed = (n) => (n < -0.005 ? `−${money(-n)}` : money(n));
  const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const CHEVRON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
  const PREV = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 6-6 6 6 6"/></svg>';
  const NEXT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>';

  /**
   * @typedef {{ y: number, m: number }} YearMonth  m is 0-11
   * @typedef {object} CalendarModel
   * @property {PlanInput} input
   * @property {CalendarPlan} plan
   * @property {MoveSuggestion | null} suggestion
   * @property {boolean} hasItems
   */

  // UI-only state; not synced.
  /** @type {{ ym: YearMonth | null, day: string | null, open: Set<string>, spreadOpen: boolean, showAll: boolean }} */
  const ui = { ym: null, day: null, open: new Set(), spreadOpen: false, showAll: false };
  const VISIBLE = 6; // paychecks listed before "Show more"
  /** @type {CalendarModel | null} */
  let model = null;
  /** @type {HTMLElement | null} */
  let rootEl = null;

  /** @param {CalendarPlan} p */
  function schedDescription(p) {
    if (p.payPeriod === "weekly") return "every Friday";
    if (p.payPeriod === "biweekly") return "every other Friday";
    if (p.payPeriod === "semimonthly") return "on the 15th and the last business day of the month";
    return "on the last business day of the month";
  }

  /** @param {number} days */
  function whenText(days) {
    return days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
  }

  /** @param {AppContext} ctx */
  function render(ctx) {
    rootEl = rootEl || document.getElementById("calendarRoot");
    if (!rootEl || !ctx) return;
    const s = ctx.state;
    /** @type {PlanInput} */
    const input = {
      items: s.items,
      extras: ctx.extras || [],
      income: s.income,
      netPerPaycheck: ctx.perYear ? ctx.result.net / ctx.perYear : 0,
      today: Schedule.todayISO(),
    };
    const p = plan(input);
    let suggestion = null;
    try { suggestion = suggestMove(input, p); } catch (err) { console.error("[calendar suggestMove]", err); }
    model = { input, plan: p, suggestion, hasItems: s.items.length + (ctx.extras || []).length > 0 };
    paint();
  }

  function paint() {
    if (!rootEl || !model) return;
    const active = document.activeElement;
    const focusKey = active && rootEl.contains(active) ? active.getAttribute("data-focus") : null;
    const spread = /** @type {HTMLDetailsElement | null} */ (rootEl.querySelector("details.cal-spread"));
    if (spread) ui.spreadOpen = spread.open;

    const p = model.plan;
    // Nothing to plan yet: show how to set it up instead of a list of $0.00 paychecks.
    if (p.net <= 0 && !model.hasItems) {
      rootEl.innerHTML = setupHtml();
      if (focusKey) {
        const el = /** @type {HTMLElement | null} */ (rootEl.querySelector(`[data-focus="${CSS.escape(focusKey)}"]`));
        if (el) el.focus({ preventScroll: true });
      }
      return;
    }
    rootEl.innerHTML = `<div class="cal">
      ${summaryHtml(p)}
      <div class="cal-layout">
        ${listHtml(p)}
        ${monthHtml(p)}
      </div>
    </div>`;

    if (focusKey) {
      const el = /** @type {HTMLElement | null} */ (rootEl.querySelector(`[data-focus="${CSS.escape(focusKey)}"]`));
      if (el) el.focus({ preventScroll: true });
    }
  }

  // ----- First-run setup -----

  function setupHtml() {
    return `<section class="card cal-setup" aria-labelledby="calTitle">
      <h2 id="calTitle" class="card-title">Paycheck calendar</h2>
      <p class="cal-sub">See which bills come out of which paycheck, and spot the tight ones before they happen.</p>
      <ol class="steps">
        <li><b>Enter your pay.</b> <button type="button" class="linklike" data-goto="paycheck" data-goto-focus="#salary" data-focus="setup-pay">Go to Paycheck</button></li>
        <li><b>Add your bills with their due days.</b> <button type="button" class="linklike" data-goto="budget" data-goto-focus="#newName" data-focus="setup-bills">Go to Budget</button></li>
        <li><b>Set your next payday</b> so the dates line up. <button type="button" class="linklike" data-goto="paycheck" data-cal-payday data-focus="setup-payday">Set it</button></li>
      </ol>
    </section>`;
  }

  // ----- Summary + hints -----

  /** @param {CalendarPlan} p */
  function summaryHtml(p) {
    const next = p.paychecks[0];
    const t = p.tightest;
    const n = p.paychecks.length;
    const stats = `
      <div class="stat"><div class="k">Next payday</div><div class="v">${esc(dt("short", next.date))}</div>
        <div class="s">${whenText(p.daysUntilNext)}${p.estimated ? " · estimated" : ""}</div></div>
      <div class="stat"><div class="k">Tightest paycheck</div><div class="v ${t.left < -0.005 ? "bad" : ""}">${signed(t.left)}</div>
        <div class="s">${esc(dt("md", t.date))} · ${plural(t.bills.length, "bill")} due</div></div>
      <div class="stat"><div class="k">Average left over</div><div class="v ${p.avgLeft < -0.005 ? "bad" : ""}">${signed(p.avgLeft)}</div>
        <div class="s">across ${plural(n, "paycheck")}</div></div>`;

    return `<section class="card cal-summary" aria-labelledby="calTitle">
      <div class="cal-summary-head">
        <div>
          <h2 id="calTitle" class="card-title">Paycheck calendar</h2>
          <p class="cal-sub">Which bills come out of each of your next ${n} ${esc(P[p.payPeriod].label.toLowerCase())} paychecks.</p>
        </div>
      </div>
      <div class="cal-stats">${stats}</div>
      ${hintsHtml(p)}
    </section>`;
  }

  /** @param {CalendarPlan} p */
  function hintsHtml(p) {
    const hints = [];
    if (p.estimated) {
      hints.push(`<div class="cal-hint accent">
        <p><strong>These dates are estimated.</strong> Without your next payday, we assume you're paid ${schedDescription(p)}.</p>
        <button type="button" class="btn primary" data-goto="paycheck" data-cal-payday data-focus="set-payday">Set next payday</button>
      </div>`);
    }
    if (p.net <= 0) {
      hints.push(`<div class="cal-hint">
        <p>Enter your pay to see what's left from each paycheck.</p>
        <button type="button" class="btn" data-goto="paycheck">Enter pay</button>
      </div>`);
    }
    const sg = /** @type {CalendarModel} */ (model).suggestion; // paint() only runs with a model
    if (sg) {
      hints.push(`<div class="cal-hint">
        <p>Moving <strong>${esc(sg.name)}</strong>'s due date from the ${ordinal(sg.fromDay)} to the ${ordinal(sg.toDay)} would even out your paychecks.
        Your ${esc(dt("md", sg.date))} paycheck would have <strong>${money(sg.gain)}</strong> more left over. Many lenders let you pick a due date.</p>
      </div>`);
    }
    if (p.undated.length) {
      const names = p.undated.map((s) => `<strong>${esc(s.name)}</strong>`);
      const list = names.length > 4 ? `${names.slice(0, 4).join(", ")} and ${names.length - 4} more` : names.join(", ");
      hints.push(`<div class="cal-hint">
        <p>${list} ${p.undated.length === 1 ? "is a monthly bill" : "are monthly bills"} without a due date, so ${p.undated.length === 1 ? "it's" : "they're"} spread across every paycheck. Add due dates to see which paycheck pays ${p.undated.length === 1 ? "it" : "them"}.</p>
        <button type="button" class="btn" data-goto="budget">Add due dates</button>
      </div>`);
    } else if (!/** @type {CalendarModel} */ (model).hasItems) {
      hints.push(`<div class="cal-hint">
        <p>Add your bills with their due dates to see which paycheck pays each one.</p>
        <button type="button" class="btn" data-goto="budget">Add bills</button>
      </div>`);
    }
    return hints.length ? `<div class="cal-hints">${hints.join("")}</div>` : "";
  }

  // ----- Paycheck list -----

  /** @param {CalendarPlan} p */
  function listHtml(p) {
    const limit = ui.showAll || p.paychecks.length <= VISIBLE + 2 ? p.paychecks.length : VISIBLE;
    const shown = p.paychecks.slice(0, limit);
    const hidden = p.paychecks.length - limit;
    const before = p.beforeFirst.length
      ? `<div class="cal-before">
          <span class="section-label">Due before your next payday</span>
          <ul class="cal-bills">${p.beforeFirst.map(billLi).join("")}</ul>
          <p class="cal-note">These come out of your current paycheck: ${money(p.beforeFirst.reduce((s, b) => s + b.amount, 0))} in total.</p>
        </div>`
      : "";

    return `<section class="card cal-list" aria-labelledby="calListTitle">
      <div class="cal-list-head">
        <h2 id="calListTitle" class="card-title">Upcoming paychecks</h2>
        <ul class="legend cal-legend" aria-hidden="true">
          <li><span class="dot cal-sw-b"></span>Bills due</li>
          <li><span class="dot cal-sw-s"></span>Spread</li>
          <li><span class="dot cal-sw-l"></span>Left over</li>
        </ul>
      </div>
      ${spreadHtml(p)}
      ${before}
      <ol class="cal-pcs">${shown.map((pc) => paycheckHtml(pc, p)).join("")}</ol>
      ${hidden ? `<button type="button" class="btn cal-more" data-cal-more data-focus="more">Show ${plural(hidden, "more paycheck")}</button>` : ""}
    </section>`;
  }

  /** @param {BillOccurrence} b */
  function billLi(b) {
    const c = category(b.category);
    return `<li><span class="dot" style="background:${c.color}"></span><span class="cal-bill-name">${esc(b.name)}<span class="cal-bill-due">${esc(dt("md", b.due))}</span></span><span class="cal-amt">${money(b.amount)}</span></li>`;
  }

  /** @param {CalendarPlan} p */
  function spreadHtml(p) {
    if (!p.spread.length) return "";
    const rows = p.spread.slice().sort((a, b) => b.perPaycheck - a.perPaycheck).map((s) => {
      const c = category(s.category);
      const note = s.kind === "extra"
        ? esc(s.note || c.name)
        : `${esc(P[s.recurrence].label)} ${money(s.amount)}${s.noDueDay ? " · no due date" : ""}`;
      return `<li><span class="dot" style="background:${c.color}"></span><span class="cal-bill-name${s.kind === "extra" ? " extra" : ""}">${esc(s.name)}<span class="cal-bill-due">${note}</span></span><span class="cal-amt">${money(s.perPaycheck)}</span></li>`;
    }).join("");
    return `<details class="cal-spread"${ui.spreadOpen ? " open" : ""}>
      <summary><span class="cal-spread-t">Spread across every paycheck <span class="cal-count">${plural(p.spread.length, "item")}</span></span><b class="cal-amt">${money(p.spreadTotal)}</b></summary>
      <ul class="cal-bills">${rows}</ul>
    </details>`;
  }

  /**
   * @param {Paycheck} pc
   * @param {CalendarPlan} p
   */
  function paycheckHtml(pc, p) {
    const open = ui.open.has(pc.date);
    const id = `cal-pc-${pc.date}`;
    const scale = Math.max(pc.net, pc.total, 0.01);
    /** @param {number} v */
    const w = (v) => `${((Math.max(0, v) / scale) * 100).toFixed(2)}%`;
    const tags = [
      pc.index === 0 ? `<span class="cal-tag next">${p.daysUntilNext === 0 ? "Today" : "Next"}</span>` : "",
      pc.over ? '<span class="cal-tag short">Short</span>' : pc.tight ? '<span class="cal-tag tight">Tight</span>' : "",
    ].join("");
    const barLabel = `Bills due ${money(pc.billsTotal)}, spread ${money(pc.spreadTotal)}, ${pc.over ? `short ${money(-pc.left)}` : `left over ${money(pc.left)}`}`;
    const bar = `<span class="bar cal-bar" role="img" aria-label="${barLabel}">
        <span class="cal-sw-b" style="width:${w(pc.billsTotal)}"></span><span class="cal-sw-s" style="width:${w(pc.spreadTotal)}"></span><span class="cal-sw-l" style="width:${w(pc.left)}"></span>
        ${pc.over && pc.net > 0 ? `<i class="cal-mark" style="left:${w(pc.net)}"></i>` : ""}
      </span>`;
    const bills = pc.bills.length
      ? `<ul class="cal-bills">${pc.bills.map(billLi).join("")}</ul>`
      : `<p class="cal-none">No bills due${p.spread.length ? ", only spread items" : ""}.</p>`;

    const diff = pc.left - p.avgLeft;
    const cmp = Math.abs(diff) >= 1 && p.paychecks.length > 1
      ? `<p class="cal-note">${money(Math.abs(diff))} ${diff < 0 ? "less" : "more"} left than your average paycheck.</p>`
      : "";
    const detail = `<div class="cal-pc-detail" id="${id}"${open ? "" : " hidden"}>
      <p class="cal-note">Covers ${esc(dt("short", pc.date))} to ${esc(dt("short", pc.end))}.</p>
      <table class="cal-tbl">
        <tbody>
          <tr><td>Take-home</td><td class="num">${money(pc.net)}</td></tr>
          ${pc.bills.map((b) => `<tr class="minus"><td>${esc(b.name)}<span class="rate">due ${esc(dt("md", b.due))}</span></td><td class="num">−${money(b.amount)}</td></tr>`).join("")}
          ${p.spread.length ? `<tr class="minus"><td>Spread items<span class="rate">${plural(p.spread.length, "item")}</span></td><td class="num">−${money(pc.spreadTotal)}</td></tr>` : ""}
        </tbody>
        <tfoot><tr><td>Left over</td><td class="num ${pc.over ? "bad" : "good"}">${signed(pc.left)}</td></tr></tfoot>
      </table>
      ${cmp}
    </div>`;

    const cls = ["cal-pc", pc.index === 0 && "is-next", pc.tight && "is-tight", pc.over && "is-over", open && "is-open"].filter(Boolean).join(" ");
    return `<li class="${cls}">
      <button type="button" class="cal-pc-head" data-cal-toggle="${pc.date}" data-focus="pc-${pc.date}" aria-expanded="${open}" aria-controls="${id}">
        <span class="cal-pc-when">
          <span class="cal-pc-date">${esc(dt("short", pc.date))}${tags}</span>
          <span class="cal-pc-sub"><span>${money(pc.net)} take-home</span><span>${money(pc.total)} out</span></span>
        </span>
        <span class="cal-pc-left"><span class="k">Left over</span><span class="v ${pc.over ? "bad" : "good"}">${signed(pc.left)}</span></span>
        <span class="cal-chev" aria-hidden="true">${CHEVRON}</span>
        ${bar}
      </button>
      ${bills}
      ${detail}
    </li>`;
  }

  // ----- Month grid -----

  /**
   * @param {string} iso  a valid ISO date
   * @returns {YearMonth}
   */
  const ymOf = (iso) => {
    const d = /** @type {Date} */ (Schedule.parse(iso));
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() };
  };
  /**
   * @param {YearMonth} a
   * @param {YearMonth} b
   */
  const sameYm = (a, b) => a.y === b.y && a.m === b.m;
  // The grid opens on the month of the next payday (the upcoming one matters most).
  /** @param {CalendarPlan} p */
  const defaultYm = (p) => ymOf(p.paychecks[0].date);

  /** @param {CalendarPlan} p */
  function monthHtml(p) {
    const ym = ui.ym || defaultYm(p);
    // paint() only runs with a model
    const mm = month({ items: /** @type {CalendarModel} */ (model).input.items, payPeriod: p.payPeriod, anchor: p.anchor, year: ym.y, month: ym.m });
    const isTodayMonth = sameYm(ym, ymOf(p.today));
    /** @param {string | null} iso */
    const inMonth = (iso) => iso && mm.days.some((d) => d.iso === iso);
    const next = p.paychecks[0].date;
    const selected = inMonth(ui.day) ? ui.day : inMonth(p.today) ? p.today : inMonth(next) ? next : null;

    const blanks = Array.from({ length: mm.lead }, () => '<span class="cal-blank" aria-hidden="true"></span>').join("");
    const cells = mm.days.map((d) => {
      const cls = ["cal-day", d.payday && "is-payday", d.iso === p.today && "is-today", d.iso < p.today && "is-past", d.bills.length && "has-bills"].filter(Boolean).join(" ");
      const label = [
        dt("long", d.iso),
        d.iso === p.today ? "today" : "",
        d.payday ? "payday" : "",
        d.bills.length ? `${d.bills.map((b) => `${b.name} ${money(b.amount)}`).join(", ")} due` : "",
      ].filter(Boolean).join(", ");
      const dots = d.bills.slice(0, 4).map((b) => `<i style="background:${category(b.category).color}"></i>`).join("") +
        (d.bills.length > 4 ? '<i class="more"></i>' : "");
      const labels = (d.payday ? '<span class="cal-lbl pay">Payday</span>' : "") +
        d.bills.slice(0, 2).map((b) => `<span class="cal-lbl" style="border-color:${category(b.category).color}">${esc(b.name)}</span>`).join("") +
        (d.bills.length > 2 ? `<span class="cal-lbl more">+${d.bills.length - 2} more</span>` : "");
      return `<button type="button" class="${cls}" data-cal-day="${d.iso}" data-focus="day-${d.iso}" aria-pressed="${d.iso === selected}" aria-label="${esc(label)}">
        <span class="n">${d.day}</span>
        ${d.bills.length ? `<span class="cal-dots" aria-hidden="true">${dots}</span>` : ""}
        <span class="cal-lbls" aria-hidden="true">${labels}</span>
      </button>`;
    }).join("");

    return `<section class="card cal-month" aria-labelledby="calMonthTitle">
      <div class="cal-month-nav">
        <button type="button" class="icon-btn" data-cal-month="-1" data-focus="prev" aria-label="Previous month" title="Previous month">${PREV}</button>
        <h2 id="calMonthTitle" class="cal-month-title" aria-live="polite">${esc(F.monthYear.format(/** @type {Date} */ (Schedule.parse(Schedule.onDay(ym.y, ym.m, 1)))))}</h2>
        <button type="button" class="icon-btn" data-cal-month="1" data-focus="next" aria-label="Next month" title="Next month">${NEXT}</button>
        ${isTodayMonth ? "" : '<button type="button" class="btn ghost cal-today-btn" data-cal-month="0" data-focus="this-month">Today</button>'}
      </div>
      <div class="cal-grid-wrap">
        <div class="cal-grid">
          ${WEEKDAYS.map((w) => `<span class="cal-wd" aria-hidden="true">${w}</span>`).join("")}
          ${blanks}${cells}
        </div>
      </div>
      <ul class="legend cal-grid-legend" aria-hidden="true">
        <li><span class="cal-key pay"></span>Payday</li>
        <li><span class="cal-key bill"></span>Bill due</li>
        <li><span class="cal-key today"></span>Today</li>
      </ul>
      <div class="cal-daydetail" aria-live="polite">${dayDetailHtml(p, mm, selected)}</div>
    </section>`;
  }

  /**
   * @param {CalendarPlan} p
   * @param {MonthGrid} mm
   * @param {string | null} iso  a day in mm, or null
   */
  function dayDetailHtml(p, mm, iso) {
    if (!iso) return '<p class="cal-note">Tap a day to see what\'s due.</p>';
    const d = /** @type {MonthDay} */ (mm.days.find((x) => x.iso === iso));
    const parts = [`<h3 class="cal-dd-title">${esc(dt("long", iso))}${iso === p.today ? ' <span class="cal-tag">Today</span>' : ""}</h3>`];

    if (d.payday) {
      const pc = p.paychecks.find((x) => x.date === iso);
      parts.push(`<div class="cal-dd-pay">
        <div><strong>Payday</strong> · ${money(p.net)} take-home${pc ? `<span class="cal-note">Pays ${plural(pc.bills.length, "bill")} due by ${esc(dt("md", pc.end))} · ${signed(pc.left)} left over</span>` : ""}</div>
        ${pc ? `<button type="button" class="btn" data-cal-open="${pc.date}">Show paycheck</button>` : ""}
      </div>`);
    }

    if (d.bills.length) {
      const rows = d.bills.map((b) => {
        const c = category(b.category);
        const from = payingPayday(p.anchor, p.payPeriod, b.due);
        const src = from ? (from === b.due ? "from that day's paycheck" : `from your ${dt("md", from)} paycheck`) : "";
        return `<li><span class="dot" style="background:${c.color}"></span><span class="cal-bill-name">${esc(b.name)}<span class="cal-bill-due">${esc(src)}</span></span><span class="cal-amt">${money(b.amount)}</span></li>`;
      }).join("");
      parts.push(`<ul class="cal-bills">${rows}</ul>`);
    } else if (!d.payday) {
      parts.push('<p class="cal-note">Nothing due this day.</p>');
    }
    return parts.join("");
  }

  // ----- Events -----

  function init() {
    rootEl = document.getElementById("calendarRoot");
    if (!rootEl) return;

    rootEl.addEventListener("click", (e) => {
      if (!(e.target instanceof Element)) return;
      const el = /** @type {HTMLElement | null} */ (e.target.closest("[data-cal-toggle], [data-cal-month], [data-cal-day], [data-cal-open], [data-cal-payday], [data-cal-more]"));
      // Every control here is drawn by paint(), so rootEl and model are set.
      if (!el || !rootEl || !rootEl.contains(el) || !model) return;

      if (el.hasAttribute("data-cal-payday")) {
        // App's [data-goto] handler switches tabs; then point at the payday field.
        setTimeout(() => {
          const input = document.getElementById("nextPayday");
          if (input) { input.scrollIntoView({ block: "center" }); input.focus({ preventScroll: true }); }
        }, 0);
        return;
      }

      if (el.hasAttribute("data-cal-more")) {
        ui.showAll = true;
        const next = model.plan.paychecks[VISIBLE];
        paint();
        const head = next && /** @type {HTMLElement | null} */ (rootEl.querySelector(`[data-cal-toggle="${next.date}"]`));
        if (head) head.focus({ preventScroll: true });
        return;
      }

      if (el.dataset.calToggle) {
        const date = el.dataset.calToggle;
        if (ui.open.has(date)) ui.open.delete(date); else ui.open.add(date);
        paint();
        return;
      }

      if (el.dataset.calMonth != null) {
        const step = Number(el.dataset.calMonth);
        const home = defaultYm(model.plan);
        let { y, m } = ui.ym || home;
        if (step === 0) ({ y, m } = ymOf(model.plan.today));
        else { m += step; if (m < 0) { m = 11; y--; } else if (m > 11) { m = 0; y++; } }
        ui.ym = sameYm({ y, m }, home) ? null : { y, m };
        ui.day = null;
        paint();
        return;
      }

      if (el.dataset.calDay) {
        ui.day = el.dataset.calDay;
        paint();
        return;
      }

      if (el.dataset.calOpen) {
        const date = el.dataset.calOpen;
        ui.open.add(date);
        if (model.plan.paychecks.findIndex((pc) => pc.date === date) >= VISIBLE) ui.showAll = true;
        paint();
        const head = /** @type {HTMLElement | null} */ (rootEl.querySelector(`[data-cal-toggle="${CSS.escape(date)}"]`));
        if (head) {
          head.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
          head.focus({ preventScroll: true });
        }
      }
    });
  }

  App.register({ id: "calendar", init, render });
})(typeof window !== "undefined" ? window : globalThis);

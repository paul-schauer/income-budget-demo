/*
 * Salary comparison (Paycheck tab, #compareRoot): your take-home at another salary or hourly
 * rate, with everything else (filing status, state, 401(k) %, benefits, spouse, other income)
 * kept as it is.
 *
 * compareSalary() is exported for tests; compareModule renders the card (main.ts registers it
 * with App). Inputs persist in localStorage (this browser only), not in App state.
 */
import * as Tax from "../tax/tax";
import { App } from "./core";
import type { AppContext, AppModule } from "./types";
import type { CompareInput, CompareNumKey, ComparePrefs, CompareResult } from "./compare.types";

/** A positive number, or 0. */
function num(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Your take-home now and at another gross pay, everything else the same.
 * Amounts are household totals, so a spouse's pay and other income still count toward the brackets.
 */
export function compareSalary(o: CompareInput): CompareResult {
  const input = o.taxInput || {};
  const now = Tax.calculate(input);
  const next = Tax.calculate({ ...input, grossAnnual: num(o.grossAnnual) });
  const change = {
    pay: next.people[0].gross - now.people[0].gross,
    benefits: next.benefits - now.benefits,
    k401: next.k401 - now.k401,
    taxes: next.taxes - now.taxes,
    net: next.net - now.net,
  };
  return {
    now, next, change,
    kept: Math.abs(change.pay) >= 0.005 ? change.net / change.pay : null,
    k401CapReached: next.people[0].k401Capped && !now.people[0].k401Capped,
    creditsLost: now.childCredit - next.childCredit,
  };
}

// ---------- UI ----------

const { money, usd0, pct, esc, parseNum } = App.util;
const STORE_KEY = "incomebudget:compare";
const DEFAULTS: ComparePrefs = { mode: "", salary: "", hourlyRate: "", hours: "", period: "paycheck" };
const NUM_KEYS: CompareNumKey[] = ["salary", "hourlyRate", "hours"];
const PERIOD_KEYS: ComparePrefs["period"][] = ["paycheck", "month", "year"];
const RAISES = [3, 5, 10]; // percent; the "Try a raise" buttons

let prefs = loadPrefs();
let rootEl: HTMLElement | null = null;
let lastCtx: AppContext | null = null;

function loadPrefs(): ComparePrefs {
  const p = Object.assign({}, DEFAULTS);
  try {
    const raw: Record<string, unknown> | null = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
    if (raw && typeof raw === "object") {
      if (raw.mode === "salary" || raw.mode === "hourly") p.mode = raw.mode;
      const period = PERIOD_KEYS.find((k) => k === raw.period);
      if (period) p.period = period;
      for (const k of NUM_KEYS) if (typeof raw[k] === "string" && raw[k].length <= 20) p[k] = raw[k];
    }
  } catch (_) { /* storage unavailable or corrupt */ }
  return p;
}

function savePrefs() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(prefs)); } catch (_) { /* ignore */ }
}

const val = (k: CompareNumKey) => { const n = parseNum(prefs[k]); return Number.isFinite(n) && n > 0 ? n : 0; };
/** "+$1.00", "-$1.00" or "$0.00" */
const signed = (n: number) => `${n >= 0.005 ? "+" : ""}${money(n)}`;
/** Whole dollars without the cents: "$5,000" but "$5,000.50". */
const dollars = (n: number) => (Math.abs(n - Math.round(n)) < 0.005 ? usd0.format(n) : money(n));
/** "a → b", or just "a" when they're the same. */
const arrow = (a: string, b: string) => (a === b ? a : `${a} → ${b}`);

/** The pay type being compared: as chosen, or your own. */
const modeFor = (ctx: AppContext) => prefs.mode || ctx.state.income.mode;

/** Your hours a week, or 40 if you're salaried. */
function ownHours(ctx: AppContext) {
  const inc = ctx.state.income;
  return (inc.mode === "hourly" ? num(inc.hoursPerWeek) : 0) || 40;
}

/** Hours a week for an hourly comparison: as typed, or your own. */
const hoursFor = (ctx: AppContext) => val("hours") || ownHours(ctx);

/** The annual pay being compared, or 0 when none is entered. */
function otherGross(ctx: AppContext) {
  return modeFor(ctx) === "hourly" ? val("hourlyRate") * hoursFor(ctx) * 52 : val("salary");
}

function build() {
  if (!rootEl) return;
  rootEl.innerHTML = `
    <div class="cmp-head">
      <h2 class="card-title">Compare a salary</h2>
      <div class="seg small" role="radiogroup" aria-label="Show amounts per" id="cmpPeriod">
        <button type="button" role="radio" data-cperiod="paycheck">Paycheck</button>
        <button type="button" role="radio" data-cperiod="month">Month</button>
        <button type="button" role="radio" data-cperiod="year">Year</button>
      </div>
    </div>
    <p class="hint cmp-intro">Your take-home at another salary or hourly rate. Everything else stays as you've set it.</p>
    <div class="seg small" role="radiogroup" aria-label="Pay type to compare" id="cmpMode">
      <button type="button" role="radio" data-cmode="salary">Salary</button>
      <button type="button" role="radio" data-cmode="hourly">Hourly</button>
    </div>
    <div class="field" data-cshow="salary">
      <label for="cmpSalary">Other annual salary</label>
      <div class="money"><span>$</span><input id="cmpSalary" data-c="salary" inputmode="decimal" autocomplete="off" placeholder="0"></div>
    </div>
    <div class="row" data-cshow="hourly">
      <div class="field">
        <label for="cmpRate">Other hourly rate</label>
        <div class="money"><span>$</span><input id="cmpRate" data-c="hourlyRate" inputmode="decimal" autocomplete="off" placeholder="0"></div>
      </div>
      <div class="field">
        <label for="cmpHours">Hours / week</label>
        <input id="cmpHours" data-c="hours" inputmode="decimal" autocomplete="off">
      </div>
    </div>
    <div class="cmp-try" role="group" aria-label="Try a raise">
      <span class="label">Try a raise</span>
      ${RAISES.map((r) => `<button type="button" data-raise="${r}">+${r}%</button>`).join("")}
    </div>
    <p class="hint" id="cmpHint"></p>
    <div id="cmpOut"></div>`;
  for (const k of NUM_KEYS) {
    const el: HTMLInputElement | null = rootEl.querySelector(`[data-c="${k}"]`);
    if (el) el.value = prefs[k];
  }

  rootEl.addEventListener("input", (e) => {
    if (!(e.target instanceof Element)) return;
    const el: HTMLInputElement | null = e.target.closest("input[data-c]");
    if (!el) return;
    const raw = el.value.trim();
    const n = parseNum(raw);
    const bad = raw !== "" && (!Number.isFinite(n) || n < 0 || (el.dataset.c === "hours" && n > 168));
    el.classList.toggle("invalid", bad);
    if (bad) return;
    prefs[el.dataset.c as CompareNumKey] = raw.slice(0, 20);
    savePrefs();
    update();
  });
  rootEl.addEventListener("click", (e) => {
    if (!(e.target instanceof Element) || !lastCtx) return;
    const b: HTMLButtonElement | null = e.target.closest("button");
    if (!b) return;
    if (b.dataset.cperiod) prefs.period = b.dataset.cperiod as ComparePrefs["period"];
    else if (b.dataset.cmode) prefs.mode = b.dataset.cmode as ComparePrefs["mode"];
    else if (b.dataset.raise) fillRaise(lastCtx, Number(b.dataset.raise));
    else return;
    savePrefs();
    update();
  });
}

/** Fills in your current pay plus `percent`, as a salary or an hourly rate. */
function fillRaise(ctx: AppContext, percent: number) {
  const target = ctx.result.people[0].gross * (1 + percent / 100);
  const hourly = modeFor(ctx) === "hourly";
  const key: CompareNumKey = hourly ? "hourlyRate" : "salary";
  prefs[key] = hourly ? (target / 52 / hoursFor(ctx)).toFixed(2) : String(Math.round(target));
  const el: HTMLInputElement | null = rootEl && rootEl.querySelector(`[data-c="${key}"]`);
  if (el) { el.value = prefs[key]; el.classList.remove("invalid"); }
}

function renderHint(ctx: AppContext, gross: number) {
  if (!rootEl) return;
  const now = ctx.result.people[0].gross;
  const hourly = modeFor(ctx) === "hourly";
  const hint = rootEl.querySelector("#cmpHint") as HTMLElement;
  if (!gross) { hint.textContent = `You make ${usd0.format(now)} a year now.`; return; }
  const diff = gross - now;
  const lead = hourly ? `${money(val("hourlyRate"))}/hr × ${+hoursFor(ctx).toFixed(2)} hours a week is ${usd0.format(gross)} a year: ` : "That's ";
  hint.textContent = Math.abs(diff) < 0.5
    ? `${lead}the same as you make now.`
    : `${lead}${usd0.format(Math.abs(diff))} (${pct(Math.abs(diff) / now)}) ${diff > 0 ? "more" : "less"} than you make now.`;
}

/** The "you keep" sentence under the table. */
function keptNote(c: CompareResult, perYear: number, showPerCheck: boolean) {
  const { change, kept } = c;
  if (kept === null) return `<p class="cmp-note">That's the same as your pay now.</p>`;
  const perCheck = Math.abs(change.net / perYear);
  if (change.pay > 0) {
    const k401 = change.k401 >= 0.005 ? ` and ${money(change.k401)} more goes to your 401(k)` : "";
    return `<p class="cmp-note">You'd keep <b>${money(change.net)}</b> of the extra ${dollars(change.pay)} a year (${pct(kept, 0)}). Taxes take ${money(change.taxes)}${k401}.${showPerCheck ? ` That's <b>${money(perCheck)}</b> more a paycheck.` : ""}</p>`;
  }
  const k401 = change.k401 <= -0.005 ? ` and ${money(-change.k401)} less goes to your 401(k)` : "";
  return `<p class="cmp-note">You'd take home <b>${money(-change.net)}</b> less on ${dollars(-change.pay)} less pay a year. Taxes drop by ${money(-change.taxes)}${k401}.${showPerCheck ? ` That's <b>${money(perCheck)}</b> less a paycheck.` : ""}</p>`;
}

function renderOut(ctx: AppContext, out: HTMLElement) {
  const gross = otherGross(ctx);
  renderHint(ctx, gross);
  if (!gross) { out.innerHTML = `<p class="cmp-note">Enter a salary to see what you'd take home.</p>`; return; }

  const c = compareSalary({ taxInput: ctx.taxInput, grossAnnual: gross });
  const { now, next } = c;
  const household = now.people.length > 1 || now.extras.gross > 0;
  // A household's totals aren't one paycheck, so it shows months instead (as the results card does).
  const period = household && prefs.period === "paycheck" ? "month" : prefs.period;
  const per = period === "paycheck" ? ctx.perYear : period === "month" ? 12 : 1;
  const p = (annual: number) => money(annual / per);
  const noun = period === "paycheck" ? "paycheck" : period;

  type Row = [label: string, now: number, next: number, minus: boolean];
  const rows: Row[] = [[household ? "Your pay" : "Gross pay", now.people[0].gross, next.people[0].gross, false]];
  const others = now.gross - now.people[0].gross;
  if (others > 0.005) {
    const label = now.people.length < 2 ? "Other income" : now.extras.gross > 0 ? "Spouse's pay & other income" : "Spouse's pay";
    rows.push([label, others, next.gross - next.people[0].gross, false]);
  }
  if (now.benefits > 0 || next.benefits > 0) rows.push(["Pre-tax benefits", -now.benefits, -next.benefits, true]);
  if (now.k401 > 0 || next.k401 > 0) rows.push([now.people.length < 2 && now.isRoth ? "Roth 401(k)" : "401(k)", -now.k401, -next.k401, true]);
  rows.push(["Federal income tax", -now.federal, -next.federal, true]);
  if (now.extraWithholding > 0) rows.push(["Extra federal withholding", -now.extraWithholding, -next.extraWithholding, true]);
  rows.push(["Social Security", -now.socialSecurity, -next.socialSecurity, true]);
  rows.push(["Medicare", -now.medicare, -next.medicare, true]);
  if (now.seTax > 0 || next.seTax > 0) rows.push(["Self-employment tax", -now.seTax, -next.seTax, true]);
  if (now.state.code) rows.push([`${esc(now.state.name)} income tax`, -now.stateTax, -next.stateTax, true]);
  if (now.local.id !== "none") rows.push([`${esc(now.local.name || "Local")} tax`, -now.localTax, -next.localTax, true]);
  // State payroll deductions (SDI, paid leave, ...), matched by id.
  const payroll: Map<string, { name: string; now: number; next: number }> = new Map();
  for (const x of now.payrollItems) payroll.set(x.id, { name: x.name, now: x.amount, next: 0 });
  for (const x of next.payrollItems) {
    const found = payroll.get(x.id);
    if (found) found.next = x.amount;
    else payroll.set(x.id, { name: x.name, now: 0, next: x.amount });
  }
  for (const x of payroll.values()) if (x.now > 0.005 || x.next > 0.005) rows.push([esc(x.name), -x.now, -x.next, true]);

  const tr = ([label, a, b, minus]: Row) =>
    `<tr class="${minus ? "minus" : ""}"><td>${label}</td><td class="num">${p(a)}</td><td class="num">${p(b)}</td><td class="num">${signed((b - a) / per)}</td></tr>`;
  const at = modeFor(ctx) === "hourly" ? `${money(val("hourlyRate"))}/hr` : usd0.format(gross);
  const diff = c.change.net;

  const budget = ctx.budgetAnnual;
  const left = (net: number) => { const v = (net - budget) / per; return `<span class="${v < 0 ? "bad" : ""}">${money(v)}</span>`; };
  const notes = [
    keptNote(c, ctx.perYear, period !== "paycheck"),
    `<div class="cmp-line"><span>Effective tax rate</span><b>${arrow(pct(now.effectiveRate), pct(next.effectiveRate))}</b></div>`,
    `<div class="cmp-line"><span>Federal bracket</span><b>${arrow(pct(now.federalMarginal, 0), pct(next.federalMarginal, 0))}</b></div>`,
    budget > 0 && `<div class="cmp-line"><span>Left over after budget / ${noun}</span><b>${left(now.net)} → ${left(next.net)}</b></div>`,
    c.k401CapReached && `<p class="cmp-note">Your 401(k) would reach the ${usd0.format(next.people[0].k401Limit)} limit at this pay.</p>`,
    c.change.pay > 0 && c.creditsLost >= 0.5 && `<p class="cmp-note">Child and dependent credits shrink by ${money(c.creditsLost)} a year at this income.</p>`,
  ].filter(Boolean).join("");

  out.innerHTML = `
    <div class="stats cmp-stats">
      <div class="stat"><div class="k">Take-home now</div><div class="v">${p(now.net)}</div></div>
      <div class="stat"><div class="k">At ${esc(at)}</div><div class="v">${p(next.net)}</div></div>
      <div class="stat"><div class="k">Difference / ${noun}</div><div class="v ${diff >= 0.005 ? "good" : diff <= -0.005 ? "bad" : ""}">${signed(diff / per)}</div></div>
    </div>
    <table class="breakdown cmp-table">
      <thead><tr><th scope="col">Per ${noun}</th><th scope="col" class="num">Now</th><th scope="col" class="num">New</th><th scope="col" class="num">Change</th></tr></thead>
      <tbody>${rows.map(tr).join("")}</tbody>
      <tfoot><tr><td>Take-home pay</td><td class="num">${p(now.net)}</td><td class="num">${p(next.net)}</td><td class="num">${signed(diff / per)}</td></tr></tfoot>
    </table>
    <div class="cmp-box">${notes}</div>
    <p class="fine">Keeps your filing status, pay frequency, ${now.state.name ? `${esc(now.state.name)} ` : ""}state and local tax, 401(k) %, benefits, dependents and W-4 extras${household ? ", spouse's pay and other income" : ""} as they are. Estimate only, not tax advice.</p>`;
}

function update() {
  if (!rootEl || !lastCtx) return;
  const ctx = lastCtx;
  const household = ctx.result.people.length > 1 || ctx.result.extras.gross > 0;
  const period = household && prefs.period === "paycheck" ? "month" : prefs.period;
  const mode = modeFor(ctx);
  for (const b of rootEl.querySelectorAll("#cmpPeriod button") as NodeListOf<HTMLButtonElement>) {
    b.setAttribute("aria-checked", String(b.dataset.cperiod === period));
    b.hidden = household && b.dataset.cperiod === "paycheck";
  }
  for (const b of rootEl.querySelectorAll("#cmpMode button") as NodeListOf<HTMLButtonElement>) b.setAttribute("aria-checked", String(b.dataset.cmode === mode));
  for (const el of rootEl.querySelectorAll("[data-cshow]") as NodeListOf<HTMLElement>) el.hidden = el.dataset.cshow !== mode;
  (rootEl.querySelector("#cmpHours") as HTMLInputElement).placeholder = String(+ownHours(ctx).toFixed(2));
  renderOut(ctx, rootEl.querySelector("#cmpOut") as HTMLElement);
}

function init() {
  rootEl = document.getElementById("compareRoot");
  if (rootEl) build();
}

function render(ctx: AppContext) {
  lastCtx = ctx;
  if (!rootEl) init();
  if (!rootEl) return;
  // Nothing to compare with until your own pay is entered.
  rootEl.hidden = ctx.result.people[0].gross <= 0;
  if (!rootEl.hidden) update();
}

export const compareModule: AppModule = { id: "compare", init, render };

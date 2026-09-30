/*
 * Bonus & overtime estimator (Paycheck tab, #bonusRoot).
 *
 * Pure estimate functions are exported for Node tests; in the browser the module
 * registers with App and renders a compact card. Inputs persist in localStorage
 * (this browser only), not in App state.
 */
(function (root) {
  "use strict";

  const isNode = typeof module !== "undefined" && module.exports;
  const Tax = isNode ? require("./tax.js") : root.Tax;

  function num(v) {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  /**
   * What a bonus paid as a separate supplemental-wage check looks like.
   * @param {object} o
   * @param {object} o.taxInput     Tax.calculate input for regular pay (annual)
   * @param {number} o.amount       gross bonus
   * @param {boolean} [o.apply401k] plan takes the 401(k) % from bonuses (default true)
   * @param {number} [o.ytdWages]   Social Security / Medicare wages already paid this year
   * @param {number} [o.priorSupplemental] supplemental wages already paid this year (for the $1M tier)
   */
  function bonusEstimate(o) {
    const input = o.taxInput || {};
    const amount = num(o.amount);
    const ytd = num(o.ytdWages);
    const base = Tax.calculate(input);
    const isRoth = input.k401Type === "roth";

    const pct = Math.min(num(input.k401Percent), 100) / 100;
    const room = Math.max(0, base.k401Limit - base.k401);
    const k401 = o.apply401k === false ? 0 : Math.min(amount * pct, room);
    const incomeWages = amount - (isRoth ? 0 : k401);

    // Withholding on the bonus check.
    const federal = Tax.supplementalFederalWithholding(incomeWages, o.priorSupplemental);
    const ssRoom = Math.max(0, Tax.FICA.socialSecurityWageBase - ytd);
    const socialSecurity = Math.min(amount, ssRoom) * Tax.FICA.socialSecurityRate;
    const addl = Tax.FICA.additionalMedicareWithholdingThreshold;
    const additionalMedicare = (Math.max(0, ytd + amount - addl) - Math.max(0, ytd - addl)) * Tax.FICA.additionalMedicareRate;
    const medicare = amount * Tax.FICA.medicareRate + additionalMedicare;
    const michigan = incomeWages * Tax.MICHIGAN.supplementalRate;
    const city = amount * base.cityRate; // 401(k) deferrals are city-taxable
    const withheld = federal + socialSecurity + medicare + michigan + city;
    const net = amount - k401 - withheld;

    // Year end, marginal method: the return with the bonus minus the return without it.
    const after = Tax.calculate(Object.assign({}, input, { grossAnnual: base.gross + amount, k401Annual: base.k401 + k401 }));
    const actual = {
      federal: after.federal - base.federal,
      michigan: after.michigan - base.michigan,
      city: after.city - base.city,
      socialSecurity: after.socialSecurity - base.socialSecurity,
      medicare: after.medicare - base.medicare,
    };
    // Settled on the return: income taxes plus the 0.9% Medicare surtax. Payroll caps Social Security itself.
    const yearEndWithheld = federal + michigan + city + additionalMedicare;
    const yearEndActual = actual.federal + actual.michigan + actual.city + (actual.medicare - amount * Tax.FICA.medicareRate);

    return {
      amount, k401, isRoth, incomeWages,
      federal, socialSecurity, medicare, michigan, city, cityRate: base.cityRate,
      federalRate: incomeWages > 0 ? federal / incomeWages : Tax.FEDERAL.supplementalRate,
      withheld, net,
      actual,
      yearEnd: { withheld: yearEndWithheld, actual: yearEndActual, balance: yearEndWithheld - yearEndActual },
    };
  }

  /** Hourly rate from the income settings; salary is converted at 2,080 hours a year (an estimate). */
  function hourlyRateFor(income) {
    const inc = income || {};
    if (inc.mode === "hourly") return { rate: num(inc.hourlyRate), estimated: false };
    return { rate: num(inc.salary) / 2080, estimated: true };
  }

  /**
   * Overtime at time-and-a-half, per paycheck and per year, plus the 2026 overtime deduction.
   * @param {object} o
   * @param {object} o.taxInput
   * @param {number} o.perYear            paychecks per year
   * @param {number} o.hourlyRate
   * @param {number} o.hoursPerPaycheck
   * @param {number} [o.multiplier=1.5]
   */
  function overtimeEstimate(o) {
    const input = o.taxInput || {};
    const perYear = num(o.perYear) || 26;
    const rate = num(o.hourlyRate);
    const hours = num(o.hoursPerPaycheck);
    const mult = num(o.multiplier) || 1.5;
    const status = Tax.FEDERAL.standardDeduction[input.filingStatus] != null ? input.filingStatus : "single";

    const payPerCheck = hours * rate * mult;
    const payAnnual = payPerCheck * perYear;
    const premiumAnnual = hours * rate * Math.max(0, mult - 1) * perYear;

    const base = Tax.calculate(input);
    const withOt = Tax.calculate(Object.assign({}, input, { grossAnnual: base.gross + payAnnual }));
    const withDeduction = Tax.calculate(Object.assign({}, input, { grossAnnual: base.gross + payAnnual, overtimePremium: premiumAnnual }));

    const keys = ["k401", "federal", "socialSecurity", "medicare", "michigan", "city"];
    const annual = {};
    for (const k of keys) annual[k] = withOt[k] - base[k];
    annual.takeHome = (withOt.net + withOt.extraWithholding) - (base.net + base.extraWithholding);
    const perCheck = {};
    for (const k of Object.keys(annual)) perCheck[k] = annual[k] / perYear;

    const cap = Tax.FEDERAL.overtime.cap[status];
    const deduction = withDeduction.overtimeDeduction;
    const capped = Math.min(premiumAnnual, cap);
    const limitedBy = status === "mfs" ? "mfs" : deduction < capped - 0.005 ? "phaseout" : premiumAnnual > cap ? "cap" : null;
    const federalSaving = withOt.federal - withDeduction.federal;
    const michiganSaving = withOt.michigan - withDeduction.michigan;

    return {
      hourlyRate: rate, overtimeRate: rate * mult, hours, perYear,
      payPerCheck, payAnnual, premiumAnnual,
      annual, perCheck,
      eligible: status !== "mfs",
      cap, deduction, limitedBy,
      federalSaving, michiganSaving, refund: federalSaving + michiganSaving,
    };
  }

  /** Rough year-to-date wages from the date: annual wages x share of the year elapsed. */
  function ytdEstimate(annualWages, date) {
    const d = date instanceof Date ? date : new Date();
    const y = d.getFullYear();
    const dayIndex = Math.round((Date.UTC(y, d.getMonth(), d.getDate()) - Date.UTC(y, 0, 1)) / 86400000);
    const days = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 366 : 365;
    return num(annualWages) * Math.min(1, Math.max(0, dayIndex / days));
  }

  const api = { bonusEstimate, overtimeEstimate, hourlyRateFor, ytdEstimate };
  if (isNode) { module.exports = api; return; }
  root.Bonus = api;
  if (!root.App || typeof document === "undefined") return;

  // ---------- UI ----------

  const App = root.App;
  const { money, usd0, esc, parseNum } = App.util;
  const STORE_KEY = "incomebudget:bonus";
  const DEFAULTS = { mode: "bonus", amount: "", ytd: "", apply401k: true, otHours: "" };
  const NUM_KEYS = ["amount", "ytd", "otHours"];

  let prefs = loadPrefs();
  let rootEl = null;
  let lastCtx = null;

  function loadPrefs() {
    const p = Object.assign({}, DEFAULTS);
    try {
      const raw = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
      if (raw && typeof raw === "object") {
        if (raw.mode === "bonus" || raw.mode === "overtime") p.mode = raw.mode;
        if (typeof raw.apply401k === "boolean") p.apply401k = raw.apply401k;
        for (const k of NUM_KEYS) if (typeof raw[k] === "string" && raw[k].length <= 20) p[k] = raw[k];
      }
    } catch (_) { /* storage unavailable or corrupt */ }
    return p;
  }

  function savePrefs() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(prefs)); } catch (_) { /* ignore */ }
  }

  const val = (k) => { const n = parseNum(prefs[k]); return Number.isFinite(n) && n > 0 ? n : 0; };
  const pctLabel = (r) => `${+(r * 100).toFixed(2)}%`;

  function build() {
    rootEl.innerHTML = `
      <div class="bonus-head">
        <h2 class="card-title">Bonus &amp; overtime</h2>
        <div class="seg small" role="radiogroup" aria-label="Estimate" id="bonusSeg">
          <button type="button" role="radio" data-bmode="bonus">Bonus</button>
          <button type="button" role="radio" data-bmode="overtime">Overtime</button>
        </div>
      </div>
      <div data-bpanel="bonus">
        <div class="row">
          <div class="field">
            <label for="bonusAmount">Bonus amount</label>
            <div class="money"><span>$</span><input id="bonusAmount" data-b="amount" inputmode="decimal" autocomplete="off" placeholder="0"></div>
          </div>
          <div class="field">
            <label for="bonusYtd">Paid so far this year</label>
            <div class="money"><span>$</span><input id="bonusYtd" data-b="ytd" inputmode="decimal" autocomplete="off"></div>
          </div>
        </div>
        <p class="hint" id="bonusYtdHint"></p>
        <label class="bonus-check"><input type="checkbox" id="bonus401k" data-b="apply401k"> My 401(k) % also comes out of bonuses</label>
      </div>
      <div data-bpanel="overtime">
        <div class="row">
          <div class="field">
            <label for="otHours">Hours per paycheck</label>
            <input id="otHours" data-b="otHours" inputmode="decimal" autocomplete="off" placeholder="0">
          </div>
          <div class="field">
            <span class="label" id="otRateLabel">Overtime rate</span>
            <div class="bonus-rate" id="otRate" aria-labelledby="otRateLabel"></div>
          </div>
        </div>
        <p class="hint" id="otHint"></p>
      </div>
      <div id="bonusOut"></div>`;
    for (const k of NUM_KEYS) {
      const el = rootEl.querySelector(`[data-b="${k}"]`);
      if (el) el.value = prefs[k];
    }
    rootEl.querySelector("#bonus401k").checked = prefs.apply401k;

    rootEl.addEventListener("input", (e) => {
      const el = e.target.closest("input[data-b]");
      if (!el || el.type === "checkbox") return;
      const raw = el.value.trim();
      const n = parseNum(raw);
      const bad = raw !== "" && (!Number.isFinite(n) || n < 0 || (el.dataset.b === "otHours" && n > 200));
      el.classList.toggle("invalid", bad);
      if (bad) return;
      prefs[el.dataset.b] = raw.slice(0, 20);
      savePrefs();
      update();
    });
    rootEl.addEventListener("change", (e) => {
      if (e.target.id !== "bonus401k") return;
      prefs.apply401k = e.target.checked;
      savePrefs();
      update();
    });
    rootEl.querySelector("#bonusSeg").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-bmode]");
      if (!b) return;
      prefs.mode = b.dataset.bmode;
      savePrefs();
      update();
    });
  }

  const row = (label, v, { minus = false, note = "", cols = 1, perYear = 1 } = {}) => {
    const cells = cols === 2
      ? `<td class="num">${money(v / perYear)}</td><td class="num">${money(v)}</td>`
      : `<td class="num">${money(v)}</td>`;
    return `<tr class="${minus ? "minus" : ""}"><td>${label}${note ? `<span class="rate">${note}</span>` : ""}</td>${cells}</tr>`;
  };

  function verdict(balance, what) {
    if (Math.abs(balance) < 1) return `<p class="bonus-note">Withholding on ${what} is about right; expect little change at tax time.</p>`;
    return balance > 0
      ? `<p class="bonus-note good">Likely about <b>${money(balance)}</b> back at tax time: more was withheld than ${what} really costs.</p>`
      : `<p class="bonus-note bad">Likely about <b>${money(-balance)}</b> owed at tax time: ${what} is taxed above the withholding rate.</p>`;
  }

  function renderBonus(ctx, out) {
    const income = ctx.state.income;
    const ficaAnnual = ctx.result.gross - ctx.result.benefits;
    const ytdTyped = String(prefs.ytd).trim() !== "";
    const ytd = ytdTyped ? val("ytd") : ytdEstimate(ficaAnnual);
    const ytdInput = rootEl.querySelector("#bonusYtd");
    ytdInput.placeholder = Math.round(ytd).toLocaleString("en-US");
    rootEl.querySelector("#bonusYtdHint").textContent = ytdTyped
      ? `Used for the ${usd0.format(Tax.FICA.socialSecurityWageBase)} Social Security wage cap.`
      : `Blank = about ${usd0.format(ytd)}, estimated from today's date. Used for the Social Security wage cap.`;

    const amount = val("amount");
    if (!amount) { out.innerHTML = `<p class="bonus-note">Enter a bonus to see what lands in your account.</p>`; return; }

    const b = bonusEstimate({ taxInput: ctx.taxInput, amount, apply401k: prefs.apply401k, ytdWages: ytd });
    const city = Tax.findCity(income.cityId);
    const fedNote = b.federalRate > Tax.FEDERAL.supplementalRate + 0.0001 ? "22% / 37% over $1M" : "22% flat";
    const rows = [
      row("Bonus", b.amount),
      b.k401 > 0 && row(b.isRoth ? "Roth 401(k)" : "401(k)", -b.k401, { minus: true, note: `${+Number(income.k401Percent).toFixed(2)}%` }),
      row("Federal withholding", -b.federal, { minus: true, note: fedNote }),
      row("Social Security", -b.socialSecurity, { minus: true, note: b.socialSecurity < b.amount * Tax.FICA.socialSecurityRate - 0.005 ? "wage cap" : "6.2%" }),
      row("Medicare", -b.medicare, { minus: true, note: b.medicare > b.amount * Tax.FICA.medicareRate + 0.005 ? "incl. 0.9%" : "1.45%" }),
      row("Michigan", -b.michigan, { minus: true, note: pctLabel(Tax.MICHIGAN.supplementalRate) }),
      city.id !== "none" && row(`${esc(city.name)} city tax`, -b.city, { minus: true, note: pctLabel(b.cityRate) }),
    ].filter(Boolean).join("");

    out.innerHTML = `
      <table class="breakdown bonus-table">
        <thead><tr><th scope="col">On the bonus check</th><th scope="col" class="num">Amount</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td>Net bonus</td><td class="num">${money(b.net)}</td></tr></tfoot>
      </table>
      <div class="bonus-yearend">
        <div class="bonus-line"><span>Income tax withheld on it</span><b>${money(b.yearEnd.withheld)}</b></div>
        <div class="bonus-line"><span>Actual tax on it at year end</span><b>${money(b.yearEnd.actual)}</b></div>
        ${verdict(b.yearEnd.balance, "the bonus")}
      </div>
      <p class="fine">Assumes the bonus is paid on its own check with the IRS 22% flat rate (37% past $1M) and Michigan's flat 4.25%. Year end compares that with your ${Math.round(ctx.result.federalMarginal * 100)}% federal bracket plus state and city tax.</p>`;
  }

  function renderOvertime(ctx, out) {
    const income = ctx.state.income;
    const hr = hourlyRateFor(income);
    rootEl.querySelector("#otRate").innerHTML = hr.rate > 0
      ? `${money(hr.rate * 1.5)}<small>/hr${hr.estimated ? " est." : ""}</small>`
      : "—";
    rootEl.querySelector("#otHint").textContent = hr.estimated
      ? `1.5 × ${money(hr.rate)}/hr, estimated as salary ÷ 2,080 hours. Salaried (exempt) jobs often don't pay overtime.`
      : `1.5 × your ${money(hr.rate)} hourly rate.`;

    const hours = val("otHours");
    if (!hr.rate) { out.innerHTML = `<p class="bonus-note">Enter your pay above to estimate overtime.</p>`; return; }
    if (!hours) { out.innerHTML = `<p class="bonus-note">Enter overtime hours to see the extra take-home.</p>`; return; }

    const o = overtimeEstimate({ taxInput: ctx.taxInput, perYear: ctx.perYear, hourlyRate: hr.rate, hoursPerPaycheck: hours });
    const city = Tax.findCity(income.cityId);
    const opt = (minus, note) => ({ minus, note, cols: 2, perYear: o.perYear });
    const a = o.annual;
    const rows = [
      row("Overtime pay", o.payAnnual, opt(false)),
      a.k401 > 0.005 && row(ctx.result.isRoth ? "Roth 401(k)" : "401(k)", -a.k401, opt(true)),
      row("Federal", -a.federal, opt(true)),
      row("Social Security", -a.socialSecurity, opt(true)),
      row("Medicare", -a.medicare, opt(true)),
      row("Michigan", -a.michigan, opt(true)),
      city.id !== "none" && row(`${esc(city.name)} city tax`, -a.city, opt(true)),
    ].filter(Boolean).join("");

    let deduction;
    if (!o.eligible) {
      deduction = `<p class="bonus-note">Married filing separately can't take the ${Tax.TAX_YEAR} overtime deduction; file jointly to claim it.</p>`;
    } else {
      const limit = o.limitedBy === "cap" ? `capped at ${usd0.format(o.cap)}`
        : o.limitedBy === "phaseout" ? "reduced by the income phase-out" : "";
      deduction = `
        <div class="bonus-line"><span>Extra-half premium / yr</span><b>${money(o.premiumAnnual)}</b></div>
        <div class="bonus-line"><span>Overtime deduction${limit ? ` <span class="rate">${limit}</span>` : ""}</span><b>${money(o.deduction)}</b></div>
        ${o.refund >= 0.5
          ? `<p class="bonus-note good">No tax on overtime: about <b>${money(o.refund)}</b> more back at tax time (${money(o.federalSaving)} federal + ${money(o.michiganSaving)} Michigan).</p>`
          : `<p class="bonus-note">The overtime deduction doesn't lower your tax at this income.</p>`}`;
    }

    out.innerHTML = `
      <table class="breakdown bonus-table">
        <thead><tr><th scope="col">Overtime</th><th scope="col" class="num">Per paycheck</th><th scope="col" class="num">Annual</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td>Extra take-home</td><td class="num">${money(o.perCheck.takeHome)}</td><td class="num">${money(a.takeHome)}</td></tr></tfoot>
      </table>
      <div class="bonus-yearend">${deduction}</div>
      <p class="fine">Paychecks don't reflect the overtime deduction unless you add it on W-4 step 4(b); it comes back as a refund. Only FLSA-required overtime counts, and it doesn't lower Social Security, Medicare or city tax.</p>`;
  }

  function update() {
    if (!rootEl || !lastCtx) return;
    for (const b of rootEl.querySelectorAll("#bonusSeg button")) b.setAttribute("aria-checked", String(b.dataset.bmode === prefs.mode));
    for (const p of rootEl.querySelectorAll("[data-bpanel]")) p.hidden = p.dataset.bpanel !== prefs.mode;
    const out = rootEl.querySelector("#bonusOut");
    if (prefs.mode === "overtime") renderOvertime(lastCtx, out);
    else renderBonus(lastCtx, out);
  }

  function init() {
    rootEl = document.getElementById("bonusRoot");
    if (rootEl) build();
  }

  function render(ctx) {
    lastCtx = ctx;
    if (!rootEl) init();
    update();
  }

  App.register({ id: "bonus", init, render });
})(typeof window !== "undefined" ? window : globalThis);

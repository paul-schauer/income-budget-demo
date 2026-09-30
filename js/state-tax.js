/*
 * State (and local) income tax engine for tax year 2026.
 *
 * The engine is generic; each state is a plain data entry registered from a file
 * in js/states/. The shape of an entry is documented in STATE_SCHEMA below and
 * enforced by validate(), which every state's tests run.
 *
 * Works in the browser (window.StateTax) and in Node (module.exports).
 * Estimates only, not tax advice.
 */
(function (root) {
  "use strict";

  const STATUSES = ["single", "mfj", "mfs", "hoh"];

  /*
   * STATE_SCHEMA (one entry per state, keyed by its 2-letter code):
   *
   * {
   *   code: "MI", name: "Michigan", year: 2026,
   *   kind: "none" | "flat" | "graduated",
   *   rate: 0.0425,                              // kind "flat"
   *   brackets: { single, mfj, mfs, hoh },       // kind "graduated": [[upperBound, rate], ..., [Infinity, rate]]
   *                                              //   on state taxable income; copy single where a status has no own table
   *   startsFrom: "agi" | "federalTaxable",      // default "agi" (federal AGI); "federalTaxable" for states that
   *                                              //   start from federal taxable income (federal std deduction applies)
   *   standardDeduction: { single, mfj, mfs, hoh } | "federal" | 0,
   *   personalExemption: { filer, dependent },   // deduction from income per filer (2 when married filing jointly) and per dependent
   *   exemptionCredit: { filer, dependent },     // credit against tax per filer / dependent (e.g. California)
   *   taxes401k: false,                          // true if traditional 401(k) deferrals stay taxable (Pennsylvania)
   *   overtimeDeduction: false,                  // true if the state allows the 2026 federal overtime deduction
   *   supplementalRate: 0.0425,                  // withholding rate on bonuses, if the state sets one
   *   payroll: [{ id, name, rate, wageCap, maxAnnual }],   // employee-paid payroll deductions (SDI, PFML, ...)
   *   locals: [{ id, name, type, ... }],         // local income taxes, see computeLocal()
   *   compute(ctx, generic) { return { taxable, tax } },   // optional override for rules the fields can't express
   *   notes: ["..."],                            // short user-facing notes
   *   unverified: true,                          // figures not yet checked against 2026 sources
   *   sources: ["https://..."],                  // where each figure came from
   * }
   */

  const DATA = {};

  function register(entries) {
    for (const [code, entry] of Object.entries(entries || {})) DATA[code] = entry;
  }

  function get(code) {
    return DATA[code] || null;
  }

  /** [{ code, name }] sorted by name. */
  function list() {
    return Object.values(DATA).map((d) => ({ code: d.code, name: d.name })).sort((a, b) => a.name.localeCompare(b.name));
  }

  function bracketTax(taxable, brackets) {
    let tax = 0;
    let lower = 0;
    for (const [upper, rate] of brackets) {
      if (taxable <= lower) break;
      tax += (Math.min(taxable, upper) - lower) * rate;
      lower = upper;
    }
    return tax;
  }

  const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);
  const statusOf = (s) => (STATUSES.includes(s) ? s : "single");

  function stdDeduction(d, status, ctx) {
    if (d.standardDeduction === "federal") return num(ctx.federalStandardDeduction);
    if (d.standardDeduction && typeof d.standardDeduction === "object") return num(d.standardDeduction[status]);
    return 0;
  }

  /**
   * Generic state income tax.
   * ctx: {
   *   status, filers (1 or 2), dependents (children + other dependents),
   *   earners: [{ wages, k401Trad }]   wages = gross pay less Section 125 benefits,
   *   agi, federalTaxable, federalStandardDeduction, overtimeDeduction,
   * }
   */
  function incomeTax(d, ctx) {
    const status = statusOf(ctx.status);
    const filers = ctx.filers === 2 ? 2 : 1;
    const deps = Math.floor(num(ctx.dependents));
    const earners = ctx.earners || [];

    let base = d.startsFrom === "federalTaxable" ? num(ctx.federalTaxable) : num(ctx.agi);
    if (d.taxes401k) base += earners.reduce((s, e) => s + num(e.k401Trad), 0);
    // Federal taxable income already reflects the overtime deduction.
    if (d.overtimeDeduction && d.startsFrom !== "federalTaxable") base -= num(ctx.overtimeDeduction);
    base = Math.max(0, base);

    const pe = d.personalExemption || {};
    const std = stdDeduction(d, status, ctx);
    let taxable = Math.max(0, base - std - num(pe.filer) * filers - num(pe.dependent) * deps);

    let tax = 0;
    if (d.kind === "flat") tax = taxable * num(d.rate);
    else if (d.kind === "graduated") tax = bracketTax(taxable, (d.brackets && (d.brackets[status] || d.brackets.single)) || []);

    const ec = d.exemptionCredit || {};
    tax = Math.max(0, tax - num(ec.filer) * filers - num(ec.dependent) * deps);

    if (typeof d.compute === "function") {
      const out = d.compute({ ...ctx, status, filers, dependents: deps, base, standardDeduction: std }, { taxable, tax });
      if (out && Number.isFinite(out.tax)) {
        tax = Math.max(0, out.tax);
        if (Number.isFinite(out.taxable)) taxable = Math.max(0, out.taxable);
      }
    }
    return { base, taxable, tax };
  }

  /**
   * Local income tax. Types:
   *   "mi-city":                   Michigan Uniform City Income Tax: (wages - exemptions × exemption) × rate
   *   "rate-on-wages":             flat rate on wages (resident / nonresident rates)
   *   "rate-on-state-taxable":     flat rate on state taxable income (e.g. Maryland counties)
   *   "brackets-on-state-taxable": graduated on state taxable income (e.g. New York City); brackets by status
   *   "percent-of-state-tax":      resident rate × state income tax (e.g. Yonkers); nonresident rate × wages
   * local: { id, resident (default true), customRate (percent, for id "custom") }
   */
  function computeLocal(d, local, wages, stateTaxable, ctx, stateTax = 0) {
    const none = { id: "none", name: "", tax: 0, rate: 0 };
    if (!local || !local.id || local.id === "none") return none;
    const resident = local.resident !== false;
    if (local.id === "custom") {
      const rate = num(local.customRate) / 100;
      return { id: "custom", name: "Local income tax", tax: wages * rate, rate };
    }
    const l = (d.locals || []).find((x) => x.id === local.id);
    if (!l) return none;
    const status = statusOf(ctx.status);
    const people = (ctx.filers === 2 ? 2 : 1) + Math.floor(num(ctx.dependents));
    const flatRate = resident ? num(l.resident ?? l.rate) : num(l.nonresident ?? l.rate);
    switch (l.type) {
      case "mi-city":
        return { id: l.id, name: l.name, rate: flatRate, tax: Math.max(0, wages - people * num(l.exemption)) * flatRate };
      case "rate-on-wages":
        return { id: l.id, name: l.name, rate: flatRate, tax: wages * flatRate };
      case "rate-on-state-taxable":
        return { id: l.id, name: l.name, rate: flatRate, tax: stateTaxable * flatRate };
      case "percent-of-state-tax":
        return { id: l.id, name: l.name, rate: null, tax: resident ? stateTax * num(l.resident ?? l.rate) : wages * num(l.nonresident) };
      case "brackets-on-state-taxable": {
        if (!resident) return { id: l.id, name: l.name, rate: 0, tax: 0 };
        const br = (l.brackets && (l.brackets[status] || l.brackets.single)) || [];
        return { id: l.id, name: l.name, rate: null, tax: bracketTax(stateTaxable, br) };
      }
      default:
        return none;
    }
  }

  /** Employee payroll deductions (SDI, paid family leave, ...) for one earner's wages. */
  function payrollFor(d, wages) {
    return (d.payroll || []).map((p) => {
      const base = p.wageCap ? Math.min(wages, p.wageCap) : wages;
      let amount = base * num(p.rate);
      if (p.maxAnnual) amount = Math.min(amount, p.maxAnnual);
      return { id: p.id, name: p.name, amount };
    });
  }

  /**
   * Everything for one household.
   * Returns { code, name, kind, taxable, tax, local, payroll: [per earner [{id,name,amount}]],
   *           payrollTotal, marginalRate, supplementalRate, notes }
   */
  function compute(code, ctx) {
    const d = get(code);
    if (!d) {
      const allWages = (ctx.earners || []).reduce((s, e) => s + num(e.wages), 0);
      return { code: "", name: "", kind: "none", taxable: 0, tax: 0, local: computeLocal({}, ctx.local, allWages, 0, ctx),
        payroll: (ctx.earners || []).map(() => []), payrollTotal: 0, marginalRate: 0, supplementalRate: 0, notes: [] };
    }
    const it = incomeTax(d, ctx);
    const wages = (ctx.earners || []).reduce((s, e) => s + num(e.wages), 0);
    const local = computeLocal(d, ctx.local, wages, it.taxable, ctx, it.tax);
    const payroll = (ctx.earners || []).map((e) => payrollFor(d, num(e.wages)));
    const payrollTotal = payroll.flat().reduce((s, p) => s + p.amount, 0);

    // Marginal rate over a $1,000 raise in AGI (and federal taxable income). Phase-outs can make
    // a small step land on a cliff, so the result is capped at 20%.
    const step = 1000;
    const bumped = incomeTax(d, { ...ctx, agi: num(ctx.agi) + step, federalTaxable: num(ctx.federalTaxable) + step });
    const marginalRate = Math.min(0.2, Math.max(0, (bumped.tax - it.tax) / step));

    return {
      code: d.code,
      name: d.name,
      kind: d.kind,
      taxable: it.taxable,
      tax: it.tax,
      local,
      payroll,
      payrollTotal,
      marginalRate,
      supplementalRate: Number.isFinite(d.supplementalRate) ? d.supplementalRate : marginalRate,
      overtimeDeduction: !!d.overtimeDeduction,
      unverified: !!d.unverified,
      notes: d.notes || [],
    };
  }

  // ---------- Validation (used by every state's tests) ----------

  function checkBrackets(br, where, errors) {
    if (!Array.isArray(br) || !br.length) { errors.push(`${where}: missing`); return; }
    let prev = 0;
    br.forEach(([upper, rate], i) => {
      if (!(rate >= 0 && rate < 0.2)) errors.push(`${where}[${i}]: rate ${rate} out of range`);
      if (!(upper > prev)) errors.push(`${where}[${i}]: upper bound ${upper} not ascending`);
      prev = upper;
    });
    if (br[br.length - 1][0] !== Infinity) errors.push(`${where}: last bracket must end at Infinity`);
  }

  /** Returns a list of problems with an entry (empty when valid). */
  function validate(d) {
    const errors = [];
    if (!d || typeof d !== "object") return ["not an object"];
    if (!/^[A-Z]{2}$/.test(d.code || "")) errors.push("code must be two capital letters");
    if (!d.name) errors.push("name missing");
    if (d.year !== 2026) errors.push("year must be 2026");
    if (!["none", "flat", "graduated"].includes(d.kind)) errors.push(`kind ${d.kind} invalid`);
    if (d.kind === "flat" && !(d.rate > 0 && d.rate < 0.2)) errors.push("flat rate out of range");
    if (d.kind === "graduated") for (const s of STATUSES) checkBrackets(d.brackets && d.brackets[s], `brackets.${s}`, errors);
    if (d.startsFrom && !["agi", "federalTaxable"].includes(d.startsFrom)) errors.push("startsFrom invalid");
    const sd = d.standardDeduction;
    if (sd && sd !== "federal" && !(typeof sd === "object" && STATUSES.every((s) => Number.isFinite(sd[s]) && sd[s] >= 0))) {
      errors.push("standardDeduction must be 0, \"federal\", or amounts for all four statuses");
    }
    for (const key of ["personalExemption", "exemptionCredit"]) {
      const v = d[key];
      if (v && !(Number.isFinite(v.filer ?? 0) && Number.isFinite(v.dependent ?? 0))) errors.push(`${key} invalid`);
    }
    for (const key of ["taxes401k", "overtimeDeduction", "unverified"]) if (d[key] != null && typeof d[key] !== "boolean") errors.push(`${key} must be boolean`);
    if (d.supplementalRate != null && !(d.supplementalRate >= 0 && d.supplementalRate < 0.2)) errors.push("supplementalRate out of range");
    for (const [i, p] of (d.payroll || []).entries()) {
      if (!p.id || !p.name || !(p.rate > 0 && p.rate < 0.05)) errors.push(`payroll[${i}] invalid`);
      if (p.wageCap != null && !(p.wageCap > 0)) errors.push(`payroll[${i}].wageCap invalid`);
    }
    const types = ["mi-city", "rate-on-wages", "rate-on-state-taxable", "brackets-on-state-taxable", "percent-of-state-tax"];
    const ids = new Set();
    for (const [i, l] of (d.locals || []).entries()) {
      if (!l.id || !l.name || !types.includes(l.type)) errors.push(`locals[${i}] invalid`);
      if (ids.has(l.id) || l.id === "none" || l.id === "custom") errors.push(`locals[${i}] id ${l.id} reserved or repeated`);
      ids.add(l.id);
      if (l.type === "brackets-on-state-taxable") for (const s of STATUSES) checkBrackets(l.brackets && l.brackets[s], `locals[${i}].brackets.${s}`, errors);
    }
    if (d.compute != null && typeof d.compute !== "function") errors.push("compute must be a function");
    if (!Array.isArray(d.sources) || !d.sources.length || !d.sources.every((u) => /^https:\/\//.test(u))) errors.push("sources must list https URLs");
    return errors;
  }

  const api = { STATUSES, register, get, list, compute, incomeTax, computeLocal, payrollFor, bracketTax, validate };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.StateTax = api;
})(typeof window !== "undefined" ? window : globalThis);

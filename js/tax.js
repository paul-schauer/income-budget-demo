/*
 * Household tax engine: federal income tax, FICA, self-employment tax, and state/local
 * tax (via js/state-tax.js) for you, an optional spouse on a joint return, and extra income.
 * Works in the browser (window.Tax) and in Node (module.exports) for tests.
 *
 * All figures are for tax year 2026. Sources for every figure are listed in
 * docs/tax-sources.md. This is an estimate, not tax advice.
 */
/**
 * @typedef {import("../types/tax").TaxApi} TaxApi
 * @typedef {import("../types/tax").FilingStatus} FilingStatus
 * @typedef {import("../types/tax").Brackets} Brackets
 * @typedef {import("../types/tax").Period} Period
 * @typedef {import("../types/tax").PayPeriod} PayPeriod
 * @typedef {import("../types/tax").PeriodInfo} PeriodInfo
 * @typedef {import("../types/tax").IncomeType} IncomeType
 * @typedef {import("../types/tax").EarnerInput} EarnerInput
 * @typedef {import("../types/tax").TaxInput} TaxInput
 * @typedef {import("../types/tax").TaxResult} TaxResult
 * @typedef {import("../types/tax").Person} Person
 * @typedef {import("../types/tax").StateResult} StateResult
 * @typedef {import("../types/tax").StateTaxApi} StateTaxApi
 * @typedef {import("../types/tax").PayrollAmount} PayrollAmount
 */

/**
 * One earner while a household is being calculated (see core()).
 * @typedef {object} Worker
 * @property {"you" | "spouse"} role
 * @property {number} gross
 * @property {number} benefits
 * @property {number} k401
 * @property {number} k401Limit
 * @property {boolean} isRoth
 * @property {boolean} k401Capped
 * @property {number} ficaWages      gross less Section 125 benefits
 * @property {number} fedWages       ficaWages less traditional 401(k)
 * @property {number} extraWithholding
 * @property {number} overtimePremium
 * @property {number} extraWages     from a second W-2 job
 * @property {number} seProfit       self-employment net profit
 * @property {number} allWages       ficaWages + extraWages
 * @property {number} socialSecurity
 * @property {number} medicare
 * @property {number} seEarnings
 * @property {number} seTax
 * @property {number} payroll        state payroll deductions
 */
(function (root) {
  "use strict";

  const TAX_YEAR = 2026;

  // State engine: in the browser it's already loaded (with its data files); in Node, load it here.
  /** @type {StateTaxApi | undefined} */
  let StateTax = root.StateTax;
  if (!StateTax && typeof module !== "undefined" && module.exports) {
    StateTax = require("./state-tax.js");
    for (const f of ["no-tax-flat", "west-plains", "northeast", "south-central"]) /** @type {StateTaxApi} */ (StateTax).register(require(`./states/${f}.js`));
  }

  // IRS Rev. Proc. 2025-32 (2026 inflation adjustments, post-OBBBA), IRS Notice 2025-67 (retirement limits).
  /** @type {TaxApi["FEDERAL"]} */
  const FEDERAL = {
    standardDeduction: { single: 16100, mfj: 32200, mfs: 16100, hoh: 24150 },
    // [upper bound of bracket (taxable income), rate]
    brackets: {
      single: [[12400, 0.10], [50400, 0.12], [105700, 0.22], [201775, 0.24], [256225, 0.32], [640600, 0.35], [Infinity, 0.37]],
      mfj:    [[24800, 0.10], [100800, 0.12], [211400, 0.22], [403550, 0.24], [512450, 0.32], [768700, 0.35], [Infinity, 0.37]],
      mfs:    [[12400, 0.10], [50400, 0.12], [105700, 0.22], [201775, 0.24], [256225, 0.32], [384350, 0.35], [Infinity, 0.37]],
      hoh:    [[17700, 0.10], [67450, 0.12], [105700, 0.22], [201750, 0.24], [256200, 0.32], [640600, 0.35], [Infinity, 0.37]],
    },
    childTaxCredit: 2200,
    childTaxCreditRefundable: 1700, // informational; the engine treats credits as nonrefundable
    otherDependentCredit: 500,
    childTaxCreditPhaseoutStart: { single: 200000, mfj: 400000, mfs: 200000, hoh: 200000 },
    childTaxCreditPhaseoutPer1000: 50,
    k401Limit: 24500,
    k401CatchUp: 8000,         // age 50+
    k401CatchUp60to63: 11250,  // SECURE 2.0 higher catch-up for ages 60-63
    // Pub. 15 (2026): optional flat rate on supplemental wages; mandatory rate above $1M for the year.
    supplementalRate: 0.22,
    supplementalRateOver1M: 0.37,
    supplementalMandatoryThreshold: 1000000,
    // OBBBA "no tax on overtime" (IRC 225, tax years 2025-2028): deduction for the FLSA overtime
    // premium (the "half" of time-and-a-half). Taken on the annual return (Schedule 1-A); it does
    // not change payroll withholding unless the employee claims it on W-4 step 4(b).
    overtime: {
      cap: { single: 12500, mfj: 25000, mfs: 0, hoh: 12500 }, // married filing separately can't claim it
      phaseoutStart: { single: 150000, mfj: 300000, mfs: 150000, hoh: 150000 },
      phaseoutPer1000: 100,
      firstYear: 2025,
      lastYear: 2028,
    },
    // Section 199A (Rev. Proc. 2025-32; OBBBA widened the phase-in range and added a $400 minimum).
    // Modeled as the simple 20% below the threshold, phasing out linearly above it (the
    // specified-service rule), which understates it for businesses that pay W-2 wages.
    qbi: {
      rate: 0.2,
      threshold: { single: 201750, mfj: 403500, mfs: 201775, hoh: 201750 },
      phaseIn: { single: 75000, mfj: 150000, mfs: 75000, hoh: 75000 },
      minimum: 400,
      minimumQbi: 1000,
    },
  };

  /** @type {TaxApi["FICA"]} */
  const FICA = {
    socialSecurityRate: 0.062,
    socialSecurityWageBase: 184500,
    medicareRate: 0.0145,
    additionalMedicareRate: 0.009,
    // Self-employment tax: 92.35% of net earnings; 12.4% Social Security (sharing the wage base
    // with W-2 wages) + 2.9% Medicare. Half of it is deductible from income.
    selfEmploymentFactor: 0.9235,
    selfEmploymentSocialSecurityRate: 0.124,
    selfEmploymentMedicareRate: 0.029,
    // Annual liability threshold (Form 8959) by filing status.
    additionalMedicareThreshold: { single: 200000, mfj: 250000, mfs: 125000, hoh: 200000 },
    // Employers start withholding the 0.9% once wages pass $200,000, regardless of filing status.
    additionalMedicareWithholdingThreshold: 200000,
  };

  // Michigan Treasury: 4.25% for tax year 2026 (no triggered cut), $5,900 exemption (Form 446, 2026).
  // 2025 PA 24 lets Michigan returns deduct the same qualified overtime as the federal return for 2026-2028.
  /** @type {TaxApi["MICHIGAN"]} */
  const MICHIGAN = {
    rate: 0.0425,
    personalExemption: 5900,
    supplementalRate: 0.0425,
    overtimeDeduction: TAX_YEAR >= 2026 && TAX_YEAR <= 2028,
  };

  // The 24 Michigan cities that levy an income tax (Michigan Treasury list).
  // Rates are resident / nonresident; exemption is per personal and dependency exemption.
  /** @type {TaxApi["CITIES"]} */
  const CITIES = [
    { id: "none", name: "No city tax", resident: 0, nonresident: 0, exemption: 0 },
    { id: "albion", name: "Albion", resident: 0.01, nonresident: 0.005, exemption: 600 },
    { id: "battle-creek", name: "Battle Creek", resident: 0.01, nonresident: 0.005, exemption: 750 },
    { id: "benton-harbor", name: "Benton Harbor", resident: 0.01, nonresident: 0.005, exemption: 750 },
    { id: "big-rapids", name: "Big Rapids", resident: 0.01, nonresident: 0.005, exemption: 600 },
    { id: "detroit", name: "Detroit", resident: 0.024, nonresident: 0.012, exemption: 600 },
    { id: "east-lansing", name: "East Lansing", resident: 0.01, nonresident: 0.005, exemption: 600 },
    { id: "flint", name: "Flint", resident: 0.01, nonresident: 0.005, exemption: 600 },
    { id: "grand-rapids", name: "Grand Rapids", resident: 0.015, nonresident: 0.0075, exemption: 600 },
    { id: "grayling", name: "Grayling", resident: 0.01, nonresident: 0.005, exemption: 3000 },
    { id: "hamtramck", name: "Hamtramck", resident: 0.01, nonresident: 0.005, exemption: 600 },
    { id: "highland-park", name: "Highland Park", resident: 0.02, nonresident: 0.01, exemption: 600 },
    { id: "hudson", name: "Hudson", resident: 0.01, nonresident: 0.005, exemption: 1000 },
    { id: "ionia", name: "Ionia", resident: 0.01, nonresident: 0.005, exemption: 700 },
    { id: "jackson", name: "Jackson", resident: 0.01, nonresident: 0.005, exemption: 600 },
    { id: "lansing", name: "Lansing", resident: 0.01, nonresident: 0.005, exemption: 600 },
    { id: "lapeer", name: "Lapeer", resident: 0.01, nonresident: 0.005, exemption: 600 },
    { id: "muskegon", name: "Muskegon", resident: 0.01, nonresident: 0.005, exemption: 600 },
    { id: "muskegon-heights", name: "Muskegon Heights", resident: 0.01, nonresident: 0.005, exemption: 600 },
    { id: "pontiac", name: "Pontiac", resident: 0.01, nonresident: 0.005, exemption: 600 },
    { id: "port-huron", name: "Port Huron", resident: 0.01, nonresident: 0.005, exemption: 600 },
    { id: "portland", name: "Portland", resident: 0.01, nonresident: 0.005, exemption: 1000 },
    { id: "saginaw", name: "Saginaw", resident: 0.015, nonresident: 0.0075, exemption: 750 },
    { id: "springfield", name: "Springfield", resident: 0.01, nonresident: 0.005, exemption: 750 },
    { id: "walker", name: "Walker", resident: 0.01, nonresident: 0.005, exemption: 600 },
  ];

  /** @type {TaxApi["FILING_STATUSES"]} */
  const FILING_STATUSES = [
    { id: "single", name: "Single" },
    { id: "mfj", name: "Married, joint" },
    { id: "mfs", name: "Married, separate" },
    { id: "hoh", name: "Head of household" },
  ];

  // Periods per year.
  /** @type {Record<Period, PeriodInfo>} */
  const PERIODS = {
    weekly: { label: "Weekly", perYear: 52, noun: "week" },
    biweekly: { label: "Biweekly", perYear: 26, noun: "2 weeks" },
    semimonthly: { label: "Semimonthly", perYear: 24, noun: "half-month" },
    monthly: { label: "Monthly", perYear: 12, noun: "month" },
    quarterly: { label: "Quarterly", perYear: 4, noun: "quarter" },
    annual: { label: "Annual", perYear: 1, noun: "year" },
  };

  /** @type {PayPeriod[]} */
  const PAY_PERIODS = ["weekly", "biweekly", "semimonthly", "monthly"];

  /** @param {number} taxable @param {Brackets} brackets */
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

  /** @param {number} taxable @param {Brackets} brackets */
  function marginalBracket(taxable, brackets) {
    for (const [upper, rate] of brackets) {
      if (taxable < upper) return rate;
    }
    return brackets[brackets.length - 1][1];
  }

  /** @param {unknown} v A positive finite number, or 0. */
  function num(v) {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  /** @param {unknown} s @returns {FilingStatus} */
  function statusOf(s) {
    return typeof s === "string" && s in FEDERAL.standardDeduction ? /** @type {FilingStatus} */ (s) : "single";
  }

  /** @param {string} id */
  function findCity(id) {
    return CITIES.find((c) => c.id === id) || CITIES[0];
  }

  /**
   * Elective-deferral limit including the catch-up for the given age (age optional).
   * @param {unknown} age
   */
  function k401LimitFor(age) {
    const a = Number(age);
    if (!Number.isFinite(a)) return FEDERAL.k401Limit;
    if (a >= 60 && a <= 63) return FEDERAL.k401Limit + FEDERAL.k401CatchUp60to63;
    if (a >= 50) return FEDERAL.k401Limit + FEDERAL.k401CatchUp;
    return FEDERAL.k401Limit;
  }

  /**
   * Qualified overtime deduction (IRC 225) for the year.
   * premium: FLSA overtime premium actually paid (the "half" of time-and-a-half), annual.
   * magi: modified AGI. Schedule 1-A: reduce by $100 per full $1,000 of MAGI over the threshold.
   * @param {number | undefined} premium @param {string} filingStatus @param {number} magi
   */
  function overtimeDeduction(premium, filingStatus, magi) {
    const status = statusOf(filingStatus);
    const ot = FEDERAL.overtime;
    if (TAX_YEAR < ot.firstYear || TAX_YEAR > ot.lastYear) return 0;
    const capped = Math.min(num(premium), ot.cap[status]);
    const excess = Math.max(0, num(magi) - ot.phaseoutStart[status]);
    const reduction = Math.floor(excess / 1000) * ot.phaseoutPer1000;
    return Math.max(0, capped - reduction);
  }

  /**
   * Section 199A deduction for self-employment income (see FEDERAL.qbi).
   * @param {number} qbi @param {number} taxableBeforeQbi @param {string} filingStatus
   */
  function qbiDeduction(qbi, taxableBeforeQbi, filingStatus) {
    const status = statusOf(filingStatus);
    const q = FEDERAL.qbi;
    if (!(qbi > 0) || !(taxableBeforeQbi > 0)) return 0;
    let deduction = q.rate * qbi;
    const over = taxableBeforeQbi - q.threshold[status];
    if (over > 0) deduction *= Math.max(0, 1 - over / q.phaseIn[status]);
    if (qbi >= q.minimumQbi) deduction = Math.max(deduction, q.minimum);
    return Math.min(deduction, q.rate * taxableBeforeQbi);
  }

  /**
   * Federal withholding on a supplemental wage payment (bonus) using the flat-rate method:
   * 22%, or 37% on the part of the year's supplemental wages above $1,000,000.
   * amount: income-tax wages in this payment; priorSupplemental: supplemental wages already paid this year.
   * @param {number} amount @param {number} [priorSupplemental]
   */
  function supplementalFederalWithholding(amount, priorSupplemental) {
    const a = num(amount);
    const prior = num(priorSupplemental);
    const t = FEDERAL.supplementalMandatoryThreshold;
    const over = Math.max(0, prior + a - t) - Math.max(0, prior - t);
    return (a - over) * FEDERAL.supplementalRate + over * FEDERAL.supplementalRateOver1M;
  }

  /** @type {IncomeType[]} */
  const INCOME_TYPES = ["w2", "self", "taxable", "nontaxable"];

  /**
   * @param {EarnerInput | null | undefined} src
   * @param {"you" | "spouse"} role
   * @returns {Worker}
   */
  function earner(src, role) {
    src = src || {};
    const gross = num(src.grossAnnual);
    const benefits = Math.min(num(src.preTaxBenefits), gross);
    const k401Limit = k401LimitFor(src.age);
    const hasAnnual = src.k401Annual != null && src.k401Annual !== "" && Number.isFinite(Number(src.k401Annual));
    const k401Requested = hasAnnual ? num(src.k401Annual) : gross * Math.min(num(src.k401Percent), 100) / 100;
    const k401 = Math.min(k401Requested, k401Limit, gross - benefits);
    const isRoth = src.k401Type === "roth";
    const ficaWages = gross - benefits;
    return {
      role, gross, benefits, k401, k401Limit, isRoth,
      k401Capped: k401Requested > k401 + 0.005,
      ficaWages,
      fedWages: ficaWages - (isRoth ? 0 : k401),
      extraWithholding: num(src.extraWithholdingAnnual),
      overtimePremium: num(src.overtimePremium),
      extraWages: 0, // from a second W-2 job
      seProfit: 0,   // self-employment net profit
      // Filled in by core():
      allWages: 0,
      socialSecurity: 0,
      medicare: 0,
      seEarnings: 0,
      seTax: 0,
      payroll: 0,
    };
  }

  /**
   * The empty state result, for when no state engine is loaded.
   * @param {number} earners
   * @returns {StateResult}
   */
  function noState(earners) {
    return {
      code: "", name: "", kind: "none", taxable: 0, tax: 0,
      local: { id: "none", name: "", tax: 0, rate: 0 },
      payroll: Array.from({ length: earners }, () => []), payrollTotal: 0,
      marginalRate: 0, supplementalRate: 0, overtimeDeduction: false, unverified: false, notes: [],
    };
  }

  /**
   * One pass over the whole household. calculate() wraps this with the per-person split.
   * @param {TaxInput} input
   */
  function core(input) {
    const status = statusOf(input.filingStatus);
    const married = status === "mfj";
    const dependents = Math.floor(num(input.dependents));
    const otherDependents = Math.floor(num(input.otherDependents));

    const people = [earner(input, "you")];
    if (married && input.spouse && num(input.spouse.grossAnnual) > 0) people.push(earner(input.spouse, "spouse"));

    const other = (Array.isArray(input.otherIncome) ? input.otherIncome : [])
      .filter(/** @returns {x is import("../types/tax").OtherIncomeInput} */ (x) => !!x && num(x.annual) > 0)
      .map((x) => ({
        type: /** @type {IncomeType} */ (INCOME_TYPES.includes(/** @type {IncomeType} */ (x.type)) ? x.type : "taxable"),
        annual: num(x.annual),
        owner: x.owner === "spouse" && people.length > 1 ? 1 : 0,
      }));
    let taxableOther = 0;
    let nontaxable = 0;
    for (const x of other) {
      if (x.type === "w2") people[x.owner].extraWages += x.annual;
      else if (x.type === "self") people[x.owner].seProfit += x.annual;
      else if (x.type === "taxable") taxableOther += x.annual;
      else nontaxable += x.annual;
    }

    // FICA and self-employment tax, per person.
    for (const p of people) {
      p.allWages = p.ficaWages + p.extraWages;
      p.socialSecurity = Math.min(p.allWages, FICA.socialSecurityWageBase) * FICA.socialSecurityRate;
      p.medicare = p.allWages * FICA.medicareRate;
      p.seEarnings = p.seProfit * FICA.selfEmploymentFactor;
      const ssRoom = Math.max(0, FICA.socialSecurityWageBase - p.allWages);
      p.seTax = Math.min(p.seEarnings, ssRoom) * FICA.selfEmploymentSocialSecurityRate +
        p.seEarnings * FICA.selfEmploymentMedicareRate;
    }
    const medicareBase = people.reduce((s, p) => s + p.allWages + p.seEarnings, 0);
    const additionalMedicare = Math.max(0, medicareBase - FICA.additionalMedicareThreshold[status]) * FICA.additionalMedicareRate;
    const seTax = people.reduce((s, p) => s + p.seTax, 0);
    const halfSeTax = seTax / 2;

    // Federal income tax.
    /** @param {(p: Worker) => number} f */
    const sum = (f) => people.reduce((s, p) => s + f(p), 0);
    const seProfit = sum((p) => p.seProfit);
    const agi = Math.max(0, sum((p) => p.fedWages + p.extraWages) + seProfit - halfSeTax + taxableOther);
    const otDeduction = overtimeDeduction(sum((p) => p.overtimePremium), status, agi);
    const standardDeduction = FEDERAL.standardDeduction[status];
    const taxableBeforeQbi = Math.max(0, agi - standardDeduction - otDeduction);
    const qbi = qbiDeduction(Math.max(0, seProfit - halfSeTax), taxableBeforeQbi, status);
    const federalTaxable = Math.max(0, taxableBeforeQbi - qbi);
    const federalBeforeCredits = bracketTax(federalTaxable, FEDERAL.brackets[status]);
    const phaseoutExcess = Math.max(0, agi - FEDERAL.childTaxCreditPhaseoutStart[status]);
    const credits = Math.max(0,
      dependents * FEDERAL.childTaxCredit + otherDependents * FEDERAL.otherDependentCredit -
      Math.ceil(phaseoutExcess / 1000) * FEDERAL.childTaxCreditPhaseoutPer1000);
    const federal = Math.max(0, federalBeforeCredits - credits);

    // State and local. Older callers passed only a Michigan city, so no state means Michigan.
    const stateCode = input.state === undefined ? "MI" : String(input.state || "");
    const local = input.local || (input.cityId ? { id: input.cityId, resident: input.cityResident !== false } : { id: "none" });
    const st = StateTax ? StateTax.compute(stateCode, {
      status,
      filers: married ? 2 : 1,
      dependents: dependents + otherDependents,
      earners: people.map((p) => ({ wages: p.allWages, k401Trad: p.isRoth ? 0 : p.k401 })),
      agi,
      federalTaxable,
      federalStandardDeduction: standardDeduction,
      overtimeDeduction: otDeduction,
      federalTax: federal,
      local,
    }) : noState(people.length);
    people.forEach((p, i) => { p.payroll = (st.payroll[i] || []).reduce((s, x) => s + x.amount, 0); });

    /** @type {PayrollAmount[]} */
    const payrollItems = [];
    for (const list of st.payroll) {
      for (const x of list) {
        const found = payrollItems.find((y) => y.id === x.id);
        if (found) found.amount += x.amount;
        else payrollItems.push({ ...x });
      }
    }

    const socialSecurity = sum((p) => p.socialSecurity);
    const medicare = sum((p) => p.medicare) + additionalMedicare;
    const stateTax = st.tax;
    const localTax = st.local.tax;
    const taxes = federal + socialSecurity + medicare + seTax + stateTax + localTax + st.payrollTotal;
    const extraGross = other.reduce((s, x) => s + x.annual, 0);
    const gross = sum((p) => p.gross) + extraGross;
    const benefits = sum((p) => p.benefits);
    const k401 = sum((p) => p.k401);
    const extraWithholding = sum((p) => p.extraWithholding);
    const net = gross - benefits - k401 - taxes - extraWithholding;

    return {
      status, people, other, additionalMedicare,
      gross, wages: sum((p) => p.gross), extraGross, taxableOther, nontaxable, seProfit,
      benefits, k401, federal, socialSecurity, medicare, seTax, stateTax, localTax,
      payrollTotal: st.payrollTotal, payrollItems, taxes, extraWithholding, net,
      agi, federalTaxable, standardDeduction, qbiDeduction: qbi, overtimeDeduction: otDeduction,
      childCredit: Math.min(credits, federalBeforeCredits),
      federalMarginal: marginalBracket(federalTaxable, FEDERAL.brackets[status]),
      st, stateCode,
    };
  }

  /**
   * Input — your pay (top level, as before):
   *   grossAnnual, filingStatus (single | mfj | mfs | hoh), k401Percent, k401Type (traditional | roth),
   *   k401Annual?, age?, preTaxBenefits, dependents, otherDependents, extraWithholdingAnnual, overtimePremium?
   * Household:
   *   state: two-letter code ("" = none chosen; omitted = Michigan, for older callers)
   *   local: { id, resident, customRate }   (older callers: cityId / cityResident)
   *   spouse: { grossAnnual, k401Percent, k401Type, preTaxBenefits, extraWithholdingAnnual, age }  (joint returns only)
   *   otherIncome: [{ type: "w2" | "self" | "taxable" | "nontaxable", annual, owner: "you" | "spouse" }]
   *
   * Top-level results are household totals. `people` has each earner's paycheck view: income tax on
   * wages is shared by wages, and the extra tax caused by other income sits in `extras`.
   * @param {TaxInput} input
   * @returns {TaxResult}
   */
  function calculate(input) {
    input = input || {};
    const full = core(input);
    const wagesOnly = full.other.length ? core({ ...input, otherIncome: [] }) : full;

    // Each person's paycheck: their own FICA and payroll deductions, plus a wage-weighted share of
    // income tax and the additional Medicare tax on the wages-only household.
    const shared = wagesOnly.federal + wagesOnly.stateTax + wagesOnly.localTax;
    /** @param {Worker} p */
    const weight = (p) => Math.max(0, p.fedWages);
    const totalWeight = wagesOnly.people.reduce((s, p) => s + weight(p), 0);
    /** @type {Person[]} */
    const people = wagesOnly.people.map((p) => {
      const share = totalWeight > 0 ? weight(p) / totalWeight : 1 / wagesOnly.people.length;
      const incomeTax = shared * share;
      const medicare = p.medicare + wagesOnly.additionalMedicare * share;
      const taxes = incomeTax + p.socialSecurity + medicare + p.payroll;
      return {
        role: p.role, gross: p.gross, benefits: p.benefits, k401: p.k401, k401Capped: p.k401Capped,
        k401Limit: p.k401Limit, isRoth: p.isRoth, federal: wagesOnly.federal * share,
        state: wagesOnly.stateTax * share, local: wagesOnly.localTax * share, incomeTax,
        socialSecurity: p.socialSecurity, medicare, payroll: p.payroll, taxes,
        extraWithholding: p.extraWithholding,
        net: p.gross - p.benefits - p.k401 - taxes - p.extraWithholding,
      };
    });

    // Other income: what it adds after the tax it causes. Tax on self-employment and other taxable
    // income isn't withheld, so it's also reported as an amount to set aside.
    const extrasTax = full.taxes - wagesOnly.taxes;
    let setAside = 0;
    if (full.other.some((x) => x.type === "self" || x.type === "taxable")) {
      const withheldOnly = core({ ...input, otherIncome: (input.otherIncome || []).filter((x) => !!x && (x.type === "w2" || x.type === "nontaxable")) });
      setAside = Math.max(0, full.taxes - withheldOnly.taxes);
    }
    const extras = {
      gross: full.extraGross,
      taxable: full.taxableOther,
      nontaxable: full.nontaxable,
      selfEmployment: full.seProfit,
      seTax: full.seTax,
      tax: extrasTax,
      net: full.extraGross - extrasTax,
      setAside,
    };

    const st = full.st;
    const you = people[0];
    return {
      // Household totals
      gross: full.gross,
      wages: full.wages,
      benefits: full.benefits,
      k401: full.k401,
      federal: full.federal,
      socialSecurity: full.socialSecurity,
      medicare: full.medicare,
      seTax: full.seTax,
      stateTax: full.stateTax,
      localTax: full.localTax,
      payroll: full.payrollTotal,
      payrollItems: full.payrollItems,
      taxes: full.taxes,
      extraWithholding: full.extraWithholding,
      net: full.net,
      effectiveRate: full.gross > 0 ? full.taxes / full.gross : 0,
      agi: full.agi,
      federalTaxable: full.federalTaxable,
      federalWages: full.agi,
      ficaWages: full.people.reduce((s, p) => s + p.allWages, 0),
      federalMarginal: full.federalMarginal,
      childCredit: full.childCredit,
      overtimeDeduction: full.overtimeDeduction,
      qbiDeduction: full.qbiDeduction,
      // State and local details
      state: { code: st.code || "", name: st.name || "", kind: st.kind || "none", taxable: st.taxable || 0,
        marginalRate: st.marginalRate || 0, supplementalRate: st.supplementalRate || 0,
        overtimeDeduction: !!st.overtimeDeduction, unverified: !!st.unverified, notes: st.notes || [] },
      local: { id: st.local.id || "none", name: st.local.name || "", rate: st.local.rate, tax: full.localTax },
      // People and other income
      people,
      extras,
      // Your own paycheck fields, for older callers
      isRoth: you.isRoth,
      k401Capped: you.k401Capped,
      k401Limit: you.k401Limit,
      // Older names for the state and local tax
      michigan: full.stateTax,
      michiganTaxable: st.taxable || 0,
      city: full.localTax,
      cityRate: st.local.rate || 0,
      cityTaxable: 0,
    };
  }

  /**
   * Extra annual take-home from a raise of `amount` dollars on your pay.
   * @param {TaxInput} input @param {number} amount
   */
  function raiseImpact(input, amount) {
    const base = calculate(input);
    const bumped = calculate(Object.assign({}, input, { grossAnnual: num(input.grossAnnual) + amount }));
    return (bumped.net + bumped.extraWithholding) - (base.net + base.extraWithholding);
  }

  /** @param {number} amount @param {Period} fromPeriod @param {Period} toPeriod */
  function convert(amount, fromPeriod, toPeriod) {
    return (amount * PERIODS[fromPeriod].perYear) / PERIODS[toPeriod].perYear;
  }

  /** @type {TaxApi} */
  const api = {
    TAX_YEAR, FEDERAL, FICA, MICHIGAN, CITIES, FILING_STATUSES, PERIODS, PAY_PERIODS,
    INCOME_TYPES, calculate, raiseImpact, convert, bracketTax, findCity,
    k401LimitFor, overtimeDeduction, qbiDeduction, supplementalFederalWithholding,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Tax = api;
})(/** @type {Window & typeof globalThis} */ (typeof window !== "undefined" ? window : globalThis));

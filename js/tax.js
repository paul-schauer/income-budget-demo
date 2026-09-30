/*
 * Paycheck tax engine: federal, FICA, Michigan, and Michigan city income tax.
 * Works in the browser (window.Tax) and in Node (module.exports) for tests.
 *
 * All figures are for tax year 2026. Sources for every figure are listed in
 * docs/tax-sources.md. This is an estimate, not tax advice.
 */
(function (root) {
  "use strict";

  const TAX_YEAR = 2026;

  // IRS Rev. Proc. 2025-32 (2026 inflation adjustments, post-OBBBA), IRS Notice 2025-67 (retirement limits).
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
  };

  const FICA = {
    socialSecurityRate: 0.062,
    socialSecurityWageBase: 184500,
    medicareRate: 0.0145,
    additionalMedicareRate: 0.009,
    // Annual liability threshold (Form 8959) by filing status.
    additionalMedicareThreshold: { single: 200000, mfj: 250000, mfs: 125000, hoh: 200000 },
    // Employers start withholding the 0.9% once wages pass $200,000, regardless of filing status.
    additionalMedicareWithholdingThreshold: 200000,
  };

  // Michigan Treasury: 4.25% for tax year 2026 (no triggered cut), $5,900 exemption (Form 446, 2026).
  // 2025 PA 24 lets Michigan returns deduct the same qualified overtime as the federal return for 2026-2028.
  const MICHIGAN = {
    rate: 0.0425,
    personalExemption: 5900,
    supplementalRate: 0.0425,
    overtimeDeduction: TAX_YEAR >= 2026 && TAX_YEAR <= 2028,
  };

  // The 24 Michigan cities that levy an income tax (Michigan Treasury list).
  // Rates are resident / nonresident; exemption is per personal and dependency exemption.
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

  const FILING_STATUSES = [
    { id: "single", name: "Single" },
    { id: "mfj", name: "Married, joint" },
    { id: "mfs", name: "Married, separate" },
    { id: "hoh", name: "Head of household" },
  ];

  // Periods per year.
  const PERIODS = {
    weekly: { label: "Weekly", perYear: 52, noun: "week" },
    biweekly: { label: "Biweekly", perYear: 26, noun: "2 weeks" },
    semimonthly: { label: "Semimonthly", perYear: 24, noun: "half-month" },
    monthly: { label: "Monthly", perYear: 12, noun: "month" },
    quarterly: { label: "Quarterly", perYear: 4, noun: "quarter" },
    annual: { label: "Annual", perYear: 1, noun: "year" },
  };

  const PAY_PERIODS = ["weekly", "biweekly", "semimonthly", "monthly"];

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

  function marginalBracket(taxable, brackets) {
    for (const [upper, rate] of brackets) {
      if (taxable < upper) return rate;
    }
    return brackets[brackets.length - 1][1];
  }

  function num(v) {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function statusOf(s) {
    return FEDERAL.standardDeduction[s] != null ? s : "single";
  }

  function findCity(id) {
    return CITIES.find((c) => c.id === id) || CITIES[0];
  }

  /** Elective-deferral limit including the catch-up for the given age (age optional). */
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
   * Federal withholding on a supplemental wage payment (bonus) using the flat-rate method:
   * 22%, or 37% on the part of the year's supplemental wages above $1,000,000.
   * amount: income-tax wages in this payment; priorSupplemental: supplemental wages already paid this year.
   */
  function supplementalFederalWithholding(amount, priorSupplemental) {
    const a = num(amount);
    const prior = num(priorSupplemental);
    const t = FEDERAL.supplementalMandatoryThreshold;
    const over = Math.max(0, prior + a - t) - Math.max(0, prior - t);
    return (a - over) * FEDERAL.supplementalRate + over * FEDERAL.supplementalRateOver1M;
  }

  /**
   * @param {object} input
   * @param {number} input.grossAnnual
   * @param {string} input.filingStatus  single | mfj | mfs | hoh
   * @param {number} input.k401Percent   percent of gross (0-100)
   * @param {number} [input.k401Annual]  optional: annual 401(k) deferral in dollars (overrides k401Percent)
   * @param {number} [input.age]         optional: enables the 50+ / 60-63 catch-up limit
   * @param {string} input.k401Type      traditional | roth
   * @param {number} input.preTaxBenefits annual Section 125 deductions (health, dental, HSA, FSA)
   * @param {number} input.dependents    qualifying children under 17
   * @param {number} input.otherDependents other dependents ($500 credit each)
   * @param {number} input.extraWithholdingAnnual extra federal withholding (W-4 step 4c), annualized
   * @param {number} [input.overtimePremium] optional: annual qualified overtime premium (deducted on the return)
   * @param {string} input.cityId
   * @param {boolean} input.cityResident
   */
  function calculate(input) {
    const status = statusOf(input.filingStatus);
    const gross = num(input.grossAnnual);
    const dependents = Math.floor(num(input.dependents));
    const otherDependents = Math.floor(num(input.otherDependents));
    const extraWithholding = num(input.extraWithholdingAnnual);
    const benefits = Math.min(num(input.preTaxBenefits), gross);
    const k401Limit = k401LimitFor(input.age);
    const hasAnnual = input.k401Annual != null && input.k401Annual !== "" && Number.isFinite(Number(input.k401Annual));
    const k401Requested = hasAnnual ? num(input.k401Annual) : gross * Math.min(num(input.k401Percent), 100) / 100;
    const k401 = Math.min(k401Requested, k401Limit, gross - benefits);
    const k401Capped = k401Requested > k401 + 0.005;
    const isRoth = input.k401Type === "roth";

    // Wage bases
    const ficaWages = gross - benefits;
    const federalWages = ficaWages - (isRoth ? 0 : k401); // ~ AGI / MAGI for a W-2 earner

    // Qualified overtime deduction: below the line (doesn't change AGI), not for FICA or city tax.
    const otDeduction = overtimeDeduction(input.overtimePremium, status, federalWages);

    // Federal income tax
    const standardDeduction = FEDERAL.standardDeduction[status];
    const federalTaxable = Math.max(0, federalWages - standardDeduction - otDeduction);
    const federalBeforeCredits = bracketTax(federalTaxable, FEDERAL.brackets[status]);
    const phaseoutExcess = Math.max(0, federalWages - FEDERAL.childTaxCreditPhaseoutStart[status]);
    const childCredit = Math.max(0,
      dependents * FEDERAL.childTaxCredit + otherDependents * FEDERAL.otherDependentCredit -
      Math.ceil(phaseoutExcess / 1000) * FEDERAL.childTaxCreditPhaseoutPer1000);
    const federal = Math.max(0, federalBeforeCredits - childCredit);

    // FICA
    const socialSecurity = Math.min(ficaWages, FICA.socialSecurityWageBase) * FICA.socialSecurityRate;
    const medicare = ficaWages * FICA.medicareRate +
      Math.max(0, ficaWages - FICA.additionalMedicareThreshold[status]) * FICA.additionalMedicareRate;

    // Michigan: starts from federal AGI, one exemption per filer plus dependents.
    const exemptions = (status === "mfj" ? 2 : 1) + dependents + otherDependents;
    const michiganOvertime = MICHIGAN.overtimeDeduction ? otDeduction : 0;
    const michiganTaxable = Math.max(0, federalWages - michiganOvertime - exemptions * MICHIGAN.personalExemption);
    const michigan = michiganTaxable * MICHIGAN.rate;

    // City: 401(k) deferrals stay taxable under the Uniform City Income Tax Ordinance
    // (Section 125 benefits don't); the overtime deduction doesn't apply to city tax.
    const city = findCity(input.cityId);
    const cityRate = input.cityResident === false ? city.nonresident : city.resident;
    const cityTaxable = Math.max(0, ficaWages - exemptions * city.exemption);
    const cityTax = cityTaxable * cityRate;

    const taxes = federal + socialSecurity + medicare + michigan + cityTax;
    const net = gross - benefits - k401 - taxes - extraWithholding;

    return {
      gross,
      k401,
      k401Capped,
      k401Limit,
      isRoth,
      benefits,
      federal,
      childCredit: Math.min(childCredit, federalBeforeCredits),
      socialSecurity,
      medicare,
      michigan,
      city: cityTax,
      cityRate,
      taxes,
      extraWithholding,
      net,
      effectiveRate: gross > 0 ? taxes / gross : 0,
      federalMarginal: marginalBracket(federalTaxable, FEDERAL.brackets[status]),
      federalTaxable,
      federalWages,
      ficaWages,
      michiganTaxable,
      cityTaxable,
      overtimeDeduction: otDeduction,
    };
  }

  /** Extra annual take-home from a raise of `amount` dollars. */
  function raiseImpact(input, amount) {
    const base = calculate(input);
    const bumped = calculate(Object.assign({}, input, { grossAnnual: num(input.grossAnnual) + amount }));
    return (bumped.net + bumped.extraWithholding) - (base.net + base.extraWithholding);
  }

  function convert(amount, fromPeriod, toPeriod) {
    return (amount * PERIODS[fromPeriod].perYear) / PERIODS[toPeriod].perYear;
  }

  const api = {
    TAX_YEAR, FEDERAL, FICA, MICHIGAN, CITIES, FILING_STATUSES, PERIODS, PAY_PERIODS,
    calculate, raiseImpact, convert, bracketTax, findCity,
    k401LimitFor, overtimeDeduction, supplementalFederalWithholding,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Tax = api;
})(typeof window !== "undefined" ? window : globalThis);

/*
 * State tax data: West and Plains graduated-rate states.
 * Schema: see STATE_SCHEMA in js/state-tax.js. Sources and a confidence flag for each figure are in
 * docs/state-tax-sources/west-plains.md. Figures flagged "unverified" there still need a check against
 * the state's own 2026 publications.
 */
(function (root) {
  "use strict";

  const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);

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

  // ---------- California ----------
  // FTB indexes brackets and credits each fall (June-to-June CCPI), so the 2026 amounts aren't out yet.
  // These are the 2025 amounts, which EDD's 2026 withholding schedules and the 2026 Form 540-ES also use.
  // The 1% Mental Health Services Tax on taxable income over $1,000,000 is folded into the top brackets.
  const CA_SINGLE = [[11079, 0.01], [26264, 0.02], [41452, 0.04], [57542, 0.06], [72724, 0.08],
    [371479, 0.093], [445771, 0.103], [742953, 0.113], [1000000, 0.123], [Infinity, 0.133]];
  const CA_BRACKETS = {
    single: CA_SINGLE,
    mfj: [[22158, 0.01], [52528, 0.02], [82904, 0.04], [115084, 0.06], [145448, 0.08],
      [742958, 0.093], [891542, 0.103], [1000000, 0.113], [1485906, 0.123], [Infinity, 0.133]],
    mfs: CA_SINGLE,
    hoh: [[22173, 0.01], [52530, 0.02], [67716, 0.04], [83805, 0.06], [98990, 0.08],
      [505208, 0.093], [606251, 0.103], [1000000, 0.113], [1010417, 0.123], [Infinity, 0.133]],
  };
  const CA_CREDIT = { filer: 153, dependent: 475 };
  // Each exemption credit shrinks by $6 for each $2,500 ($1,250 MFS), or part of it, of federal AGI over these.
  const CA_CREDIT_PHASEOUT = { single: 252203, mfj: 504411, mfs: 252203, hoh: 378310 };

  // ---------- Oregon ----------
  const OR_SINGLE = [[4550, 0.0475], [11400, 0.0675], [125000, 0.0875], [Infinity, 0.099]];
  const OR_JOINT = [[9100, 0.0475], [22800, 0.0675], [250000, 0.0875], [Infinity, 0.099]];
  const OR_BRACKETS = { single: OR_SINGLE, mfj: OR_JOINT, mfs: OR_SINGLE, hoh: OR_JOINT };
  const OR_EXEMPTION_CREDIT = 260;
  // The exemption credit is lost entirely above this federal AGI.
  const OR_CREDIT_AGI_LIMIT = { single: 100000, mfj: 200000, mfs: 100000, hoh: 200000 };
  // Federal income tax subtraction: capped, and the cap steps down 20% for each $5,000 ($10,000 joint/HOH)
  // of federal AGI from the start of the phase-out, reaching zero at $145,000 ($290,000).
  const OR_FED_SUB_CAP = { single: 8750, mfj: 8750, mfs: 4375, hoh: 8750 };
  const OR_FED_SUB_PHASEOUT = { single: [125000, 5000], mfj: [250000, 10000], mfs: [125000, 5000], hoh: [250000, 10000] };

  function oregonFederalSubtraction(status, agi, federalTax) {
    const [start, step] = OR_FED_SUB_PHASEOUT[status];
    const share = agi < start ? 1 : Math.max(0, 1 - 0.2 * (Math.floor((agi - start) / step) + 1));
    return Math.min(num(federalTax), OR_FED_SUB_CAP[status] * share);
  }

  // ---------- Hawaii ----------
  // Act 46 (SLH 2024) schedule for taxable years beginning after Dec 31, 2024; unchanged for 2026.
  // Joint = 2x and head of household = 1.5x the single thresholds (the HRS 235-51 structure).
  const HI_SINGLE = [[9600, 0.014], [14400, 0.032], [19200, 0.055], [24000, 0.064], [36000, 0.068], [48000, 0.072],
    [125000, 0.076], [175000, 0.079], [225000, 0.0825], [275000, 0.09], [325000, 0.1], [Infinity, 0.11]];
  const scale = (br, k) => br.map(([upper, rate]) => [upper * k, rate]);

  // ---------- Minnesota ----------
  const MN_BRACKETS = {
    single: [[32570, 0.0535], [106990, 0.068], [198630, 0.0785], [Infinity, 0.0985]],
    mfj: [[47620, 0.0535], [189180, 0.068], [330410, 0.0785], [Infinity, 0.0985]],
    mfs: [[23810, 0.0535], [94590, 0.068], [165205, 0.0785], [Infinity, 0.0985]],
    hoh: [[40100, 0.0535], [161130, 0.068], [264050, 0.0785], [Infinity, 0.0985]],
  };
  const MN_DEPENDENT_EXEMPTION = 5200;
  // The standard deduction shrinks by 3% of AGI over this threshold, by at most 80% of the deduction.
  const MN_STD_PHASEOUT = { single: 238950, mfj: 238950, mfs: 119475, hoh: 238950 };

  const STATES = {
    CA: {
      code: "CA",
      name: "California",
      year: 2026,
      kind: "graduated",
      brackets: CA_BRACKETS,
      startsFrom: "agi",
      standardDeduction: { single: 5706, mfj: 11412, mfs: 5706, hoh: 11412 },
      exemptionCredit: CA_CREDIT,
      taxes401k: false,
      overtimeDeduction: false, // California conforms to the IRC as of Jan 1, 2025, before the OBBBA
      supplementalRate: 0.1023, // EDD: 10.23% on bonuses and stock options (6.6% on other supplemental wages)
      payroll: [{ id: "ca-sdi", name: "CA SDI", rate: 0.013 }], // no wage cap since 2024
      locals: [],
      // Exemption credits phase out with federal AGI.
      compute(ctx, generic) {
        const status = ctx.status;
        const over = num(ctx.agi) - CA_CREDIT_PHASEOUT[status];
        const cut = over > 0 ? 6 * Math.ceil(over / (status === "mfs" ? 1250 : 2500)) : 0;
        const personal = Math.max(0, (CA_CREDIT.filer - cut) * ctx.filers);
        const dependents = Math.max(0, (CA_CREDIT.dependent - cut) * ctx.dependents);
        const tax = bracketTax(generic.taxable, CA_BRACKETS[status]) - personal - dependents;
        return { taxable: generic.taxable, tax: Math.max(0, tax) };
      },
      notes: [
        "Uses California's 2025 brackets and credits; the 2026 inflation update isn't published yet.",
        "HSA contributions are taxable in California; this estimate doesn't add them back.",
      ],
      sources: [
        "https://www.ftb.ca.gov/forms/2025/2025-540-tax-rate-schedules.pdf",
        "https://www.ftb.ca.gov/forms/2025/2025-540-instructions.html",
        "https://www.ftb.ca.gov/forms/2026/2026-540-es-instructions.html",
        "https://edd.ca.gov/siteassets/files/pdf_pub_ctr/26methb.pdf",
        "https://edd.ca.gov/siteassets/files/pdf_pub_ctr/de4.pdf",
        "https://edd.ca.gov/siteassets/files/pdf_pub_ctr/de231ps.pdf",
        "https://edd.ca.gov/en/payroll_taxes/rates_and_withholding/",
      ],
    },

    OR: {
      code: "OR",
      name: "Oregon",
      year: 2026,
      kind: "graduated",
      brackets: OR_BRACKETS,
      startsFrom: "agi",
      standardDeduction: { single: 2910, mfj: 5820, mfs: 2910, hoh: 4685 },
      exemptionCredit: { filer: OR_EXEMPTION_CREDIT, dependent: OR_EXEMPTION_CREDIT },
      taxes401k: false,
      overtimeDeduction: false,
      supplementalRate: 0.08, // optional flat rate on supplemental wages paid separately
      payroll: [
        { id: "or-paid-leave", name: "Paid Leave Oregon", rate: 0.006, wageCap: 184500 }, // 60% of 1%, SSA wage base
        { id: "or-transit", name: "OR statewide transit tax", rate: 0.001 },
      ],
      // Graduated on Oregon taxable income, residents only. Single/MFS use the single threshold, MFJ/HOH the joint one.
      locals: [
        {
          id: "metro-shs",
          name: "Metro SHS tax (Portland metro)",
          type: "brackets-on-state-taxable",
          brackets: {
            single: [[128000, 0], [Infinity, 0.01]],
            mfj: [[205000, 0], [Infinity, 0.01]],
            mfs: [[128000, 0], [Infinity, 0.01]],
            hoh: [[205000, 0], [Infinity, 0.01]],
          },
        },
        {
          id: "metro-shs-multnomah-pfa",
          name: "Metro SHS + Multnomah Preschool for All (Portland)",
          type: "brackets-on-state-taxable",
          brackets: {
            single: [[125000, 0], [128000, 0.015], [250000, 0.025], [Infinity, 0.04]],
            mfj: [[200000, 0], [205000, 0.015], [400000, 0.025], [Infinity, 0.04]],
            mfs: [[125000, 0], [128000, 0.015], [250000, 0.025], [Infinity, 0.04]],
            hoh: [[200000, 0], [205000, 0.015], [400000, 0.025], [Infinity, 0.04]],
          },
        },
      ],
      // Federal tax subtraction (uses ctx.federalTax) and the all-or-nothing exemption credit.
      compute(ctx, generic) {
        const status = ctx.status;
        const agi = num(ctx.agi);
        const fedSub = oregonFederalSubtraction(status, agi, ctx.federalTax);
        const taxable = Math.max(0, ctx.base - fedSub - ctx.standardDeduction);
        const credit = agi > OR_CREDIT_AGI_LIMIT[status] ? 0 : OR_EXEMPTION_CREDIT * (ctx.filers + ctx.dependents);
        return { taxable, tax: Math.max(0, bracketTax(taxable, OR_BRACKETS[status]) - credit) };
      },
      notes: ["Portland's Arts Tax ($35 per adult) isn't included."],
      sources: [
        "https://www.oregon.gov/dor/forms/FormsPubs/publication-or-estimate_101-026_2026.pdf",
        "https://www.oregon.gov/dor/forms/FormsPubs/form-or-W-4-instr_101-402-1_2026.pdf",
        "https://www.oregon.gov/dor/forms/FormsPubs/withholding-tax-formulas_206-436_2026.pdf",
        "https://www.oregon.gov/dor/forms/FormsPubs/form-or-40-inst_101-040-1_2025.pdf",
        "https://www.oregon.gov/employ/NewsAndMedia/Documents/2025-11-18_Tax_Rate_2026_Press_Release.pdf",
        "https://paidleave.oregon.gov/employers/contributions-calculator.html",
        "https://www.oregon.gov/dor/programs/businesses/pages/statewide-transit-tax.aspx",
        "https://www.oregonmetro.gov/what-metro-does/housing-and-homelessness/supportive-housing-services/pay-my-shs-taxes/shs-taxes-faq",
        "https://multco.us/info/multnomah-county-preschool-all-personal-income-tax",
      ],
    },

    HI: {
      code: "HI",
      name: "Hawaii",
      year: 2026,
      kind: "graduated",
      brackets: { single: HI_SINGLE, mfj: scale(HI_SINGLE, 2), mfs: HI_SINGLE, hoh: scale(HI_SINGLE, 1.5) },
      startsFrom: "agi",
      standardDeduction: { single: 8000, mfj: 16000, mfs: 8000, hoh: 12000 },
      personalExemption: { filer: 1144, dependent: 1144 },
      taxes401k: false,
      overtimeDeduction: false,
      // TDI: employees pay up to 0.5% of wages, capped at a weekly maximum ($6.87 in 2025) x 52 weeks.
      payroll: [{ id: "hi-tdi", name: "HI TDI", rate: 0.005, maxAnnual: 357.24 }],
      locals: [],
      notes: ["TDI is the most an employer may withhold; many employers pay all of it."],
      sources: [
        "https://tax.hawaii.gov/forms/d_25table-on/d_25table-on_p13/",
        "https://tax.hawaii.gov/payrollupdate/",
        "https://data.capitol.hawaii.gov/sessions/sessionlaws/Years/SLH2024/SLH2024_Act46.pdf",
        "https://files.hawaii.gov/tax/forms/current/n11ins.pdf",
        "https://labor.hawaii.gov/dcd/",
      ],
    },

    NM: {
      unverified: true, // figures from recall; not checked against 2026 sources (see docs)
      code: "NM",
      name: "New Mexico",
      year: 2026,
      kind: "graduated",
      // 2024 HB 252 schedule, in effect from tax year 2025. HOH uses the joint schedule.
      brackets: {
        single: [[5500, 0.015], [16500, 0.032], [33500, 0.043], [66500, 0.047], [210000, 0.049], [Infinity, 0.059]],
        mfj: [[8000, 0.015], [25000, 0.032], [50000, 0.043], [100000, 0.047], [315000, 0.049], [Infinity, 0.059]],
        mfs: [[4000, 0.015], [12500, 0.032], [25000, 0.043], [50000, 0.047], [157500, 0.049], [Infinity, 0.059]],
        hoh: [[8000, 0.015], [25000, 0.032], [50000, 0.043], [100000, 0.047], [315000, 0.049], [Infinity, 0.059]],
      },
      startsFrom: "agi",
      standardDeduction: "federal",
      taxes401k: false,
      overtimeDeduction: false,
      payroll: [],
      locals: [],
      notes: ["New Mexico's low- and middle-income exemption and dependent deduction aren't included."],
      sources: [
        "https://www.tax.newmexico.gov/",
        "https://www.nmlegis.gov/Legislation/Legislation?chamber=H&legType=B&legNo=252&year=24",
      ],
    },

    MT: {
      unverified: true, // figures from recall; not checked against 2026 sources (see docs)
      code: "MT",
      name: "Montana",
      year: 2026,
      kind: "graduated",
      // HB 337 (2025) for 2026: 4.7% up to $47,500 single / $95,000 joint / $71,250 HOH, then 5.65%.
      brackets: {
        single: [[47500, 0.047], [Infinity, 0.0565]],
        mfj: [[95000, 0.047], [Infinity, 0.0565]],
        mfs: [[47500, 0.047], [Infinity, 0.0565]],
        hoh: [[71250, 0.047], [Infinity, 0.0565]],
      },
      startsFrom: "federalTaxable", // the federal standard deduction applies; no state exemptions since 2024
      standardDeduction: 0,
      taxes401k: false,
      overtimeDeduction: true, // flows through federal taxable income; no Montana add-back known
      payroll: [],
      locals: [],
      notes: [],
      sources: [
        "https://mtrevenue.gov/taxes/individual-income-tax/",
        "https://leg.mt.gov/bills/2025/billpdf/HB0337.pdf",
      ],
    },

    ND: {
      unverified: true, // figures from recall; not checked against 2026 sources (see docs)
      code: "ND",
      name: "North Dakota",
      year: 2026,
      kind: "graduated",
      // 0% / 1.95% / 2.5% on 2025 indexed thresholds; the 2026 update isn't confirmed.
      brackets: {
        single: [[48475, 0], [244825, 0.0195], [Infinity, 0.025]],
        mfj: [[80975, 0], [298075, 0.0195], [Infinity, 0.025]],
        mfs: [[40475, 0], [149050, 0.0195], [Infinity, 0.025]],
        hoh: [[64950, 0], [271450, 0.0195], [Infinity, 0.025]],
      },
      startsFrom: "federalTaxable",
      standardDeduction: 0,
      taxes401k: false,
      overtimeDeduction: true, // flows through federal taxable income; no North Dakota add-back known
      payroll: [],
      locals: [],
      notes: [],
      sources: ["https://www.tax.nd.gov/"],
    },

    NE: {
      unverified: true, // figures from recall; not checked against 2026 sources (see docs)
      code: "NE",
      name: "Nebraska",
      year: 2026,
      kind: "graduated",
      // LB 754 rates for 2026 (2.46% / 3.51% / 4.55% / 4.55%) on 2025 indexed thresholds.
      brackets: {
        single: [[4030, 0.0246], [24120, 0.0351], [38870, 0.0455], [Infinity, 0.0455]],
        mfj: [[8040, 0.0246], [48250, 0.0351], [77730, 0.0455], [Infinity, 0.0455]],
        mfs: [[4030, 0.0246], [24120, 0.0351], [38870, 0.0455], [Infinity, 0.0455]],
        hoh: [[7510, 0.0246], [38590, 0.0351], [57630, 0.0455], [Infinity, 0.0455]],
      },
      startsFrom: "agi",
      standardDeduction: { single: 8600, mfj: 17200, mfs: 8600, hoh: 12600 },
      exemptionCredit: { filer: 171, dependent: 171 },
      taxes401k: false,
      overtimeDeduction: false,
      payroll: [],
      locals: [],
      notes: [],
      sources: [
        "https://revenue.nebraska.gov/individuals",
        "https://nebraskalegislature.gov/laws/statutes.php?statute=77-2715.03",
      ],
    },

    KS: {
      unverified: true, // figures from recall; not checked against 2026 sources (see docs)
      code: "KS",
      name: "Kansas",
      year: 2026,
      kind: "graduated",
      // 2024 SB 1: 5.2% up to $23,000 ($46,000 joint), 5.58% above.
      brackets: {
        single: [[23000, 0.052], [Infinity, 0.0558]],
        mfj: [[46000, 0.052], [Infinity, 0.0558]],
        mfs: [[23000, 0.052], [Infinity, 0.0558]],
        hoh: [[23000, 0.052], [Infinity, 0.0558]],
      },
      startsFrom: "agi",
      standardDeduction: { single: 3605, mfj: 8240, mfs: 4120, hoh: 6180 },
      personalExemption: { filer: 9160, dependent: 2320 },
      taxes401k: false,
      overtimeDeduction: false,
      payroll: [],
      locals: [],
      notes: [],
      sources: ["https://www.ksrevenue.gov/perstaxtypesii.html"],
    },

    MN: {
      unverified: true, // figures from recall; not checked against 2026 sources (see docs)
      code: "MN",
      name: "Minnesota",
      year: 2026,
      kind: "graduated",
      brackets: MN_BRACKETS, // 2025 indexed thresholds; the 2026 update isn't confirmed
      startsFrom: "agi",
      standardDeduction: { single: 14950, mfj: 29900, mfs: 14950, hoh: 22500 },
      personalExemption: { filer: 0, dependent: MN_DEPENDENT_EXEMPTION },
      taxes401k: false,
      overtimeDeduction: false,
      // Paid Leave premium is 0.88%; employers may deduct up to half from wages, up to the SSA wage base.
      payroll: [{ id: "mn-paid-leave", name: "MN Paid Leave", rate: 0.0044, wageCap: 184500 }],
      locals: [],
      // Standard deduction phase-out at higher incomes.
      compute(ctx, generic) {
        const over = num(ctx.agi) - MN_STD_PHASEOUT[ctx.status];
        if (over <= 0) return generic;
        const std = ctx.standardDeduction - Math.min(0.03 * over, 0.8 * ctx.standardDeduction);
        const taxable = Math.max(0, ctx.base - std - MN_DEPENDENT_EXEMPTION * ctx.dependents);
        return { taxable, tax: bracketTax(taxable, MN_BRACKETS[ctx.status]) };
      },
      notes: ["Paid Leave assumes your employer passes on half the premium, the most it may."],
      sources: [
        "https://www.revenue.state.mn.us/minnesota-income-tax-rates-and-brackets",
        "https://paidleave.mn.gov/",
      ],
    },
  };

  if (typeof module !== "undefined" && module.exports) module.exports = STATES;
  else root.StateTax.register(STATES);
})(typeof window !== "undefined" ? window : globalThis);

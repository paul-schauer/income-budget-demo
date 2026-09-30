/*
 * State tax data: West and Plains graduated-rate states.
 * Schema: see STATE_SCHEMA in js/state-tax.js. Sources and a confidence flag for each figure are in
 * docs/state-tax-sources/west-plains.md. Figures flagged "unverified" there still need a check against
 * the state's own 2026 publications.
 */
/**
 * @typedef {import("../../types/tax").Brackets} Brackets
 * @typedef {import("../../types/tax").FilingStatus} FilingStatus
 */
(function (root) {
  "use strict";

  /** @param {unknown} v */
  const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);

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

  // ---------- California ----------
  // FTB indexes brackets and credits each fall (June-to-June CCPI), so the 2026 amounts aren't out yet.
  // These are the 2025 amounts, which EDD's 2026 withholding schedules and the 2026 Form 540-ES also use.
  // The 1% Mental Health Services Tax on taxable income over $1,000,000 is folded into the top brackets.
  /** @type {Brackets} */
  const CA_SINGLE = [[11079, 0.01], [26264, 0.02], [41452, 0.04], [57542, 0.06], [72724, 0.08],
    [371479, 0.093], [445771, 0.103], [742953, 0.113], [1000000, 0.123], [Infinity, 0.133]];
  /** @type {Record<FilingStatus, Brackets>} */
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
  /** @type {Brackets} */
  const OR_SINGLE = [[4550, 0.0475], [11400, 0.0675], [125000, 0.0875], [Infinity, 0.099]];
  /** @type {Brackets} */
  const OR_JOINT = [[9100, 0.0475], [22800, 0.0675], [250000, 0.0875], [Infinity, 0.099]];
  /** @type {Record<FilingStatus, Brackets>} */
  const OR_BRACKETS = { single: OR_SINGLE, mfj: OR_JOINT, mfs: OR_SINGLE, hoh: OR_JOINT };
  const OR_EXEMPTION_CREDIT = 260;
  // The exemption credit is lost entirely above this federal AGI.
  const OR_CREDIT_AGI_LIMIT = { single: 100000, mfj: 200000, mfs: 100000, hoh: 200000 };
  // Federal income tax subtraction: capped, and the cap steps down 20% for each $5,000 ($10,000 joint/HOH)
  // of federal AGI from the start of the phase-out, reaching zero at $145,000 ($290,000).
  const OR_FED_SUB_CAP = { single: 8750, mfj: 8750, mfs: 4375, hoh: 8750 };
  /** @type {Record<FilingStatus, [number, number]>} */
  const OR_FED_SUB_PHASEOUT = { single: [125000, 5000], mfj: [250000, 10000], mfs: [125000, 5000], hoh: [250000, 10000] };

  /** @param {FilingStatus} status @param {number} agi @param {number | undefined} federalTax */
  function oregonFederalSubtraction(status, agi, federalTax) {
    const [start, step] = OR_FED_SUB_PHASEOUT[status];
    const share = agi < start ? 1 : Math.max(0, 1 - 0.2 * (Math.floor((agi - start) / step) + 1));
    return Math.min(num(federalTax), OR_FED_SUB_CAP[status] * share);
  }

  // ---------- Hawaii ----------
  // Act 46 (SLH 2024) schedule for taxable years beginning after Dec 31, 2024; unchanged for 2026.
  // Joint = 2x and head of household = 1.5x the single thresholds (the HRS 235-51 structure).
  /** @type {Brackets} */
  const HI_SINGLE = [[9600, 0.014], [14400, 0.032], [19200, 0.055], [24000, 0.064], [36000, 0.068], [48000, 0.072],
    [125000, 0.076], [175000, 0.079], [225000, 0.0825], [275000, 0.09], [325000, 0.1], [Infinity, 0.11]];
  /** @param {Brackets} br @param {number} k @returns {Brackets} */
  const scale = (br, k) => br.map(([upper, rate]) => [upper * k, rate]);

  // ---------- Minnesota ----------
  // 2026 amounts from MN Revenue's December 2025 release and "Tax Year 2026 Inflation-Adjusted Amounts".
  /** @type {Record<FilingStatus, Brackets>} */
  const MN_BRACKETS = {
    single: [[33310, 0.0535], [109430, 0.068], [203150, 0.0785], [Infinity, 0.0985]],
    mfj: [[48700, 0.0535], [193480, 0.068], [337930, 0.0785], [Infinity, 0.0985]],
    mfs: [[24350, 0.0535], [96740, 0.068], [168965, 0.0785], [Infinity, 0.0985]],
    hoh: [[41010, 0.0535], [164800, 0.068], [270060, 0.0785], [Infinity, 0.0985]],
  };
  const MN_DEPENDENT_EXEMPTION = 5300;
  // Minn. Stat. 290.0123 subd. 3: the standard deduction shrinks by 3% of AGI between the two thresholds plus
  // 10% of AGI over the second, by at most 80% of the deduction.
  /** @type {Record<FilingStatus, [number, number]>} */
  const MN_STD_PHASEOUT = { single: [244400, 337800], mfj: [244400, 337800], mfs: [122200, 168900], hoh: [244400, 337800] };
  // Dependent exemptions lose 2 percentage points for each $2,500 ($1,250 MFS), or part of it, of AGI over these.
  // Single and MFS are the 2026 amounts; MFJ and HOH are 2025's, as the 2026 ones aren't confirmed.
  const MN_DEP_PHASEOUT = { single: 244500, mfj: 358550, mfs: 183350, hoh: 298800 };

  // ---------- Kansas ----------
  /** @type {Brackets} */
  const KS_SINGLE = [[23000, 0.052], [Infinity, 0.0558]];
  /** @type {Record<FilingStatus, Brackets>} */
  const KS_BRACKETS = { single: KS_SINGLE, mfj: [[46000, 0.052], [Infinity, 0.0558]], mfs: KS_SINGLE, hoh: KS_SINGLE };
  // K.S.A. 79-32,121: heads of household get one more $2,320 exemption on top of their own and their dependents'.
  const KS_HOH_EXEMPTION = 2320;

  /** @type {import("../../types/tax").StateTable} */
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
      unverified: true, // exemptions, dependent deduction and bonus rate not confirmed (see docs)
      code: "NM",
      name: "New Mexico",
      year: 2026,
      kind: "graduated",
      // NMSA 7-2-7 as amended by 2024 HB 252, for tax years from 2025; not indexed. HOH uses the joint schedule.
      brackets: {
        single: [[5500, 0.015], [16500, 0.032], [33500, 0.043], [66500, 0.047], [210000, 0.049], [Infinity, 0.059]],
        mfj: [[8000, 0.015], [25000, 0.032], [50000, 0.043], [100000, 0.047], [315000, 0.049], [Infinity, 0.059]],
        mfs: [[4000, 0.015], [12500, 0.032], [25000, 0.043], [50000, 0.047], [157500, 0.049], [Infinity, 0.059]],
        hoh: [[8000, 0.015], [25000, 0.032], [50000, 0.043], [100000, 0.047], [315000, 0.049], [Infinity, 0.059]],
      },
      startsFrom: "agi",
      standardDeduction: "federal", // New Mexico follows the OBBBA federal standard deduction
      taxes401k: false,
      overtimeDeduction: false, // 2026 HB 264 would have added one; it wasn't enacted
      payroll: [], // the Workers' Compensation fee is $2 a quarter, not a rate; no paid-leave program
      locals: [],
      notes: ["New Mexico's low- and middle-income exemption and $4,000 dependent deduction aren't included."],
      sources: [
        "https://www.nmlegis.gov/Sessions/24%20Regular/bills/house/HB0252.HTML",
        "https://www.tax.newmexico.gov/all-nm-taxes/current-historic-tax-rates-overview/personal-income-tax-rates/",
        "https://www.nmlegis.gov/handouts/ZFFSS%20073125%20Item%203%20OBBBA%20Tax%20Presentation.pdf",
        "https://www.nmlegis.gov/Sessions/26%20Regular/AgencyAnalysis/HB0264_333.pdf",
        "https://www.tax.newmexico.gov/businesses/withholding-tax-and-workers-compensation/",
      ],
    },

    MT: {
      code: "MT",
      name: "Montana",
      year: 2026,
      kind: "graduated",
      // HB 337 (2025) for 2026: 4.7% up to $47,500 ($95,000 joint, $71,250 HOH), then 5.65%.
      brackets: {
        single: [[47500, 0.047], [Infinity, 0.0565]],
        mfj: [[95000, 0.047], [Infinity, 0.0565]],
        mfs: [[47500, 0.047], [Infinity, 0.0565]],
        hoh: [[71250, 0.047], [Infinity, 0.0565]],
      },
      startsFrom: "federalTaxable", // the federal standard deduction applies; no state exemptions since 2024
      standardDeduction: 0,
      taxes401k: false,
      overtimeDeduction: true, // flows through federal taxable income (Legislative Fiscal Division)
      supplementalRate: 0.05, // optional flat rate on supplemental wages paid separately
      payroll: [],
      locals: [],
      notes: ["Montana adds back the federal QBI deduction; this estimate doesn't, so it runs low on self-employment income."],
      sources: [
        "https://revenue.mt.gov/news/recent-news/HB-337",
        "https://revenue.mt.gov/news/recent-news/2026-withholding-updates",
        "https://revenue.mt.gov/files/BIT/Montana_Employer_and_Information_Agent_Guide_with_Tax_Tables-1.pdf",
        "https://revenue.mt.gov/montana-tax-simplification-resource-hub",
        "https://archive.legmt.gov/content/Committees/Interim/2025-2026/RIC/Meetings/July_11_2025/2.12.Updated-HR1-Impacts-to-Montana-Revenue.pdf",
        "https://mca.legmt.gov/bills/mca/title_0390/chapter_0510/part_0310/section_0030/0390-0510-0310-0030.html",
      ],
    },

    ND: {
      unverified: true, // the 2026 married-filing-separately 2.5% threshold isn't confirmed (see docs)
      code: "ND",
      name: "North Dakota",
      year: 2026,
      kind: "graduated",
      // 2026 schedules from Form ND-1ES 2026. The MFS 2.5% threshold is half the joint one, like its 0% threshold.
      brackets: {
        single: [[49575, 0], [250400, 0.0195], [Infinity, 0.025]],
        mfj: [[82800, 0], [304850, 0.0195], [Infinity, 0.025]],
        mfs: [[41400, 0], [152425, 0.0195], [Infinity, 0.025]],
        hoh: [[66400, 0], [277600, 0.0195], [Infinity, 0.025]],
      },
      startsFrom: "federalTaxable",
      standardDeduction: 0,
      taxes401k: false,
      overtimeDeduction: true, // flows through federal taxable income (Tax Commissioner's OBBBA estimates)
      supplementalRate: 0.015,
      payroll: [],
      locals: [],
      notes: [],
      sources: [
        "https://www.tax.nd.gov/sites/www/files/documents/forms/software-developer/individual-income-forms/28709-form-nd-1es-2026%20final.pdf",
        "https://www.tax.nd.gov/sites/www/files/documents/forms/individual/2026-iit/2026-income-tax-withholding-rates-booklet.pdf",
        "https://www.tax.nd.gov/sites/www/files/documents/forms/individual/2025-iit/28702-form-nd-1-2025.pdf",
        "https://ndlegis.gov/sites/default/files/pdf/committees/69-2025/27.5083.03000appendixf.pdf",
      ],
    },

    NE: {
      unverified: true, // the 2026 head-of-household thresholds aren't confirmed (see docs)
      code: "NE",
      name: "Nebraska",
      year: 2026,
      kind: "graduated",
      // LB 754 (2023) rates for 2026: 2.46% / 3.51% / 4.55%. The third and fourth brackets are both 4.55%, so
      // they're merged. HOH thresholds are the 2025 ones; the 2026 ones aren't confirmed.
      brackets: {
        single: [[4130, 0.0246], [24760, 0.0351], [Infinity, 0.0455]],
        mfj: [[8260, 0.0246], [49520, 0.0351], [Infinity, 0.0455]],
        mfs: [[4130, 0.0246], [24760, 0.0351], [Infinity, 0.0455]],
        hoh: [[7510, 0.0246], [38590, 0.0351], [Infinity, 0.0455]],
      },
      startsFrom: "agi",
      standardDeduction: { single: 8850, mfj: 17700, mfs: 8850, hoh: 12950 },
      exemptionCredit: { filer: 176, dependent: 176 },
      taxes401k: false,
      overtimeDeduction: false, // 2026 LB 932 would have added one; it didn't pass
      supplementalRate: 0.035, // optional flat rate, down from 5% in 2025
      payroll: [],
      locals: [],
      notes: [],
      sources: [
        "https://revenue.nebraska.gov/sites/default/files/doc/research/chronology/4-607table1.pdf",
        "https://revenue.nebraska.gov/sites/default/files/doc/tax-forms/drafts/2026_tax_tables.pdf",
        "https://revenue.nebraska.gov/sites/default/files/doc/tax-forms/drafts/f_1040n-es.pdf",
        "https://revenue.nebraska.gov/sites/default/files/doc/business/Cir_En_2025/2026cir_en_whole.pdf",
        "https://nebraskalegislature.gov/laws/statutes.php?statute=77-2715.03",
        "https://nebraskalegislature.gov/bills/view_bill.php?DocumentID=63391",
      ],
    },

    KS: {
      code: "KS",
      name: "Kansas",
      year: 2026,
      kind: "graduated",
      // K.S.A. 79-32,110 (2024 SB 1). SB 269's rate-cut trigger did not fire for 2026.
      brackets: KS_BRACKETS,
      startsFrom: "agi",
      standardDeduction: { single: 3605, mfj: 8240, mfs: 4120, hoh: 6180 }, // fixed by K.S.A. 79-32,119; not indexed
      personalExemption: { filer: 9160, dependent: 2320 },
      taxes401k: false,
      overtimeDeduction: false,
      supplementalRate: 0.05,
      payroll: [],
      locals: [],
      // The extra head-of-household exemption.
      compute(ctx, generic) {
        if (ctx.status !== "hoh") return generic;
        const taxable = Math.max(0, generic.taxable - KS_HOH_EXEMPTION);
        return { taxable, tax: bracketTax(taxable, KS_BRACKETS.hoh) };
      },
      notes: [],
      sources: [
        "https://ksrevisor.gov/statutes/chapters/ch79/079_032_0110.html",
        "https://ksrevisor.gov/statutes/chapters/ch79/079_032_0119.html",
        "https://ksrevisor.gov/statutes/chapters/ch79/079_032_0121.html",
        "https://www.ksrevenue.gov/pdf/2025LegChangesPresentation.pdf",
        "https://www.ksrevenue.gov/pdf/kw100.pdf",
        "https://ksrevenue.gov/prnewtaxnotices.html",
      ],
    },

    MN: {
      unverified: true, // the 2026 MFJ and HOH dependent-exemption phase-out thresholds aren't confirmed (see docs)
      code: "MN",
      name: "Minnesota",
      year: 2026,
      kind: "graduated",
      brackets: MN_BRACKETS,
      startsFrom: "agi",
      standardDeduction: { single: 15300, mfj: 30600, mfs: 15300, hoh: 23000 },
      personalExemption: { filer: 0, dependent: MN_DEPENDENT_EXEMPTION },
      taxes401k: false,
      overtimeDeduction: false, // the 2026 tax bill (Laws 2026, ch. 128) didn't add one
      supplementalRate: 0.0625,
      // Paid Leave premium is 0.88%; employers may deduct up to half. Wages are capped at the SSA wage base
      // ($184,500) rounded to the nearest $1,000 (Minn. Stat. ch. 268B).
      payroll: [{ id: "mn-paid-leave", name: "MN Paid Leave", rate: 0.0044, wageCap: 185000 }],
      locals: [],
      // Standard deduction and dependent exemption phase-outs.
      compute(ctx, generic) {
        const status = ctx.status;
        const agi = num(ctx.agi);
        const [first, second] = MN_STD_PHASEOUT[status];
        const cut = 0.03 * Math.max(0, Math.min(agi, second) - first) + 0.1 * Math.max(0, agi - second);
        const std = ctx.standardDeduction - Math.min(cut, 0.8 * ctx.standardDeduction);
        const over = agi - MN_DEP_PHASEOUT[status];
        const kept = over > 0 ? Math.max(0, 1 - 0.02 * Math.ceil(over / (status === "mfs" ? 1250 : 2500))) : 1;
        const taxable = Math.max(0, ctx.base - std - MN_DEPENDENT_EXEMPTION * kept * ctx.dependents);
        return { taxable, tax: bracketTax(taxable, MN_BRACKETS[status]) };
      },
      notes: ["Paid Leave assumes your employer passes on half the premium, the most it may."],
      sources: [
        "https://www.revenue.state.mn.us/press-release/2025-12-16/minnesota-income-tax-brackets-standard-deduction-and-dependent-exemption",
        "https://www.revenue.state.mn.us/sites/default/files/2025-12/inflation-adjusted-amounts-2026.pdf",
        "https://www.revenue.state.mn.us/sites/default/files/2026-04/w-4mn.pdf",
        "https://www.revenue.state.mn.us/sites/default/files/2025-12/wh-inst-26.pdf",
        "https://www.revisor.mn.gov/statutes/cite/290.0123",
        "https://www.revenue.state.mn.us/tax-law-changes",
        "https://pl.mn.gov/resources/calculators/premium-rate-and-contributions",
        "https://www.revisor.mn.gov/statutes/cite/268B.14",
      ],
    },
  };

  if (typeof module !== "undefined" && module.exports) module.exports = STATES;
  else root.StateTax.register(STATES);
})(/** @type {Window & typeof globalThis} */ (typeof window !== "undefined" ? window : globalThis));

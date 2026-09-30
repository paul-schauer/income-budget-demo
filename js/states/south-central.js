/*
 * State tax data: South and Central states (AL, AR, KY, LA, MO, MS, NC, OK, SC, VA, WI, WV).
 * Schema: see STATE_SCHEMA in js/state-tax.js. Sources for each figure are in
 * docs/state-tax-sources/south-central.md.
 *
 * Entries with a compute() override keep headline amounts in the plain fields (for example the
 * standard deduction before its phase-out) and apply the full rule in compute().
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

  const byStatus = (single, mfj, mfs = single, hoh = single) => ({ single, mfj, mfs, hoh });

  /** Earned income of the first two earners: wages less traditional 401(k). */
  function earned(ctx) {
    const e = (ctx.earners || []).slice(0, 2).map((x) => Math.max(0, num(x.wages) - num(x.k401Trad)));
    while (e.length < 2) e.push(0);
    return e;
  }

  /** Each spouse's share of the household's state income, split in proportion to earned income. */
  function spouseShares(ctx) {
    const [a, b] = earned(ctx);
    const base = num(ctx.base);
    if (!(a + b > 0)) return [base, 0];
    return [(base * a) / (a + b), (base * b) / (a + b)];
  }

  // ---------- Alabama ----------
  const AL_BRACKETS = byStatus([[500, 0.02], [3000, 0.04], [Infinity, 0.05]], [[1000, 0.02], [6000, 0.04], [Infinity, 0.05]]);
  // Code of Ala. 40-18-15(b): the maximum applies below the AGI threshold, then drops by `cut` for each
  // full `step` of AGI above it, down to a floor.
  const AL_STD = {
    single: { max: 3000, min: 2500, start: 25500, step: 500, cut: 25 },
    mfj: { max: 8500, min: 5000, start: 25500, step: 500, cut: 175 },
    mfs: { max: 4250, min: 2500, start: 12750, step: 250, cut: 88 },
    hoh: { max: 5200, min: 2500, start: 25500, step: 500, cut: 135 },
  };
  function alStandardDeduction(agi, status) {
    const p = AL_STD[status];
    const steps = Math.max(0, Math.floor((agi - p.start) / p.step));
    return Math.max(p.min, p.max - steps * p.cut);
  }
  const alDependentExemption = (agi) => (agi <= 50000 ? 1000 : agi <= 100000 ? 500 : 300);

  // ---------- Arkansas (Act 1 of 2026, 1st Extraordinary Session) ----------
  const AR_STANDARD_TABLE = [[5600, 0], [11200, 0.02], [16000, 0.03], [26400, 0.034], [Infinity, 0.037]];
  const AR_UPPER_TABLE = [[4700, 0.02], [Infinity, 0.037]];
  const AR_UPPER_START = 94700;
  const AR_STD_EACH = 2470;
  function arTableTax(netIncome) {
    if (netIncome <= AR_UPPER_START) return bracketTax(netIncome, AR_STANDARD_TABLE);
    // Bracket adjustment: $290 just above the threshold, $10 less per $100, gone at $97,600.
    const adjustment = Math.max(0, 290 - 10 * Math.floor((netIncome - AR_UPPER_START) / 100));
    return Math.max(0, bracketTax(netIncome, AR_UPPER_TABLE) - adjustment);
  }

  // ---------- Missouri ----------
  const MO_BRACKETS = [[1348, 0], [2696, 0.02], [4044, 0.025], [5392, 0.03], [6740, 0.035], [8088, 0.04], [9436, 0.045], [Infinity, 0.047]];
  // Share of federal income tax that is deductible, by Missouri AGI (RSMo 143.171).
  const moFederalTaxShare = (agi) => (agi <= 25000 ? 0.35 : agi <= 50000 ? 0.25 : agi <= 100000 ? 0.15 : agi <= 125000 ? 0.05 : 0);

  // ---------- Oklahoma (HB 2764 of 2025) ----------
  const OK_SINGLE = [[3750, 0], [4900, 0.025], [7200, 0.035], [Infinity, 0.045]];
  const OK_JOINT = [[7500, 0], [9800, 0.025], [14400, 0.035], [Infinity, 0.045]];

  // ---------- South Carolina (H.4216, Act 110 of 2026) ----------
  const SC_BRACKETS = [[30000, 0.0199], [Infinity, 0.0521]];
  // SC Income Adjusted Deduction: base amount, reduced by the fraction (AGI - start) / width.
  const SC_SCIAD = {
    single: { base: 15000, start: 40000, width: 55000 },
    mfj: { base: 30000, start: 80000, width: 110000 },
    mfs: { base: 15000, start: 40000, width: 55000 },
    hoh: { base: 22500, start: 60000, width: 82500 },
  };
  const SC_DEPENDENT_EXEMPTION = 4930; // 2025 amount; the 2026 indexed amount isn't published yet

  // ---------- Virginia ----------
  const VA_BRACKETS = [[3000, 0.02], [5000, 0.03], [17000, 0.05], [Infinity, 0.0575]];

  // ---------- West Virginia (SB 392 of 2026) ----------
  const WV_BRACKETS = [[10000, 0.0211], [25000, 0.0281], [40000, 0.0316], [60000, 0.0422], [Infinity, 0.0458]];
  const WV_MFS = [[5000, 0.0211], [12500, 0.0281], [20000, 0.0316], [30000, 0.0422], [Infinity, 0.0458]];

  // ---------- Wisconsin ----------
  const WI_BRACKETS = byStatus(
    [[15110, 0.035], [51950, 0.044], [332720, 0.053], [Infinity, 0.0765]],
    [[20150, 0.035], [69260, 0.044], [443630, 0.053], [Infinity, 0.0765]],
    [[10080, 0.035], [34630, 0.044], [221820, 0.053], [Infinity, 0.0765]],
  );
  // Sliding-scale standard deduction (2025 amounts; the 2026 table isn't confirmed).
  const WI_STD = {
    single: { max: 13560, start: 19550, rate: 0.12 },
    mfj: { max: 25110, start: 28210, rate: 0.19778 },
    mfs: { max: 11930, start: 13390, rate: 0.19778 },
    hoh: { max: 17520, start: 19550, rate: 0.22515 },
  };
  function wiStandardDeduction(agi, status) {
    const line = (p) => Math.max(0, p.max - p.rate * Math.max(0, agi - p.start));
    // Head of household phases out faster until it meets the single amount, then follows it.
    if (status === "hoh") return Math.max(line(WI_STD.hoh), line(WI_STD.single));
    return line(WI_STD[status]);
  }

  // ---------- Kentucky ----------
  const KY_RATE = 0.035;
  const KY_STD = 3270; // 2025 amount; the 2026 amount isn't confirmed

  // ---------- Mississippi (HB 1 of 2025) ----------
  const MS_ZERO_BAND = 10000;
  const MS_RATE = 0.04;
  const MS_BRACKETS = [[MS_ZERO_BAND, 0], [Infinity, MS_RATE]];
  const MS_EXEMPTION = byStatus(6000, 12000, 6000, 8000);

  // ---------- North Carolina ----------
  const NC_RATE = 0.0399;
  // Child deduction per qualifying child: $3,000, less $500 for each AGI step above the first (G.S. 105-153.5(a1)).
  const NC_CHILD_STEPS = byStatus(
    [20000, 30000, 40000, 50000, 60000, 70000],
    [40000, 60000, 80000, 100000, 120000, 140000],
    [20000, 30000, 40000, 50000, 60000, 70000],
    [30000, 45000, 60000, 75000, 90000, 105000],
  );
  function ncChildDeduction(agi, status) {
    const i = NC_CHILD_STEPS[status].findIndex((upper) => agi <= upper);
    return i === -1 ? 0 : 3000 - 500 * i;
  }

  const STATES = {
    AL: {
      code: "AL",
      name: "Alabama",
      year: 2026,
      kind: "graduated",
      brackets: AL_BRACKETS,
      startsFrom: "agi",
      standardDeduction: byStatus(3000, 8500, 4250, 5200), // maximums; compute applies the AGI-based chart
      personalExemption: { filer: 1500, dependent: 1000 }, // compute: $3,000 for head of family, dependents by AGI
      taxes401k: false,
      overtimeDeduction: false, // Alabama has its own, smaller overtime deduction instead (see compute)
      payroll: [],
      locals: [{ id: "birmingham", name: "Birmingham occupational tax", type: "rate-on-wages", resident: 0.01, nonresident: 0.01 }],
      // AGI-based standard deduction and dependent exemption, the deduction for federal income tax, and
      // Act 2026-604's overtime premium deduction (up to $1,000 per taxpayer).
      compute(ctx) {
        const agi = num(ctx.base);
        const status = ctx.status;
        const personal = status === "mfj" || status === "hoh" ? 3000 : 1500;
        const overtime = Math.min(num(ctx.overtimeDeduction), 1000 * ctx.filers);
        const taxable = Math.max(0, agi - alStandardDeduction(agi, status) - personal
          - alDependentExemption(agi) * ctx.dependents - num(ctx.federalTax) - overtime);
        return { taxable, tax: bracketTax(taxable, AL_BRACKETS[status]) };
      },
      notes: [
        "Birmingham's 1% occupational tax is on pay earned in the city, wherever you live. For other Alabama occupational taxes, use Other local tax %.",
      ],
      sources: [
        "https://www.revenue.alabama.gov/wp-content/uploads/2026/01/whbooklet_0126.pdf",
        "https://www.revenue.alabama.gov/wp-content/uploads/2026/01/25f40bk.pdf",
        "https://law.justia.com/codes/alabama/title-40/chapter-18/article-1/section-40-18-15/",
        "https://www.revenue.alabama.gov/faqs/how-much-is-the-alabama-standard-deduction/",
        "https://www.revenue.alabama.gov/individual-corporate/overtime-premium-deduction-act-2026-604/",
      ],
    },

    AR: {
      code: "AR",
      name: "Arkansas",
      year: 2026,
      kind: "graduated",
      brackets: byStatus(AR_STANDARD_TABLE, AR_STANDARD_TABLE), // same table for every status
      startsFrom: "agi",
      standardDeduction: byStatus(AR_STD_EACH, 2 * AR_STD_EACH),
      exemptionCredit: { filer: 29, dependent: 29 },
      taxes401k: false,
      overtimeDeduction: false,
      supplementalRate: 0.037,
      payroll: [],
      locals: [],
      // Upper-income table above $94,700 net income, with its bracket adjustment. Married couples get the
      // lower of filing jointly and filing separately on the same return (status 4), where each spouse
      // takes a standard deduction and uses the table on their own income.
      compute(ctx) {
        const credits = 29 * (ctx.filers + ctx.dependents);
        let taxable = Math.max(0, num(ctx.base) - ctx.standardDeduction);
        let tax = arTableTax(taxable);
        if (ctx.status === "mfj") {
          const each = spouseShares(ctx).map((x) => Math.max(0, x - AR_STD_EACH));
          const separate = arTableTax(each[0]) + arTableTax(each[1]);
          if (separate < tax) {
            tax = separate;
            taxable = each[0] + each[1];
          }
        }
        return { taxable, tax: Math.max(0, tax - credits) };
      },
      notes: ["Arkansas's low-income tax tables and credits aren't modeled, so tax on low incomes may be overstated."],
      sources: [
        "https://www.arkleg.state.ar.us/Home/FTPDocument?path=%2FACTS%2F2026S1%2FPublic%2FACT1.pdf",
        "https://www.arkleg.state.ar.us/Home/FTPDocument?path=%2FAssembly%2F2025%2F2026S1%2FFiscal+Impacts%2FHB1001-DFA1.pdf",
        "https://www.dfa.arkansas.gov/wp-content/uploads/whformula_2026.pdf",
        "https://www.dfa.arkansas.gov/wp-content/uploads/withholdInstructions.pdf",
        "https://www.dfa.arkansas.gov/wp-content/uploads/2025_AR1000F_and_AR1000NR_Instructions.pdf",
      ],
    },

    KY: {
      code: "KY",
      name: "Kentucky",
      year: 2026,
      kind: "flat",
      rate: KY_RATE,
      startsFrom: "agi",
      standardDeduction: byStatus(KY_STD, KY_STD),
      taxes401k: false,
      overtimeDeduction: false,
      payroll: [],
      locals: [
        { id: "louisville", name: "Louisville Metro (Jefferson County)", type: "rate-on-wages", resident: 0.022, nonresident: 0.0145 },
        { id: "lexington", name: "Lexington-Fayette", type: "rate-on-wages", resident: 0.0275, nonresident: 0.0225 },
      ],
      // When both spouses earn, filing separately on a combined return (status 3) gives each a standard
      // deduction; at a flat rate that's the only difference from filing jointly.
      compute(ctx) {
        let std = ctx.standardDeduction;
        if (ctx.status === "mfj") std += Math.min(KY_STD, Math.min(...spouseShares(ctx)));
        const taxable = Math.max(0, num(ctx.base) - std);
        return { taxable, tax: taxable * KY_RATE };
      },
      notes: [
        "Louisville: 1.25% Metro + 0.20% TARC, plus the 0.75% school tax for residents. Lexington: 2.25%, plus the 0.5% school tax for residents. Other Kentucky cities and counties: use Other local tax %.",
      ],
      sources: [
        "https://apps.legislature.ky.gov/record/25rs/hb1.html",
        "https://revenue.ky.gov/Forms/740%20(2025).pdf",
        "https://revenue.ky.gov/News/Pages/Kentucky-DOR-Announces-2025-Standard-Deduction.aspx",
        "https://louisvilleky.gov/sites/default/files/2024-12/w-1kjc_instructions_2025.pdf",
        "https://www.lexingtonky.gov/working/business-licensing-taxes/occupational-license-fee-rates-current-forms",
      ],
    },

    LA: {
      code: "LA",
      name: "Louisiana",
      year: 2026,
      kind: "flat",
      rate: 0.03,
      startsFrom: "agi",
      standardDeduction: byStatus(12835, 25670, 12835, 25670),
      taxes401k: false,
      overtimeDeduction: false,
      payroll: [],
      locals: [],
      notes: [],
      sources: [
        "https://www.legis.la.gov/legis/Law.aspx?d=101946",
        "https://www.legis.la.gov/legis/Law.aspx?d=101761",
        "https://dam.ldr.la.gov/taxforms/IT540i%20WEB(2025)D11.pdf",
        "https://bese.louisiana.gov/docs/default-source/rulemaking-docket/feb-louisiana-register.pdf",
      ],
    },

    MO: {
      code: "MO",
      name: "Missouri",
      year: 2026,
      kind: "graduated",
      brackets: byStatus(MO_BRACKETS, MO_BRACKETS), // same brackets for every status
      startsFrom: "agi",
      standardDeduction: "federal",
      taxes401k: false,
      overtimeDeduction: false,
      supplementalRate: 0.047,
      payroll: [],
      locals: [
        { id: "kansas-city", name: "Kansas City earnings tax", type: "rate-on-wages", resident: 0.01, nonresident: 0.01 },
        { id: "st-louis", name: "St. Louis earnings tax", type: "rate-on-wages", resident: 0.01, nonresident: 0.01 },
      ],
      // Deduction for part of federal income tax (35% down to 0% by AGI; capped at $5,000, or $10,000
      // on a joint return), and the $1,400 head-of-household exemption.
      compute(ctx) {
        const agi = num(ctx.base);
        const cap = ctx.status === "mfj" ? 10000 : 5000;
        const federal = Math.min(cap, moFederalTaxShare(agi) * num(ctx.federalTax));
        const hoh = ctx.status === "hoh" ? 1400 : 0;
        const taxable = Math.max(0, agi - ctx.standardDeduction - federal - hoh);
        return { taxable, tax: bracketTax(taxable, MO_BRACKETS) };
      },
      notes: ["Kansas City and St. Louis tax residents on all pay and nonresidents on pay earned in the city."],
      sources: [
        "https://dor.mo.gov/forms/Withholding%20Formula_2026.pdf",
        "https://dor.mo.gov/personal/individual/fitdeduc.php",
        "https://revisor.mo.gov/main/OneSection.aspx?bid=57543&hl=&section=143.121",
        "https://www.kcmo.gov/city-hall/departments/finance/earnings-tax",
        "https://www.stlouis-mo.gov/government/departments/collector/earnings-tax/file-earnings-tax.cfm",
      ],
    },

    MS: {
      code: "MS",
      name: "Mississippi",
      year: 2026,
      kind: "graduated", // 0% on the first $10,000 of taxable income, 4% above
      brackets: byStatus(MS_BRACKETS, MS_BRACKETS),
      startsFrom: "agi",
      standardDeduction: byStatus(2300, 4600, 2300, 3400),
      personalExemption: { filer: 6000, dependent: 1500 },
      taxes401k: false,
      overtimeDeduction: false,
      payroll: [],
      locals: [],
      // Head of family exemption is $8,000. On a joint return each spouse's tax is figured on their own
      // income, and deductions and exemptions can be split to suit, so each spouse can use a $10,000 zero band.
      compute(ctx) {
        const status = ctx.status;
        const taxable = Math.max(0, num(ctx.base) - ctx.standardDeduction - MS_EXEMPTION[status] - 1500 * ctx.dependents);
        if (status !== "mfj") return { taxable, tax: bracketTax(taxable, MS_BRACKETS) };
        const lower = Math.min(...spouseShares(ctx));
        return { taxable, tax: MS_RATE * Math.max(0, taxable - MS_ZERO_BAND - Math.min(MS_ZERO_BAND, lower)) };
      },
      notes: [],
      sources: [
        "https://www.dor.ms.gov/individual/tax-rates",
        "https://www.dor.ms.gov/sites/default/files/tax-forms/individual/80100251%202.pdf",
        "https://law.justia.com/codes/mississippi/title-27/chapter-7/article-1/section-27-7-5/",
        "https://law.justia.com/codes/mississippi/title-27/chapter-7/article-1/section-27-7-21/",
      ],
    },

    NC: {
      code: "NC",
      name: "North Carolina",
      year: 2026,
      kind: "flat",
      rate: NC_RATE,
      startsFrom: "agi",
      standardDeduction: byStatus(12750, 25500, 12750, 19125),
      taxes401k: false,
      overtimeDeduction: false,
      payroll: [],
      locals: [],
      // Child deduction per child, stepping down with AGI.
      compute(ctx) {
        const agi = num(ctx.base);
        const taxable = Math.max(0, agi - ctx.standardDeduction - ncChildDeduction(agi, ctx.status) * ctx.dependents);
        return { taxable, tax: taxable * NC_RATE };
      },
      notes: ["The child deduction assumes every dependent is a child who qualifies for the federal child tax credit."],
      sources: [
        "https://www.ncdor.gov/taxes-forms/individual-income-tax/tax-rate-schedules",
        "https://www.ncdor.gov/taxes-forms/individual-income-tax/filing-topics/north-carolina-standard-deduction-or-north-carolina-itemized-deductions",
        "https://www.ncdor.gov/taxes-forms/individual-income-tax/filing-topics/north-carolina-child-deduction",
        "https://www.ncdor.gov/2025-d-401-individual-income-tax-instructions/open",
      ],
    },

    OK: {
      code: "OK",
      name: "Oklahoma",
      year: 2026,
      kind: "graduated",
      brackets: byStatus(OK_SINGLE, OK_JOINT, OK_SINGLE, OK_JOINT),
      startsFrom: "agi",
      standardDeduction: byStatus(6350, 12700, 6350, 9350),
      personalExemption: { filer: 1000, dependent: 1000 },
      taxes401k: false,
      overtimeDeduction: false,
      supplementalRate: 0.045,
      payroll: [],
      locals: [],
      notes: [],
      sources: [
        "https://oklahoma.gov/content/dam/ok/en/tax/documents/resources/publications/legislation/2025LegislativeUpdate.pdf",
        "https://www.oklahoma.gov/content/dam/ok/en/tax/documents/resources/publications/businesses/withholding-tables/WHTables-2026.pdf",
        "https://oklahoma.gov/tax/individuals/exemptions.html",
      ],
    },

    SC: {
      code: "SC",
      name: "South Carolina",
      year: 2026,
      kind: "graduated",
      brackets: byStatus(SC_BRACKETS, SC_BRACKETS), // same brackets for every status
      // H.4216 moved the starting point from federal taxable income to federal AGI for 2026.
      startsFrom: "agi",
      standardDeduction: byStatus(15000, 30000, 15000, 22500), // SCIAD before its phase-out (see compute)
      personalExemption: { filer: 0, dependent: SC_DEPENDENT_EXEMPTION },
      taxes401k: false,
      overtimeDeduction: false,
      payroll: [],
      locals: [],
      // SC Income Adjusted Deduction phase-out, and the two-wage-earner credit
      // (0.7% of the lower-earning spouse's earned income, up to $50,000).
      compute(ctx) {
        const agi = num(ctx.base);
        const p = SC_SCIAD[ctx.status];
        const fraction = Math.min(1, Math.max(0, (agi - p.start) / p.width));
        const taxable = Math.max(0, agi - p.base * (1 - fraction) - SC_DEPENDENT_EXEMPTION * ctx.dependents);
        let tax = bracketTax(taxable, SC_BRACKETS);
        if (ctx.status === "mfj") tax -= 0.007 * Math.min(50000, Math.min(...earned(ctx)));
        return { taxable, tax: Math.max(0, tax) };
      },
      notes: ["The extra deduction for dependents under age 6 isn't modeled."],
      sources: [
        "https://dor.sc.gov/news/information-about-h-4216",
        "https://www.scstatehouse.gov/sess126_2025-2026/bills/4216.htm",
        "https://dor.sc.gov/sites/dor/files/forms/SC1040Instr_2025.pdf",
        "https://dor.sc.gov/news/south-carolina-withholding-tables-updated-2026",
      ],
    },

    VA: {
      code: "VA",
      name: "Virginia",
      year: 2026,
      kind: "graduated",
      brackets: byStatus(VA_BRACKETS, VA_BRACKETS), // same brackets for every status
      startsFrom: "agi",
      standardDeduction: byStatus(8750, 17500, 8750, 8750),
      personalExemption: { filer: 930, dependent: 930 },
      taxes401k: false,
      overtimeDeduction: false,
      supplementalRate: 0.0575,
      payroll: [],
      locals: [],
      // Spouse tax adjustment: a joint return is taxed as if the lower earner's share of taxable income
      // (up to half) had its own brackets, worth up to $259. Shares are split in proportion to earnings.
      compute(ctx, generic) {
        if (ctx.status !== "mfj") return generic;
        const [a, b] = spouseShares(ctx);
        const ti = generic.taxable;
        const lower = a + b > 0 ? Math.min((ti * Math.min(a, b)) / (a + b), ti / 2) : 0;
        const adjustment = bracketTax(ti, VA_BRACKETS) - bracketTax(lower, VA_BRACKETS) - bracketTax(ti - lower, VA_BRACKETS);
        return { taxable: ti, tax: Math.max(0, generic.tax - Math.min(259, Math.max(0, adjustment))) };
      },
      notes: [],
      sources: [
        "https://www.tax.virginia.gov/deductions",
        "https://www.tax.virginia.gov/news/new-virginia-tax-laws",
        "https://www.tax.virginia.gov/sites/default/files/vatax-pdf/2025-760-instructions.pdf",
        "https://www.tax.virginia.gov/sites/default/files/vatax-pdf/employer-withholding-instructions.pdf",
        "https://www.tax.virginia.gov/laws-rules-decisions/tax-bulletins/26-1",
      ],
    },

    WV: {
      code: "WV",
      name: "West Virginia",
      year: 2026,
      kind: "graduated",
      brackets: byStatus(WV_BRACKETS, WV_BRACKETS, WV_MFS, WV_BRACKETS),
      startsFrom: "agi",
      standardDeduction: 0,
      personalExemption: { filer: 2000, dependent: 2000 },
      taxes401k: false,
      overtimeDeduction: false,
      payroll: [],
      locals: [],
      notes: [],
      sources: [
        "https://tax.wv.gov/Individuals/Pages/PersonalIncomeTaxReductionBill.aspx",
        "https://www.wvlegislature.gov/Bill_Text_HTML/2026_SESSIONS/RS/bills/sb392%20sub1%20enr.pdf",
        "https://tax.wv.gov/Documents/Withholding/it100.2a.pdf",
        "https://tax.wv.gov/Documents/PIT/2025/it140.PersonalIncomeTaxFormsAndInstructions.2025.pdf",
      ],
    },

    WI: {
      code: "WI",
      name: "Wisconsin",
      year: 2026,
      kind: "graduated",
      brackets: WI_BRACKETS,
      startsFrom: "agi",
      standardDeduction: byStatus(WI_STD.single.max, WI_STD.mfj.max, WI_STD.mfs.max, WI_STD.hoh.max), // before phase-out
      personalExemption: { filer: 700, dependent: 700 },
      taxes401k: false,
      overtimeDeduction: false,
      payroll: [],
      locals: [],
      // Sliding-scale standard deduction, and the married couple credit
      // (3% of the lower-earning spouse's earned income, up to $480).
      compute(ctx) {
        const agi = num(ctx.base);
        const status = ctx.status;
        const taxable = Math.max(0, agi - wiStandardDeduction(agi, status) - 700 * (ctx.filers + ctx.dependents));
        let tax = bracketTax(taxable, WI_BRACKETS[status]);
        if (status === "mfj") tax -= Math.min(480, 0.03 * Math.min(...earned(ctx)));
        return { taxable, tax: Math.max(0, tax) };
      },
      notes: [],
      sources: [
        "https://www.revenue.wi.gov/TaxForms2026/2026-Form1-ES-Inst.pdf",
        "https://www.revenue.wi.gov/TaxForms2025/2025-Form1-inst.pdf",
        "https://www.revenue.wi.gov/Pages/FAQS/pcs-taxrates.aspx",
        "https://docs.legis.wisconsin.gov/statutes/statutes/71/i/05/22/dm",
      ],
    },
  };

  if (typeof module !== "undefined" && module.exports) module.exports = STATES;
  else root.StateTax.register(STATES);
})(typeof window !== "undefined" ? window : globalThis);

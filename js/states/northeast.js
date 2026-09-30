/*
 * State tax data: Northeast and Mid-Atlantic graduated-rate states.
 * NY, NJ, CT, RI, VT, ME, DE, MD, DC.
 * Schema: see STATE_SCHEMA in js/state-tax.js. Each figure's source, and how firmly it
 * could be confirmed, is in docs/state-tax-sources/northeast.md.
 */
(function (root) {
  "use strict";

  const INF = Infinity;
  const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);

  // Same arithmetic as the engine's bracketTax (data files load without the engine in Node).
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

  // Whole-or-partial steps of `step` in `excess` ("for each $1,000 or fraction thereof").
  const steps = (excess, step) => (excess > 0 ? Math.ceil(excess / step) : 0);
  // Phase-out fraction rounded to four decimals and capped at 1, as the NY and Maine worksheets do.
  const fraction = (excess, span) => (excess > 0 ? Math.min(1, Math.round((excess / span) * 1e4) / 1e4) : 0);
  const same = (b) => ({ single: b, mfj: b, mfs: b, hoh: b });

  /*
   * Some local taxes pick ONE rate by income and charge it on all of it (Frederick County, MD).
   * The engine's local brackets are marginal, so each step up is spread over a short ramp just
   * above the threshold. Above the ramp the tax is exactly rate × whole income. Inside it (the
   * first $700 to $4,100 above a threshold) it runs up to one step low instead of jumping.
   * table: [[upperBound, rate], ..., [Infinity, rate]]
   */
  function rateOnWholeIncome(table) {
    const out = [];
    for (let i = 0; i < table.length; i++) {
      const [upper, rate] = table[i];
      if (i > 0) {
        const threshold = table[i - 1][0];
        const jump = threshold * (rate - table[i - 1][1]);
        const width = Math.ceil(jump / (0.18 - rate) / 100) * 100;
        out.push([threshold + width, rate + jump / width]);
      }
      out.push([upper, rate]);
    }
    return out;
  }

  // ------------------------------------------------------------------ New York
  // 2026: the first five rates cut by 0.1 point (Chapter 59, Laws of 2025, Part A). Thresholds unchanged.
  const NY_BRACKETS = {
    single: [[8500, 0.039], [11700, 0.044], [13900, 0.0515], [80650, 0.054], [215400, 0.059], [1077550, 0.0685], [5000000, 0.0965], [25000000, 0.103], [INF, 0.109]],
    mfj: [[17150, 0.039], [23600, 0.044], [27900, 0.0515], [161550, 0.054], [323200, 0.059], [2155350, 0.0685], [5000000, 0.0965], [25000000, 0.103], [INF, 0.109]],
    hoh: [[12800, 0.039], [17650, 0.044], [20900, 0.0515], [107650, 0.054], [269300, 0.059], [1616450, 0.0685], [5000000, 0.0965], [25000000, 0.103], [INF, 0.109]],
  };
  NY_BRACKETS.mfs = NY_BRACKETS.single;
  const NY_RECAPTURE_AGI = 107650;

  /*
   * New York's tax computation worksheets for NY AGI over $107,650 (the supplemental tax, or
   * benefit recapture). Worksheet 1 moves all of taxable income onto the flat rate of the bracket
   * that holds $107,650, phased in over the next $50,000 of AGI. Each later worksheet starts from
   * the benefit already recaptured at its bracket's floor L (the "recapture base": previous rate × L
   * less the schedule tax on L, e.g. $333 and $1,140 joint) and phases the rest in over the $50,000
   * of AGI above L.
   */
  function nyTax(taxable, agi, br) {
    const scheduleTax = bracketTax(taxable, br);
    if (agi <= NY_RECAPTURE_AGI) return scheduleTax;
    const first = br.findIndex(([upper]) => upper > NY_RECAPTURE_AGI);
    const k = Math.max(first, br.findIndex(([upper]) => taxable <= upper));
    const floor = k > 0 ? br[k - 1][0] : 0;
    const start = k === first ? NY_RECAPTURE_AGI : floor;
    const recaptured = k === first ? 0 : br[k - 1][1] * floor - bracketTax(floor, br);
    const phaseIn = fraction(agi - start, 50000);
    return scheduleTax + recaptured + phaseIn * (br[k][1] * taxable - scheduleTax - recaptured);
  }

  // ------------------------------------------------------------------ Connecticut
  // Form CT-1040 TCS: Table A (exemption), C (2% rate phase-out add-back), D (recapture) and
  // E (personal tax credit). Unchanged since the 2024 rate cut and not indexed.
  const CT = {
    brackets: {
      single: [[10000, 0.02], [50000, 0.045], [100000, 0.055], [200000, 0.06], [250000, 0.065], [500000, 0.069], [INF, 0.0699]],
      mfj: [[20000, 0.02], [100000, 0.045], [200000, 0.055], [400000, 0.06], [500000, 0.065], [1000000, 0.069], [INF, 0.0699]],
      hoh: [[16000, 0.02], [80000, 0.045], [160000, 0.055], [320000, 0.06], [400000, 0.065], [800000, 0.069], [INF, 0.0699]],
    },
    // Table A: [maximum exemption, AGI where it starts losing $1,000 per $1,000 (or part)].
    exemption: { single: [15000, 30000], mfj: [24000, 48000], mfs: [12000, 24000], hoh: [19000, 38000] },
    // Tables C and D: [AGI start, amount per step, step, maximum].
    addBack: { single: [56500, 25, 5000, 250], mfj: [100500, 50, 5000, 500], mfs: [50250, 25, 2500, 250], hoh: [78500, 40, 4000, 400] },
    recapture: {
      single: [[105000, 25, 5000, 250], [200000, 90, 5000, 2700], [500000, 50, 5000, 450]],
      mfj: [[210000, 50, 10000, 500], [400000, 180, 10000, 5400], [1000000, 100, 10000, 900]],
      mfs: [[105000, 25, 5000, 250], [200000, 90, 5000, 2700], [500000, 50, 5000, 450]],
      hoh: [[168000, 40, 8000, 400], [320000, 140, 8000, 4200], [800000, 80, 8000, 720]],
    },
    // Table E: [CT AGI up to, share of tax credited]; nothing above the last row.
    credit: {
      single: [[18800, 0.75], [19300, 0.7], [19800, 0.65], [20300, 0.6], [20800, 0.55], [21300, 0.5], [21800, 0.45], [22300, 0.4], [25000, 0.35], [25500, 0.3], [26000, 0.25], [26500, 0.2], [31300, 0.15], [31800, 0.14], [32300, 0.13], [32800, 0.12], [33300, 0.11], [60000, 0.1], [60500, 0.09], [61000, 0.08], [61500, 0.07], [62000, 0.06], [62500, 0.05], [63000, 0.04], [63500, 0.03], [64000, 0.02], [64500, 0.01]],
      mfj: [[30000, 0.75], [30500, 0.7], [31000, 0.65], [31500, 0.6], [32000, 0.55], [32500, 0.5], [33000, 0.45], [33500, 0.4], [40000, 0.35], [40500, 0.3], [41000, 0.25], [41500, 0.2], [50000, 0.15], [50500, 0.14], [51000, 0.13], [51500, 0.12], [52000, 0.11], [96000, 0.1], [96500, 0.09], [97000, 0.08], [97500, 0.07], [98000, 0.06], [98500, 0.05], [99000, 0.04], [99500, 0.03], [100000, 0.02], [100500, 0.01]],
      mfs: [[15000, 0.75], [15500, 0.7], [16000, 0.65], [16500, 0.6], [17000, 0.55], [17500, 0.5], [18000, 0.45], [18500, 0.4], [20000, 0.35], [20500, 0.3], [21000, 0.25], [21500, 0.2], [25000, 0.15], [25500, 0.14], [26000, 0.13], [26500, 0.12], [27000, 0.11], [48000, 0.1], [48500, 0.09], [49000, 0.08], [49500, 0.07], [50000, 0.06], [50500, 0.05], [51000, 0.04], [51500, 0.03], [52000, 0.02], [52500, 0.01]],
      hoh: [[24000, 0.75], [24500, 0.7], [25000, 0.65], [25500, 0.6], [26000, 0.55], [26500, 0.5], [27000, 0.45], [27500, 0.4], [34000, 0.35], [34500, 0.3], [35000, 0.25], [35500, 0.2], [44000, 0.15], [44500, 0.14], [45000, 0.13], [45500, 0.12], [46000, 0.11], [74000, 0.1], [74500, 0.09], [75000, 0.08], [75500, 0.07], [76000, 0.06], [76500, 0.05], [77000, 0.04], [77500, 0.03], [78000, 0.02], [78500, 0.01]],
    },
  };
  CT.brackets.mfs = CT.brackets.single;
  const stepAmount = (agi, [start, per, step, max]) => Math.min(max, per * steps(agi - start, step));

  function ctTax(ctx) {
    const s = ctx.status;
    const agi = num(ctx.base);
    const [maxExemption, exemptionStart] = CT.exemption[s];
    const exemption = Math.max(0, maxExemption - 1000 * steps(agi - exemptionStart, 1000));
    const taxable = Math.max(0, agi - exemption);
    let tax = bracketTax(taxable, CT.brackets[s]) + stepAmount(agi, CT.addBack[s]);
    for (const r of CT.recapture[s]) tax += stepAmount(agi, r);
    const row = CT.credit[s].find(([upTo]) => agi <= upTo);
    return { taxable, tax: tax * (1 - (row ? row[1] : 0)) };
  }

  // ------------------------------------------------------------------ Rhode Island
  const RI_BRACKETS = [[82050, 0.0375], [186450, 0.0475], [INF, 0.0599]];
  const RI_EXEMPTION = 5250;

  // ------------------------------------------------------------------ Maine
  // The standard deduction and exemption phase out in a straight line; the dependent credit loses
  // $20 for each $500 (or part) of AGI over the start.
  const ME = {
    std: { single: 15700, mfj: 31400, mfs: 15700, hoh: 23550 },
    stdPhaseOut: { single: [102250, 75000], mfj: [204550, 150000], mfs: [102250, 75000], hoh: [153400, 112500] },
    exemption: 5300,
    exemptionPhaseOut: { single: [333450, 125000], mfj: [400100, 125000], mfs: [200050, 62500], hoh: [366750, 125000] },
    dependentCredit: 305,
    dependentCreditStart: { single: 100000, mfj: 150000, mfs: 75000, hoh: 125000 },
    brackets: {
      single: [[27400, 0.058], [64850, 0.0675], [INF, 0.0715]],
      mfj: [[54850, 0.058], [129750, 0.0675], [INF, 0.0715]],
      hoh: [[41100, 0.058], [97300, 0.0675], [INF, 0.0715]],
    },
  };
  ME.brackets.mfs = ME.brackets.single;

  // ------------------------------------------------------------------ Maryland
  const MD_BRACKETS = {
    single: [[1000, 0.02], [2000, 0.03], [3000, 0.04], [100000, 0.0475], [125000, 0.05], [150000, 0.0525], [250000, 0.055], [500000, 0.0575], [1000000, 0.0625], [INF, 0.065]],
    mfj: [[1000, 0.02], [2000, 0.03], [3000, 0.04], [150000, 0.0475], [175000, 0.05], [225000, 0.0525], [300000, 0.055], [600000, 0.0575], [1200000, 0.0625], [INF, 0.065]],
  };
  MD_BRACKETS.mfs = MD_BRACKETS.single;
  MD_BRACKETS.hoh = MD_BRACKETS.mfj;
  // Each $3,200 exemption by federal AGI: [AGI up to, amount]; $0 above the last row.
  const MD_EXEMPTION = {
    single: [[100000, 3200], [125000, 1600], [150000, 800]],
    mfs: [[100000, 3200], [125000, 1600], [150000, 800]],
    mfj: [[150000, 3200], [175000, 1600], [200000, 800]],
    hoh: [[150000, 3200], [175000, 1600], [200000, 800]],
  };

  // County tax on Maryland taxable income (Withholding Tax Facts 2026). It's owed where you live,
  // so the nonresident rate is 0.
  const mdCounty = (id, name, rate) => ({ id, name, type: "rate-on-state-taxable", resident: rate, nonresident: 0 });
  // Anne Arundel is marginal: 2.70% up to $50,000 ($75,000 joint and HOH), 2.94% up to $400,000
  // ($480,000), 3.20% above.
  const AA_SINGLE = [[50000, 0.027], [400000, 0.0294], [INF, 0.032]];
  const AA_JOINT = [[75000, 0.027], [480000, 0.0294], [INF, 0.032]];
  // Frederick charges one rate on all taxable income, picked by income: 2.25% up to $25,000,
  // 2.75% up to $50,000 ($100,000 joint and HOH), 2.96% up to $150,000 ($250,000), 3.20% above.
  const FREDERICK_SINGLE = rateOnWholeIncome([[25000, 0.0225], [50000, 0.0275], [150000, 0.0296], [INF, 0.032]]);
  const FREDERICK_JOINT = rateOnWholeIncome([[25000, 0.0225], [100000, 0.0275], [250000, 0.0296], [INF, 0.032]]);

  // ------------------------------------------------------------------ Entries
  const STATES = {
    NY: {
      code: "NY",
      name: "New York",
      year: 2026,
      kind: "graduated",
      brackets: NY_BRACKETS,
      startsFrom: "agi",
      standardDeduction: { single: 8000, mfj: 16050, mfs: 8000, hoh: 11200 },
      personalExemption: { filer: 0, dependent: 1000 },
      taxes401k: false,
      overtimeDeduction: false,
      supplementalRate: 0.117,
      payroll: [
        // 0.5% of wages, at most $0.60 a week.
        { id: "ny-sdi", name: "NY disability insurance (SDI)", rate: 0.005, maxAnnual: 31.2 },
        { id: "ny-pfl", name: "NY Paid Family Leave", rate: 0.00432, maxAnnual: 411.91 },
      ],
      locals: [
        {
          id: "nyc",
          name: "New York City",
          type: "brackets-on-state-taxable",
          brackets: {
            single: [[12000, 0.03078], [25000, 0.03762], [50000, 0.03819], [INF, 0.03876]],
            mfj: [[21600, 0.03078], [45000, 0.03762], [90000, 0.03819], [INF, 0.03876]],
            mfs: [[12000, 0.03078], [25000, 0.03762], [50000, 0.03819], [INF, 0.03876]],
            hoh: [[14400, 0.03078], [30000, 0.03762], [60000, 0.03819], [INF, 0.03876]],
          },
        },
        // Residents: 16.75% of New York State tax. Working in Yonkers but living elsewhere: 0.5% of wages.
        { id: "yonkers", name: "Yonkers", type: "percent-of-state-tax", resident: 0.1675, nonresident: 0.005 },
      ],
      compute(ctx, generic) {
        return { taxable: generic.taxable, tax: nyTax(generic.taxable, num(ctx.base), NY_BRACKETS[ctx.status]) };
      },
      notes: ["Doesn't include the Empire State child credit or the NYC and Yonkers household and school tax credits."],
      sources: [
        "https://www.tax.ny.gov/pdf/publications/withholding/nys50_t_nys.pdf",
        "https://www.tax.ny.gov/bus/wt/rate.htm",
        "https://www.tax.ny.gov/pdf/current_forms/it/it2105i.pdf",
        "https://www.tax.ny.gov/pdf/publications/withholding/nys50_t_nyc.pdf",
        "https://www.tax.ny.gov/pdf/publications/withholding/nys50_t_y.pdf",
        "https://www.osc.ny.gov/state-agencies/payroll-bulletins/state-agencies/2416-summary-tax-related-changes-2026",
        "https://paidfamilyleave.ny.gov/2026",
        "https://www.nysenate.gov/legislation/laws/WKC/209",
      ],
    },

    NJ: {
      code: "NJ",
      name: "New Jersey",
      year: 2026,
      kind: "graduated",
      brackets: {
        single: [[20000, 0.014], [35000, 0.0175], [40000, 0.035], [75000, 0.05525], [500000, 0.0637], [1000000, 0.0897], [INF, 0.1075]],
        mfj: [[20000, 0.014], [50000, 0.0175], [70000, 0.0245], [80000, 0.035], [150000, 0.05525], [500000, 0.0637], [1000000, 0.0897], [INF, 0.1075]],
        mfs: [[20000, 0.014], [35000, 0.0175], [40000, 0.035], [75000, 0.05525], [500000, 0.0637], [1000000, 0.0897], [INF, 0.1075]],
        hoh: [[20000, 0.014], [50000, 0.0175], [70000, 0.0245], [80000, 0.035], [150000, 0.05525], [500000, 0.0637], [1000000, 0.0897], [INF, 0.1075]],
      },
      startsFrom: "agi",
      standardDeduction: 0,
      personalExemption: { filer: 1000, dependent: 1500 },
      taxes401k: false, // 401(k) deferrals are excluded; 403(b) and 457 deferrals are not
      overtimeDeduction: false,
      payroll: [
        { id: "nj-tdi", name: "NJ disability insurance (TDI)", rate: 0.0019, wageCap: 171100 },
        { id: "nj-fli", name: "NJ Family Leave Insurance", rate: 0.0023, wageCap: 171100 },
        { id: "nj-ui", name: "NJ unemployment and workforce (UI/WF/SWF)", rate: 0.00425, wageCap: 44800 },
      ],
      locals: [],
      notes: ["Doesn't include the NJ child tax credit (children 5 and under) or the property tax deduction."],
      sources: [
        "https://www.nj.gov/treasury/taxation/pdf/current/njtaxratesch.pdf",
        "https://www.nj.gov/treasury/taxation/pdf/current/1040i.pdf",
        "https://www.nj.gov/labor/lwdhome/press/2025/20251229_newbenefitrates2026.shtml",
        "https://www.nj.gov/labor/ea/employer-services/rate-info/",
      ],
    },

    CT: {
      code: "CT",
      name: "Connecticut",
      year: 2026,
      kind: "graduated",
      brackets: CT.brackets,
      startsFrom: "agi",
      standardDeduction: 0,
      taxes401k: false,
      overtimeDeduction: false,
      payroll: [{ id: "ct-paid-leave", name: "CT Paid Leave", rate: 0.005, wageCap: 184500 }],
      locals: [],
      // Exemption and its phase-out, the 2% rate add-back, recapture, then the personal tax credit.
      compute: (ctx) => ctTax(ctx),
      notes: ["Doesn't include the property tax credit."],
      sources: [
        "https://portal.ct.gov/-/media/drs/forms/2025/income/ct-1040-tcs_1225.pdf",
        "https://portal.ct.gov/-/media/drs/forms/2025/income/2025-ct-1040-instructions_1225.pdf",
        "https://portal.ct.gov/-/media/drs/forms/2025/wth/tpg-211_1225.pdf",
        "https://www.ctpaidleave.org/how-ct-paid-leave-works/contributions",
      ],
    },

    RI: {
      code: "RI",
      name: "Rhode Island",
      year: 2026,
      kind: "graduated",
      brackets: same(RI_BRACKETS),
      startsFrom: "agi",
      standardDeduction: { single: 11200, mfj: 22400, mfs: 11200, hoh: 16800 },
      personalExemption: { filer: RI_EXEMPTION, dependent: RI_EXEMPTION },
      taxes401k: false,
      overtimeDeduction: false,
      payroll: [{ id: "ri-tdi", name: "RI disability insurance (TDI)", rate: 0.011, wageCap: 100000 }],
      locals: [],
      // The standard deduction and exemptions lose 20% for each $7,450 (or part) of AGI over $261,000.
      compute(ctx, generic) {
        const n = steps(num(ctx.base) - 261000, 7450);
        if (!n) return generic;
        const kept = Math.max(0, 1 - 0.2 * n);
        const deductions = (num(ctx.standardDeduction) + RI_EXEMPTION * (ctx.filers + ctx.dependents)) * kept;
        const taxable = Math.max(0, num(ctx.base) - deductions);
        return { taxable, tax: bracketTax(taxable, RI_BRACKETS) };
      },
      notes: [],
      sources: [
        "https://tax.ri.gov/sites/g/files/xkgbur541/files/2025-11/ADV_2025_22_Inflation_Adjustments.pdf",
        "https://tax.ri.gov/sites/g/files/xkgbur541/files/2025-12/2026%20Withholding%20Tax%20Booklet.pdf",
        "https://tax.ri.gov/sites/g/files/xkgbur541/files/2026-01/2026%20RI-1040ES_w.pdf",
        "https://dlt.ri.gov/press-releases/2026-tax-rates-unemployment-insurance-and-temporary-disability-insurance",
      ],
    },

    VT: {
      code: "VT",
      name: "Vermont",
      year: 2026,
      kind: "graduated",
      // 2026 preliminary rates (2026 Form IN-114 instructions).
      brackets: {
        single: [[50750, 0.0335], [122850, 0.066], [256300, 0.076], [INF, 0.0875]],
        mfj: [[84700, 0.0335], [204750, 0.066], [312050, 0.076], [INF, 0.0875]],
        mfs: [[42350, 0.0335], [102375, 0.066], [156025, 0.076], [INF, 0.0875]],
        hoh: [[68000, 0.0335], [175500, 0.066], [284150, 0.076], [INF, 0.0875]],
      },
      startsFrom: "agi",
      standardDeduction: { single: 7850, mfj: 15700, mfs: 7850, hoh: 11800 },
      personalExemption: { filer: 5400, dependent: 5400 },
      taxes401k: false,
      overtimeDeduction: false,
      // Employers pay 0.44% of wages and may deduct up to a quarter of it (0.11%) from pay.
      payroll: [{ id: "vt-child-care", name: "VT child care contribution", rate: 0.0011 }],
      locals: [],
      // Above $150,000 of AGI the tax is at least 3% of AGI.
      compute(ctx, generic) {
        const agi = num(ctx.base);
        return { taxable: generic.taxable, tax: agi > 150000 ? Math.max(generic.tax, 0.03 * agi) : generic.tax };
      },
      notes: [
        "Doesn't include Vermont's child tax credit for young children.",
        "Includes the 0.11% child care contribution employers may deduct from pay.",
      ],
      sources: [
        "https://tax.vermont.gov/sites/tax/files/documents/IN-114-Instr-2026.pdf",
        "https://tax.vermont.gov/sites/tax/files/documents/GB-1210-2026.pdf",
        "https://legislature.vermont.gov/statutes/section/32/151/05822",
        "https://tax.vermont.gov/sites/tax/files/documents/GB-1326.pdf",
      ],
    },

    ME: {
      code: "ME",
      name: "Maine",
      year: 2026,
      kind: "graduated",
      brackets: ME.brackets,
      startsFrom: "agi",
      // Maine's own 2026 amounts, not the federal ones (it switches to federal in 2027).
      standardDeduction: ME.std,
      personalExemption: { filer: ME.exemption, dependent: 0 },
      exemptionCredit: { filer: 0, dependent: ME.dependentCredit },
      taxes401k: false,
      overtimeDeduction: false,
      payroll: [{ id: "me-pfml", name: "Maine Paid Family & Medical Leave", rate: 0.005, wageCap: 184500 }],
      locals: [],
      compute(ctx) {
        const s = ctx.status;
        const agi = num(ctx.base);
        const [stdStart, stdSpan] = ME.stdPhaseOut[s];
        const std = ME.std[s] * (1 - fraction(agi - stdStart, stdSpan));
        const [exStart, exSpan] = ME.exemptionPhaseOut[s];
        const exemption = ME.exemption * ctx.filers * (1 - fraction(agi - exStart, exSpan));
        const taxable = Math.max(0, agi - std - exemption);
        const credit = Math.max(0, ME.dependentCredit * ctx.dependents - 20 * steps(agi - ME.dependentCreditStart[s], 500));
        return { taxable, tax: Math.max(0, bracketTax(taxable, ME.brackets[s]) - credit) };
      },
      notes: ["Assumes dependents are 6 or older; the dependent credit doubles for younger children."],
      sources: [
        "https://www.maine.gov/revenue/sites/maine.gov.revenue/files/2026-05/ind_tax_rate_sched_2026_rev.pdf",
        "https://www.maine.gov/revenue/sites/maine.gov.revenue/files/inline-files/legischange26.pdf",
        "https://www.maine.gov/revenue/sites/maine.gov.revenue/files/inline-files/26_item_stand_%20ded_phaseout_wksht_0.pdf",
        "https://www.mainelegislature.org/legis/statutes/36/title36sec5219-SS.html",
        "https://legislature.maine.gov/legis/statutes/26/title26sec850-F.html",
      ],
    },

    DE: {
      code: "DE",
      name: "Delaware",
      year: 2026,
      kind: "graduated",
      brackets: same([[2000, 0], [5000, 0.022], [10000, 0.039], [20000, 0.048], [25000, 0.052], [60000, 0.0555], [INF, 0.066]]),
      startsFrom: "agi",
      standardDeduction: { single: 3250, mfj: 6500, mfs: 3250, hoh: 3250 },
      exemptionCredit: { filer: 110, dependent: 110 },
      taxes401k: false,
      overtimeDeduction: false,
      // 0.8% in all at employers with 25+ employees, who may deduct up to half of it from pay.
      payroll: [{ id: "de-paid-leave", name: "Delaware Paid Leave", rate: 0.004, wageCap: 184500 }],
      locals: [{ id: "wilmington", name: "Wilmington", type: "rate-on-wages", resident: 0.0125, nonresident: 0.0125 }],
      notes: ["Paid leave assumes an employer with 25+ employees that passes on the full 50% employee share."],
      sources: [
        "https://delcode.delaware.gov/title30/c011/sc01/index.html",
        "https://delcode.delaware.gov/title30/c011/sc02/index.html",
        "https://revenuefiles.delaware.gov/2025/PITForms_Instructions/Instructions/PIT-RES_Instructions_2025-01.pdf",
        "https://delcode.delaware.gov/title19/c037/",
        "https://labor.delaware.gov/delaware-paid-leave/",
        "https://wilmdebudget.org/wp-content/uploads/2026/03/fy27-tax-rates.pdf",
      ],
    },

    MD: {
      code: "MD",
      name: "Maryland",
      year: 2026,
      kind: "graduated",
      brackets: MD_BRACKETS,
      startsFrom: "agi",
      // Flat amounts since 2025 (HB 352, Chapter 604).
      standardDeduction: { single: 3350, mfj: 6700, mfs: 3350, hoh: 6700 },
      personalExemption: { filer: 3200, dependent: 3200 },
      taxes401k: false,
      overtimeDeduction: false,
      payroll: [], // FAMLI contributions haven't started
      locals: [
        mdCounty("allegany", "Allegany County", 0.032),
        {
          id: "anne-arundel",
          name: "Anne Arundel County",
          type: "brackets-on-state-taxable",
          brackets: { single: AA_SINGLE, mfj: AA_JOINT, mfs: AA_SINGLE, hoh: AA_JOINT },
        },
        mdCounty("baltimore-city", "Baltimore City", 0.032),
        mdCounty("baltimore-county", "Baltimore County", 0.032),
        mdCounty("calvert", "Calvert County", 0.032),
        mdCounty("caroline", "Caroline County", 0.032),
        mdCounty("carroll", "Carroll County", 0.0303),
        mdCounty("cecil", "Cecil County", 0.0274),
        mdCounty("charles", "Charles County", 0.0303),
        mdCounty("dorchester", "Dorchester County", 0.033),
        {
          id: "frederick",
          name: "Frederick County",
          type: "brackets-on-state-taxable",
          brackets: { single: FREDERICK_SINGLE, mfj: FREDERICK_JOINT, mfs: FREDERICK_SINGLE, hoh: FREDERICK_JOINT },
        },
        mdCounty("garrett", "Garrett County", 0.0265),
        mdCounty("harford", "Harford County", 0.0306),
        mdCounty("howard", "Howard County", 0.032),
        mdCounty("kent", "Kent County", 0.033),
        mdCounty("montgomery", "Montgomery County", 0.032),
        mdCounty("prince-georges", "Prince George's County", 0.032),
        mdCounty("queen-annes", "Queen Anne's County", 0.032),
        mdCounty("st-marys", "St. Mary's County", 0.032),
        mdCounty("somerset", "Somerset County", 0.032),
        mdCounty("talbot", "Talbot County", 0.024),
        mdCounty("washington", "Washington County", 0.0295),
        mdCounty("wicomico", "Wicomico County", 0.032),
        mdCounty("worcester", "Worcester County", 0.0225),
      ],
      // Each exemption drops to $1,600, then $800, then $0 as federal AGI rises.
      compute(ctx) {
        const agi = num(ctx.base);
        const row = MD_EXEMPTION[ctx.status].find(([upTo]) => agi <= upTo);
        const each = row ? row[1] : 0;
        const taxable = Math.max(0, agi - num(ctx.standardDeduction) - each * (ctx.filers + ctx.dependents));
        return { taxable, tax: bracketTax(taxable, MD_BRACKETS[ctx.status]) };
      },
      notes: ["If you live outside Maryland you pay a 2.25% nonresident tax instead of a county tax, which isn't included."],
      sources: [
        "https://www.marylandcomptroller.gov/content/dam/mdcomp/tax/legal-publications/facts/withholding-tax-facts-2026.pdf",
        "https://www.marylandcomptroller.gov/content/dam/mdcomp/tax/instructions/2025/resident-booklet.pdf",
        "https://mgaleg.maryland.gov/2025RS/Chapters_noln/CH_604_hb0352e.pdf",
      ],
    },

    DC: {
      code: "DC",
      name: "District of Columbia",
      year: 2026,
      kind: "graduated",
      brackets: same([[10000, 0.04], [40000, 0.06], [60000, 0.065], [250000, 0.085], [500000, 0.0925], [1000000, 0.0975], [INF, 0.1075]]),
      startsFrom: "agi",
      // Congress disapproved DC's 2025 decoupling act, so 2026 uses the federal amounts.
      standardDeduction: "federal",
      taxes401k: false,
      overtimeDeduction: false,
      payroll: [], // Paid Family Leave is paid by employers only
      locals: [],
      notes: ["Doesn't include DC's child tax credit or the Keep Child Care Affordable credit."],
      sources: [
        "https://otr.cfo.dc.gov/sites/default/files/dc/sites/otr/publication/attachments/2026_D40ES_Book_wLinks04012026.pdf",
        "https://www.congress.gov/bill/119th-congress/house-joint-resolution/142",
        "https://code.dccouncil.gov/us/dc/council/code/sections/32-541.03",
      ],
    },
  };

  if (typeof module !== "undefined" && module.exports) module.exports = STATES;
  else root.StateTax.register(STATES);
})(typeof window !== "undefined" ? window : globalThis);

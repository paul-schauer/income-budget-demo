// Northeast and Mid-Atlantic states: NY, NJ, CT, RI, VT, ME, DE, MD, DC.
// Every expected tax below is worked by hand from the published 2026 schedules
// (see docs/state-tax-sources/northeast.md), not copied from the engine.
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../js/state-tax.js");

S.register(require("../js/states/northeast.js"));

const near = (actual, expected, tol = 0.01) =>
  assert.ok(Math.abs(actual - expected) <= tol, `expected ${expected}, got ${actual}`);

const CODES = ["NY", "NJ", "CT", "RI", "VT", "ME", "DE", "MD", "DC"];

// Household 1: single, $55,000 wages, 5% traditional 401(k) ($2,750), no dependents.
// AGI = 55,000 - 2,750 = 52,250. Federal taxable = 52,250 - 16,100 = 36,150.
const single = (over = {}) => ({
  status: "single",
  filers: 1,
  dependents: 0,
  earners: [{ wages: 55000, k401Trad: 2750 }],
  agi: 52250,
  federalTaxable: 52250 - 16100,
  federalStandardDeduction: 16100,
  overtimeDeduction: 0,
  local: { id: "none" },
  ...over,
});

// Household 2: married filing jointly, $95,000 + $45,000 wages, 2 children, no 401(k).
// AGI = 140,000. Federal taxable = 140,000 - 32,200 = 107,800.
const joint = (over = {}) => ({
  status: "mfj",
  filers: 2,
  dependents: 2,
  earners: [{ wages: 95000, k401Trad: 0 }, { wages: 45000, k401Trad: 0 }],
  agi: 140000,
  federalTaxable: 140000 - 32200,
  federalStandardDeduction: 32200,
  overtimeDeduction: 0,
  local: { id: "none" },
  ...over,
});

// A single filer with other wages, for phase-out checks.
const singleAt = (agi) => single({ earners: [{ wages: agi, k401Trad: 0 }], agi, federalTaxable: Math.max(0, agi - 16100) });

test("every Northeast entry passes validation", () => {
  for (const code of CODES) assert.deepEqual(S.validate(S.get(code)), [], code);
});

test("all nine jurisdictions are registered", () => {
  for (const code of CODES) assert.ok(S.get(code), code);
  assert.equal(S.get("DC").name, "District of Columbia");
});

test("no Northeast state taxes 401(k) deferrals or follows the federal overtime deduction", () => {
  for (const code of CODES) {
    assert.equal(S.get(code).taxes401k, false, code);
    assert.equal(S.get(code).overtimeDeduction, false, code);
  }
  // Overtime input changes nothing.
  near(S.compute("NJ", single({ overtimeDeduction: 5000 })).tax, S.compute("NJ", single()).tax);
});

// ---------------------------------------------------------------- New York

test("New York: single", () => {
  // 52,250 - 8,000 standard deduction = 44,250
  const r = S.compute("NY", single());
  near(r.taxable, 44250);
  near(r.tax, 8500 * 0.039 + 3200 * 0.044 + 2200 * 0.0515 + (44250 - 13900) * 0.054);
  near(r.supplementalRate, 0.117);
});

test("New York: joint, with the $107,650 recapture worksheet", () => {
  // 140,000 - 16,050 - 2 × 1,000 dependent exemptions = 121,950
  const taxable = 140000 - 16050 - 2000;
  const schedule = 17150 * 0.039 + 6450 * 0.044 + 4300 * 0.0515 + (taxable - 27900) * 0.054; // 6,252.80
  // Worksheet 1: flat 5.4% on all taxable income, phased in by (140,000 - 107,650) / 50,000 = 0.647.
  const tax = schedule + 0.647 * (taxable * 0.054 - schedule);
  const r = S.compute("NY", joint());
  near(r.taxable, taxable);
  near(r.tax, tax);
  near(r.tax, 6467.93);
});

test("New York: higher recapture worksheets", () => {
  // Single, AGI 250,000: taxable 242,000 is in the 6.85% bracket. Recapture base at 215,400:
  // 5.9% × 215,400 - schedule tax on 215,400.
  const at215 = 8500 * 0.039 + 3200 * 0.044 + 2200 * 0.0515 + 66750 * 0.054 + 134750 * 0.059; // 12,140.35
  const base = 0.059 * 215400 - at215; // 568.25
  const schedule = at215 + (242000 - 215400) * 0.0685;
  const phase = (250000 - 215400) / 50000; // 0.692
  near(S.compute("NY", singleAt(250000)).tax, schedule + base + phase * (242000 * 0.0685 - schedule - base));
  // Fully phased in: everything at 6.85%.
  near(S.compute("NY", singleAt(300000)).tax, (300000 - 8000) * 0.0685);
});

test("New York City resident tax on NY taxable income", () => {
  near(S.compute("NY", single({ local: { id: "nyc" } })).local.tax, 12000 * 0.03078 + 13000 * 0.03762 + (44250 - 25000) * 0.03819);
  near(
    S.compute("NY", joint({ local: { id: "nyc" } })).local.tax,
    21600 * 0.03078 + 23400 * 0.03762 + 45000 * 0.03819 + (121950 - 90000) * 0.03876,
  );
  // Nonresidents don't pay it.
  near(S.compute("NY", single({ local: { id: "nyc", resident: false } })).local.tax, 0);
});

test("Yonkers: 16.75% of NY tax for residents, 0.5% of wages for nonresidents", () => {
  const nySingle = 8500 * 0.039 + 3200 * 0.044 + 2200 * 0.0515 + (44250 - 13900) * 0.054;
  near(S.compute("NY", single({ local: { id: "yonkers" } })).local.tax, nySingle * 0.1675);
  near(S.compute("NY", joint({ local: { id: "yonkers" } })).local.tax, 6467.9275 * 0.1675);
  near(S.compute("NY", joint({ local: { id: "yonkers", resident: false } })).local.tax, 140000 * 0.005);
});

test("New York payroll: SDI capped at $31.20, PFL at 0.432% up to $411.91", () => {
  const [[sdi, pfl]] = S.compute("NY", single()).payroll;
  near(sdi.amount, 31.2); // 0.5% of 55,000 = 275, capped
  near(pfl.amount, 55000 * 0.00432);
  const high = S.compute("NY", single({ earners: [{ wages: 200000, k401Trad: 0 }] })).payroll[0];
  near(high[1].amount, 411.91);
});

// ---------------------------------------------------------------- New Jersey

test("New Jersey: single ($1,000 exemption, 401(k) excluded)", () => {
  const taxable = 52250 - 1000;
  const r = S.compute("NJ", single());
  near(r.taxable, taxable);
  near(r.tax, 20000 * 0.014 + 15000 * 0.0175 + 5000 * 0.035 + (taxable - 40000) * 0.05525);
});

test("New Jersey: joint ($1,000 per filer, $1,500 per child)", () => {
  const taxable = 140000 - 2 * 1000 - 2 * 1500; // 135,000
  near(S.compute("NJ", joint()).tax, 20000 * 0.014 + 30000 * 0.0175 + 20000 * 0.0245 + 10000 * 0.035 + (taxable - 80000) * 0.05525);
});

test("New Jersey payroll: TDI and FLI to $171,100, UI/WF/SWF to $44,800", () => {
  const [[tdi, fli, ui]] = S.compute("NJ", single()).payroll;
  near(tdi.amount, 55000 * 0.0019);
  near(fli.amount, 55000 * 0.0023);
  near(ui.amount, 44800 * 0.00425); // 190.40, capped
  const high = S.compute("NJ", single({ earners: [{ wages: 250000, k401Trad: 0 }] })).payroll[0];
  near(high[0].amount, 171100 * 0.0019); // 325.09
  near(high[1].amount, 171100 * 0.0023); // 393.53
});

// ---------------------------------------------------------------- Connecticut

test("Connecticut: single (exemption gone above $45,000, 10% personal credit)", () => {
  // Exemption 15,000 less 1,000 × ceil(22,250 / 1,000) → 0. No add-back below 56,500.
  const tax = 10000 * 0.02 + 40000 * 0.045 + 2250 * 0.055; // 2,123.75
  const r = S.compute("CT", single());
  near(r.taxable, 52250);
  near(r.tax, tax * (1 - 0.1)); // Table E: AGI over 33,300 up to 60,000 → 10%
});

test("Connecticut: joint (2% rate add-back, no credit)", () => {
  const tax = 20000 * 0.02 + 80000 * 0.045 + 40000 * 0.055; // 6,200
  const addBack = 50 * Math.ceil((140000 - 100500) / 5000); // $50 per $5,000 → 400
  near(S.compute("CT", joint()).tax, tax + addBack);
});

test("Connecticut: exemption phase-out, recapture and credit steps", () => {
  // AGI 40,000: exemption 15,000 - 10,000 = 5,000; credit 10%.
  near(S.compute("CT", singleAt(40000)).tax, (10000 * 0.02 + 25000 * 0.045) * 0.9);
  // AGI 120,000: add-back capped at 250; recapture $25 × ceil(15,000 / 5,000) = 75; no credit.
  near(S.compute("CT", singleAt(120000)).tax, 10000 * 0.02 + 40000 * 0.045 + 50000 * 0.055 + 20000 * 0.06 + 250 + 75);
});

test("Connecticut payroll: Paid Leave 0.5% up to the Social Security wage base", () => {
  near(S.compute("CT", single()).payroll[0][0].amount, 275);
  near(S.compute("CT", single({ earners: [{ wages: 250000, k401Trad: 0 }] })).payroll[0][0].amount, 184500 * 0.005);
});

// ---------------------------------------------------------------- Rhode Island

test("Rhode Island: single and joint", () => {
  near(S.compute("RI", single()).tax, (52250 - 11200 - 5250) * 0.0375);
  const taxable = 140000 - 22400 - 4 * 5250; // 96,600
  near(S.compute("RI", joint()).tax, 82050 * 0.0375 + (taxable - 82050) * 0.0475);
});

test("Rhode Island: deduction and exemption phase-out above $261,000", () => {
  // AGI 270,000: ceil(9,000 / 7,450) = 2 steps → 60% kept.
  const taxable = 270000 - (11200 + 5250) * 0.6;
  near(S.compute("RI", singleAt(270000)).tax, 82050 * 0.0375 + (186450 - 82050) * 0.0475 + (taxable - 186450) * 0.0599);
});

test("Rhode Island payroll: TDI 1.1% up to $100,000", () => {
  const [a, b] = S.compute("RI", joint()).payroll;
  near(a[0].amount, 95000 * 0.011);
  near(b[0].amount, 45000 * 0.011);
  near(S.compute("RI", single({ earners: [{ wages: 150000, k401Trad: 0 }] })).payroll[0][0].amount, 1100);
});

// ---------------------------------------------------------------- Vermont

test("Vermont: single and joint", () => {
  near(S.compute("VT", single()).tax, (52250 - 7850 - 5400) * 0.0335);
  const taxable = 140000 - 15700 - 4 * 5400; // 102,700
  near(S.compute("VT", joint()).tax, 84700 * 0.0335 + (taxable - 84700) * 0.066);
});

test("Vermont: schedule tax still applies above $150,000 when it beats 3% of AGI", () => {
  const taxable = 160000 - 7850 - 5400;
  near(S.compute("VT", singleAt(160000)).tax, 50750 * 0.0335 + (122850 - 50750) * 0.066 + (taxable - 122850) * 0.076);
});

test("Vermont payroll: child care contribution 0.11%, no cap", () => {
  near(S.compute("VT", single({ earners: [{ wages: 300000, k401Trad: 0 }] })).payroll[0][0].amount, 330);
});

// ---------------------------------------------------------------- Maine

test("Maine: single and joint (dependent credit $305 each)", () => {
  near(S.compute("ME", single()).tax, 27400 * 0.058 + (52250 - 15700 - 5300 - 27400) * 0.0675);
  const taxable = 140000 - 31400 - 2 * 5300; // 98,000
  near(S.compute("ME", joint()).tax, 54850 * 0.058 + (taxable - 54850) * 0.0675 - 2 * 305);
});

test("Maine: standard deduction phase-out", () => {
  // AGI 139,750: (139,750 - 102,250) / 75,000 = 0.5 → half of 15,700 left.
  const taxable = 139750 - 7850 - 5300;
  near(S.compute("ME", singleAt(139750)).tax, 27400 * 0.058 + (64850 - 27400) * 0.0675 + (taxable - 64850) * 0.0715);
});

test("Maine payroll: PFML 0.5% up to the Social Security wage base", () => {
  near(S.compute("ME", single()).payroll[0][0].amount, 275);
  near(S.compute("ME", single({ earners: [{ wages: 200000, k401Trad: 0 }] })).payroll[0][0].amount, 922.5);
});

// ---------------------------------------------------------------- Delaware

test("Delaware: single and joint ($110 credit per person)", () => {
  const single49 = 3000 * 0.022 + 5000 * 0.039 + 10000 * 0.048 + 5000 * 0.052 + (49000 - 25000) * 0.0555;
  near(S.compute("DE", single()).tax, single49 - 110); // 52,250 - 3,250 = 49,000
  const upTo60k = 3000 * 0.022 + 5000 * 0.039 + 10000 * 0.048 + 5000 * 0.052 + 35000 * 0.0555; // 2,943.50
  near(S.compute("DE", joint()).tax, upTo60k + (140000 - 6500 - 60000) * 0.066 - 4 * 110);
});

test("Wilmington: 1.25% of wages for residents and people who work there", () => {
  near(S.compute("DE", single({ local: { id: "wilmington" } })).local.tax, 55000 * 0.0125);
  near(S.compute("DE", joint({ local: { id: "wilmington", resident: false } })).local.tax, 140000 * 0.0125);
});

test("Delaware payroll: Paid Leave employee share 0.4%, capped", () => {
  near(S.compute("DE", single()).payroll[0][0].amount, 220);
  near(S.compute("DE", single({ earners: [{ wages: 200000, k401Trad: 0 }] })).payroll[0][0].amount, 184500 * 0.004);
});

// ---------------------------------------------------------------- Maryland

const MD_SINGLE_TAXABLE = 52250 - 3350 - 3200; // 45,700
const MD_JOINT_TAXABLE = 140000 - 6700 - 4 * 3200; // 120,500

test("Maryland: single and joint", () => {
  const r = S.compute("MD", single());
  near(r.taxable, MD_SINGLE_TAXABLE);
  near(r.tax, 1000 * 0.02 + 1000 * 0.03 + 1000 * 0.04 + (MD_SINGLE_TAXABLE - 3000) * 0.0475);
  near(S.compute("MD", joint()).tax, 1000 * 0.02 + 1000 * 0.03 + 1000 * 0.04 + (MD_JOINT_TAXABLE - 3000) * 0.0475);
});

test("Maryland: personal exemption shrinks above $100,000 single", () => {
  const taxable = 110000 - 3350 - 1600;
  near(S.compute("MD", singleAt(110000)).tax, 90 + (100000 - 3000) * 0.0475 + (taxable - 100000) * 0.05);
  near(S.compute("MD", singleAt(160000)).taxable, 160000 - 3350);
});

test("Maryland counties: flat, graduated (Anne Arundel) and rate-by-income (Frederick)", () => {
  near(S.compute("MD", single({ local: { id: "montgomery" } })).local.tax, MD_SINGLE_TAXABLE * 0.032);
  near(S.compute("MD", joint({ local: { id: "worcester" } })).local.tax, MD_JOINT_TAXABLE * 0.0225);
  // Anne Arundel is marginal: 2.70% to $50,000 single / $75,000 joint, then 2.94%.
  near(S.compute("MD", single({ local: { id: "anne-arundel" } })).local.tax, MD_SINGLE_TAXABLE * 0.027);
  near(S.compute("MD", joint({ local: { id: "anne-arundel" } })).local.tax, 75000 * 0.027 + (MD_JOINT_TAXABLE - 75000) * 0.0294);
  // Frederick charges one rate on all income: 2.75% (single, $25,001-$50,000), 2.96% (joint, $100,001-$250,000).
  near(S.compute("MD", single({ local: { id: "frederick" } })).local.tax, MD_SINGLE_TAXABLE * 0.0275);
  near(S.compute("MD", joint({ local: { id: "frederick" } })).local.tax, MD_JOINT_TAXABLE * 0.0296);
  // Above $150,000 single: 3.20% on everything. AGI 206,550 - 3,350, no exemption left = 203,200.
  near(S.compute("MD", { ...singleAt(206550), local: { id: "frederick" } }).local.tax, 203200 * 0.032);
  // Counties tax residents only.
  near(S.compute("MD", single({ local: { id: "montgomery", resident: false } })).local.tax, 0);
  assert.equal(S.get("MD").locals.length, 24); // 23 counties and Baltimore City
});

test("Maryland payroll: no FAMLI contributions in 2026", () => {
  near(S.compute("MD", joint()).payrollTotal, 0);
});

// ---------------------------------------------------------------- District of Columbia

test("DC: federal standard deduction, one schedule for every status", () => {
  near(S.compute("DC", single()).tax, 10000 * 0.04 + (52250 - 16100 - 10000) * 0.06);
  near(S.compute("DC", joint()).tax, 10000 * 0.04 + 30000 * 0.06 + 20000 * 0.065 + (140000 - 32200 - 60000) * 0.085);
  near(S.compute("DC", joint()).payrollTotal, 0);
});

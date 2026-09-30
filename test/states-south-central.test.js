const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../js/state-tax.js");

S.register(require("../js/states/south-central.js"));

const CODES = ["AL", "AR", "KY", "LA", "MO", "MS", "NC", "OK", "SC", "VA", "WI", "WV"];

const near = (actual, expected, tol = 0.01) =>
  assert.ok(Math.abs(actual - expected) <= tol, `expected ${expected}, got ${actual}`);

// Household 1: single, $55,000 wages, 5% traditional 401(k), no dependents.
const single = (over = {}) => ({
  status: "single",
  filers: 1,
  dependents: 0,
  earners: [{ wages: 55000, k401Trad: 2750 }],
  agi: 55000 - 2750, // 52,250
  federalTaxable: 52250 - 16100, // 36,150
  federalStandardDeduction: 16100,
  federalTax: 12400 * 0.1 + (36150 - 12400) * 0.12, // 4,090
  overtimeDeduction: 0,
  local: { id: "none" },
  ...over,
});

// Household 2: married filing jointly, $95,000 (5% traditional 401(k)) + $45,000 wages, 2 children.
const married = (over = {}) => ({
  status: "mfj",
  filers: 2,
  dependents: 2,
  earners: [{ wages: 95000, k401Trad: 4750 }, { wages: 45000, k401Trad: 0 }],
  agi: 140000 - 4750, // 135,250
  federalTaxable: 135250 - 32200, // 103,050
  federalStandardDeduction: 32200,
  federalTax: 24800 * 0.1 + (100800 - 24800) * 0.12 + (103050 - 100800) * 0.22 - 2 * 2200, // 7,695
  overtimeDeduction: 0,
  local: { id: "none" },
  ...over,
});

const tax = (code, ctx) => S.compute(code, ctx).tax;

test("every south-central entry passes validation", () => {
  for (const code of CODES) assert.deepEqual(S.validate(S.get(code)), [], code);
});

test("all 12 states are present", () => {
  const listed = S.list().map((s) => s.code);
  for (const code of CODES) assert.ok(listed.includes(code), code);
  assert.deepEqual(Object.keys(require("../js/states/south-central.js")).sort(), [...CODES].sort());
});

test("Alabama: AGI-based deductions and exemptions, federal income tax deduction", () => {
  // Single: standard deduction 3,000 - 25 × 53 steps is below the $2,500 floor; $1,500 personal exemption.
  const t1 = 52250 - 2500 - 1500 - 4090;
  near(tax("AL", single()), 500 * 0.02 + 2500 * 0.04 + (t1 - 3000) * 0.05);
  // Joint: $5,000 floor, $3,000 personal exemption, $300 per dependent (AGI over $100,000).
  const t2 = 135250 - 5000 - 3000 - 2 * 300 - 7695;
  near(tax("AL", married()), 1000 * 0.02 + 5000 * 0.04 + (t2 - 6000) * 0.05);
});

test("Alabama: standard deduction slides with AGI; overtime deduction capped at $1,000 per taxpayer", () => {
  const ctx = single({ earners: [{ wages: 30000, k401Trad: 0 }], agi: 30000, federalTax: 1500, overtimeDeduction: 2500 });
  // $3,000 less $25 for each full $500 of AGI over $25,500 (9 steps).
  const t = 30000 - (3000 - 25 * 9) - 1500 - 1500 - 1000;
  near(tax("AL", ctx), 500 * 0.02 + 2500 * 0.04 + (t - 3000) * 0.05);
});

test("Arkansas: Act 1 of 2026 tables, $29 personal credits, joint vs. separate on the same return", () => {
  const ni = 52250 - 2470;
  near(tax("AR", single()), (11200 - 5600) * 0.02 + (16000 - 11200) * 0.03 + (26400 - 16000) * 0.034 + (ni - 26400) * 0.037 - 29);
  // Joint: net income 130,310 uses the upper-income table.
  const joint = 4700 * 0.02 + (135250 - 4940 - 4700) * 0.037;
  // Status 4: each spouse takes $2,470 and uses the standard table.
  const low = (11200 - 5600) * 0.02 + (16000 - 11200) * 0.03 + (26400 - 16000) * 0.034;
  const separate = low + (90250 - 2470 - 26400) * 0.037 + low + (45000 - 2470 - 26400) * 0.037;
  assert.ok(separate < joint);
  near(tax("AR", married()), separate - 4 * 29);
});

test("Arkansas: upper-income table less the bracket adjustment just above $94,700", () => {
  const ctx = single({ earners: [{ wages: 97470, k401Trad: 0 }], agi: 97470 });
  const ni = 97470 - 2470; // 95,000: adjustment is $290 less $10 × 3
  near(tax("AR", ctx), 4700 * 0.02 + (ni - 4700) * 0.037 - (290 - 30) - 29);
});

test("Kentucky: 3.5% flat after the standard deduction; two deductions for a two-earner couple", () => {
  near(tax("KY", single()), (52250 - 3270) * 0.035);
  near(tax("KY", married()), (135250 - 2 * 3270) * 0.035);
});

test("Louisiana: 3% flat after the 2026 standard deduction", () => {
  near(tax("LA", single()), (52250 - 12835) * 0.03);
  near(tax("LA", married()), (135250 - 25670) * 0.03);
});

test("Missouri: federal standard deduction and partial federal income tax deduction", () => {
  const lower = 1348 * (0.02 + 0.025 + 0.03 + 0.035 + 0.04 + 0.045);
  const t1 = 52250 - 16100 - 0.15 * 4090; // 15% of federal tax for AGI $50,001-$100,000
  near(tax("MO", single()), lower + (t1 - 9436) * 0.047);
  const t2 = 135250 - 32200; // 0% of federal tax above $125,000 AGI
  near(tax("MO", married()), lower + (t2 - 9436) * 0.047);
});

test("Mississippi: 0% on the first $10,000, 4% above; each spouse has a $10,000 band", () => {
  near(tax("MS", single()), (52250 - 2300 - 6000 - 10000) * 0.04);
  near(tax("MS", married()), (135250 - 4600 - 12000 - 2 * 1500 - 2 * 10000) * 0.04);
});

test("North Carolina: 3.99% flat, standard deduction and child deduction", () => {
  near(tax("NC", single()), (52250 - 12750) * 0.0399);
  // Joint AGI $120,001-$140,000: $500 per child.
  near(tax("NC", married()), (135250 - 25500 - 2 * 500) * 0.0399);
});

test("Oklahoma: 2026 brackets, standard deduction and $1,000 exemptions", () => {
  const t1 = 52250 - 6350 - 1000;
  near(tax("OK", single()), (4900 - 3750) * 0.025 + (7200 - 4900) * 0.035 + (t1 - 7200) * 0.045);
  const t2 = 135250 - 12700 - 4 * 1000;
  near(tax("OK", married()), (9800 - 7500) * 0.025 + (14400 - 9800) * 0.035 + (t2 - 14400) * 0.045);
});

test("South Carolina: federal AGI less the phased SCIAD, 1.99%/5.21%, two-wage-earner credit", () => {
  const t1 = 52250 - 15000 * (1 - (52250 - 40000) / 55000);
  near(tax("SC", single()), 30000 * 0.0199 + (t1 - 30000) * 0.0521);
  const t2 = 135250 - 30000 * (1 - (135250 - 80000) / 110000) - 2 * 4930;
  near(tax("SC", married()), 30000 * 0.0199 + (t2 - 30000) * 0.0521 - 0.007 * 45000);
});

test("Virginia: brackets, standard deduction, $930 exemptions, spouse tax adjustment", () => {
  const first17k = 3000 * 0.02 + 2000 * 0.03 + 12000 * 0.05;
  near(tax("VA", single()), first17k + (52250 - 8750 - 930 - 17000) * 0.0575);
  // Both spouses' shares of taxable income are above $17,000, so the adjustment is the full
  // difference between 5.75% and the lower brackets on $17,000.
  const adjustment = 17000 * 0.0575 - first17k;
  near(tax("VA", married()), first17k + (135250 - 17500 - 4 * 930 - 17000) * 0.0575 - adjustment);
});

test("West Virginia: 2026 rates (SB 392) and $2,000 exemptions", () => {
  const first40k = 10000 * 0.0211 + 15000 * 0.0281 + 15000 * 0.0316;
  near(tax("WV", single()), first40k + (52250 - 2000 - 40000) * 0.0422);
  near(tax("WV", married()), first40k + 20000 * 0.0422 + (135250 - 4 * 2000 - 60000) * 0.0458);
});

test("Wisconsin: sliding standard deduction, $700 exemptions, married couple credit", () => {
  const t1 = 52250 - (13560 - 0.12 * (52250 - 19550)) - 700;
  near(tax("WI", single()), 15110 * 0.035 + (t1 - 15110) * 0.044);
  const t2 = 135250 - (25110 - 0.19778 * (135250 - 28210)) - 4 * 700;
  // Credit: 3% of the lower earner's $45,000 is $1,350, capped at $480.
  near(tax("WI", married()), 20150 * 0.035 + (69260 - 20150) * 0.044 + (t2 - 69260) * 0.053 - 480);
});

test("the federal overtime deduction doesn't carry over to these states' taxable income", () => {
  for (const code of CODES.filter((c) => c !== "AL")) {
    near(tax(code, married({ overtimeDeduction: 5000 })), tax(code, married()), 1e-9);
  }
});

test("local taxes: Birmingham, Kansas City, St. Louis, Louisville, Lexington", () => {
  const local = (code, id, resident = true) => S.compute(code, single({ local: { id, resident } })).local.tax;
  near(local("AL", "birmingham"), 55000 * 0.01);
  near(local("AL", "birmingham", false), 55000 * 0.01);
  near(local("MO", "kansas-city"), 55000 * 0.01);
  near(local("MO", "kansas-city", false), 55000 * 0.01);
  near(local("MO", "st-louis"), 55000 * 0.01);
  near(S.compute("MO", married({ local: { id: "st-louis", resident: false } })).local.tax, 140000 * 0.01);
  near(local("KY", "louisville"), 55000 * (0.0125 + 0.002 + 0.0075));
  near(local("KY", "louisville", false), 55000 * (0.0125 + 0.002));
  near(local("KY", "lexington"), 55000 * (0.0225 + 0.005));
  near(local("KY", "lexington", false), 55000 * 0.0225);
});

test("supplemental rates where the state sets one", () => {
  near(S.compute("AR", single()).supplementalRate, 0.037);
  near(S.compute("MO", single()).supplementalRate, 0.047);
  near(S.compute("OK", single()).supplementalRate, 0.045);
  near(S.compute("VA", single()).supplementalRate, 0.0575);
});

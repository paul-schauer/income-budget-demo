const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../js/state-tax.js");

const WEST = require("../js/states/west-plains.js");
S.register(WEST);

const CODES = ["CA", "OR", "HI", "NM", "MT", "ND", "NE", "KS", "MN"];

const near = (actual, expected, tol = 0.01) =>
  assert.ok(Math.abs(actual - expected) <= tol, `expected ${expected}, got ${actual}`);

// Household 1: single, $55,000 wages, 5% traditional 401(k), no dependents.
// Federal: AGI 52,250; taxable 52,250 - 16,100 = 36,150; tax 10% to 12,400 then 12%.
const single = (over = {}) => ({
  status: "single",
  filers: 1,
  dependents: 0,
  earners: [{ wages: 55000, k401Trad: 2750 }],
  agi: 52250,
  federalTaxable: 52250 - 16100,
  federalStandardDeduction: 16100,
  federalTax: 1240 + (36150 - 12400) * 0.12, // 4,090
  overtimeDeduction: 0,
  local: { id: "none" },
  ...over,
});

// Household 2: married filing jointly, $95,000 (5% 401(k)) + $45,000 wages, two children.
// Federal: AGI 135,250; taxable 135,250 - 32,200 = 103,050; tax less the $2,200 child tax credit per child.
const family = (over = {}) => ({
  status: "mfj",
  filers: 2,
  dependents: 2,
  earners: [{ wages: 95000, k401Trad: 4750 }, { wages: 45000, k401Trad: 0 }],
  agi: 135250,
  federalTaxable: 135250 - 32200,
  federalStandardDeduction: 32200,
  federalTax: 2480 + (100800 - 24800) * 0.12 + (103050 - 100800) * 0.22 - 2 * 2200, // 7,695
  overtimeDeduction: 0,
  local: { id: "none" },
  ...over,
});

// A single filer with no 401(k), for high-income phase-out checks.
const earner = (wages, over = {}) => single({
  earners: [{ wages, k401Trad: 0 }],
  agi: wages,
  federalTaxable: wages - 16100,
  ...over,
});

test("every West/Plains entry passes validation", () => {
  for (const [code, entry] of Object.entries(WEST)) {
    assert.equal(entry.code, code);
    assert.deepEqual(S.validate(entry), [], code);
  }
});

test("all nine states are present and listed", () => {
  assert.deepEqual(Object.keys(WEST).sort(), [...CODES].sort());
  const listed = S.list().map((s) => s.code);
  for (const code of CODES) assert.ok(listed.includes(code), code);
});

test("household fixtures carry the federal figures from the brief", () => {
  near(single().federalTax, 4090);
  near(family().federalTax, 7695);
});

// ---------- California ----------

test("California: single", () => {
  const r = S.compute("CA", single());
  const taxable = 52250 - 5706;
  near(r.taxable, taxable);
  near(r.tax, 11079 * 0.01 + (26264 - 11079) * 0.02 + (41452 - 26264) * 0.04 + (taxable - 41452) * 0.06 - 153);
  near(r.supplementalRate, 0.1023);
});

test("California: married filing jointly, two children", () => {
  const r = S.compute("CA", family());
  const taxable = 135250 - 11412;
  near(r.taxable, taxable);
  near(r.tax, 22158 * 0.01 + (52528 - 22158) * 0.02 + (82904 - 52528) * 0.04 + (115084 - 82904) * 0.06
    + (taxable - 115084) * 0.08 - (2 * 153 + 2 * 475));
});

test("California: exemption credit phases out above $252,203 (single)", () => {
  const r = S.compute("CA", earner(300000));
  const taxable = 300000 - 5706;
  near(r.taxable, taxable);
  const steps = Math.ceil((300000 - 252203) / 2500); // 20
  near(r.tax, 11079 * 0.01 + (26264 - 11079) * 0.02 + (41452 - 26264) * 0.04 + (57542 - 41452) * 0.06
    + (72724 - 57542) * 0.08 + (taxable - 72724) * 0.093 - (153 - 6 * steps));
});

test("California: 1% Mental Health Services Tax over $1M of taxable income", () => {
  near(S.compute("CA", earner(1500000)).marginalRate, 0.133, 1e-6);
  near(S.compute("CA", earner(900000)).marginalRate, 0.123, 1e-6);
  // Joint: $1.2M taxable sits in the 11.3% bracket plus the 1% surcharge.
  near(S.compute("CA", family({ agi: 1200000 + 11412 })).marginalRate, 0.123, 1e-6);
});

test("California SDI: 1.3% of all wages, no cap", () => {
  near(S.compute("CA", single()).payroll[0][0].amount, 55000 * 0.013);
  const fam = S.compute("CA", family());
  near(fam.payroll[0][0].amount, 95000 * 0.013);
  near(fam.payroll[1][0].amount, 45000 * 0.013);
  near(S.compute("CA", earner(400000)).payroll[0][0].amount, 400000 * 0.013);
});

// ---------- Oregon ----------

test("Oregon: single, with the federal tax subtraction and exemption credit", () => {
  const r = S.compute("OR", single());
  const taxable = 52250 - 4090 - 2910; // federal tax under the $8,750 cap
  near(r.taxable, taxable);
  near(r.tax, 4550 * 0.0475 + (11400 - 4550) * 0.0675 + (taxable - 11400) * 0.0875 - 260);
  near(r.supplementalRate, 0.08);
});

test("Oregon: married filing jointly, two children", () => {
  const r = S.compute("OR", family());
  const taxable = 135250 - 7695 - 5820;
  near(r.taxable, taxable);
  near(r.tax, 9100 * 0.0475 + (22800 - 9100) * 0.0675 + (taxable - 22800) * 0.0875 - 4 * 260);
});

test("Oregon: federal tax subtraction cap and phase-out, exemption credit cliff", () => {
  // Cap binds; AGI exactly $100,000 still gets the credit.
  const capped = S.compute("OR", earner(100000, { federalTax: 12000 }));
  near(capped.taxable, 100000 - 8750 - 2910);
  near(capped.tax, 4550 * 0.0475 + 6850 * 0.0675 + (100000 - 8750 - 2910 - 11400) * 0.0875 - 260);
  // AGI $132,000: third step of the phase-out (60% of $8,750); no exemption credit over $100,000.
  const phased = S.compute("OR", earner(132000, { federalTax: 20000 }));
  near(phased.taxable, 132000 - 5250 - 2910);
  near(phased.tax, 4550 * 0.0475 + 6850 * 0.0675 + (132000 - 5250 - 2910 - 11400) * 0.0875);
  // Joint AGI $295,000: no subtraction, no credit.
  const rich = S.compute("OR", family({ agi: 295000, federalTax: 40000 }));
  near(rich.taxable, 295000 - 5820);
  near(rich.tax, 9100 * 0.0475 + 13700 * 0.0675 + (250000 - 22800) * 0.0875 + (295000 - 5820 - 250000) * 0.099);
});

test("Oregon payroll: Paid Leave 0.6% to the $184,500 cap, transit tax 0.1%", () => {
  const s = S.compute("OR", single());
  near(s.payroll[0][0].amount, 55000 * 0.006);
  near(s.payroll[0][1].amount, 55000 * 0.001);
  const fam = S.compute("OR", family());
  near(fam.payroll[0][0].amount, 95000 * 0.006);
  near(fam.payroll[1][0].amount, 45000 * 0.006);
  near(fam.payrollTotal, 140000 * 0.007);
  const high = S.compute("OR", earner(250000));
  near(high.payroll[0][0].amount, 184500 * 0.006);
  near(high.payroll[0][1].amount, 250000 * 0.001);
});

test("Oregon locals: Metro SHS and Multnomah Preschool for All on Oregon taxable income", () => {
  const OR = S.get("OR");
  const ctxS = { status: "single", filers: 1, dependents: 0 };
  const ctxJ = { status: "mfj", filers: 2, dependents: 0 };
  near(S.computeLocal(OR, { id: "metro-shs" }, 0, 150000, ctxS).tax, (150000 - 128000) * 0.01);
  near(S.computeLocal(OR, { id: "metro-shs" }, 0, 150000, ctxJ).tax, 0);
  near(S.computeLocal(OR, { id: "metro-shs" }, 0, 300000, ctxJ).tax, (300000 - 205000) * 0.01);
  near(S.computeLocal(OR, { id: "metro-shs" }, 0, 300000, { ...ctxS, status: "hoh" }).tax, (300000 - 205000) * 0.01);
  near(S.computeLocal(OR, { id: "metro-shs", resident: false }, 0, 300000, ctxS).tax, 0);
  // Combined: PFA 1.5% over $125k / $200k, plus 1.5% more over $250k / $400k; SHS 1% over $128k / $205k.
  near(S.computeLocal(OR, { id: "metro-shs-multnomah-pfa" }, 0, 300000, ctxS).tax,
    (128000 - 125000) * 0.015 + (250000 - 128000) * 0.025 + (300000 - 250000) * 0.04);
  near(S.computeLocal(OR, { id: "metro-shs-multnomah-pfa" }, 0, 450000, ctxJ).tax,
    (205000 - 200000) * 0.015 + (400000 - 205000) * 0.025 + (450000 - 400000) * 0.04);
  // Through compute(): the local uses Oregon taxable income (after the federal tax subtraction).
  near(S.compute("OR", family({ local: { id: "metro-shs-multnomah-pfa" } })).local.tax, 0);
  const high = S.compute("OR", earner(300000, { federalTax: 70000, local: { id: "metro-shs" } }));
  near(high.taxable, 300000 - 2910);
  near(high.local.tax, (300000 - 2910 - 128000) * 0.01);
});

// ---------- Hawaii ----------

test("Hawaii: single", () => {
  const r = S.compute("HI", single());
  const taxable = 52250 - 8000 - 1144;
  near(r.taxable, taxable);
  near(r.tax, 9600 * 0.014 + 4800 * 0.032 + 4800 * 0.055 + 4800 * 0.064 + 12000 * 0.068 + (taxable - 36000) * 0.072);
});

test("Hawaii: married filing jointly, two children", () => {
  const r = S.compute("HI", family());
  const taxable = 135250 - 16000 - 4 * 1144;
  near(r.taxable, taxable);
  near(r.tax, 19200 * 0.014 + 9600 * 0.032 + 9600 * 0.055 + 9600 * 0.064 + 24000 * 0.068 + 24000 * 0.072
    + (taxable - 96000) * 0.076);
});

test("Hawaii TDI: 0.5% of wages up to the annual maximum", () => {
  near(S.compute("HI", single()).payroll[0][0].amount, 55000 * 0.005);
  const fam = S.compute("HI", family());
  near(fam.payroll[0][0].amount, 6.87 * 52); // 0.5% of $95,000 = $475, over the maximum
  near(fam.payroll[1][0].amount, 45000 * 0.005);
});

// ---------- New Mexico ----------
// NMSA 7-2-7 brackets (2024 HB 252, not indexed) on federal AGI less the federal standard deduction.

test("New Mexico: single, federal standard deduction", () => {
  const r = S.compute("NM", single());
  const taxable = 52250 - 16100; // 36,150
  near(r.taxable, taxable);
  near(r.tax, 5500 * 0.015 + (16500 - 5500) * 0.032 + (33500 - 16500) * 0.043 + (taxable - 33500) * 0.047);
  assert.equal(r.payrollTotal, 0);
  near(r.supplementalRate, 0.047, 1e-9); // no flat bonus rate set, so the marginal rate is used
});

test("New Mexico: married filing jointly, two children", () => {
  const r = S.compute("NM", family());
  const taxable = 135250 - 32200; // 103,050; the $4,000 dependent deduction isn't modeled
  near(r.taxable, taxable);
  near(r.tax, 8000 * 0.015 + (25000 - 8000) * 0.032 + (50000 - 25000) * 0.043 + (100000 - 50000) * 0.047
    + (taxable - 100000) * 0.049);
});

test("New Mexico: schedules reproduce the base tax printed in HB 252", () => {
  const NM = S.get("NM");
  near(S.bracketTax(210000, NM.brackets.single), 9748);
  near(S.bracketTax(315000, NM.brackets.mfj), 14624);
  near(S.bracketTax(315000, NM.brackets.hoh), 14624);
  near(S.bracketTax(157500, NM.brackets.mfs), 7312);
});

// ---------- Montana ----------
// HB 337 (2025): 4.7% up to $47,500 ($95,000 joint, $71,250 HOH), 5.65% above, on federal taxable income.

test("Montana: single, from federal taxable income", () => {
  const r = S.compute("MT", single());
  const taxable = 52250 - 16100; // federal taxable income, 36,150
  near(r.taxable, taxable);
  near(r.tax, taxable * 0.047);
  near(r.supplementalRate, 0.05);
});

test("Montana: married filing jointly, two children", () => {
  const r = S.compute("MT", family());
  const taxable = 135250 - 32200; // 103,050; Montana has no exemptions of its own
  near(r.taxable, taxable);
  near(r.tax, 95000 * 0.047 + (taxable - 95000) * 0.0565);
});

test("Montana and North Dakota take federal taxable income as is (overtime deduction already in it)", () => {
  const r = S.compute("MT", single({ overtimeDeduction: 5000, federalTaxable: 36150 - 5000 }));
  near(r.taxable, 31150);
  assert.equal(r.overtimeDeduction, true);
  near(S.compute("ND", family({ overtimeDeduction: 5000, federalTaxable: 103050 - 5000 })).taxable, 98050);
});

// ---------- North Dakota ----------
// Form ND-1ES 2026: 0% / 1.95% / 2.5% on federal taxable income.

test("North Dakota: single owes nothing inside the 0% bracket", () => {
  const r = S.compute("ND", single());
  const taxable = 52250 - 16100; // 36,150, under the $49,575 top of the 0% bracket
  near(r.taxable, taxable);
  near(r.tax, 0);
  near(r.supplementalRate, 0.015);
});

test("North Dakota: married filing jointly, two children", () => {
  const r = S.compute("ND", family());
  const taxable = 135250 - 32200; // 103,050
  near(r.taxable, taxable);
  near(r.tax, (taxable - 82800) * 0.0195);
});

test("North Dakota: schedules reproduce the base tax printed on Form ND-1ES 2026", () => {
  const ND = S.get("ND");
  near(S.bracketTax(250400, ND.brackets.single), 3916.09);
  near(S.bracketTax(304850, ND.brackets.mfj), 4329.98);
  near(S.bracketTax(277600, ND.brackets.hoh), 4118.40);
});

// ---------- Nebraska ----------
// 2026: 2.46% / 3.51% / 4.55%; standard deduction $8,850 / $17,700 / $12,950; $176 credit per exemption.

test("Nebraska: single", () => {
  const r = S.compute("NE", single());
  const taxable = 52250 - 8850; // 43,400
  near(r.taxable, taxable);
  near(r.tax, 4130 * 0.0246 + (24760 - 4130) * 0.0351 + (taxable - 24760) * 0.0455 - 176);
  near(r.supplementalRate, 0.035);
});

test("Nebraska: married filing jointly, two children", () => {
  const r = S.compute("NE", family());
  const taxable = 135250 - 17700; // 117,550
  near(r.taxable, taxable);
  near(r.tax, 8260 * 0.0246 + (49520 - 8260) * 0.0351 + (taxable - 49520) * 0.0455 - 4 * 176);
});

test("Nebraska: schedules match the 2026 tax table at $79,860 (to the dollar)", () => {
  const NE = S.get("NE");
  near(S.bracketTax(79860, NE.brackets.single), 3333, 0.5);
  near(S.bracketTax(79860, NE.brackets.mfj), 3032, 0.5);
});

// ---------- Kansas ----------
// K.S.A. 79-32,110: 5.2% up to $23,000 ($46,000 joint), 5.58% above. Standard deduction and exemptions are fixed
// amounts (79-32,119 and 79-32,121).

test("Kansas: single", () => {
  const r = S.compute("KS", single());
  const taxable = 52250 - 3605 - 9160; // 39,485
  near(r.taxable, taxable);
  near(r.tax, 23000 * 0.052 + (taxable - 23000) * 0.0558);
  near(r.supplementalRate, 0.05);
});

test("Kansas: married filing jointly, two children", () => {
  const r = S.compute("KS", family());
  const taxable = 135250 - 8240 - 2 * 9160 - 2 * 2320; // 104,050
  near(r.taxable, taxable);
  near(r.tax, 46000 * 0.052 + (taxable - 46000) * 0.0558);
});

test("Kansas: head of household gets an extra $2,320 exemption", () => {
  const r = S.compute("KS", single({ status: "hoh", dependents: 2 }));
  const taxable = 52250 - 6180 - 9160 - 2320 - 2 * 2320; // 29,950
  near(r.taxable, taxable);
  near(r.tax, 23000 * 0.052 + (taxable - 23000) * 0.0558);
});

// ---------- Minnesota ----------
// 2026 brackets, $15,300 / $30,600 / $23,000 standard deduction and $5,300 dependent exemption.

test("Minnesota: single", () => {
  const r = S.compute("MN", single());
  const taxable = 52250 - 15300; // 36,950
  near(r.taxable, taxable);
  near(r.tax, 33310 * 0.0535 + (taxable - 33310) * 0.068);
  near(r.supplementalRate, 0.0625);
});

test("Minnesota: married filing jointly, two children", () => {
  const r = S.compute("MN", family());
  const taxable = 135250 - 30600 - 2 * 5300; // 94,050
  near(r.taxable, taxable);
  near(r.tax, 48700 * 0.0535 + (taxable - 48700) * 0.068);
});

test("Minnesota: standard deduction shrinks 3% over $244,400, 10% over $337,800, by at most 80%", () => {
  const mid = S.compute("MN", earner(300000));
  const midTaxable = 300000 - (15300 - 0.03 * (300000 - 244400));
  near(mid.taxable, midTaxable);
  near(mid.tax, 33310 * 0.0535 + (109430 - 33310) * 0.068 + (203150 - 109430) * 0.0785 + (midTaxable - 203150) * 0.0985);
  const high = S.compute("MN", earner(400000));
  near(high.taxable, 400000 - (15300 - (0.03 * (337800 - 244400) + 0.1 * (400000 - 337800))));
  // At $450,000 the cut (2,802 + 11,220) passes 80% of the deduction, so 20% of it is left.
  near(S.compute("MN", earner(450000)).taxable, 450000 - 0.2 * 15300);
});

test("Minnesota: dependent exemption loses 2% per $2,500 of AGI over $244,500 (single)", () => {
  const r = S.compute("MN", earner(250000, { dependents: 1 }));
  const steps = Math.ceil((250000 - 244500) / 2500); // 3
  near(r.taxable, 250000 - (15300 - 0.03 * (250000 - 244400)) - 5300 * (1 - 0.02 * steps));
});

test("Minnesota Paid Leave: 0.44% employee share, wages capped at $185,000", () => {
  near(S.compute("MN", single()).payroll[0][0].amount, 55000 * 0.0044);
  const fam = S.compute("MN", family());
  near(fam.payroll[0][0].amount, 95000 * 0.0044);
  near(fam.payroll[1][0].amount, 45000 * 0.0044);
  near(S.compute("MN", earner(200000)).payroll[0][0].amount, 185000 * 0.0044); // $814, Paid Leave's 2026 maximum
});

// ---------- Cross-state ----------

test("no West/Plains state taxes traditional 401(k) deferrals", () => {
  for (const code of CODES) assert.equal(S.get(code).taxes401k, false, code);
});

test("of the six Plains states, only Montana and North Dakota pass the federal overtime deduction through", () => {
  for (const code of ["MT", "ND"]) assert.equal(S.get(code).overtimeDeduction, true, code);
  for (const code of ["NM", "NE", "KS", "MN"]) assert.equal(S.get(code).overtimeDeduction, false, code);
});

test("Kansas and Montana are verified; NM, ND, NE and MN still carry the unverified flag", () => {
  for (const code of ["KS", "MT"]) assert.equal(S.compute(code, single()).unverified, false, code);
  for (const code of ["NM", "ND", "NE", "MN"]) assert.equal(S.compute(code, single()).unverified, true, code);
});

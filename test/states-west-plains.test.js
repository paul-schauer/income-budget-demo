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

test("New Mexico: single, federal standard deduction", () => {
  const r = S.compute("NM", single());
  const taxable = 52250 - 16100;
  near(r.taxable, taxable);
  near(r.tax, 5500 * 0.015 + 11000 * 0.032 + 17000 * 0.043 + (taxable - 33500) * 0.047);
  assert.equal(r.payrollTotal, 0);
});

test("New Mexico: married filing jointly, two children", () => {
  const r = S.compute("NM", family());
  const taxable = 135250 - 32200;
  near(r.taxable, taxable);
  near(r.tax, 8000 * 0.015 + 17000 * 0.032 + 25000 * 0.043 + 50000 * 0.047 + (taxable - 100000) * 0.049);
});

// ---------- Montana ----------

test("Montana: single, from federal taxable income", () => {
  const r = S.compute("MT", single());
  near(r.taxable, 36150);
  near(r.tax, 36150 * 0.047);
});

test("Montana: married filing jointly, two children", () => {
  const r = S.compute("MT", family());
  near(r.taxable, 103050);
  near(r.tax, 95000 * 0.047 + (103050 - 95000) * 0.0565);
});

test("Montana and North Dakota take federal taxable income as is (overtime deduction already in it)", () => {
  const r = S.compute("MT", single({ overtimeDeduction: 5000, federalTaxable: 36150 - 5000 }));
  near(r.taxable, 31150);
  assert.equal(r.overtimeDeduction, true);
  near(S.compute("ND", family({ overtimeDeduction: 5000, federalTaxable: 103050 - 5000 })).taxable, 98050);
});

// ---------- North Dakota ----------

test("North Dakota: single owes nothing inside the 0% bracket", () => {
  const r = S.compute("ND", single());
  near(r.taxable, 36150);
  near(r.tax, 0);
});

test("North Dakota: married filing jointly, two children", () => {
  const r = S.compute("ND", family());
  near(r.taxable, 103050);
  near(r.tax, (103050 - 80975) * 0.0195);
});

// ---------- Nebraska ----------

test("Nebraska: single", () => {
  const r = S.compute("NE", single());
  const taxable = 52250 - 8600;
  near(r.taxable, taxable);
  near(r.tax, 4030 * 0.0246 + (24120 - 4030) * 0.0351 + (taxable - 24120) * 0.0455 - 171);
});

test("Nebraska: married filing jointly, two children", () => {
  const r = S.compute("NE", family());
  const taxable = 135250 - 17200;
  near(r.taxable, taxable);
  near(r.tax, 8040 * 0.0246 + (48250 - 8040) * 0.0351 + (taxable - 48250) * 0.0455 - 4 * 171);
});

// ---------- Kansas ----------

test("Kansas: single", () => {
  const r = S.compute("KS", single());
  const taxable = 52250 - 3605 - 9160;
  near(r.taxable, taxable);
  near(r.tax, 23000 * 0.052 + (taxable - 23000) * 0.0558);
});

test("Kansas: married filing jointly, two children", () => {
  const r = S.compute("KS", family());
  const taxable = 135250 - 8240 - 2 * 9160 - 2 * 2320;
  near(r.taxable, taxable);
  near(r.tax, 46000 * 0.052 + (taxable - 46000) * 0.0558);
});

// ---------- Minnesota ----------

test("Minnesota: single", () => {
  const r = S.compute("MN", single());
  const taxable = 52250 - 14950;
  near(r.taxable, taxable);
  near(r.tax, 32570 * 0.0535 + (taxable - 32570) * 0.068);
});

test("Minnesota: married filing jointly, two children", () => {
  const r = S.compute("MN", family());
  const taxable = 135250 - 29900 - 2 * 5200;
  near(r.taxable, taxable);
  near(r.tax, 47620 * 0.0535 + (taxable - 47620) * 0.068);
});

test("Minnesota: standard deduction shrinks by 3% of AGI over $238,950", () => {
  const r = S.compute("MN", earner(300000));
  const taxable = 300000 - (14950 - 0.03 * (300000 - 238950));
  near(r.taxable, taxable);
  near(r.tax, 32570 * 0.0535 + (106990 - 32570) * 0.068 + (198630 - 106990) * 0.0785 + (taxable - 198630) * 0.0985);
});

test("Minnesota Paid Leave: 0.44% employee share to the $184,500 cap", () => {
  near(S.compute("MN", single()).payroll[0][0].amount, 55000 * 0.0044);
  const fam = S.compute("MN", family());
  near(fam.payroll[0][0].amount, 95000 * 0.0044);
  near(fam.payroll[1][0].amount, 45000 * 0.0044);
  near(S.compute("MN", earner(200000)).payroll[0][0].amount, 184500 * 0.0044);
});

// ---------- Cross-state ----------

test("no West/Plains state taxes traditional 401(k) deferrals", () => {
  for (const code of CODES) assert.equal(S.get(code).taxes401k, false, code);
});

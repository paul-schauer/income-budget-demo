const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../js/state-tax.js");

const DATA = require("../js/states/no-tax-flat.js");
S.register(DATA);

const near = (actual, expected, tol = 0.01) =>
  assert.ok(Math.abs(actual - expected) <= tol, `expected ${expected}, got ${actual}`);

const NO_TAX = ["AK", "FL", "NV", "NH", "SD", "TN", "TX", "WA", "WY"];
const FLAT = ["AZ", "CO", "GA", "ID", "IL", "IN", "IA", "MI", "PA", "UT", "OH", "MA"];

// 2026 federal standard deduction.
const FED_STD = { single: 16100, mfj: 32200 };

// Household A: single, $55,000 wages, 5% traditional 401(k), no dependents.
const single = (over = {}) => ({
  status: "single",
  filers: 1,
  dependents: 0,
  earners: [{ wages: 55000, k401Trad: 2750 }],
  agi: 55000 - 2750, // 52,250
  federalTaxable: 55000 - 2750 - FED_STD.single, // 36,150
  federalStandardDeduction: FED_STD.single,
  overtimeDeduction: 0,
  local: { id: "none" },
  ...over,
});

// Household B: married filing jointly, $95,000 + $45,000 wages (5% traditional 401(k) each), 2 children.
const joint = (over = {}) => ({
  status: "mfj",
  filers: 2,
  dependents: 2,
  earners: [{ wages: 95000, k401Trad: 4750 }, { wages: 45000, k401Trad: 2250 }],
  agi: 140000 - 7000, // 133,000
  federalTaxable: 140000 - 7000 - FED_STD.mfj, // 100,800
  federalStandardDeduction: FED_STD.mfj,
  overtimeDeduction: 0,
  local: { id: "none" },
  ...over,
});

test("every entry passes validation", () => {
  for (const [code, entry] of Object.entries(DATA)) {
    assert.deepEqual(S.validate(entry), [], code);
    assert.equal(entry.code, code);
  }
});

test("all 21 states are present with the right kind", () => {
  assert.deepEqual(Object.keys(DATA).sort(), [...NO_TAX, ...FLAT].sort());
  assert.equal(Object.keys(DATA).length, 21);
  for (const code of NO_TAX) assert.equal(S.get(code).kind, "none", code);
  for (const code of FLAT) assert.ok(["flat", "graduated"].includes(S.get(code).kind), code);
  assert.equal(S.get("OH").kind, "graduated"); // 0% band, then 2.75%
  assert.equal(S.get("ID").kind, "graduated"); // 0% band, then 5.3%
});

test("notes are short and at most two per state", () => {
  for (const [code, entry] of Object.entries(DATA)) {
    assert.ok((entry.notes || []).length <= 2, code);
    for (const note of entry.notes || []) assert.ok(note.length <= 140, `${code}: ${note}`);
  }
});

test("no-tax states owe no income tax", () => {
  for (const code of NO_TAX) {
    assert.equal(S.compute(code, single()).tax, 0, code);
    assert.equal(S.compute(code, joint()).tax, 0, code);
  }
});

test("Arizona: 2.5% after the federal standard deduction, $125 dependent credit", () => {
  near(S.compute("AZ", single()).tax, (52250 - 16100) * 0.025);
  near(S.compute("AZ", joint()).tax, (133000 - 32200) * 0.025 - 2 * 125);
  // The credit loses 5% per $1,000 of AGI over $400,000 (joint): $410,500 -> 11 steps -> 55% lost.
  const rich = joint({ agi: 410500 });
  near(S.compute("AZ", rich).tax, (410500 - 32200) * 0.025 - 2 * 125 * (1 - 0.55));
  // Overtime is deducted.
  near(S.compute("AZ", single({ overtimeDeduction: 4000 })).tax, (52250 - 4000 - 16100) * 0.025);
});

test("Colorado: 4.4% of federal taxable income, overtime added back", () => {
  near(S.compute("CO", single()).tax, 36150 * 0.044);
  near(S.compute("CO", joint()).tax, 100800 * 0.044);
  // Federal taxable income already reflects the overtime deduction; Colorado adds it back for 2026.
  near(S.compute("CO", single({ federalTaxable: 36150 - 3000, overtimeDeduction: 3000 })).tax, 36150 * 0.044);
  // AGI over $300,000: standard deduction above $1,000 added back.
  const high = single({ agi: 350000, federalTaxable: 350000 - 16100 });
  near(S.compute("CO", high).tax, (350000 - 16100 + (16100 - 1000)) * 0.044);
});

test("Georgia: 4.99% after a $15,000 / $30,000 standard deduction and $5,000 per dependent", () => {
  near(S.compute("GA", single()).tax, (52250 - 15000) * 0.0499);
  near(S.compute("GA", joint()).tax, (133000 - 30000 - 2 * 5000) * 0.0499);
  // Overtime exclusion is capped at $1,750 per worker.
  near(S.compute("GA", single({ overtimeDeduction: 5000 })).tax, (52250 - 1750 - 15000) * 0.0499);
  near(S.compute("GA", single({ overtimeDeduction: 1000 })).tax, (52250 - 1000 - 15000) * 0.0499);
  near(S.compute("GA", joint({ overtimeDeduction: 5000 })).tax, (133000 - 3500 - 30000 - 2 * 5000) * 0.0499);
  near(S.compute("GA", single()).supplementalRate, 0.0499);
});

test("Idaho: 0% band then 5.3% of federal taxable income, $205 child credit", () => {
  near(S.compute("ID", single()).tax, (36150 - 4811) * 0.053);
  near(S.compute("ID", joint()).tax, (100800 - 9622) * 0.053 - 2 * 205);
});

test("Illinois: 4.95% after $2,850 per person; no exemptions over $250,000 AGI", () => {
  near(S.compute("IL", single()).tax, (52250 - 2850) * 0.0495);
  near(S.compute("IL", joint()).tax, (133000 - 4 * 2850) * 0.0495);
  near(S.compute("IL", single({ agi: 260000 })).tax, 260000 * 0.0495);
  near(S.compute("IL", joint({ agi: 260000 })).tax, (260000 - 4 * 2850) * 0.0495);
});

test("Indiana: 2.95% after $1,000 per person and $1,500 more per child; overtime deducted", () => {
  near(S.compute("IN", single()).tax, (52250 - 1000) * 0.0295);
  near(S.compute("IN", joint()).tax, (133000 - 2 * 1000 - 2 * (1000 + 1500)) * 0.0295);
  near(S.compute("IN", joint({ overtimeDeduction: 5000 })).tax, (133000 - 5000 - 2 * 1000 - 2 * (1000 + 1500)) * 0.0295);
});

test("Iowa: 3.8% of federal taxable income less $40 credits per person", () => {
  near(S.compute("IA", single()).tax, 36150 * 0.038 - 40);
  near(S.compute("IA", joint()).tax, 100800 * 0.038 - 4 * 40);
});

test("Massachusetts: 5% after exemptions and the FICA deduction", () => {
  // $4,400 personal exemption; FICA deduction capped at $2,000 per earner.
  near(S.compute("MA", single()).tax, (52250 - 4400 - 2000) * 0.05);
  near(S.compute("MA", joint()).tax, (133000 - 8800 - 2 * 1000 - 2 * 2000) * 0.05);
  // Head of household: $6,800 exemption.
  const hoh = single({ status: "hoh", dependents: 1 });
  near(S.compute("MA", hoh).tax, (52250 - 6800 - 1000 - 2000) * 0.05);
  // Low wages: the FICA deduction is 7.65% of wages.
  const low = single({ earners: [{ wages: 20000, k401Trad: 0 }], agi: 20000 });
  near(S.compute("MA", low).tax, (20000 - 4400 - 20000 * 0.0765) * 0.05);
});

test("Massachusetts: 4% surtax on taxable income over $1,107,750", () => {
  const rich = single({ earners: [{ wages: 1500000, k401Trad: 0 }], agi: 1500000 });
  const taxable = 1500000 - 4400 - 2000;
  const r = S.compute("MA", rich);
  near(r.taxable, taxable);
  near(r.tax, taxable * 0.05 + (taxable - 1107750) * 0.04);
  near(r.marginalRate, 0.09, 1e-6);
  // Just under the threshold: no surtax.
  const under = single({ earners: [{ wages: 1100000, k401Trad: 0 }], agi: 1100000 });
  near(S.compute("MA", under).tax, (1100000 - 4400 - 2000) * 0.05);
});

test("Michigan: 4.25% after $5,900 per person", () => {
  near(S.compute("MI", single()).tax, (52250 - 5900) * 0.0425);
  near(S.compute("MI", joint()).tax, (133000 - 4 * 5900) * 0.0425);
});

test("Ohio: $332 plus 2.75% over $26,050, MAGI-based exemptions, joint filing credit", () => {
  // MAGI $52,250 -> $2,150 exemption.
  near(S.compute("OH", single()).tax, 332 + (52250 - 2150 - 26050) * 0.0275);
  // MAGI $133,000 -> $1,900 x 4; both spouses work, income less exemptions over $75,000 -> 5% joint filing credit.
  const jointTax = 332 + (133000 - 4 * 1900 - 26050) * 0.0275;
  near(S.compute("OH", joint()).tax, jointTax * (1 - 0.05));
  // One earner: no joint filing credit.
  const oneEarner = joint({ earners: [{ wages: 140000, k401Trad: 7000 }] });
  near(S.compute("OH", oneEarner).tax, jointTax);
  // At or under $26,050 of taxable income: no tax.
  near(S.compute("OH", single({ agi: 28000 })).tax, 0);
  // Low income: $2,400 exemption and a $20 credit per exemption when MAGI is under $30,000.
  near(S.compute("OH", single({ agi: 29500 })).tax, 332 + (29500 - 2400 - 26050) * 0.0275 - 20);
  near(S.compute("OH", single({ agi: 45000 })).tax, 332 + (45000 - 2150 - 26050) * 0.0275);
  // No exemptions over $500,000 MAGI.
  near(S.compute("OH", single({ agi: 600000 })).tax, 332 + (600000 - 26050) * 0.0275);
  near(S.compute("OH", single()).marginalRate, 0.0275, 1e-6);
});

test("Pennsylvania: 3.07% of wages including 401(k) deferrals", () => {
  near(S.compute("PA", single()).tax, 55000 * 0.0307);
  near(S.compute("PA", joint()).tax, (95000 + 45000) * 0.0307);
});

test("Utah: 4.45% less the taxpayer tax credit", () => {
  const creditA = 0.06 * 16100 - 0.013 * (52250 - 18213);
  near(S.compute("UT", single()).tax, 52250 * 0.0445 - creditA);
  const creditB = 0.06 * (32200 + 2 * 2111) - 0.013 * (133000 - 36426);
  near(S.compute("UT", joint()).tax, 133000 * 0.0445 - creditB);
  // The credit is fully phased out at higher income.
  near(S.compute("UT", single({ agi: 150000 })).tax, 150000 * 0.0445);
});

test("overtime flag is set only where the state allows the deduction", () => {
  const allows = Object.values(DATA).filter((d) => d.overtimeDeduction).map((d) => d.code).sort();
  assert.deepEqual(allows, ["AZ", "GA", "IA", "ID", "IN", "MI"]);
  // Pennsylvania taxes 401(k) deferrals; no one else in this file does.
  assert.deepEqual(Object.values(DATA).filter((d) => d.taxes401k).map((d) => d.code), ["PA"]);
});

test("payroll: Washington PFML (capped) and WA Cares (uncapped)", () => {
  const [low, high] = S.compute("WA", joint({ earners: [{ wages: 60000 }, { wages: 200000 }] })).payroll;
  near(low.find((p) => p.id === "wa-pfml").amount, 60000 * 0.0113 * 0.7143);
  near(high.find((p) => p.id === "wa-pfml").amount, 184500 * 0.0113 * 0.7143);
  near(low.find((p) => p.id === "wa-cares").amount, 60000 * 0.0058);
  near(high.find((p) => p.id === "wa-cares").amount, 200000 * 0.0058);
});

test("payroll: Alaska unemployment insurance up to $54,200", () => {
  const r = S.compute("AK", joint({ earners: [{ wages: 40000 }, { wages: 90000 }] }));
  near(r.payroll[0][0].amount, 40000 * 0.005);
  near(r.payroll[1][0].amount, 54200 * 0.005);
  near(r.payrollTotal, 40000 * 0.005 + 54200 * 0.005);
});

test("payroll: Colorado FAMLI and Massachusetts PFML stop at the $184,500 wage base", () => {
  near(S.payrollFor(S.get("CO"), 80000)[0].amount, 80000 * 0.0044);
  near(S.payrollFor(S.get("CO"), 250000)[0].amount, 184500 * 0.0044);
  near(S.payrollFor(S.get("MA"), 80000)[0].amount, 80000 * (0.0018 + 0.4 * 0.007));
  near(S.payrollFor(S.get("MA"), 250000)[0].amount, 184500 * (0.0018 + 0.4 * 0.007));
});

test("payroll: Pennsylvania unemployment compensation has no cap", () => {
  near(S.payrollFor(S.get("PA"), 55000)[0].amount, 55000 * 0.0007);
  near(S.payrollFor(S.get("PA"), 500000)[0].amount, 500000 * 0.0007);
});

test("Pennsylvania locals: Philadelphia wage tax and Pittsburgh EIT", () => {
  const at = (id, resident = true) => S.compute("PA", single({ local: { id, resident } })).local;
  near(at("philadelphia").tax, 55000 * 0.03735);
  near(at("philadelphia", false).tax, 55000 * 0.03425);
  near(at("pittsburgh").tax, 55000 * 0.03);
  near(at("pittsburgh", false).tax, 55000 * 0.01);
  near(S.compute("PA", joint({ local: { id: "philadelphia" } })).local.tax, 140000 * 0.03735);
});

test("Ohio locals: Columbus, Cleveland and Cincinnati tax wages at the same rate for everyone", () => {
  const at = (id, resident = true) => S.compute("OH", single({ local: { id, resident } })).local;
  near(at("columbus").tax, 55000 * 0.025);
  near(at("columbus", false).tax, 55000 * 0.025);
  near(at("cleveland").tax, 55000 * 0.025);
  near(at("cincinnati").tax, 55000 * 0.018);
  near(at("cincinnati", false).tax, 55000 * 0.018);
});

test("every state in this file lists sources", () => {
  for (const entry of Object.values(DATA)) assert.ok(entry.sources.length >= 1, entry.code);
});

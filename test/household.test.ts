const test = require("node:test");
const assert = require("node:assert/strict");
const Tax = require("../js/tax.js");

const near = (actual, expected, tol = 0.01) =>
  assert.ok(Math.abs(actual - expected) <= tol, `expected ${expected}, got ${actual}`);

// No state or local tax, so each test isolates the federal and FICA math.
const you = { grossAnnual: 80000, filingStatus: "mfj", k401Percent: 5, k401Type: "traditional", preTaxBenefits: 0, dependents: 0, state: "" };
const spouse = { grossAnnual: 50000, k401Percent: 0, k401Type: "traditional", preTaxBenefits: 2000 };
const sumPeople = (r) => r.people.reduce((s, p) => s + p.net, 0);

test("a spouse's pay is combined on a joint return with separate FICA", () => {
  const r = Tax.calculate({ ...you, spouse });
  assert.equal(r.people.length, 2);
  near(r.wages, 130000);
  // AGI: 80,000 - 4,000 (401k) + 50,000 - 2,000 (benefits)
  near(r.agi, 124000);
  near(r.federalTaxable, 124000 - 32200);
  near(r.federal, 2480 + (124000 - 32200 - 24800) * 0.12); // $91,800 taxable, inside the 12% bracket
  near(r.socialSecurity, 80000 * 0.062 + 48000 * 0.062);
  near(r.medicare, 128000 * 0.0145);
  near(r.people[1].socialSecurity, 48000 * 0.062);
  near(sumPeople(r), r.net);
});

test("income tax is shared between spouses by wages", () => {
  const r = Tax.calculate({ ...you, spouse });
  near(r.people[0].incomeTax / r.people[1].incomeTax, 76000 / 48000, 1e-9);
  near(r.people[0].incomeTax + r.people[1].incomeTax, r.federal);
});

test("a spouse only counts on a joint return", () => {
  for (const filingStatus of ["single", "mfs", "hoh"]) {
    const r = Tax.calculate({ ...you, filingStatus, spouse });
    assert.equal(r.people.length, 1, filingStatus);
    near(r.wages, 80000);
  }
});

test("each spouse has their own Social Security wage base; additional Medicare uses the joint threshold", () => {
  const r = Tax.calculate({ ...you, grossAnnual: 190000, k401Percent: 0, spouse: { grossAnnual: 150000 } });
  near(r.socialSecurity, 184500 * 0.062 + 150000 * 0.062);
  near(r.medicare, 340000 * 0.0145 + (340000 - 250000) * 0.009);
});

test("self-employment income: SE tax, half deducted, 20% QBI deduction, and money to set aside", () => {
  const base = Tax.calculate({ ...you, filingStatus: "single" });
  const r = Tax.calculate({ ...you, filingStatus: "single", otherIncome: [{ type: "self", annual: 20000 }] });
  const seEarnings = 20000 * 0.9235;
  const seTax = seEarnings * 0.153;
  near(r.seTax, seTax);
  near(r.agi, 76000 + 20000 - seTax / 2);
  const taxableBeforeQbi = r.agi - 16100;
  near(r.qbiDeduction, 0.2 * (20000 - seTax / 2));
  near(r.federalTaxable, taxableBeforeQbi - r.qbiDeduction);
  // No FICA on it from an employer, so the paycheck is unchanged and the extra tax is set aside.
  near(r.people[0].net, base.people[0].net);
  near(r.extras.tax, r.taxes - base.taxes);
  near(r.extras.setAside, r.extras.tax);
  near(r.extras.net, 20000 - r.extras.tax);
  near(sumPeople(r) + r.extras.net, r.net);
});

test("self-employment Social Security shares the wage base with W-2 pay", () => {
  const r = Tax.calculate({ ...you, filingStatus: "single", grossAnnual: 180000, k401Percent: 0, otherIncome: [{ type: "self", annual: 50000 }] });
  const seEarnings = 50000 * 0.9235;
  near(r.seTax, (184500 - 180000) * 0.124 + seEarnings * 0.029);
});

test("QBI deduction phases out above the threshold and has a $400 minimum", () => {
  near(Tax.qbiDeduction(10000, 150000, "single"), 2000);
  near(Tax.qbiDeduction(10000, 201750 + 37500, "single"), 1000); // halfway through the $75k range
  near(Tax.qbiDeduction(10000, 300000, "single"), 400); // phased out, but the minimum applies
  near(Tax.qbiDeduction(900, 300000, "single"), 0); // under $1,000 of QBI: no minimum
  near(Tax.qbiDeduction(10000, 1000, "single"), 200); // capped at 20% of taxable income
});

test("a second W-2 job adds FICA and income tax but no set-aside", () => {
  const base = Tax.calculate({ ...you, filingStatus: "single" });
  const r = Tax.calculate({ ...you, filingStatus: "single", otherIncome: [{ type: "w2", annual: 10000 }] });
  near(r.socialSecurity - base.socialSecurity, 620);
  near(r.agi, 86000);
  near(r.extras.setAside, 0);
  near(r.extras.tax, r.taxes - base.taxes);
});

test("other taxable income has no FICA; non-taxable income adds straight to take-home", () => {
  const base = Tax.calculate({ ...you, filingStatus: "single" });
  const taxable = Tax.calculate({ ...you, filingStatus: "single", otherIncome: [{ type: "taxable", annual: 5000 }] });
  near(taxable.socialSecurity, base.socialSecurity);
  near(taxable.federal - base.federal, 5000 * 0.22, 5000 * 0.12 + 1); // lands in the 12-22% range
  assert.ok(taxable.extras.setAside > 0);
  const gift = Tax.calculate({ ...you, filingStatus: "single", otherIncome: [{ type: "nontaxable", annual: 3000 }] });
  near(gift.net - base.net, 3000);
  near(gift.taxes, base.taxes);
  near(gift.extras.net, 3000);
});

test("extra income can belong to a spouse", () => {
  const r = Tax.calculate({ ...you, spouse, otherIncome: [{ type: "w2", annual: 10000, owner: "spouse" }] });
  const base = Tax.calculate({ ...you, spouse });
  near(r.socialSecurity - base.socialSecurity, 620);
  // Without a spouse on the return it falls back to you.
  const single = Tax.calculate({ ...you, filingStatus: "single", otherIncome: [{ type: "w2", annual: 10000, owner: "spouse" }] });
  near(single.wages, 80000);
  near(single.agi, 86000);
});

test("junk extra income is ignored", () => {
  const r = Tax.calculate({ ...you, otherIncome: [null, { type: "w2", annual: -5 }, { type: "bogus", annual: "abc" }] });
  near(r.net, Tax.calculate(you).net);
});

test("no state chosen means no state or local tax; unknown state too", () => {
  const r = Tax.calculate({ ...you, state: "" });
  assert.equal(r.stateTax, 0);
  assert.equal(r.localTax, 0);
  assert.equal(Tax.calculate({ ...you, state: "ZZ" }).stateTax, 0);
});

test("a custom local income tax rate applies to wages in any state", () => {
  const r = Tax.calculate({ ...you, state: "", local: { id: "custom", customRate: 2 } });
  near(r.localTax, 80000 * 0.02);
});

test("Michigan state and city tax still work through the state engine", () => {
  const r = Tax.calculate({ ...you, state: "MI", local: { id: "detroit", resident: true }, spouse });
  near(r.stateTax, (124000 - 2 * 5900) * 0.0425);
  near(r.localTax, (80000 + 48000 - 2 * 600) * 0.024);
  assert.equal(r.state.name, "Michigan");
  assert.equal(r.local.name, "Detroit");
});

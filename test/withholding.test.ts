import test from "node:test";
import assert from "node:assert/strict";
import * as Tax from "../src/tax/tax";
import type { TaxInput, TaxResult } from "../src/tax/types";

const near = (actual: number, expected: number, tol = 0.01) =>
  assert.ok(Math.abs(actual - expected) <= tol, `expected ${expected}, got ${actual}`);
const sumPeople = (r: TaxResult) => r.people.reduce((s, p) => s + p.net, 0);

// No state or local tax, so each test isolates the federal math.
const single80k: TaxInput = { grossAnnual: 80000, filingStatus: "single", k401Percent: 5, k401Type: "traditional", preTaxBenefits: 0, dependents: 0, state: "" };
// $80,000 (5% traditional 401(k)) and $50,000 ($2,000 of benefits) on a joint return.
const joint: TaxInput = { ...single80k, filingStatus: "mfj", spouse: { grossAnnual: 50000, k401Percent: 0, k401Type: "traditional", preTaxBenefits: 2000 } };
// Employers' withholding on the two jobs: $76,000 and $48,000 of wages, less the $32,200 joint standard deduction.
const jointWithheld = (2480 + (76000 - 32200 - 24800) * 0.12) + (48000 - 32200) * 0.10; // 4,760 + 1,580
const jointOwed = 2480 + (124000 - 32200 - 24800) * 0.12; // $91,800 taxable
const jointShortfall = jointOwed - jointWithheld; // 4,180

test("withholding: each 2026 schedule plus line 1g comes to the standard deduction", () => {
  const w = Tax.FEDERAL.withholding;
  for (const s of ["single", "mfj", "mfs", "hoh"] as const) near(w.adjustment[s] + w.zeroBracket[s], Tax.FEDERAL.standardDeduction[s]);
});

test("withholding: reproduces the base amounts printed in Pub. 15-T's annual schedules", () => {
  // Adjusted annual wage = wages less line 1g, so add the adjustment back to land on each row.
  near(Tax.federalWithholding(19900 + 8600, "single"), 1240);
  near(Tax.federalWithholding(57900 + 8600, "single"), 1240 + (57900 - 19900) * 0.12); // 5,800
  near(Tax.federalWithholding(44100 + 12900, "mfj"), 2480);
  near(Tax.federalWithholding(120100 + 12900, "mfj"), 2480 + (120100 - 44100) * 0.12); // 11,600
  near(Tax.federalWithholding(33250 + 8600, "hoh"), 1770);
});

test("withholding: married filing separately uses the single schedule, and credits come off the result", () => {
  near(Tax.federalWithholding(90000, "mfs"), Tax.federalWithholding(90000, "single"));
  near(Tax.federalWithholding(80000, "single", 2200), Tax.federalWithholding(80000, "single") - 2200);
  near(Tax.federalWithholding(20000, "single", 5000), 0);
});

test("withholding: one job withholds what you owe", () => {
  const r = Tax.calculate(single80k);
  near(r.withholding.withheld, r.federal);
  near(r.withholding.shortfall, 0);
  // Head of household with two children: the credits on the W-4 match the ones on the return.
  const hoh = Tax.calculate({ ...single80k, filingStatus: "hoh", grossAnnual: 60000, k401Percent: 0, dependents: 2 });
  near(hoh.withholding.shortfall, 0);
});

test("withholding: two jobs on a joint return come up short", () => {
  const r = Tax.calculate(joint);
  near(r.withholding.withheld, jointWithheld);
  near(r.withholding.owed, jointOwed);
  near(r.withholding.shortfall, jointShortfall);
  near(r.withholding.due, jointShortfall);
  assert.equal(r.withholding.payer, "you");
});

test("withholding: withholding the shortfall pays it without lowering take-home", () => {
  const r = Tax.calculate(joint);
  const covered = Tax.calculate({ ...joint, withholdShortfall: true, extraWithholdingAnnual: 9999 });
  near(covered.extraWithholding, jointShortfall); // replaces the amount entered
  near(covered.people[0].extraWithholding, jointShortfall);
  near(covered.withholding.covered, jointShortfall);
  near(covered.withholding.due, 0);
  near(covered.withholding.overWithheld, 0);
  near(covered.taxes, r.taxes);
  near(covered.net, r.net);
  near(sumPeople(covered), covered.net);
});

test("withholding: extra withholding pays the shortfall first; only the rest lowers take-home", () => {
  const none = Tax.calculate(joint);
  const some = Tax.calculate({ ...joint, extraWithholdingAnnual: 1000 });
  near(some.net, none.net);
  near(some.withholding.due, jointShortfall - 1000);
  const more = Tax.calculate({ ...joint, extraWithholdingAnnual: 5000 });
  near(more.withholding.overWithheld, 5000 - jointShortfall);
  near(none.net - more.net, 5000 - jointShortfall);
  near(none.people[0].net - more.people[0].net, 5000 - jointShortfall);
});

test("withholding: the step 3 credits go on the higher-paid job", () => {
  const r = Tax.calculate({ ...joint, grossAnnual: 50000, k401Percent: 0, dependents: 2, spouse: { grossAnnual: 90000 } });
  near(r.withholding.withheld, Tax.federalWithholding(50000, "mfj") + Tax.federalWithholding(90000, "mfj", 2 * 2200));
  near(r.withholding.withheld, (50000 - 32200) * 0.10 + (2480 + (90000 - 32200 - 24800) * 0.12 - 4400)); // 1,780 + 2,040
  near(r.withholding.owed, 2480 + (100800 - 24800) * 0.12 + (140000 - 32200 - 100800) * 0.22 - 4400); // 8,740
});

test("withholding: additional Medicare on a joint return counts toward the shortfall", () => {
  const r = Tax.calculate({ ...joint, grossAnnual: 150000, k401Percent: 0, spouse: { grossAnnual: 150000 } });
  near(r.withholding.owed - r.federal, (300000 - 250000) * 0.009);
  near(r.withholding.withheld, 2 * Tax.federalWithholding(150000, "mfj")); // neither job passes $200,000
  // One job over $200,000: the employer withholds the 0.9%, so nothing is short.
  near(Tax.calculate({ ...single80k, grossAnnual: 250000, k401Percent: 0 }).withholding.shortfall, 0);
});

test("withholding: a second W-2 job withholds on its own, so it comes up short", () => {
  const r = Tax.calculate({ ...single80k, otherIncome: [{ type: "w2", annual: 20000 }] });
  const withheld = (1240 + (50400 - 12400) * 0.12 + (76000 - 16100 - 50400) * 0.22) + (20000 - 16100) * 0.10; // 7,890 + 390
  near(r.withholding.withheld, withheld);
  near(r.withholding.shortfall, (1240 + (50400 - 12400) * 0.12 + (96000 - 16100 - 50400) * 0.22) - withheld); // 12,290 - 8,280
  near(r.extras.setAside, 0);
});

test("withholding: self-employment income stays out of it and is set aside instead", () => {
  const base = Tax.calculate(single80k);
  const r = Tax.calculate({ ...single80k, otherIncome: [{ type: "self", annual: 20000 }] });
  near(r.withholding.shortfall, base.withholding.shortfall);
  assert.ok(r.extras.setAside > 0);
});

test("withholding: with no wages of your own, the extra goes on your spouse's W-4", () => {
  const input: TaxInput = { ...joint, grossAnnual: 0, spouse: { grossAnnual: 60000 }, otherIncome: [{ type: "w2", annual: 30000, owner: "spouse" }] };
  const r = Tax.calculate({ ...input, withholdShortfall: true });
  // $60,000 and $30,000 jobs: the second one withholds nothing under the $32,200 deduction.
  const shortfall = (2480 + (90000 - 32200 - 24800) * 0.12) - (2480 + (60000 - 32200 - 24800) * 0.12);
  near(r.withholding.shortfall, shortfall);
  assert.equal(r.withholding.payer, "spouse");
  near(r.people[0].extraWithholding, 0);
  near(r.people[1].extraWithholding, shortfall);
});

test("withholding: a raise's take-home doesn't depend on extra withholding", () => {
  const plain = Tax.raiseImpact(joint, 1000);
  near(Tax.raiseImpact({ ...joint, withholdShortfall: true }, 1000), plain);
  near(Tax.raiseImpact({ ...joint, extraWithholdingAnnual: 8000 }, 1000), plain);
});

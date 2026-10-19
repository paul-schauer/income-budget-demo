import test from "node:test";
import assert from "node:assert/strict";
import * as C from "../src/app/compare";
import * as Tax from "../src/tax/tax";
import type { TaxInput } from "../src/tax/types";

const near = (actual: number, expected: number, tol = 0.01) =>
  assert.ok(Math.abs(actual - expected) <= tol, `expected ${expected}, got ${actual}`);

// Michigan (no state given), single, no 401(k): $80k and $90k both sit in the 22% bracket.
const single80k: TaxInput = {
  grossAnnual: 80000,
  filingStatus: "single",
  k401Percent: 0,
  k401Type: "traditional",
  preTaxBenefits: 0,
  dependents: 0,
  local: { id: "none" },
};

test("compare: a $10k raise in the 22% bracket keeps 66.1% after federal, FICA and Michigan", () => {
  const c = C.compareSalary({ taxInput: single80k, grossAnnual: 90000 });
  near(c.now.people[0].gross, 80000);
  near(c.next.people[0].gross, 90000);
  near(c.change.pay, 10000);
  near(c.next.federal - c.now.federal, 2200);
  near(c.next.socialSecurity - c.now.socialSecurity, 620);
  near(c.next.medicare - c.now.medicare, 145);
  near(c.next.stateTax - c.now.stateTax, 425);
  near(c.change.taxes, 3390);
  near(c.change.net, 6610);
  near(c.kept as number, 0.661, 0.0001);
  assert.equal(c.k401CapReached, false);
});

test("compare: matches the raise estimate on the results card", () => {
  for (const input of [single80k, { ...single80k, k401Percent: 6, preTaxBenefits: 3000, extraWithholdingAnnual: 1300 }]) {
    const c = C.compareSalary({ taxInput: input, grossAnnual: 97500 });
    near(c.change.net, Tax.raiseImpact(input, 17500));
  }
});

test("compare: a pay cut mirrors a raise", () => {
  const c = C.compareSalary({ taxInput: { ...single80k, grossAnnual: 90000 }, grossAnnual: 80000 });
  near(c.change.pay, -10000);
  near(c.change.taxes, -3390);
  near(c.change.net, -6610);
  near(c.kept as number, 0.661, 0.0001);
});

test("compare: the same pay changes nothing", () => {
  const c = C.compareSalary({ taxInput: single80k, grossAnnual: 80000 });
  assert.equal(c.kept, null);
  for (const v of Object.values(c.change)) near(v, 0);
  near(c.next.net, c.now.net);
});

test("compare: your 401(k) % comes out of the new pay; traditional lowers income tax, Roth doesn't", () => {
  const trad = C.compareSalary({ taxInput: { ...single80k, k401Percent: 5 }, grossAnnual: 90000 });
  near(trad.change.k401, 500);
  near(trad.change.taxes, 0.22 * 9500 + 765 + 0.0425 * 9500);
  near(trad.change.net, 10000 - 500 - 3258.75);

  const roth = C.compareSalary({ taxInput: { ...single80k, k401Percent: 5, k401Type: "roth" }, grossAnnual: 90000 });
  near(roth.change.k401, 500);
  near(roth.change.taxes, 3390);
  near(roth.change.net, 10000 - 500 - 3390);
});

test("compare: flags the 401(k) limit only when the new pay reaches it", () => {
  const input = { ...single80k, grossAnnual: 100000, k401Percent: 20 };
  const c = C.compareSalary({ taxInput: input, grossAnnual: 130000 });
  assert.equal(c.k401CapReached, true);
  near(c.change.k401, 24500 - 20000);
  assert.equal(C.compareSalary({ taxInput: input, grossAnnual: 110000 }).k401CapReached, false);
  // Already capped now: nothing new to flag.
  assert.equal(C.compareSalary({ taxInput: { ...input, grossAnnual: 130000 }, grossAnnual: 150000 }).k401CapReached, false);
});

test("compare: reports the move to a higher federal bracket", () => {
  const c = C.compareSalary({ taxInput: single80k, grossAnnual: 130000 });
  near(c.now.federalMarginal, 0.22);
  near(c.next.federalMarginal, 0.24);
});

test("compare: child tax credit phases out above $200,000 (single)", () => {
  const input = { ...single80k, grossAnnual: 190000, dependents: 2 };
  const c = C.compareSalary({ taxInput: input, grossAnnual: 230000 });
  near(c.now.childCredit, 4400);
  near(c.creditsLost, Math.ceil(30000 / 1000) * 50);
});

test("compare: on a joint return only your pay changes; your spouse's and other income stay", () => {
  const input: TaxInput = {
    ...single80k,
    grossAnnual: 60000,
    filingStatus: "mfj",
    state: "MI",
    spouse: { grossAnnual: 50000, k401Percent: 4 },
    otherIncome: [{ type: "self", annual: 12000, owner: "spouse" }],
  };
  const c = C.compareSalary({ taxInput: input, grossAnnual: 75000 });
  near(c.change.pay, 15000);
  near(c.next.people[1].gross, 50000);
  near(c.next.extras.gross, c.now.extras.gross);
  near(c.next.gross - c.next.people[0].gross, c.now.gross - c.now.people[0].gross);
  near(c.change.net, Tax.raiseImpact(input, 15000));
});

test("compare: uses the state you live in, payroll deductions included", () => {
  const input: TaxInput = { ...single80k, state: "CA" };
  const c = C.compareSalary({ taxInput: input, grossAnnual: 90000 });
  assert.equal(c.next.state.code, "CA");
  assert.ok(c.next.payroll > c.now.payroll, "California SDI grows with pay");
  near(c.change.taxes, c.next.taxes - c.now.taxes);
  near(c.change.net, Tax.raiseImpact(input, 10000));
});

test("compare: a blank or bad comparison salary counts as $0", () => {
  for (const g of [0, -5, NaN]) {
    const c = C.compareSalary({ taxInput: single80k, grossAnnual: g });
    near(c.next.people[0].gross, 0);
    near(c.next.net, 0);
  }
});

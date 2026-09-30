import test from "node:test";
import assert from "node:assert/strict";
import * as Tax from "../src/tax/tax";
import type { FilingStatus, TaxApi, TaxInput } from "../src/tax/types";

// The module's exports match the TaxApi type that other code can use to describe it.
Tax satisfies TaxApi;

const near = (actual: number, expected: number, tol = 0.01) =>
  assert.ok(Math.abs(actual - expected) <= tol, `expected ${expected}, got ${actual}`);

const base: TaxInput = {
  grossAnnual: 92000,
  filingStatus: "mfj",
  k401Percent: 4,
  k401Type: "traditional",
  preTaxBenefits: 0,
  dependents: 0,
  cityId: "lansing",
  cityResident: true,
};

test("bracket math walks each bracket", () => {
  // MFJ taxable 56,120: 10% of 24,800 + 12% of 31,320
  near(Tax.bracketTax(56120, Tax.FEDERAL.brackets.mfj), 2480 + 3758.4);
  assert.equal(Tax.bracketTax(0, Tax.FEDERAL.brackets.single), 0);
});

test("2026 bracket thresholds and standard deductions match Rev. Proc. 2025-32", () => {
  const tops = (s: FilingStatus) => Tax.FEDERAL.brackets[s].slice(0, -1).map(([u]) => u);
  assert.deepEqual(tops("single"), [12400, 50400, 105700, 201775, 256225, 640600]);
  assert.deepEqual(tops("mfj"), [24800, 100800, 211400, 403550, 512450, 768700]);
  assert.deepEqual(tops("mfs"), [12400, 50400, 105700, 201775, 256225, 384350]);
  assert.deepEqual(tops("hoh"), [17700, 67450, 105700, 201750, 256200, 640600]);
  for (const s of ["single", "mfj", "mfs", "hoh"] as const) {
    assert.deepEqual(Tax.FEDERAL.brackets[s].map(([, r]) => r), [0.10, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37]);
  }
  assert.deepEqual(Tax.FEDERAL.standardDeduction, { single: 16100, mfj: 32200, mfs: 16100, hoh: 24150 });
  // HOH: 10% of 17,700 + 12% of 49,750 at the top of the 12% bracket
  near(Tax.bracketTax(67450, Tax.FEDERAL.brackets.hoh), 1770 + 5970);
});

test("MFJ $92k, 4% 401(k), Lansing resident", () => {
  const r = Tax.calculate(base);
  near(r.k401, 3680);
  near(r.federal, 6238.4); // 88,320 - 32,200 = 56,120 taxable
  near(r.socialSecurity, 92000 * 0.062);
  near(r.medicare, 92000 * 0.0145);
  near(r.michigan, (88320 - 2 * 5900) * 0.0425); // two exemptions for joint filers
  near(r.city, (92000 - 2 * 600) * 0.01); // 401(k) is taxable for city purposes
  near(r.net, 92000 - 3680 - r.taxes);
});

test("Roth 401(k) does not reduce income-tax wages", () => {
  const trad = Tax.calculate(base);
  const roth = Tax.calculate({ ...base, k401Type: "roth" });
  assert.ok(roth.federal > trad.federal);
  assert.ok(roth.michigan > trad.michigan);
  near(roth.socialSecurity, trad.socialSecurity);
  near(roth.city, trad.city);
});

test("Section 125 benefits reduce FICA and city wages; 401(k) does not", () => {
  const r = Tax.calculate({ ...base, k401Percent: 0, preTaxBenefits: 5000 });
  near(r.socialSecurity, 87000 * 0.062);
  near(r.city, (87000 - 2 * 600) * 0.01);
});

test("401(k) is capped at the annual limit", () => {
  const r = Tax.calculate({ ...base, grossAnnual: 400000, k401Percent: 20 });
  near(r.k401, Tax.FEDERAL.k401Limit);
  near(Tax.FEDERAL.k401Limit, 24500);
  assert.equal(r.k401Capped, true);
});

test("catch-up contributions raise the 401(k) limit by age", () => {
  assert.equal(Tax.k401LimitFor(undefined), 24500);
  assert.equal(Tax.k401LimitFor(49), 24500);
  assert.equal(Tax.k401LimitFor(50), 32500);
  assert.equal(Tax.k401LimitFor(60), 35750);
  assert.equal(Tax.k401LimitFor(63), 35750);
  assert.equal(Tax.k401LimitFor(64), 32500);
  const r = Tax.calculate({ ...base, grossAnnual: 400000, k401Percent: 20, age: 55 });
  near(r.k401, 32500);
  assert.equal(r.k401Limit, 32500);
  assert.equal(r.k401Capped, true);
  const noAge = Tax.calculate({ ...base, grossAnnual: 400000, k401Percent: 20 });
  assert.equal(noAge.k401Limit, 24500);
});

test("k401Annual overrides the percentage", () => {
  const r = Tax.calculate({ ...base, k401Annual: 6000 });
  near(r.k401, 6000);
  const pct = Tax.calculate({ ...base, k401Annual: null });
  near(pct.k401, 3680);
  const capped = Tax.calculate({ ...base, k401Annual: 30000 });
  near(capped.k401, 24500);
  assert.equal(capped.k401Capped, true);
});

test("Social Security stops at the wage base; additional Medicare kicks in", () => {
  const r = Tax.calculate({ ...base, grossAnnual: 300000, k401Percent: 0, filingStatus: "single" });
  near(Tax.FICA.socialSecurityWageBase, 184500);
  near(r.socialSecurity, 184500 * 0.062);
  near(r.medicare, 300000 * 0.0145 + 100000 * 0.009);
  const mfs = Tax.calculate({ ...base, grossAnnual: 300000, k401Percent: 0, filingStatus: "mfs" });
  near(mfs.medicare, 300000 * 0.0145 + 175000 * 0.009);
});

test("child tax credit reduces federal tax but not below zero", () => {
  const none = Tax.calculate(base);
  const two = Tax.calculate({ ...base, dependents: 2 });
  near(none.federal - two.federal, 4400);
  const lots = Tax.calculate({ ...base, dependents: 10 });
  assert.equal(lots.federal, 0);
});

test("child tax credit phases out $50 per $1,000 over $200k (single)", () => {
  const r = Tax.calculate({ ...base, filingStatus: "single", grossAnnual: 210500, k401Percent: 0, dependents: 1 });
  // excess 10,500 -> 11 steps -> $550 off
  near(r.childCredit, 2200 - 550);
});

test("nonresident city rate is half", () => {
  const r = Tax.calculate({ ...base, cityResident: false });
  near(r.cityRate, 0.005);
});

test("no city means no city tax; zero income is all zeros", () => {
  assert.equal(Tax.calculate({ ...base, cityId: "none" }).city, 0);
  const z = Tax.calculate({ ...base, grossAnnual: 0 });
  assert.equal(z.net, 0);
  assert.equal(z.taxes, 0);
});

test("period conversion", () => {
  near(Tax.convert(500, "monthly", "weekly"), 115.38, 0.01);
  near(Tax.convert(20, "weekly", "annual"), 1040);
});

test("other dependents get a $500 credit and a Michigan exemption", () => {
  const none = Tax.calculate(base);
  const one = Tax.calculate({ ...base, otherDependents: 1 });
  near(none.federal - one.federal, 500);
  near(none.michigan - one.michigan, Tax.MICHIGAN.personalExemption * Tax.MICHIGAN.rate);
});

test("extra withholding lowers take-home but not tax owed", () => {
  const none = Tax.calculate(base);
  const extra = Tax.calculate({ ...base, extraWithholdingAnnual: 1040 });
  near(none.net - extra.net, 1040);
  near(extra.taxes, none.taxes);
});

test("Michigan 2026: 4.25% and $5,900 per exemption", () => {
  assert.equal(Tax.TAX_YEAR, 2026);
  assert.equal(Tax.MICHIGAN.rate, 0.0425);
  assert.equal(Tax.MICHIGAN.personalExemption, 5900);
});

test("all 24 Michigan income-tax cities with verified rates and exemptions", () => {
  const cities = Tax.CITIES.filter((c) => c.id !== "none");
  assert.equal(cities.length, 24);
  const expect: Record<string, [number, number]> = {
    albion: [0.01, 600], "battle-creek": [0.01, 750], "benton-harbor": [0.01, 750], "big-rapids": [0.01, 600],
    detroit: [0.024, 600], "east-lansing": [0.01, 600], flint: [0.01, 600], "grand-rapids": [0.015, 600],
    grayling: [0.01, 3000], hamtramck: [0.01, 600], "highland-park": [0.02, 600], hudson: [0.01, 1000],
    ionia: [0.01, 700], jackson: [0.01, 600], lansing: [0.01, 600], lapeer: [0.01, 600], muskegon: [0.01, 600],
    "muskegon-heights": [0.01, 600], pontiac: [0.01, 600], "port-huron": [0.01, 600], portland: [0.01, 1000],
    saginaw: [0.015, 750], springfield: [0.01, 750], walker: [0.01, 600],
  };
  for (const c of cities) {
    assert.ok(expect[c.id], `unexpected city ${c.id}`);
    assert.equal(c.resident, expect[c.id][0], `${c.name} resident rate`);
    near(c.nonresident, c.resident / 2, 1e-9); // Uniform City Income Tax Ordinance: nonresident = half
    assert.equal(c.exemption, expect[c.id][1], `${c.name} exemption`);
  }
});

test("city exemption amount is per exemption (Grayling $3,000)", () => {
  const r = Tax.calculate({ ...base, cityId: "grayling", dependents: 1 });
  near(r.city, (92000 - 3 * 3000) * 0.01);
});

test("overtime deduction: cap by filing status, none for married filing separately", () => {
  assert.equal(Tax.overtimeDeduction(20000, "single", 80000), 12500);
  assert.equal(Tax.overtimeDeduction(20000, "hoh", 80000), 12500);
  assert.equal(Tax.overtimeDeduction(30000, "mfj", 80000), 25000);
  assert.equal(Tax.overtimeDeduction(5000, "mfs", 80000), 0);
  assert.equal(Tax.overtimeDeduction(4000, "single", 80000), 4000);
});

test("overtime deduction phases out $100 per full $1,000 over $150k / $300k", () => {
  assert.equal(Tax.overtimeDeduction(10000, "single", 150000), 10000);
  assert.equal(Tax.overtimeDeduction(10000, "single", 150999), 10000); // partial $1,000 doesn't count
  assert.equal(Tax.overtimeDeduction(10000, "single", 160000), 9000);
  assert.equal(Tax.overtimeDeduction(10000, "single", 160500), 9000);
  assert.equal(Tax.overtimeDeduction(12500, "single", 275000), 0);
  assert.equal(Tax.overtimeDeduction(25000, "mfj", 310000), 24000);
});

test("overtime premium lowers federal and Michigan tax, not FICA or city", () => {
  const input = { ...base, filingStatus: "single", k401Percent: 0, cityId: "detroit" };
  const without = Tax.calculate(input);
  const withOt = Tax.calculate({ ...input, overtimePremium: 3000 });
  assert.equal(withOt.overtimeDeduction, 3000);
  near(without.federal - withOt.federal, 3000 * 0.22); // $92k single is in the 22% bracket
  near(without.michigan - withOt.michigan, 3000 * 0.0425);
  near(withOt.socialSecurity, without.socialSecurity);
  near(withOt.medicare, without.medicare);
  near(withOt.city, without.city);
  assert.equal(Tax.calculate(input).overtimeDeduction, 0);
});

test("supplemental withholding: 22%, 37% above $1M for the year", () => {
  near(Tax.supplementalFederalWithholding(10000), 2200);
  near(Tax.supplementalFederalWithholding(1500000), 1000000 * 0.22 + 500000 * 0.37);
  near(Tax.supplementalFederalWithholding(100000, 1200000), 37000);
  near(Tax.supplementalFederalWithholding(100000, 950000), 50000 * 0.22 + 50000 * 0.37);
  assert.equal(Tax.supplementalFederalWithholding(-5), 0);
});

const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../js/state-tax.js");

S.register(require("../js/states/no-tax-flat.js"));

const near = (actual, expected, tol = 0.01) =>
  assert.ok(Math.abs(actual - expected) <= tol, `expected ${expected}, got ${actual}`);

const household = (over = {}) => ({
  status: "mfj",
  filers: 2,
  dependents: 1,
  earners: [{ wages: 60000, k401Trad: 3000 }, { wages: 40000, k401Trad: 0 }],
  agi: 97000,
  federalTaxable: 97000 - 32200,
  federalStandardDeduction: 32200,
  overtimeDeduction: 0,
  local: { id: "none" },
  ...over,
});

// Synthetic entries that exercise every field.
const FAKE = {
  ZG: {
    code: "ZG", name: "Graduatedland", year: 2026, kind: "graduated",
    brackets: {
      single: [[10000, 0.02], [50000, 0.05], [Infinity, 0.08]],
      mfj: [[20000, 0.02], [100000, 0.05], [Infinity, 0.08]],
      mfs: [[10000, 0.02], [50000, 0.05], [Infinity, 0.08]],
      hoh: [[15000, 0.02], [75000, 0.05], [Infinity, 0.08]],
    },
    standardDeduction: { single: 5000, mfj: 10000, mfs: 5000, hoh: 7500 },
    personalExemption: { filer: 1000, dependent: 500 },
    exemptionCredit: { filer: 50, dependent: 25 },
    payroll: [{ id: "sdi", name: "SDI", rate: 0.01, wageCap: 50000 }, { id: "pfl", name: "PFL", rate: 0.004, maxAnnual: 100 }],
    locals: [
      { id: "metro", name: "Metro", type: "rate-on-wages", resident: 0.02, nonresident: 0.01 },
      { id: "county", name: "County", type: "rate-on-state-taxable", rate: 0.03 },
      { id: "surcharge", name: "Surcharge City", type: "percent-of-state-tax", resident: 0.1675, nonresident: 0.005 },
      { id: "bigcity", name: "Big City", type: "brackets-on-state-taxable",
        brackets: { single: [[10000, 0.01], [Infinity, 0.03]], mfj: [[20000, 0.01], [Infinity, 0.03]], mfs: [[10000, 0.01], [Infinity, 0.03]], hoh: [[15000, 0.01], [Infinity, 0.03]] } },
    ],
    sources: ["https://example.com/zg"],
  },
  ZF: {
    code: "ZF", name: "Federalstart", year: 2026, kind: "flat", rate: 0.04,
    startsFrom: "federalTaxable", taxes401k: true, sources: ["https://example.com/zf"],
  },
  ZC: {
    code: "ZC", name: "Customland", year: 2026, kind: "flat", rate: 0.05, sources: ["https://example.com/zc"],
    compute: (ctx, generic) => ({ taxable: generic.taxable, tax: generic.tax / 2 }),
  },
  ZN: { code: "ZN", name: "Notaxland", year: 2026, kind: "none", sources: ["https://example.com/zn"] },
};
S.register(FAKE);

test("every synthetic entry and Michigan pass validation", () => {
  for (const code of ["ZG", "ZF", "ZC", "ZN", "MI"]) assert.deepEqual(S.validate(S.get(code)), [], code);
});

test("Michigan: 4.25% on AGI less $5,900 per filer and dependent, city tax on wages", () => {
  const r = S.compute("MI", household({ local: { id: "pontiac" } }));
  near(r.taxable, 97000 - 3 * 5900);
  near(r.tax, (97000 - 3 * 5900) * 0.0425);
  // City: all wages (401(k) included) less $600 per person, at 1% for residents.
  near(r.local.tax, (100000 - 3 * 600) * 0.01);
  near(S.compute("MI", household({ local: { id: "pontiac", resident: false } })).local.tax, (100000 - 3 * 600) * 0.005);
  near(r.supplementalRate, 0.0425);
  near(r.marginalRate, 0.0425, 1e-6);
});

test("Michigan matches the original single-state calculator", () => {
  const Tax = require("../js/tax.js");
  const old = Tax.calculate({ grossAnnual: 70000, filingStatus: "single", k401Percent: 5, preTaxBenefits: 1200, dependents: 0, cityId: "detroit" });
  const r = S.compute("MI", {
    status: "single", filers: 1, dependents: 0,
    earners: [{ wages: 70000 - 1200, k401Trad: 3500 }],
    agi: 70000 - 1200 - 3500, federalTaxable: 0, federalStandardDeduction: 16100,
    local: { id: "detroit" },
  });
  near(r.tax, old.michigan);
  near(r.local.tax, old.city);
});

test("graduated brackets by status, deductions, exemptions and credits", () => {
  const r = S.compute("ZG", household());
  const taxable = 97000 - 10000 - 2 * 1000 - 500;
  near(r.taxable, taxable);
  near(r.tax, 20000 * 0.02 + (taxable - 20000) * 0.05 - (2 * 50 + 25));
  const single = S.compute("ZG", household({ status: "single", filers: 1, dependents: 0, agi: 30000 }));
  near(single.tax, 10000 * 0.02 + (30000 - 5000 - 1000 - 10000) * 0.05 - 50);
});

test("payroll deductions per earner honor wage caps and annual maximums", () => {
  const r = S.compute("ZG", household());
  assert.equal(r.payroll.length, 2);
  near(r.payroll[0][0].amount, 50000 * 0.01); // capped at $50k of wages
  near(r.payroll[1][0].amount, 40000 * 0.01);
  near(r.payroll[0][1].amount, 100); // 0.4% of 60k = 240, max 100
  near(r.payrollTotal, 500 + 400 + 100 + 100);
});

test("local tax types", () => {
  const base = household();
  const taxable = S.compute("ZG", base).taxable;
  near(S.compute("ZG", { ...base, local: { id: "metro" } }).local.tax, 100000 * 0.02);
  near(S.compute("ZG", { ...base, local: { id: "metro", resident: false } }).local.tax, 100000 * 0.01);
  near(S.compute("ZG", { ...base, local: { id: "county" } }).local.tax, taxable * 0.03);
  near(S.compute("ZG", { ...base, local: { id: "bigcity" } }).local.tax, 20000 * 0.01 + (taxable - 20000) * 0.03);
  near(S.compute("ZG", { ...base, local: { id: "bigcity", resident: false } }).local.tax, 0);
  near(S.compute("ZG", { ...base, local: { id: "surcharge" } }).local.tax, S.compute("ZG", base).tax * 0.1675);
  near(S.compute("ZG", { ...base, local: { id: "surcharge", resident: false } }).local.tax, 100000 * 0.005);
  near(S.compute("ZN", { ...base, local: { id: "custom", customRate: 1.5 } }).local.tax, 100000 * 0.015);
  near(S.compute("ZG", { ...base, local: { id: "nope" } }).local.tax, 0);
});

test("states that start from federal taxable income, and ones that tax 401(k) deferrals", () => {
  const r = S.compute("ZF", household());
  near(r.taxable, 97000 - 32200 + 3000);
  near(r.tax, (97000 - 32200 + 3000) * 0.04);
});

test("overtime deduction applies only where the state follows it", () => {
  near(S.compute("MI", household({ overtimeDeduction: 5000 })).tax, (97000 - 5000 - 3 * 5900) * 0.0425);
  near(S.compute("ZG", household({ overtimeDeduction: 5000 })).taxable, S.compute("ZG", household()).taxable);
});

test("compute override adjusts the generic result", () => {
  const r = S.compute("ZC", household());
  near(r.tax, 97000 * 0.05 / 2);
});

test("no-tax states and unknown codes owe nothing", () => {
  assert.equal(S.compute("ZN", household()).tax, 0);
  const unknown = S.compute("??", household());
  assert.equal(unknown.tax, 0);
  assert.equal(unknown.payroll.length, 2);
});

test("validate catches bad entries", () => {
  const bad = S.validate({
    code: "zz", year: 2025, kind: "graduated",
    brackets: { single: [[100, 0.5], [50, 0.02]] },
    standardDeduction: { single: 1 },
    payroll: [{ id: "x", name: "X", rate: 0.2 }],
    locals: [{ id: "custom", name: "C", type: "rate-on-wages" }],
    sources: ["http://insecure"],
  });
  for (const pattern of [/code/, /name/, /year/, /rate 0.5/, /ascending/, /Infinity/, /brackets.mfj/, /standardDeduction/, /payroll\[0\]/, /reserved/, /sources/]) {
    assert.ok(bad.some((e) => pattern.test(e)), `expected an error matching ${pattern}: ${bad.join("; ")}`);
  }
});

test("list() is sorted by name", () => {
  const names = S.list().map((s) => s.name);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
});

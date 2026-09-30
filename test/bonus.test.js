const test = require("node:test");
const assert = require("node:assert/strict");
const B = require("../js/bonus.js");

const near = (actual, expected, tol = 0.01) =>
  assert.ok(Math.abs(actual - expected) <= tol, `expected ${expected}, got ${actual}`);

const single60k = {
  grossAnnual: 60000,
  filingStatus: "single",
  k401Percent: 0,
  k401Type: "traditional",
  preTaxBenefits: 0,
  dependents: 0,
  cityId: "none",
  cityResident: true,
};

test("bonus: flat 22% federal, FICA, Michigan 4.25%", () => {
  const b = B.bonusEstimate({ taxInput: single60k, amount: 10000, apply401k: true, ytdWages: 50000 });
  near(b.k401, 0);
  near(b.federal, 2200);
  near(b.socialSecurity, 620);
  near(b.medicare, 145);
  near(b.michigan, 425);
  near(b.city, 0);
  near(b.net, 10000 - 3390);
});

test("bonus: 401(k) % comes out pre-tax (not for FICA or city); Roth doesn't cut income tax", () => {
  const input = { ...single60k, k401Percent: 5, cityId: "detroit" };
  const b = B.bonusEstimate({ taxInput: input, amount: 10000, ytdWages: 50000 });
  near(b.k401, 500);
  near(b.federal, 0.22 * 9500);
  near(b.michigan, 0.0425 * 9500);
  near(b.socialSecurity, 620);
  near(b.city, 0.024 * 10000);
  near(b.net, 10000 - 500 - (2090 + 620 + 145 + 403.75 + 240));

  const off = B.bonusEstimate({ taxInput: input, amount: 10000, apply401k: false, ytdWages: 50000 });
  near(off.k401, 0);
  near(off.federal, 2200);

  const roth = B.bonusEstimate({ taxInput: { ...input, k401Type: "roth" }, amount: 10000, ytdWages: 50000 });
  near(roth.k401, 500);
  near(roth.federal, 2200);
  near(roth.michigan, 425);
});

test("bonus: 401(k) stops at the annual limit", () => {
  const input = { ...single60k, grossAnnual: 400000, k401Percent: 10 };
  const b = B.bonusEstimate({ taxInput: input, amount: 50000, ytdWages: 0 });
  near(b.k401, 0); // regular pay already hits $24,500
  const some = B.bonusEstimate({ taxInput: { ...single60k, grossAnnual: 230000, k401Percent: 10 }, amount: 50000, ytdWages: 0 });
  near(some.k401, 24500 - 23000);
});

test("bonus: Social Security stops at the $184,500 wage base", () => {
  near(B.bonusEstimate({ taxInput: single60k, amount: 10000, ytdWages: 180000 }).socialSecurity, 4500 * 0.062);
  near(B.bonusEstimate({ taxInput: single60k, amount: 10000, ytdWages: 190000 }).socialSecurity, 0);
  near(B.bonusEstimate({ taxInput: single60k, amount: 10000, ytdWages: 174500 }).socialSecurity, 620);
});

test("bonus: 0.9% Medicare withholding starts past $200,000 of wages", () => {
  near(B.bonusEstimate({ taxInput: single60k, amount: 10000, ytdWages: 195000 }).medicare, 145 + 5000 * 0.009);
  near(B.bonusEstimate({ taxInput: single60k, amount: 10000, ytdWages: 250000 }).medicare, 145 + 90);
});

test("bonus: 37% on supplemental wages over $1M", () => {
  const b = B.bonusEstimate({ taxInput: single60k, amount: 1500000, ytdWages: 60000 });
  near(b.federal, 1000000 * 0.22 + 500000 * 0.37);
  const later = B.bonusEstimate({ taxInput: single60k, amount: 100000, ytdWages: 60000, priorSupplemental: 1200000 });
  near(later.federal, 37000);
});

test("bonus year end: 12% bracket gets money back", () => {
  const b = B.bonusEstimate({ taxInput: single60k, amount: 10000, ytdWages: 50000 });
  // taxable 43,900 -> 53,900: 6,500 at 12% + 3,500 at 22%
  near(b.actual.federal, 780 + 770);
  near(b.actual.michigan, 425);
  near(b.yearEnd.withheld, 2200 + 425);
  near(b.yearEnd.actual, 1550 + 425);
  near(b.yearEnd.balance, 650);
});

test("bonus year end: 24% bracket owes", () => {
  const b = B.bonusEstimate({ taxInput: { ...single60k, grossAnnual: 150000 }, amount: 10000, ytdWages: 100000 });
  near(b.actual.federal, 2400);
  near(b.yearEnd.balance, -200);
});

test("bonus year end: Medicare surtax withheld at $200k but owed at $250k (joint)", () => {
  const input = { ...single60k, filingStatus: "mfj", grossAnnual: 230000 };
  const b = B.bonusEstimate({ taxInput: input, amount: 10000, ytdWages: 230000 });
  near(b.federal, 2200);
  near(b.actual.federal, 2200); // still in the 22% joint bracket
  near(b.yearEnd.balance, 90);
});

test("overtime: time-and-a-half, extra take-home and the premium", () => {
  const input = { ...single60k, grossAnnual: 52000 };
  const o = B.overtimeEstimate({ taxInput: input, perYear: 26, hourlyRate: 25, hoursPerPaycheck: 5 });
  near(o.overtimeRate, 37.5);
  near(o.payPerCheck, 187.5);
  near(o.payAnnual, 4875);
  near(o.premiumAnnual, 1625);
  near(o.annual.federal, 4875 * 0.12);
  near(o.annual.socialSecurity, 4875 * 0.062);
  near(o.annual.medicare, 4875 * 0.0145);
  near(o.annual.michigan, 4875 * 0.0425);
  near(o.annual.takeHome, 4875 * (1 - 0.12 - 0.062 - 0.0145 - 0.0425));
  near(o.perCheck.takeHome, o.annual.takeHome / 26);
});

test("overtime deduction: premium only, federal + Michigan savings", () => {
  const input = { ...single60k, grossAnnual: 52000 };
  const o = B.overtimeEstimate({ taxInput: input, perYear: 26, hourlyRate: 25, hoursPerPaycheck: 5 });
  assert.equal(o.eligible, true);
  near(o.deduction, 1625);
  assert.equal(o.limitedBy, null);
  near(o.federalSaving, 1625 * 0.12);
  near(o.michiganSaving, 1625 * 0.0425);
  near(o.refund, 195 + 69.0625);
});

test("overtime deduction: $12,500 cap and $100-per-$1,000 phase-out", () => {
  const capped = B.overtimeEstimate({ taxInput: { ...single60k, grossAnnual: 62400 }, perYear: 52, hourlyRate: 30, hoursPerPaycheck: 20 });
  near(capped.premiumAnnual, 15600);
  near(capped.deduction, 12500);
  assert.equal(capped.limitedBy, "cap");

  // MAGI 145,600 + 109,200 = 254,800 -> 104 steps -> $10,400 off the $12,500 cap
  const phased = B.overtimeEstimate({ taxInput: { ...single60k, grossAnnual: 145600 }, perYear: 52, hourlyRate: 70, hoursPerPaycheck: 20 });
  near(phased.deduction, 2100);
  assert.equal(phased.limitedBy, "phaseout");

  const mfs = B.overtimeEstimate({ taxInput: { ...single60k, filingStatus: "mfs" }, perYear: 26, hourlyRate: 25, hoursPerPaycheck: 5 });
  assert.equal(mfs.eligible, false);
  near(mfs.deduction, 0);
  near(mfs.refund, 0);
});

test("overtime: salaried pay converts at 2,080 hours", () => {
  assert.deepEqual(B.hourlyRateFor({ mode: "salary", salary: 62400 }), { rate: 30, estimated: true });
  assert.deepEqual(B.hourlyRateFor({ mode: "hourly", hourlyRate: 28, salary: 99999 }), { rate: 28, estimated: false });
  assert.deepEqual(B.hourlyRateFor({ mode: "salary", salary: "" }), { rate: 0, estimated: true });
});

test("no hours or no bonus means nothing extra", () => {
  const o = B.overtimeEstimate({ taxInput: single60k, perYear: 26, hourlyRate: 25, hoursPerPaycheck: 0 });
  near(o.annual.takeHome, 0);
  near(o.refund, 0);
  const b = B.bonusEstimate({ taxInput: single60k, amount: 0, ytdWages: 0 });
  near(b.net, 0);
  near(b.yearEnd.balance, 0);
});

test("year-to-date estimate prorates by date", () => {
  near(B.ytdEstimate(73000, new Date(2026, 6, 2)), 73000 * 182 / 365);
  near(B.ytdEstimate(73000, new Date(2026, 0, 1)), 0);
});

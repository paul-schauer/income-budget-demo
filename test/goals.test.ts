import test from "node:test";
import assert from "node:assert/strict";
import * as G from "../src/app/goals";
import type { Goal } from "../src/app/calendar-goals.types";

// Fixed clock: Wednesday 2026-09-30. 2026-10-02 is a Friday payday.
const TODAY = "2026-09-30";
const biweekly = { anchor: "2026-10-02", payPeriod: "biweekly", today: TODAY, perYear: 26 };
const weekly = { anchor: "2026-10-02", payPeriod: "weekly", today: TODAY, perYear: 52 };

const goal = (over: Partial<Goal>): Goal => ({
  id: "g", name: "Goal", target: 1000, saved: 0, mode: "date", targetDate: "", perPaycheck: 0,
  includeInBudget: true, createdAt: 0, ...over,
});
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);

// ---------- Date mode ----------

test("date mode, biweekly: remaining spread over the paydays through the target date", () => {
  // Paydays 2026-10-02 + 14k; the 26th is 2027-09-17, the next (2027-10-01) is past the date.
  const p = G.plan(goal({ target: 5000, saved: 1200, targetDate: "2027-09-30" }), biweekly);
  assert.equal(p.status, "active");
  assert.equal(p.remaining, 3800);
  assert.equal(p.paychecksLeft, 26);
  assert.equal(p.perPaycheck, 146.16); // 3800 / 26 = 146.1538..., rounded up to the cent
  close(p.monthly, (146.16 * 26) / 12);
  close(p.progress, 0.24);
});

test("date mode, weekly: 13 Fridays from Oct 2 through Dec 31", () => {
  const p = G.plan(goal({ target: 1500, saved: 200, targetDate: "2026-12-31" }), weekly);
  assert.equal(p.paychecksLeft, 13);
  assert.equal(p.perPaycheck, 100);
  close(p.monthly, (100 * 52) / 12);
});

test("date mode follows the payday anchor", () => {
  const g = goal({ target: 700, targetDate: "2026-12-31" });
  assert.equal(G.plan(g, biweekly).paychecksLeft, 7); // Oct 2 ... Dec 25
  const later = G.plan(g, { ...biweekly, anchor: "2026-10-09" }); // Oct 9 ... Dec 18
  assert.equal(later.paychecksLeft, 6);
  assert.equal(later.perPaycheck, 116.67);
});

test("date mode counts paydays beyond the default look-ahead", () => {
  const p = G.plan(goal({ target: 70000, targetDate: "2046-10-01" }), weekly);
  // Oct 2 2026 + 7k <= Oct 1 2046: 7304 days / 7 = 1043.4 -> 1044 paydays
  assert.equal(p.paychecksLeft, 1044);
});

// ---------- Overdue ----------

test("a target date in the past is overdue with no per-paycheck amount", () => {
  const p = G.plan(goal({ target: 5000, saved: 1000, targetDate: "2026-09-01" }), biweekly);
  assert.equal(p.status, "overdue");
  assert.equal(p.pastDate, true);
  assert.equal(p.perPaycheck, null);
  assert.equal(p.remaining, 4000);
});

test("no paydays left before the date is overdue too", () => {
  const p = G.plan(goal({ targetDate: "2026-10-01" }), biweekly);
  assert.equal(p.status, "overdue");
  assert.equal(p.pastDate, false);
});

test("a reached goal is complete even if its date has passed", () => {
  const p = G.plan(goal({ target: 500, saved: 650, targetDate: "2026-01-01" }), biweekly);
  assert.equal(p.status, "complete");
  assert.equal(p.remaining, 0);
  assert.equal(p.progress, 1);
});

test("missing date or amount is 'unset', not overdue", () => {
  assert.equal(G.plan(goal({ mode: "date", targetDate: "" }), biweekly).status, "unset");
  assert.equal(G.plan(goal({ mode: "amount", perPaycheck: 0 }), biweekly).status, "unset");
});

// ---------- Amount mode ----------

test("amount mode projects the payday the goal is reached", () => {
  const p = G.plan(goal({ mode: "amount", target: 1000, perPaycheck: 100 }), biweekly);
  assert.equal(p.status, "active");
  assert.equal(p.paychecksLeft, 10);
  assert.equal(p.finishDate, "2027-02-05"); // 2026-10-02 + 9 * 14 days
  close(p.monthly, (100 * 26) / 12);
});

test("amount mode rounds a partial last paycheck up", () => {
  const p = G.plan(goal({ mode: "amount", target: 1050, perPaycheck: 100 }), biweekly);
  assert.equal(p.paychecksLeft, 11);
  assert.equal(p.finishDate, "2027-02-19");
});

test("amount mode on a semimonthly schedule uses the 15th and month end", () => {
  const p = G.plan(goal({ mode: "amount", target: 300, perPaycheck: 100 }), { anchor: "", payPeriod: "semimonthly", today: "2026-10-01", perYear: 24 });
  assert.equal(p.finishDate, "2026-11-13"); // Oct 15, Oct 30, Nov 13 (Nov 15 is a Sunday)
});

test("amount mode flags goals more than 50 years out", () => {
  const p = G.plan(goal({ mode: "amount", target: 1e6, perPaycheck: 1 }), biweekly);
  assert.equal(p.tooFar, true);
  assert.equal(p.finishDate, null);
});

// ---------- Budget lines ----------

test("budgetLines includes only unfinished, on-schedule goals that are in the budget", () => {
  const goals = [
    goal({ id: "done", name: "Done", target: 500, saved: 500, targetDate: "2027-09-30" }),
    goal({ id: "ef", name: "Emergency fund", target: 5000, saved: 1200, targetDate: "2027-09-30" }),
    goal({ id: "off", name: "Not budgeted", mode: "amount", perPaycheck: 50, includeInBudget: false }),
    goal({ id: "late", name: "Late", targetDate: "2026-01-01" }),
    goal({ id: "car", name: "Car", mode: "amount", target: 6000, perPaycheck: 25 }),
  ];
  const lines = G.budgetLines(goals, biweekly);
  assert.deepEqual(lines.map((l) => l.id), ["ef", "car"]);
  assert.deepEqual(lines[0], { id: "ef", name: "Emergency fund", annual: 146.16 * 26, category: "savings", tab: "goals", note: "Savings goal" });
  assert.equal(lines[1].annual, 650);
});

test("summarize totals saved, targets and per-paycheck amounts", () => {
  const goals = [
    goal({ id: "a", target: 5000, saved: 1200, targetDate: "2027-09-30" }),
    goal({ id: "b", mode: "amount", target: 1000, saved: 1500, perPaycheck: 40 }),
    goal({ id: "c", mode: "amount", target: 600, perPaycheck: 50, includeInBudget: false }),
  ];
  const s = G.summarize(goals, biweekly);
  assert.equal(s.saved, 2700);
  assert.equal(s.target, 6600);
  close(s.progress, (1200 + 1000) / 6600); // over-saving doesn't count past a goal's target
  close(s.perPaycheck, 196.16);
  close(s.budgeted, 146.16);
  assert.deepEqual(s.counts, { active: 2, complete: 1, overdue: 0, unset: 0 });
});

// ---------- Sanitize ----------

test("sanitize rejects junk", () => {
  for (const junk of [null, undefined, "goals", 42, {}, { 0: { target: 5 } }]) assert.deepEqual(G.sanitize(junk), []);
  const out = G.sanitize([
    null, 5, "x", [], {},
    { name: "No target" },
    { name: "Bad target", target: "abc" },
    { name: "Negative", target: -10 },
    { name: "Bool", target: true },
    { name: "Infinite", target: Infinity },
    { name: "Huge", target: 1e12 },
  ]);
  assert.deepEqual(out, []);
});

test("sanitize repairs fields it can", () => {
  const [g] = G.sanitize([{
    id: { evil: 1 }, name: "  <b>Trip</b>\n\n  fund  ", target: "2,500.456", saved: -5, mode: "weird",
    targetDate: "2026-02-31", perPaycheck: "12", includeInBudget: "no", createdAt: "yesterday", extra: "dropped",
  }]);
  assert.equal(typeof g.id, "string");
  assert.ok(g.id.length > 0);
  assert.equal(g.name, "<b>Trip</b> fund"); // escaping happens at render time
  assert.equal(g.target, 2500.46);
  assert.equal(g.saved, 0);
  assert.equal(g.targetDate, ""); // Feb 31 isn't a date
  assert.equal(g.mode, "amount"); // inferred: no date, has an amount
  assert.equal(g.perPaycheck, 12);
  assert.equal(g.includeInBudget, true);
  assert.equal(g.createdAt, 0);
  assert.equal("extra" in g, false);
});

test("sanitize keeps good goals intact, dedupes ids and caps the list", () => {
  const good = { id: "a", name: "Car", target: 6000, saved: 100, mode: "date", targetDate: "2028-09-30", perPaycheck: 0, includeInBudget: false, createdAt: 1700000000000 };
  assert.deepEqual(G.sanitize([good]), [good]);
  const two = G.sanitize([good, { ...good, name: "Copy" }]);
  assert.equal(two.length, 2);
  assert.notEqual(two[0].id, two[1].id);
  assert.equal(G.sanitize([{ target: 5, name: "" }])[0].name, "Savings goal");
  assert.equal(G.sanitize([{ target: 5, name: "x".repeat(200) }])[0].name.length, 60);
  assert.equal(G.sanitize(Array.from({ length: 150 }, (_, i) => ({ id: `g${i}`, name: "G", target: 10 }))).length, G.MAX_GOALS);
});

// ---------- Templates and defaults ----------

test("emergency-fund template is 3 months of budgeted expenses, rounded up to $100", () => {
  assert.equal(G.emergencyFundTarget(37036), 9300); // 37036 / 12 * 3 = 9259
  assert.equal(G.emergencyFundTarget(24000), 6000);
  assert.equal(G.emergencyFundTarget(0), 1000); // no budget yet: starter fund
  assert.equal(G.emergencyFundTarget(NaN), 1000);
  const ef = G.templates({ itemsAnnual: 37036, today: TODAY }).find((t) => t.key === "emergency")!;
  assert.equal(ef.target, 9300);
  assert.equal(ef.targetDate, "2027-09-30");
});

test("templates: vacation, car and holiday gifts by Dec 15", () => {
  const t = G.templates({ itemsAnnual: 0, today: TODAY });
  assert.deepEqual(t.map((x) => x.name), ["Emergency fund", "Vacation", "Car", "Holiday gifts"]);
  for (const x of t) {
    assert.ok(x.target > 0);
    assert.ok(G.isISODate(x.targetDate) && x.targetDate > TODAY);
  }
  assert.equal(t.find((x) => x.key === "holiday")!.targetDate, "2026-12-15");
  assert.equal(G.holidayDate("2026-12-01"), "2027-12-15"); // too close: next year
});

test("addMonths clamps to short months", () => {
  assert.equal(G.addMonths("2026-01-31", 1), "2026-02-28");
  assert.equal(G.addMonths("2026-11-15", 3), "2027-02-15");
});

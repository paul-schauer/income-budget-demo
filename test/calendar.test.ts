import test from "node:test";
import assert from "node:assert/strict";
import * as C from "../src/app/calendar";
import type { BudgetItem, BudgetLine } from "../src/app/types";
import type { CalendarPlan, PlanInput } from "../src/app/calendar-goals.types";
import type { PayPeriod } from "../src/tax/types";

const near = (actual: number, expected: number, tol = 0.005) =>
  assert.ok(Math.abs(actual - expected) <= tol, `expected ${expected}, got ${actual}`);

const bill = (name: string, amount: number, dueDay: number, extra: Partial<BudgetItem> = {}): BudgetItem =>
  ({ id: name, name, amount, recurrence: "monthly", category: "other", dueDay, ...extra });

// Map of paycheck date -> "name@due" strings, for compact assertions.
const layout = (p: CalendarPlan) => Object.fromEntries(p.paychecks.map((pc) => [pc.date, pc.bills.map((b) => `${b.name}@${b.due}`)]));

test("weekly: each bill goes to the latest payday on or before its due date", () => {
  // Paid Fridays; today is Wednesday 2026-09-30.
  const p = C.plan({
    items: [bill("Rent", 1250, 1), bill("Car", 340, 15), bill("Phone", 55, 9), bill("Loan", 210, 5)],
    income: { payPeriod: "weekly", nextPayday: "2026-10-02" },
    netPerPaycheck: 900, today: "2026-09-30", count: 5,
  });
  assert.equal(p.estimated, false);
  assert.deepEqual(p.paychecks.map((pc) => [pc.date, pc.end]), [
    ["2026-10-02", "2026-10-08"], ["2026-10-09", "2026-10-15"], ["2026-10-16", "2026-10-22"],
    ["2026-10-23", "2026-10-29"], ["2026-10-30", "2026-11-05"],
  ]);
  assert.deepEqual(layout(p), {
    "2026-10-02": ["Loan@2026-10-05"],
    // Phone is due on payday itself, so that day's paycheck pays it.
    "2026-10-09": ["Phone@2026-10-09", "Car@2026-10-15"],
    "2026-10-16": [],
    "2026-10-23": [],
    "2026-10-30": ["Rent@2026-11-01", "Loan@2026-11-05"],
  });
  assert.equal(p.daysUntilNext, 2);
  assert.equal(p.horizonEnd, "2026-11-05");
});

test("biweekly: windows are two weeks; bills past the horizon are left out", () => {
  const p = C.plan({
    items: [bill("Rent", 1250, 1), bill("Car", 340, 15), bill("Gym", 40, 25)],
    income: { payPeriod: "biweekly", nextPayday: "2026-10-09" },
    netPerPaycheck: 1800, today: "2026-09-30", count: 3,
  });
  assert.deepEqual(layout(p), {
    "2026-10-09": ["Car@2026-10-15"],
    "2026-10-23": ["Gym@2026-10-25", "Rent@2026-11-01"],
    "2026-11-06": ["Car@2026-11-15"], // Gym on Nov 25 falls after this window (ends Nov 19)
  });
});

test("biweekly with an old anchor walks forward to the next payday", () => {
  const p = C.plan({
    items: [bill("Car", 340, 15)],
    income: { payPeriod: "biweekly", nextPayday: "2026-01-02" },
    netPerPaycheck: 1800, today: "2026-09-29", count: 2,
  });
  assert.deepEqual(p.paychecks.map((pc) => pc.date), ["2026-10-09", "2026-10-23"]);
  assert.deepEqual(layout(p)["2026-10-09"], ["Car@2026-10-15"]);
});

test("semimonthly: 15th and month-end paydays split the month", () => {
  const p = C.plan({
    items: [bill("Rent", 1250, 1), bill("Car", 340, 15), bill("Card", 90, 31)],
    income: { payPeriod: "semimonthly", nextPayday: "" },
    netPerPaycheck: 2000, today: "2026-10-01", count: 4,
  });
  assert.deepEqual(layout(p), {
    "2026-10-15": ["Car@2026-10-15"],
    // Oct 31 is a Saturday; payday moved to Friday the 30th.
    "2026-10-30": ["Card@2026-10-31", "Rent@2026-11-01"],
    "2026-11-13": ["Car@2026-11-15"],
    // Due day 31 clamps to Nov 30, which is also payday.
    "2026-11-30": ["Card@2026-11-30", "Rent@2026-12-01"],
  });
  assert.equal(p.estimated, true);
  assert.equal(p.anchor, "", "calendar-based schedules keep the default anchor");
});

test("monthly pay: a window can hold the same bill twice", () => {
  // Paid on the last business day. Window Feb 26 - Mar 30 catches Feb 27 and Mar 27.
  const p = C.plan({
    items: [bill("Insurance", 120, 27)],
    income: { payPeriod: "monthly", nextPayday: "2026-01-31" },
    netPerPaycheck: 4000, today: "2027-01-20", count: 3,
  });
  assert.deepEqual(layout(p), {
    "2027-01-29": [],
    "2027-02-26": ["Insurance@2027-02-27", "Insurance@2027-03-27"],
    "2027-03-31": ["Insurance@2027-04-27"],
  });
  near(p.paychecks[1].billsTotal, 240);
  // Jan 27 is after today but before the first payday (Jan 29).
  assert.deepEqual(p.beforeFirst.map((b) => b.due), ["2027-01-27"]);
});

test("due day 31 clamps to the end of February (and leap years)", () => {
  const p = C.plan({
    items: [bill("Card", 90, 31)],
    income: { payPeriod: "monthly", nextPayday: "2026-01-31" },
    netPerPaycheck: 4000, today: "2027-01-20", count: 3,
  });
  assert.deepEqual(layout(p), {
    "2027-01-29": ["Card@2027-01-31"],
    "2027-02-26": ["Card@2027-02-28"],
    "2027-03-31": ["Card@2027-03-31"],
  });
  const occ = C.occurrences([bill("Card", 90, 31), bill("Rent", 1000, 30)], "2028-02-01", "2028-02-29");
  assert.deepEqual(occ.map((o) => `${o.name}@${o.due}`), ["Rent@2028-02-29", "Card@2028-02-29"]);
});

test("bills due before the first payday don't land in the first window", () => {
  const p = C.plan({
    items: [bill("Rent", 1250, 1), bill("Old", 50, 29)],
    income: { payPeriod: "weekly", nextPayday: "2026-10-02" },
    netPerPaycheck: 900, today: "2026-09-30", count: 2,
  });
  // Rent on Oct 1 is between today and the first payday: paid from money already in hand.
  assert.deepEqual(p.beforeFirst.map((b) => `${b.name}@${b.due}`), ["Rent@2026-10-01"]);
  assert.deepEqual(layout(p), { "2026-10-02": [], "2026-10-09": [] });
  // Sep 29 is before today: not shown anywhere. Oct 29 is past the horizon.
  assert.ok(!p.beforeFirst.some((b) => b.name === "Old"));
  near(p.paychecks[0].left, 900);
});

test("a bill due on today's payday belongs to today's paycheck", () => {
  const p = C.plan({
    items: [bill("Rent", 1250, 2)],
    income: { payPeriod: "weekly", nextPayday: "2026-10-02" },
    netPerPaycheck: 900, today: "2026-10-02", count: 1,
  });
  assert.equal(p.daysUntilNext, 0);
  assert.deepEqual(layout(p), { "2026-10-02": ["Rent@2026-10-02"] });
  assert.equal(p.beforeFirst.length, 0);
});

test("undated and non-monthly items plus extras are spread across every paycheck", () => {
  const items = [
    { name: "Groceries", amount: 110, recurrence: "weekly", category: "food", dueDay: null },
    { name: "Roth IRA", amount: 100, recurrence: "biweekly", category: "savings", dueDay: null },
    { name: "Phone", amount: 60, recurrence: "monthly", category: "utilities", dueDay: null },
    { name: "Insurance", amount: 600, recurrence: "quarterly", category: "transport", dueDay: 10 },
    { name: "Club", amount: 520, recurrence: "annual", category: "personal", dueDay: 3 },
    { name: "Free", amount: 0, recurrence: "monthly", category: "other", dueDay: 5 },
  ] as BudgetItem[];
  const extras: BudgetLine[] = [{ name: "Vacation goal", annual: 2600, category: "savings", source: "goals" }, { name: "Nothing", annual: 0 }];
  const p = C.plan({ items, extras, income: { payPeriod: "biweekly", nextPayday: "2026-10-09" }, netPerPaycheck: 1800, today: "2026-09-30", count: 4 });

  const per = Object.fromEntries(p.spread.map((s) => [s.name, s.perPaycheck]));
  near(per.Groceries, 220); // 110 * 52 / 26
  near(per["Roth IRA"], 100);
  near(per.Phone, 60 * 12 / 26);
  near(per.Insurance, 600 * 4 / 26); // quarterly with a due day is still spread
  near(per.Club, 20);
  near(per["Vacation goal"], 100);
  assert.ok(!("Free" in per) && !("Nothing" in per), "zero amounts are skipped");
  near(p.spreadTotal, 220 + 100 + 60 * 12 / 26 + 600 * 4 / 26 + 20 + 100);
  assert.deepEqual(p.undated.map((s) => s.name), ["Phone"]);
  for (const pc of p.paychecks) {
    assert.equal(pc.bills.length, 0);
    near(pc.spreadTotal, p.spreadTotal);
  }
});

test("left over = take-home - dated bills - spread", () => {
  const p = C.plan({
    items: [bill("Car", 340, 15), { name: "Gas", amount: 45, recurrence: "weekly", category: "transport" } as BudgetItem],
    extras: [{ name: "Goal", annual: 5200, category: "savings" }],
    income: { payPeriod: "weekly", nextPayday: "2026-10-02" },
    netPerPaycheck: 800, today: "2026-09-30", count: 3,
  });
  const [a, b] = p.paychecks;
  near(a.spreadTotal, 45 + 100);
  near(a.left, 800 - 145);
  near(b.billsTotal, 340);
  near(b.total, 485);
  near(b.left, 800 - 485);
  near(p.avgLeft, (655 + 315 + 655) / 3);
  assert.equal(p.tightest, b);
  assert.equal(b.over, false);
});

test("negative left over is flagged as over", () => {
  const p = C.plan({
    items: [bill("Rent", 1250, 1)],
    income: { payPeriod: "weekly", nextPayday: "2026-10-02" },
    netPerPaycheck: 900, today: "2026-09-30", count: 6,
  });
  const rent = p.paychecks.find((pc) => pc.bills.length)!;
  assert.equal(rent.date, "2026-10-30");
  near(rent.left, -350);
  assert.equal(rent.over, true);
  assert.equal(rent.tight, true);
  assert.equal(p.paychecks.filter((pc) => pc.over).length, 1);
});

test("tight flags the lowest quartile, and nothing when paychecks are even", () => {
  const mk = (lefts: number[]): { left: number; tight?: boolean }[] => lefts.map((left) => ({ left }));
  const eight = C.flagTight(mk([500, 100, 450, 480, 520, 90, 470, 510]), 1000);
  assert.deepEqual(eight.map((p) => p.tight), [false, true, false, false, false, true, false, false]);

  const even = C.flagTight(mk([400, 400, 400, 400]), 1000);
  assert.ok(even.every((p) => !p.tight));

  // Within $1 / 2% of take-home of the average isn't "tight".
  const close = C.flagTight(mk([400, 399.5, 400, 400]), 1000);
  assert.ok(close.every((p) => !p.tight));

  // Ties at the cutoff are all flagged.
  const ties = C.flagTight(mk([100, 100, 500, 500]), 1000);
  assert.deepEqual(ties.map((p) => p.tight), [true, true, false, false]);
});

test("no payday set: weekly/biweekly default to Fridays and pin the anchor", () => {
  const p = C.plan({ items: [], income: { payPeriod: "biweekly", nextPayday: "" }, netPerPaycheck: 1000, today: "2026-09-29", count: 3 });
  assert.equal(p.estimated, true);
  assert.deepEqual(p.paychecks.map((pc) => pc.date), ["2026-10-02", "2026-10-16", "2026-10-30"]);
  assert.equal(p.anchor, "2026-10-02");
  // The month grid uses the pinned anchor, so it agrees with the list.
  const oct = C.month({ items: [], payPeriod: "biweekly", anchor: p.anchor, year: 2026, month: 9 });
  assert.deepEqual(oct.days.filter((d) => d.payday).map((d) => d.iso), ["2026-10-02", "2026-10-16", "2026-10-30"]);
});

test("default horizon covers about three months", () => {
  const n = (payPeriod: PayPeriod) => C.plan({ income: { payPeriod }, netPerPaycheck: 1, today: "2026-09-30" }).paychecks.length;
  assert.equal(n("weekly"), 13);
  assert.equal(n("biweekly"), 7);
  assert.equal(n("semimonthly"), 6);
  assert.equal(n("monthly"), 4);
});

test("month grid: paydays, bills on due days, clamped month end", () => {
  const m = C.month({
    items: [bill("Rent", 1250, 1), bill("Card", 90, 31), bill("Car", 340, 15)],
    payPeriod: "weekly", anchor: "2026-10-02", year: 2027, month: 1,
  });
  assert.equal(m.days.length, 28);
  assert.equal(m.lead, 1); // Feb 1, 2027 is a Monday
  assert.deepEqual(m.days.filter((d) => d.payday).map((d) => d.day), [5, 12, 19, 26]);
  const names = (day: number) => m.days[day - 1].bills.map((b) => b.name);
  assert.deepEqual(names(1), ["Rent"]);
  assert.deepEqual(names(15), ["Car"]);
  assert.deepEqual(names(28), ["Card"]);
});

test("payingPayday finds the paycheck that covers a date", () => {
  assert.equal(C.payingPayday("2026-10-02", "weekly", "2026-10-15"), "2026-10-09");
  assert.equal(C.payingPayday("2026-10-02", "weekly", "2026-10-16"), "2026-10-16");
  assert.equal(C.payingPayday("", "semimonthly", "2026-11-01"), "2026-10-30");
});

test("suggests moving a bill out of a much tighter paycheck", () => {
  const input: PlanInput = {
    items: [
      bill("Rent", 1000, 1, { category: "housing" }),
      bill("Car payment", 400, 3, { category: "transport" }),
      bill("Phone", 50, 20, { category: "utilities" }),
    ],
    income: { payPeriod: "semimonthly", nextPayday: "" },
    netPerPaycheck: 1500, today: "2026-10-01",
  };
  const base = C.plan(input);
  // The month-end paycheck pays Rent and the Car payment; the 15th pays only the Phone.
  const s = C.suggestMove(input, base);
  assert.ok(s, "expected a suggestion");
  assert.equal(s.name, "Car payment", "housing is never suggested");
  assert.equal(s.fromDay, 3);
  assert.ok(s.toDay >= 15 && s.toDay <= 28, `moved into the 15th's window, got ${s.toDay}`);
  near(s.gain, 400);
  assert.ok(s.after > s.before);
});

test("no suggestion when paychecks are already even", () => {
  const input: PlanInput = {
    items: [bill("A", 300, 5), bill("B", 300, 20)],
    income: { payPeriod: "semimonthly", nextPayday: "" },
    netPerPaycheck: 1500, today: "2026-10-01",
  };
  assert.equal(C.suggestMove(input), null);
});

test("weekly pay: suggests moving a bill so it never shares rent's paycheck", () => {
  const input: PlanInput = {
    items: [
      bill("Rent", 1250, 1, { category: "housing" }),
      bill("Student loan", 210, 5, { category: "debt" }),
      bill("Internet", 65, 20, { category: "utilities" }),
    ],
    income: { payPeriod: "weekly", nextPayday: "2026-10-02" },
    netPerPaycheck: 850, today: "2026-09-30",
  };
  const base = C.plan(input);
  assert.equal(base.tightest.date, "2026-10-30"); // Rent Nov 1 + Student loan Nov 5
  const s = C.suggestMove(input, base);
  assert.ok(s);
  assert.equal(s.name, "Student loan");
  assert.equal(s.date, "2026-10-30");
  // A Friday-to-Thursday window can't hold both the 1st and the 8th, so the 8th is the nearest safe day.
  assert.equal(s.toDay, 8);
  near(s.gain, 210);
  near(s.after, base.tightest.left + 210);
});

test("no suggestion when only housing makes a paycheck tight", () => {
  const input: PlanInput = {
    items: [bill("Rent", 1250, 1, { category: "housing" })],
    income: { payPeriod: "weekly", nextPayday: "2026-10-02" },
    netPerPaycheck: 850, today: "2026-09-30",
  };
  assert.equal(C.suggestMove(input), null);
});

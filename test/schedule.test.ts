import test from "node:test";
import assert from "node:assert/strict";
import * as S from "../src/lib/schedule";
import type { ScheduleApi } from "../src/tax/types";

// The module's exports match the ScheduleApi type that other code can use to describe it.
S satisfies ScheduleApi;

test("biweekly steps 14 days from an anchor, even an old one", () => {
  assert.deepEqual(S.paydays("2026-01-02", "biweekly", "2026-09-29", 3), ["2026-10-09", "2026-10-23", "2026-11-06"]);
});

test("weekly includes today if it's payday", () => {
  assert.deepEqual(S.paydays("2026-10-02", "weekly", "2026-10-02", 2), ["2026-10-02", "2026-10-09"]);
});

test("anchor in the future is walked back to the first payday on/after today", () => {
  assert.deepEqual(S.paydays("2026-12-04", "weekly", "2026-11-20", 2), ["2026-11-20", "2026-11-27"]);
});

test("no anchor defaults to Fridays", () => {
  assert.deepEqual(S.paydays("", "weekly", "2026-09-29", 1), ["2026-10-02"]);
});

test("semimonthly pays the 15th and month end, moved off weekends", () => {
  // 2026-10-31 is a Saturday -> Friday the 30th; 2026-11-15 is a Sunday -> the 13th
  assert.deepEqual(S.paydays("", "semimonthly", "2026-10-01", 4), ["2026-10-15", "2026-10-30", "2026-11-13", "2026-11-30"]);
});

test("monthly uses the anchor's day, clamped to short months", () => {
  assert.deepEqual(S.paydays("2026-01-31", "monthly", "2026-02-01", 2), ["2026-02-27", "2026-03-31"]);
});

test("countPaydays counts inclusive range", () => {
  assert.equal(S.countPaydays("2026-10-02", "weekly", "2026-10-01", "2026-10-30"), 5);
  assert.equal(S.countPaydays("2026-10-02", "weekly", "2026-10-01", "2026-09-01"), 0);
});

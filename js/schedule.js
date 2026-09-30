/*
 * Payday schedule helpers shared by the Calendar and Goals modules.
 * Dates are ISO strings ("YYYY-MM-DD"); math is done at UTC noon to dodge DST.
 * Works in the browser (window.Schedule) and in Node (module.exports).
 */
(function (root) {
  "use strict";

  const DAY = 86400000;

  /**
   * @param {string | null | undefined} iso
   * @returns {Date | null}
   */
  function parse(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
    return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12)) : null;
  }

  /**
   * parse() for dates that must be valid: throws on a malformed date.
   * @param {string} iso
   * @returns {Date}
   */
  function req(iso) {
    const d = parse(iso);
    if (!d) throw new TypeError(`Not an ISO date: ${iso}`);
    return d;
  }

  /** @param {Date} d */
  function fmt(d) {
    return d.toISOString().slice(0, 10);
  }

  /** @param {string} iso @param {number} n */
  function addDays(iso, n) {
    return fmt(new Date(req(iso).getTime() + n * DAY));
  }

  /** @param {string} aIso @param {string} bIso */
  function daysBetween(aIso, bIso) {
    return Math.round((req(bIso).getTime() - req(aIso).getTime()) / DAY);
  }

  /** @param {Date} [now] */
  function todayISO(now = new Date()) {
    return fmt(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 12)));
  }

  /** @param {number} y @param {number} m 0-based month */
  function daysInMonth(y, m) {
    return new Date(Date.UTC(y, m + 1, 0, 12)).getUTCDate();
  }

  /**
   * Date in month (y, m) on `day`, clamped to the month's length.
   * @param {number} y @param {number} m @param {number} day
   */
  function onDay(y, m, day) {
    return fmt(new Date(Date.UTC(y, m, Math.min(day, daysInMonth(y, m)), 12)));
  }

  /**
   * Move Saturday/Sunday back to Friday, as most payroll does.
   * @param {string} iso
   */
  function prevBusinessDay(iso) {
    const dow = req(iso).getUTCDay();
    return dow === 6 ? addDays(iso, -1) : dow === 0 ? addDays(iso, -2) : iso;
  }

  /** @param {string} fromIso */
  function nextFriday(fromIso) {
    const dow = req(fromIso).getUTCDay();
    return addDays(fromIso, (5 - dow + 7) % 7);
  }

  /**
   * Upcoming paydays on or after `fromIso`.
   * @param {string | null | undefined} anchorIso  a known payday ("" = sensible default)
   * @param {string} payPeriod  weekly | biweekly | semimonthly | monthly
   * @param {string} fromIso
   * @param {number} count
   * @returns {string[]}
   */
  function paydays(anchorIso, payPeriod, fromIso, count) {
    /** @type {string[]} */
    const out = [];
    const anchor = anchorIso && parse(anchorIso) ? anchorIso : null;

    if (payPeriod === "weekly" || payPeriod === "biweekly") {
      const step = payPeriod === "weekly" ? 7 : 14;
      let d = anchor || nextFriday(fromIso);
      const behind = daysBetween(d, fromIso);
      if (behind > 0) d = addDays(d, Math.ceil(behind / step) * step);
      else if (behind < 0) d = addDays(d, -Math.floor(-behind / step) * step);
      while (out.length < count) { out.push(d); d = addDays(d, step); }
      return out;
    }

    // Monthly and semimonthly are calendar-based.
    const from = req(fromIso);
    let y = from.getUTCFullYear();
    let m = from.getUTCMonth();
    const anchorDay = anchor ? req(anchor).getUTCDate() : null;
    // Semimonthly: 15th and last day. Monthly: anchor's day of month, else last day.
    const days = payPeriod === "semimonthly" ? [15, 31] : [anchorDay || 31];
    while (out.length < count) {
      for (const day of days) {
        const d = prevBusinessDay(onDay(y, m, day));
        if (d >= fromIso && out.length < count) out.push(d);
      }
      if (++m > 11) { m = 0; y++; }
    }
    return out;
  }

  /**
   * Number of paydays from `fromIso` (inclusive) up to `toIso` (inclusive).
   * @param {string | null | undefined} anchorIso @param {string} payPeriod @param {string} fromIso @param {string} toIso
   */
  function countPaydays(anchorIso, payPeriod, fromIso, toIso) {
    if (!parse(toIso) || toIso < fromIso) return 0;
    let n = 0;
    const batch = paydays(anchorIso, payPeriod, fromIso, 800);
    for (const d of batch) { if (d > toIso) break; n++; }
    return n;
  }

  /** @type {import("../types/tax").ScheduleApi} */
  const api = { parse, fmt, addDays, daysBetween, todayISO, daysInMonth, onDay, prevBusinessDay, paydays, countPaydays };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Schedule = api;
})(/** @type {Window & typeof globalThis} */ (typeof window !== "undefined" ? window : globalThis));

/*
 * Payday schedule helpers shared by the Calendar and Goals modules.
 * Dates are ISO strings ("YYYY-MM-DD"); math is done at UTC noon to dodge DST.
 */
const DAY = 86400000;

export function parse(iso: string | null | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12)) : null;
}

/** parse() for dates that must be valid: throws on a malformed date. */
function req(iso: string): Date {
  const d = parse(iso);
  if (!d) throw new TypeError(`Not an ISO date: ${iso}`);
  return d;
}

export function fmt(d: Date) {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, n: number) {
  return fmt(new Date(req(iso).getTime() + n * DAY));
}

export function daysBetween(aIso: string, bIso: string) {
  return Math.round((req(bIso).getTime() - req(aIso).getTime()) / DAY);
}

export function todayISO(now: Date = new Date()) {
  return fmt(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 12)));
}

/** @param m 0-based month */
export function daysInMonth(y: number, m: number) {
  return new Date(Date.UTC(y, m + 1, 0, 12)).getUTCDate();
}

/** Date in month (y, m) on `day`, clamped to the month's length. */
export function onDay(y: number, m: number, day: number) {
  return fmt(new Date(Date.UTC(y, m, Math.min(day, daysInMonth(y, m)), 12)));
}

/** Move Saturday/Sunday back to Friday, as most payroll does. */
export function prevBusinessDay(iso: string) {
  const dow = req(iso).getUTCDay();
  return dow === 6 ? addDays(iso, -1) : dow === 0 ? addDays(iso, -2) : iso;
}

function nextFriday(fromIso: string) {
  const dow = req(fromIso).getUTCDay();
  return addDays(fromIso, (5 - dow + 7) % 7);
}

/**
 * Upcoming paydays on or after `fromIso`.
 * @param anchorIso  a known payday ("" = sensible default)
 * @param payPeriod  weekly | biweekly | semimonthly | monthly
 */
export function paydays(anchorIso: string | null | undefined, payPeriod: string, fromIso: string, count: number): string[] {
  const out: string[] = [];
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

/** Number of paydays from `fromIso` (inclusive) up to `toIso` (inclusive). */
export function countPaydays(anchorIso: string | null | undefined, payPeriod: string, fromIso: string, toIso: string) {
  if (!parse(toIso) || toIso < fromIso) return 0;
  let n = 0;
  const batch = paydays(anchorIso, payPeriod, fromIso, 800);
  for (const d of batch) { if (d > toIso) break; n++; }
  return n;
}

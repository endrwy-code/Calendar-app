import { addDays, addMonths, addYears, differenceInCalendarDays, startOfWeek } from 'date-fns';
import type { CalEvent } from '../types';
import { parseLocal, toDateKey } from './dates';

export interface Occurrence {
  /** Unique per occurrence: `${eventId}:${YYYY-MM-DD}` */
  key: string;
  event: CalEvent;
  start: Date;
  /** Exclusive end */
  end: Date;
  /** Date key of the occurrence start (identifies the occurrence in a series) */
  dateKey: string;
}

const MAX_ITER = 4000;

/** Start/end of the event's base instance as Dates (end exclusive). */
export function eventBounds(ev: CalEvent): { start: Date; end: Date } {
  const start = parseLocal(ev.start);
  if (ev.allDay) {
    const last = parseLocal(ev.end);
    return { start, end: addDays(last, 1) };
  }
  let end = parseLocal(ev.end);
  if (end.getTime() <= start.getTime()) end = new Date(start.getTime() + 15 * 60000);
  return { start, end };
}

function shiftTo(base: Date, day: Date): Date {
  return new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    base.getHours(),
    base.getMinutes(),
    0,
    0,
  );
}

/** The nth (1–5, or -1 = last) given weekday of a month, or null if that month has none. */
export function nthWeekdayOfMonth(year: number, month: number, weekday: number, nth: number): Date | null {
  if (nth < 0) {
    const last = new Date(year, month + 1, 0);
    return new Date(year, month, last.getDate() - ((last.getDay() - weekday + 7) % 7));
  }
  const first = new Date(year, month, 1);
  const day = 1 + ((weekday - first.getDay() + 7) % 7) + (nth - 1) * 7;
  const d = new Date(year, month, day);
  return d.getMonth() === month ? d : null;
}

/** Which week of its month a date falls in, as used by "nth weekday" rules: 1–4, or -1 for a 5th (last). */
export function nthOfMonth(d: Date): number {
  const n = Math.ceil(d.getDate() / 7);
  return n >= 5 ? -1 : n;
}

export const ORDINAL: Record<string, string> = { '1': '1st', '2': '2nd', '3': '3rd', '4': '4th', '5': '5th', '-1': 'last' };
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "the 2nd Tuesday", "the last Friday" */
export function describeNth(nth: number, weekday: number): string {
  return `the ${ORDINAL[String(nth)] ?? `${nth}th`} ${DAY_NAMES[weekday]}`;
}

/** Generates candidate start dates for a recurring event, roughly from `from` onwards. */
function* candidates(ev: CalEvent, base: Date, from: Date): Generator<Date> {
  const r = ev.recurrence!;
  const interval = Math.max(1, Math.floor(r.interval || 1));
  switch (r.freq) {
    case 'daily': {
      const diff = differenceInCalendarDays(from, base);
      let k = Math.max(0, Math.floor(diff / interval));
      for (;;) yield addDays(base, k++ * interval);
    }
    case 'weekly': {
      const days = (r.byWeekday && r.byWeekday.length ? [...r.byWeekday] : [base.getDay()]).sort();
      const anchor = startOfWeek(base, { weekStartsOn: 0 });
      const diffWeeks = Math.floor(differenceInCalendarDays(from, anchor) / 7);
      let w = Math.max(0, Math.floor(diffWeeks / interval) * interval);
      for (;;) {
        const weekStart = addDays(anchor, w * 7);
        for (const wd of days) {
          const day = shiftTo(base, addDays(weekStart, wd));
          if (day.getTime() >= base.getTime()) yield day;
        }
        w += interval;
      }
    }
    case 'monthly': {
      const monthsDiff =
        (from.getFullYear() - base.getFullYear()) * 12 + (from.getMonth() - base.getMonth());
      let k = Math.max(0, Math.floor(monthsDiff / interval) * interval);
      const nth = r.nth && r.byWeekday?.length ? r.nth : null;
      for (;;) {
        const d = addMonths(new Date(base.getFullYear(), base.getMonth(), 1), k);
        if (nth) {
          // "2nd Tuesday", "last Friday": months without a 5th one are skipped
          const day = nthWeekdayOfMonth(d.getFullYear(), d.getMonth(), r.byWeekday![0], nth);
          if (day) {
            const cand = shiftTo(base, day);
            if (cand.getTime() >= base.getTime()) yield cand;
          }
          k += interval;
          continue;
        }
        const cand = new Date(
          d.getFullYear(),
          d.getMonth(),
          base.getDate(),
          base.getHours(),
          base.getMinutes(),
        );
        // Skip months that don't have this date (e.g. 31st)
        if (cand.getDate() === base.getDate()) yield cand;
        k += interval;
      }
    }
    case 'yearly': {
      const yearsDiff = from.getFullYear() - base.getFullYear();
      let k = Math.max(0, Math.floor(yearsDiff / interval) * interval);
      for (;;) {
        const y = addYears(new Date(base.getFullYear(), 0, 1), k).getFullYear();
        const cand = new Date(y, base.getMonth(), base.getDate(), base.getHours(), base.getMinutes());
        if (cand.getMonth() === base.getMonth()) yield cand;
        k += interval;
      }
    }
  }
}

/** Expands events (including recurring ones) into concrete occurrences overlapping [rangeStart, rangeEnd). */
export function expandEvents(events: CalEvent[], rangeStart: Date, rangeEnd: Date): Occurrence[] {
  const out: Occurrence[] = [];
  for (const ev of events) {
    const { start, end } = eventBounds(ev);
    const durMs = end.getTime() - start.getTime();
    if (!ev.recurrence) {
      if (start < rangeEnd && end > rangeStart) {
        const dateKey = toDateKey(start);
        out.push({ key: `${ev.id}:${dateKey}`, event: ev, start, end, dateKey });
      }
      continue;
    }
    const until = ev.recurrence.until ? addDays(parseLocal(ev.recurrence.until), 1) : null;
    const ex = new Set(ev.exdates ?? []);
    // Start generating early enough that long occurrences overlapping the range are included.
    const from = new Date(rangeStart.getTime() - durMs - 86400000);
    let i = 0;
    for (const cand of candidates(ev, start, from)) {
      if (++i > MAX_ITER) break;
      if (cand >= rangeEnd) break;
      if (until && cand >= until) break;
      const candEnd = new Date(cand.getTime() + durMs);
      const fixedEnd = ev.allDay ? addDays(cand, Math.round(durMs / 86400000)) : candEnd;
      if (fixedEnd <= rangeStart) continue;
      const dateKey = toDateKey(cand);
      if (ex.has(dateKey)) continue;
      out.push({ key: `${ev.id}:${dateKey}`, event: ev, start: cand, end: fixedEnd, dateKey });
    }
  }
  out.sort((a, b) => a.start.getTime() - b.start.getTime() || b.end.getTime() - a.end.getTime());
  return out;
}

export function describeRecurrence(ev: CalEvent): string | null {
  const r = ev.recurrence;
  if (!r) return null;
  const n = Math.max(1, r.interval || 1);
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  let s: string;
  switch (r.freq) {
    case 'daily':
      s = n === 1 ? 'Every day' : `Every ${n} days`;
      break;
    case 'weekly': {
      const days = r.byWeekday && r.byWeekday.length ? r.byWeekday : [parseLocal(ev.start).getDay()];
      const set = [...days].sort().join(',');
      const label =
        set === '1,2,3,4,5'
          ? 'weekdays'
          : set === '0,6'
            ? 'weekends'
            : [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => names[d]).join(', ');
      s = n === 1 ? `Weekly on ${label}` : `Every ${n} weeks on ${label}`;
      break;
    }
    case 'monthly':
      s = n === 1 ? 'Monthly' : `Every ${n} months`;
      if (r.nth && r.byWeekday?.length) s += ` on ${describeNth(r.nth, r.byWeekday[0])}`;
      break;
    case 'yearly':
      s = n === 1 ? 'Yearly' : `Every ${n} years`;
      break;
  }
  if (r.until) s += ` until ${r.until}`;
  return s;
}

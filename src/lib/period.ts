import { addDays, addMonths, format, isSameMonth, isSameYear, startOfMonth, startOfWeek } from 'date-fns';
import type { ViewMode } from '../types';
import { parseLocal, toDateKey } from './dates';

/** Days shown per page in the time-grid views. */
export function spanOf(view: ViewMode): number {
  return view === 'day' ? 1 : view === '3day' ? 3 : 7;
}

/** First day of the page that contains `cursor`. */
export function periodStart(view: ViewMode, cursor: Date, weekStartsOn: 0 | 1): Date {
  if (view === 'week') return startOfWeek(cursor, { weekStartsOn });
  if (view === 'month') return startOfMonth(cursor);
  return cursor;
}

/** Cursor for the previous/next page. */
export function shiftCursor(view: ViewMode, cursorKey: string, dir: number): string {
  const c = parseLocal(cursorKey);
  if (view === 'month') return toDateKey(addMonths(c, dir));
  if (view === 'agenda') return toDateKey(addDays(c, dir * 7));
  return toDateKey(addDays(c, dir * spanOf(view)));
}

/** Whether `dateKey` falls on the page currently showing `cursorKey`. */
export function pageContains(view: ViewMode, cursorKey: string, dateKey: string, weekStartsOn: 0 | 1): boolean {
  const c = parseLocal(cursorKey);
  const d = parseLocal(dateKey);
  if (view === 'month') return isSameMonth(c, d);
  if (view === 'agenda') return dateKey >= cursorKey;
  const s = periodStart(view, c, weekStartsOn);
  const e = addDays(s, spanOf(view));
  return d >= s && d < e;
}

/** Header title: "November", "Nov – Dec", or with the year when it isn't this year. */
export function periodTitle(view: ViewMode, cursorKey: string, weekStartsOn: 0 | 1, now = new Date()): { main: string; year: string | null } {
  const c = parseLocal(cursorKey);
  const first = view === 'month' || view === 'agenda' ? c : periodStart(view, c, weekStartsOn);
  const last = view === 'month' || view === 'agenda' ? c : addDays(first, spanOf(view) - 1);
  const year = isSameYear(first, now) && isSameYear(last, now) ? null : format(last, 'yyyy');
  if (isSameMonth(first, last)) return { main: format(first, 'MMMM'), year };
  return { main: `${format(first, 'MMM')} – ${format(last, 'MMM')}`, year };
}

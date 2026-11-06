import {
  addDays,
  differenceInCalendarDays,
  format,
  getISOWeek,
  isSameDay,
  startOfDay,
  startOfWeek,
} from 'date-fns';

const pad = (n: number) => String(n).padStart(2, '0');

/** "YYYY-MM-DD" for a local date */
export function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "YYYY-MM-DDTHH:mm" in local time */
export function toLocalISO(d: Date): string {
  return `${toDateKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Parses "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm" as local wall-clock time. */
export function parseLocal(s: string): Date {
  const [datePart, timePart] = s.split('T');
  const [y, m, d] = datePart.split('-').map(Number);
  let h = 0;
  let min = 0;
  if (timePart) {
    const [hh, mm] = timePart.split(':').map(Number);
    h = hh || 0;
    min = mm || 0;
  }
  return new Date(y, (m || 1) - 1, d || 1, h, min, 0, 0);
}

export function todayKey(): string {
  return toDateKey(new Date());
}

export function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

export function atMinutes(day: Date, minutes: number): Date {
  const d = startOfDay(day);
  d.setMinutes(minutes);
  return d;
}

export function roundUpToStep(d: Date, stepMin: number): Date {
  const r = new Date(d);
  r.setSeconds(0, 0);
  if (r.getTime() < d.getTime()) r.setMinutes(r.getMinutes() + 1);
  const rem = r.getMinutes() % stepMin;
  if (rem) r.setMinutes(r.getMinutes() + stepMin - rem);
  return r;
}

export function fmtTime(d: Date, timeFormat: '24h' | '12h'): string {
  if (timeFormat === '24h') return format(d, 'HH:mm');
  return d.getMinutes() === 0 ? format(d, 'h a').toLowerCase() : format(d, 'h:mm a').toLowerCase();
}

export function fmtHourLabel(hour: number, timeFormat: '24h' | '12h'): string {
  if (timeFormat === '24h') return `${pad(hour)}:00`;
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h} ${hour < 12 ? 'am' : 'pm'}`;
}

export function fmtDuration(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** Friendly relative label: Today / Tomorrow / Yesterday / Mon 12 Oct */
export function relativeDayLabel(d: Date, now = new Date()): string {
  const diff = differenceInCalendarDays(d, now);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff > 1 && diff < 7) return format(d, 'EEEE');
  if (d.getFullYear() === now.getFullYear()) return format(d, 'EEE d MMM');
  return format(d, 'EEE d MMM yyyy');
}

export function weekDays(anchor: Date, weekStartsOn: 0 | 1): Date[] {
  const s = startOfWeek(anchor, { weekStartsOn });
  return Array.from({ length: 7 }, (_, i) => addDays(s, i));
}

export function isoWeek(d: Date): number {
  return getISOWeek(d);
}

export function sameDay(a: Date, b: Date): boolean {
  return isSameDay(a, b);
}

export function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h < 5) return 'Good night';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

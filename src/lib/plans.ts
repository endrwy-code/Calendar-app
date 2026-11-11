/**
 * Plans read from forwarded messages: what Claude suggests, before you confirm.
 *
 * A plan is either an event or a to-do, with dates and times as the message
 * gave them (in your time zone). Shared by the server, which asks Claude and
 * shows the draft in Telegram, and the app, where you can edit it before
 * adding it to your calendar.
 */
import { addDays, addMinutes, format } from 'date-fns';
import type { CalEvent, Freq, Recurrence, Task } from '../types';
import { fmtTime, parseLocal, toDateKey, toLocalISO } from './dates';
import { describeNth } from './recurrence';

export interface PlanRepeat {
  freq: Freq;
  interval: number;
  /** 0 = Sunday … 6 = Saturday */
  byWeekday: number[];
  /** Monthly on the nth weekday (1–5, or -1 for the last) */
  nth: number | null;
  /** Last date, YYYY-MM-DD */
  until: string | null;
}

export interface PlanItem {
  kind: 'event' | 'todo';
  title: string;
  /** YYYY-MM-DD */
  date: string | null;
  /** Last day of a multi-day plan; null = same day */
  endDate: string | null;
  /** HH:MM, 24-hour; null = all day (events) or no set time (to-dos) */
  startTime: string | null;
  endTime: string | null;
  location: string | null;
  notes: string | null;
  /** One of your tags, if one clearly fits */
  tagId: string | null;
  repeat: PlanRepeat | null;
  /** What was guessed, e.g. “No year given; assumed 2026” */
  assumption: string | null;
}

export interface PlanDraft {
  id: string;
  items: PlanItem[];
  /** A remark about the whole message, if any */
  note: string | null;
  status: 'open' | 'added' | 'cancelled';
}

/* ---------- The shape Claude answers in (JSON Schema for structured outputs) ---------- */

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: 'null' }] });

export const PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items', 'note'],
  properties: {
    items: {
      type: 'array',
      description: 'Every plan in the message, in the order they appear. Empty if there is nothing to add.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'title', 'date', 'endDate', 'startTime', 'endTime', 'location', 'notes', 'tagId', 'repeat', 'assumption'],
        properties: {
          kind: { type: 'string', enum: ['event', 'todo'], description: 'event: happens at a date (and maybe time). todo: something to do, with or without a deadline.' },
          title: { type: 'string', description: 'Short, like a calendar entry (2-8 words), without the date or time.' },
          date: nullable({ type: 'string', format: 'date', description: 'Start date, YYYY-MM-DD. Required for events.' }),
          endDate: nullable({ type: 'string', format: 'date', description: 'Last day, only for plans spanning several days.' }),
          startTime: nullable({ type: 'string', description: '24-hour HH:MM in the person’s time zone. null for all-day events.' }),
          endTime: nullable({ type: 'string', description: '24-hour HH:MM. null when the message gives no end time.' }),
          location: nullable({ type: 'string', description: 'Place, address or meeting link, if given.' }),
          notes: nullable({ type: 'string', description: 'Brief useful details (what to bring, dress code). Never phone numbers, emails or ID numbers.' }),
          tagId: nullable({ type: 'string', description: 'The id of one of the person’s tags if one clearly fits, else null.' }),
          repeat: nullable({
            type: 'object',
            additionalProperties: false,
            required: ['freq', 'interval', 'byWeekday', 'nth', 'until'],
            description: 'Only when the message says the plan repeats.',
            properties: {
              freq: { type: 'string', enum: ['daily', 'weekly', 'monthly', 'yearly'] },
              interval: { type: 'integer', description: '1 = every week/month, 2 = every other, …' },
              byWeekday: { type: 'array', items: { type: 'integer', enum: [0, 1, 2, 3, 4, 5, 6] }, description: 'Weekly: the days (0 = Sunday). Monthly by weekday: the one weekday. Else empty.' },
              nth: nullable({ type: 'integer', enum: [1, 2, 3, 4, 5, -1], description: 'Monthly on the nth weekday (-1 = last), e.g. “first Sunday”.' }),
              until: nullable({ type: 'string', format: 'date', description: 'Last date it repeats, if given.' }),
            },
          }),
          assumption: nullable({ type: 'string', description: 'One short sentence on anything you had to guess (date, time, year), else null.' }),
        },
      },
    },
    note: nullable({ type: 'string', description: 'One short remark for the person about the message as a whole, only if needed.' }),
  },
} as const;

/* ---------- Checking what comes back ---------- */

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const FREQS: Freq[] = ['daily', 'weekly', 'monthly', 'yearly'];

function str(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
}

function text(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
}

function date(v: unknown): string | null {
  if (typeof v !== 'string' || !DATE.test(v)) return null;
  const d = parseLocal(v);
  return toDateKey(d) === v ? v : null;
}

const time = (v: unknown) => (typeof v === 'string' && TIME.test(v) ? v : null);

/**
 * Makes Claude's answer (or an edited draft) safe to use: drops anything
 * malformed, keeps tags to ones you have, and turns an event without a date
 * into a to-do.
 */
export function normalizePlans(raw: unknown, tagIds: string[]): PlanItem[] {
  const list = Array.isArray(raw) ? raw : [];
  const tags = new Set(tagIds);
  const out: PlanItem[] = [];
  for (const r of list.slice(0, 25) as Record<string, unknown>[]) {
    if (!r || typeof r !== 'object') continue;
    const title = str(r.title, 200);
    if (!title) continue;
    const start = date(r.date);
    let kind: PlanItem['kind'] = r.kind === 'todo' ? 'todo' : 'event';
    let assumption = str(r.assumption, 240);
    if (kind === 'event' && !start) {
      kind = 'todo';
      assumption ??= 'No date given, so it’s a to-do.';
    }
    const end = date(r.endDate);
    const item: PlanItem = {
      kind,
      title,
      date: start,
      endDate: start && end && end > start ? end : null,
      startTime: start ? time(r.startTime) : null,
      endTime: null,
      location: str(r.location, 300),
      notes: text(r.notes, 2000),
      tagId: typeof r.tagId === 'string' && tags.has(r.tagId) ? r.tagId : null,
      repeat: null,
      assumption,
    };
    if (item.startTime) item.endTime = time(r.endTime);
    const rep = r.repeat as Record<string, unknown> | null;
    if (kind === 'event' && rep && typeof rep === 'object' && FREQS.includes(rep.freq as Freq)) {
      const days = Array.isArray(rep.byWeekday) ? [...new Set(rep.byWeekday.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))] : [];
      const nth = [1, 2, 3, 4, 5, -1].includes(rep.nth as number) ? (rep.nth as number) : null;
      const until = date(rep.until);
      item.repeat = {
        freq: rep.freq as Freq,
        interval: Number.isInteger(rep.interval) ? Math.min(99, Math.max(1, rep.interval as number)) : 1,
        byWeekday: days.sort(),
        nth: rep.freq === 'monthly' ? nth : null,
        until: until && start && until >= start ? until : null,
      };
    }
    out.push(item);
  }
  return out;
}

/* ---------- Turning a plan into an event or a to-do ---------- */

function recurrenceOf(item: PlanItem): Recurrence | null {
  const r = item.repeat;
  if (!r || !item.date) return null;
  const dow = parseLocal(item.date).getDay();
  const rec: Recurrence = { freq: r.freq, interval: r.interval, until: r.until };
  if (r.freq === 'weekly') rec.byWeekday = r.byWeekday.length ? r.byWeekday : [dow];
  if (r.freq === 'monthly' && r.nth) {
    rec.nth = r.nth;
    rec.byWeekday = [r.byWeekday[0] ?? dow];
  }
  return rec;
}

/** Start and end as Daybook stores them. A time range that ends before it starts runs past midnight. */
export function planTimes(item: PlanItem, defaultMinutes: number): { allDay: boolean; start: string; end: string } {
  const day = item.date!;
  if (!item.startTime) return { allDay: true, start: day, end: item.endDate ?? day };
  const start = parseLocal(`${day}T${item.startTime}`);
  let end: Date;
  if (item.endTime) {
    end = parseLocal(`${item.endDate ?? day}T${item.endTime}`);
    if (end <= start) end = addDays(end, 1);
  } else end = addMinutes(start, defaultMinutes);
  return { allDay: false, start: toLocalISO(start), end: toLocalISO(end) };
}

export function planToEvent(item: PlanItem, opts: { defaultMinutes: number; fallbackTag: string }): Omit<CalEvent, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    title: item.title,
    calendarId: item.tagId ?? opts.fallbackTag,
    ...planTimes(item, opts.defaultMinutes),
    location: item.location ?? '',
    notes: item.notes ?? '',
    recurrence: recurrenceOf(item),
    exdates: [],
  };
}

/** A to-do. With a date and time it's planned on the calendar; with only a date, the date goes in its notes. */
export function planToTask(item: PlanItem): Pick<Task, 'title' | 'notes' | 'scheduledStart' | 'durationMin'> {
  let notes = item.notes ?? '';
  let scheduledStart: string | null = null;
  let durationMin = 30;
  if (item.date && item.startTime) {
    const t = planTimes(item, 30);
    scheduledStart = t.start;
    durationMin = Math.max(5, Math.round((parseLocal(t.end).getTime() - parseLocal(t.start).getTime()) / 60000));
  } else if (item.date) {
    notes = [`By ${format(parseLocal(item.date), 'EEE d MMM yyyy')}`, notes].filter(Boolean).join('\n');
  }
  if (item.location) notes = [notes, item.location].filter(Boolean).join('\n');
  return { title: item.title, notes, scheduledStart, durationMin };
}

/* ---------- Describing a plan in one line ---------- */

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function dayLabel(key: string, now: Date): string {
  const d = parseLocal(key);
  return format(d, d.getFullYear() === now.getFullYear() ? 'EEE d MMM' : 'EEE d MMM yyyy');
}

export function describeRepeat(r: PlanRepeat): string {
  const unit = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[r.freq];
  let s = r.interval === 1 ? `Every ${unit}` : `Every ${r.interval} ${unit}s`;
  if (r.freq === 'weekly' && r.byWeekday.length) s += ` on ${[...r.byWeekday].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => DAY_NAMES[d]).join(', ')}`;
  if (r.freq === 'monthly' && r.nth && r.byWeekday.length) s += ` on ${describeNth(r.nth, r.byWeekday[0])}`;
  if (r.until) s += ` until ${format(parseLocal(r.until), 'd MMM')}`;
  return s;
}

/** “Sat 14 Nov · 10:00–12:00”, “Fri 27 – Sun 29 Nov · all day”, “To-do · by Fri 13 Nov” */
export function describeWhen(item: PlanItem, tf: '24h' | '12h', now = new Date()): string {
  if (item.kind === 'todo') {
    if (!item.date) return 'To-do';
    const when = item.startTime ? `${dayLabel(item.date, now)}, ${fmtTime(parseLocal(`${item.date}T${item.startTime}`), tf)}` : `by ${dayLabel(item.date, now)}`;
    return `To-do · ${when}`;
  }
  const parts = [item.endDate ? `${dayLabel(item.date!, now)} – ${dayLabel(item.endDate, now)}` : dayLabel(item.date!, now)];
  if (!item.startTime) parts.push('all day');
  else {
    const t = planTimes(item, 60);
    parts.push(item.endTime ? `${fmtTime(parseLocal(t.start), tf)}–${fmtTime(parseLocal(t.end), tf)}` : fmtTime(parseLocal(t.start), tf));
  }
  if (item.repeat) parts.push(describeRepeat(item.repeat));
  return parts.join(' · ');
}

/* ---------- Taking out contact details before a message is sent to Claude ---------- */

/**
 * Removes emails, phone numbers and Singapore NRIC/FIN numbers, which a
 * calendar entry never needs. It's a best effort, not a guarantee: names and
 * other details stay, so don't forward anything sensitive.
 */
export function redactContacts(input: string): string {
  return input
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]')
    .replace(/\b[STFGM]\d{7}[A-Z]\b/gi, '[ID number]')
    .replace(/\+\d[\d\s().-]{6,}\d/g, '[phone]')
    .replace(/\b[3689]\d{3}[\s-]?\d{4}\b/g, '[phone]')
    .replace(/\b\d{9,}\b/g, '[number]');
}

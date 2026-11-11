/**
 * iCalendar (.ics, RFC 5545) reading and writing.
 *
 * Reading turns another app's calendar into Daybook events: times in other
 * zones are moved to this device's wall clock, repeat rules are mapped onto
 * Daybook's (daily / weekly on days / monthly on a date or "2nd Tuesday" /
 * yearly, with an end date), cancelled or moved occurrences become exceptions,
 * and alarms become alerts. Rules Daybook can't express are kept as their first
 * occurrence and counted as "simplified" so the import can say so.
 *
 * Writing produces a file Apple Calendar, Google Calendar and Outlook accept,
 * with a VTIMEZONE for the device's zone.
 */
import { addDays, addMinutes } from 'date-fns';
import type { CalEvent, CalendarCategory, Freq, Recurrence, Settings, Task } from '../types';
import { parseLocal, toDateKey, toLocalISO } from './dates';
import { eventBounds, expandEvents, nthWeekdayOfMonth } from './recurrence';
import { eventAlerts } from './reminders';
import { taskBounds } from './schedule';
import { hash } from './hash';
import { resolveTimeZone, tzOffset, wallClock, zonedToInstant } from './tz';

const pad = (n: number) => String(n).padStart(2, '0');
const ICS_DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/* ================================ Reading ================================ */

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}
interface Comp {
  type: string;
  props: Prop[];
  children: Comp[];
}

export interface ImportedEvent {
  icsUid: string;
  title: string;
  /** Wall-clock time on this device, as Daybook stores it */
  start: string;
  end: string;
  allDay: boolean;
  location?: string;
  notes?: string;
  recurrence: Recurrence | null;
  exdates: string[];
  /** Alerts from the file's alarms; undefined when it has none */
  reminders?: number[];
  categories: string[];
}

export interface IcsImport {
  /** The calendar's own name (X-WR-CALNAME), if it has one */
  name: string | null;
  events: ImportedEvent[];
  /** Repeat rules Daybook could only approximate */
  simplified: number;
  /** Entries that couldn't be read */
  skipped: number;
}

function splitOutside(s: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (const ch of s) {
    if (ch === '"') quoted = !quoted;
    if (ch === sep && !quoted) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function parseLine(line: string): Prop | null {
  let i = 0;
  let quoted = false;
  for (; i < line.length; i++) {
    const c = line[i];
    if (c === '"') quoted = !quoted;
    else if (c === ':' && !quoted) break;
  }
  if (i >= line.length) return null;
  const [name, ...rest] = splitOutside(line.slice(0, i), ';');
  const params: Record<string, string> = {};
  for (const seg of rest) {
    const eq = seg.indexOf('=');
    if (eq > 0) params[seg.slice(0, eq).toUpperCase()] = seg.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: name.trim().toUpperCase(), params, value: line.slice(i + 1) };
}

function parseComponents(text: string): Comp[] {
  // Unfold: a line break followed by a space or tab continues the previous line.
  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n|\r/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const root: Comp = { type: 'ROOT', props: [], children: [] };
  const stack = [root];
  for (const line of lines) {
    if (!line.trim()) continue;
    const p = parseLine(line);
    if (!p) continue;
    if (p.name === 'BEGIN') {
      const c: Comp = { type: p.value.trim().toUpperCase(), props: [], children: [] };
      stack[stack.length - 1].children.push(c);
      stack.push(c);
    } else if (p.name === 'END') {
      if (stack.length > 1) stack.pop();
    } else stack[stack.length - 1].props.push(p);
  }
  return root.children;
}

const unescapeText = (v: string) => v.replace(/\\([\\;,nN])/g, (_, c: string) => (c === 'n' || c === 'N' ? '\n' : c)).trim();
const prop = (c: Comp, name: string) => c.props.find((p) => p.name === name);
const props = (c: Comp, name: string) => c.props.filter((p) => p.name === name);

type Time = { kind: 'date'; key: string } | { kind: 'instant'; ms: number } | { kind: 'floating'; wall: string };

function parseTimeValue(raw: string, params: Record<string, string>): Time | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(raw.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  if (!m[4] || params.VALUE === 'DATE') return { kind: 'date', key: `${m[1]}-${m[2]}-${m[3]}` };
  const h = Number(m[4]);
  const mi = Number(m[5]);
  const s = Number(m[6] ?? 0);
  if (m[7]) return { kind: 'instant', ms: Date.UTC(y, mo, d, h, mi, s) };
  const tz = resolveTimeZone(params.TZID);
  if (tz) return { kind: 'instant', ms: zonedToInstant(tz, y, mo, d, h, mi, s) };
  return { kind: 'floating', wall: `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}` };
}

const parseTime = (p: Prop | undefined): Time | null => (p ? parseTimeValue(p.value.split(',')[0], p.params) : null);

/** Signed minutes from an ISO 8601 duration such as -PT15M, P1D or PT1H30M. */
export function parseDuration(v: string): number | null {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim());
  if (!m) return null;
  const [, sign, w, d, h, mi, s] = m;
  const total = Number(w ?? 0) * 10080 + Number(d ?? 0) * 1440 + Number(h ?? 0) * 60 + Number(mi ?? 0) + Math.round(Number(s ?? 0) / 60);
  return sign === '-' ? -total : total;
}

/** The 1st…last occurrence of a series, as a date key (to turn COUNT into an end date). */
function lastOfCount(ev: CalEvent, count: number): string | null {
  let from = parseLocal(ev.start);
  let seen = 0;
  for (let year = 0; year < 80; year++) {
    const to = addDays(from, 366);
    for (const o of expandEvents([{ ...ev, exdates: [] }], from, to)) {
      if (o.start < from) continue;
      if (++seen === count) return o.dateKey;
    }
    from = to;
  }
  return null;
}

interface RuleResult {
  recurrence: Recurrence | null;
  simplified: boolean;
  count?: number;
}

function mapRule(rule: string, start: Date, toWall: (t: Time) => string): RuleResult {
  const parts: Record<string, string> = {};
  for (const kv of rule.split(';')) {
    const [k, v] = kv.split('=');
    if (k && v !== undefined) parts[k.trim().toUpperCase()] = v.trim();
  }
  const freqs: Record<string, Freq> = { DAILY: 'daily', WEEKLY: 'weekly', MONTHLY: 'monthly', YEARLY: 'yearly' };
  let freq = freqs[parts.FREQ];
  if (!freq) return { recurrence: null, simplified: true };
  const known = new Set(['FREQ', 'INTERVAL', 'UNTIL', 'COUNT', 'BYDAY', 'WKST', 'BYMONTHDAY', 'BYMONTH', 'BYSETPOS']);
  let simplified = Object.keys(parts).some((k) => !known.has(k));
  const interval = Math.max(1, Number.parseInt(parts.INTERVAL ?? '1', 10) || 1);
  const r: Recurrence = { freq, interval };

  const byDay = (parts.BYDAY ?? '')
    .split(',')
    .filter(Boolean)
    .map((s) => {
      const m = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/i.exec(s.trim());
      return m ? { n: m[1] ? Number(m[1]) : null, wd: ICS_DAYS.indexOf(m[2].toUpperCase()) } : null;
    });
  if (byDay.some((x) => !x)) simplified = true;
  const days = byDay.filter((x): x is { n: number | null; wd: number } => !!x);
  const monthDays = (parts.BYMONTHDAY ?? '').split(',').filter(Boolean).map(Number);
  const months = (parts.BYMONTH ?? '').split(',').filter(Boolean).map(Number);
  const setPos = (parts.BYSETPOS ?? '').split(',').filter(Boolean).map(Number);

  if (freq === 'daily' && days.length) {
    // "Every weekday" is sometimes written as a daily rule limited to some days.
    if (interval === 1 && days.every((d) => d.n === null)) {
      freq = r.freq = 'weekly';
    } else simplified = true;
  }
  if (r.freq === 'weekly') {
    if (days.some((d) => d.n !== null)) simplified = true;
    const wds = [...new Set(days.map((d) => d.wd))];
    r.byWeekday = wds.length ? wds : [start.getDay()];
  } else if (freq === 'monthly') {
    const ok = (n: number) => (n >= 1 && n <= 5) || n === -1;
    if (days.length === 1 && days[0].n !== null && ok(days[0].n) && !setPos.length) {
      r.nth = days[0].n;
      r.byWeekday = [days[0].wd];
    } else if (days.length === 1 && days[0].n === null && setPos.length === 1 && ok(setPos[0])) {
      r.nth = setPos[0];
      r.byWeekday = [days[0].wd];
    } else if (days.length || setPos.length) simplified = true;
    if (monthDays.length && !(monthDays.length === 1 && monthDays[0] === start.getDate())) simplified = true;
  } else if (freq === 'yearly') {
    if (days.length || setPos.length) simplified = true;
    if (months.length && !(months.length === 1 && months[0] === start.getMonth() + 1)) simplified = true;
    if (monthDays.length && !(monthDays.length === 1 && monthDays[0] === start.getDate())) simplified = true;
  }

  if (parts.UNTIL) {
    const t = parseTimeValue(parts.UNTIL, {});
    if (t) {
      const wall = toWall(t);
      let key = wall.slice(0, 10);
      // UNTIL is inclusive of the instant: an occurrence later that day is outside it.
      if (wall.length > 10 && wall.slice(11) < toLocalISO(start).slice(11)) key = toDateKey(addDays(parseLocal(key), -1));
      r.until = key;
    }
  }
  const count = parts.COUNT ? Number.parseInt(parts.COUNT, 10) : undefined;
  return { recurrence: r, simplified, count: count && count > 0 ? count : undefined };
}

/**
 * Reads an .ics file. Times come out on this device's wall clock, or on the
 * wall clock of `zone` when given (used by tests and the server).
 */
export function parseIcs(text: string, opts: { zone?: string } = {}): IcsImport {
  const toWallMs = opts.zone
    ? (ms: number) => {
        const w = wallClock(opts.zone!, ms);
        return `${w.getUTCFullYear()}-${pad(w.getUTCMonth() + 1)}-${pad(w.getUTCDate())}T${pad(w.getUTCHours())}:${pad(w.getUTCMinutes())}`;
      }
    : (ms: number) => toLocalISO(new Date(ms));
  const toWall = (t: Time): string => (t.kind === 'date' ? t.key : t.kind === 'floating' ? t.wall : toWallMs(t.ms));

  const result: IcsImport = { name: null, events: [], simplified: 0, skipped: 0 };
  const masters = new Map<string, ImportedEvent>();
  const overrides: { uid: string; dateKey: string; ev: ImportedEvent | null }[] = [];

  const cals = parseComponents(text).filter((c) => c.type === 'VCALENDAR');
  for (const cal of cals) {
    const name = prop(cal, 'X-WR-CALNAME') ?? prop(cal, 'NAME');
    if (name && !result.name) result.name = unescapeText(name.value) || null;

    for (const c of cal.children) {
      if (c.type !== 'VEVENT') continue;
      const dtstart = parseTime(prop(c, 'DTSTART'));
      if (!dtstart) {
        result.skipped++;
        continue;
      }
      const cancelled = prop(c, 'STATUS')?.value.trim().toUpperCase() === 'CANCELLED';
      const allDay = dtstart.kind === 'date';
      const start = toWall(dtstart);
      let end: string;
      const dtend = parseTime(prop(c, 'DTEND'));
      const dur = prop(c, 'DURATION') ? parseDuration(prop(c, 'DURATION')!.value) : null;
      if (allDay) {
        // DTEND is exclusive for dates; Daybook keeps the last day.
        const endKey = dtend ? toWall(dtend).slice(0, 10) : null;
        if (endKey && endKey > start) end = toDateKey(addDays(parseLocal(endKey), -1));
        else if (dur && dur >= 1440) end = toDateKey(addDays(parseLocal(start), Math.ceil(dur / 1440) - 1));
        else end = start;
      } else {
        if (dtend && dtend.kind !== 'date') end = toWall(dtend);
        else if (dur !== null) end = toLocalISO(addMinutes(parseLocal(start), dur));
        else end = start;
        if (end < start) end = start;
      }

      const summary = prop(c, 'SUMMARY');
      const description = prop(c, 'DESCRIPTION');
      const location = prop(c, 'LOCATION');
      const url = prop(c, 'URL');
      let notes = description ? unescapeText(description.value) : '';
      if (url && !notes.includes(url.value.trim())) notes = [notes, url.value.trim()].filter(Boolean).join('\n\n');
      const title = summary ? unescapeText(summary.value) : '';
      const uidProp = prop(c, 'UID')?.value.trim();
      const uid = uidProp || `${hash(`${title}|${start}`)}@import`;

      // Alarms → alerts
      let reminders: number[] | undefined;
      const startMs = parseLocal(start).getTime();
      const durMin = Math.round((parseLocal(allDay ? toDateKey(addDays(parseLocal(end), 1)) : end).getTime() - startMs) / 60000);
      for (const alarm of c.children.filter((x) => x.type === 'VALARM')) {
        const action = prop(alarm, 'ACTION')?.value.trim().toUpperCase();
        const trig = prop(alarm, 'TRIGGER');
        if (!trig || action === 'NONE') continue;
        let before: number | null = null;
        if (trig.params.VALUE === 'DATE-TIME' || /^\d{8}T/.test(trig.value.trim())) {
          const t = parseTimeValue(trig.value, trig.params);
          if (t && t.kind !== 'date') {
            const fire = parseLocal(toWall(t)).getTime();
            if (fire > Date.UTC(2000, 0, 1)) before = Math.round((startMs - fire) / 60000);
          }
        } else {
          const d = parseDuration(trig.value);
          if (d !== null) before = trig.params.RELATED?.toUpperCase() === 'END' ? -(durMin + d) : -d;
        }
        if (before !== null) reminders = [...new Set([...(reminders ?? []), before])].sort((a, b) => a - b);
      }

      const exdates = new Set<string>();
      for (const p of props(c, 'EXDATE')) {
        for (const v of p.value.split(',')) {
          const t = parseTimeValue(v, p.params);
          if (t) exdates.add(toWall(t).slice(0, 10));
        }
      }

      const categories = props(c, 'CATEGORIES').flatMap((p) =>
        splitOutside(p.value.replace(/\\,/g, '\u0000'), ',')
          .map((s) => unescapeText(s.replace(/\u0000/g, ',')))
          .filter(Boolean),
      );

      const ev: ImportedEvent = {
        icsUid: uid,
        title: title || 'Untitled',
        start,
        end,
        allDay,
        location: location ? unescapeText(location.value) || undefined : undefined,
        notes: notes || undefined,
        recurrence: null,
        exdates: [],
        reminders,
        categories,
      };

      const rid = parseTime(prop(c, 'RECURRENCE-ID'));
      if (rid) {
        // One occurrence of a series that was moved, edited or cancelled.
        const dateKey = toWall(rid).slice(0, 10);
        overrides.push({ uid, dateKey, ev: cancelled ? null : { ...ev, icsUid: `${uid}/${dateKey}` } });
        continue;
      }
      if (cancelled) continue;

      const rrule = prop(c, 'RRULE');
      if (rrule) {
        const mapped = mapRule(rrule.value, parseLocal(start), toWall);
        if (mapped.simplified) result.simplified++;
        ev.recurrence = mapped.recurrence;
        if (ev.recurrence && mapped.count) {
          const probe = { id: 'probe', title: '', calendarId: '', start, end, allDay, recurrence: ev.recurrence, createdAt: 0, updatedAt: 0 } as CalEvent;
          ev.recurrence.until = lastOfCount(probe, mapped.count) ?? ev.recurrence.until ?? null;
        }
      }
      if (ev.recurrence) ev.exdates = [...exdates].sort();
      masters.set(uid, ev);
    }
  }

  for (const o of overrides) {
    const master = masters.get(o.uid);
    if (master?.recurrence && !master.exdates.includes(o.dateKey)) master.exdates = [...master.exdates, o.dateKey].sort();
    if (o.ev) masters.set(o.ev.icsUid, o.ev);
  }
  result.events = [...masters.values()];
  return result;
}

/* ================================ Writing ================================ */

const escapeText = (v: string) => v.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

const encoder = new TextEncoder();

/** Lines longer than 75 bytes are folded onto continuation lines that start with a space. */
function fold(line: string): string {
  if (encoder.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = '';
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const b = encoder.encode(ch).length;
    if (bytes + b > limit) {
      out.push(cur);
      cur = '';
      bytes = 0;
      limit = 74;
    }
    cur += ch;
    bytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}

const icsDate = (key: string) => key.replace(/-/g, '');
const icsWall = (wall: string) => `${wall.slice(0, 4)}${wall.slice(5, 7)}${wall.slice(8, 10)}T${wall.slice(11, 13)}${wall.slice(14, 16)}00`;
const icsUtc = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

function icsDuration(min: number): string {
  if (min === 0) return 'PT0S';
  const sign = min < 0 ? '-' : '';
  let m = Math.abs(min);
  const d = Math.floor(m / 1440);
  m -= d * 1440;
  const h = Math.floor(m / 60);
  m -= h * 60;
  let s = `${sign}P${d ? `${d}D` : ''}`;
  if (h || m) s += `T${h ? `${h}H` : ''}${m ? `${m}M` : ''}`;
  return s;
}

const fmtOffset = (m: number) => `${m < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(m) / 60))}${pad(Math.abs(m) % 60)}`;

/** A VTIMEZONE block for `tz`, worked out from this year's offsets and transitions. */
function vtimezone(tz: string, year: number): string[] {
  const offsetAt = (ms: number) => tzOffset(tz, ms);
  const lines = ['BEGIN:VTIMEZONE', `TZID:${tz}`];
  const transitions: { at: number; from: number; to: number }[] = [];
  for (let m = 0; m < 12; m++) {
    let lo = Date.UTC(year, m, 1);
    let hi = Date.UTC(year, m + 1, 1);
    const a = offsetAt(lo);
    const b = offsetAt(hi);
    if (a === b) continue;
    while (hi - lo > 60000) {
      const mid = lo + Math.floor((hi - lo) / 120000) * 60000;
      if (offsetAt(mid) === a) lo = mid;
      else hi = mid;
    }
    transitions.push({ at: hi, from: a, to: b });
  }
  if (!transitions.length) {
    const off = fmtOffset(offsetAt(Date.UTC(year, 0, 1)));
    lines.push('BEGIN:STANDARD', 'DTSTART:19700101T000000', `TZOFFSETFROM:${off}`, `TZOFFSETTO:${off}`, 'END:STANDARD');
  }
  for (const t of transitions) {
    // The rule is written on the clock as it reads just before the change.
    const wall = new Date(t.at + t.from * 60000);
    const month = wall.getUTCMonth();
    const day = wall.getUTCDate();
    const wd = wall.getUTCDay();
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const nth = day + 7 > daysInMonth ? -1 : Math.ceil(day / 7);
    const first = nthWeekdayOfMonth(1970, month, wd, nth);
    const kind = t.to > t.from ? 'DAYLIGHT' : 'STANDARD';
    lines.push(
      `BEGIN:${kind}`,
      `DTSTART:1970${pad(month + 1)}${pad(first?.getDate() ?? day)}T${pad(wall.getUTCHours())}${pad(wall.getUTCMinutes())}00`,
      `RRULE:FREQ=YEARLY;BYMONTH=${month + 1};BYDAY=${nth}${ICS_DAYS[wd]}`,
      `TZOFFSETFROM:${fmtOffset(t.from)}`,
      `TZOFFSETTO:${fmtOffset(t.to)}`,
      `END:${kind}`,
    );
  }
  lines.push('END:VTIMEZONE');
  return lines;
}

export interface IcsExportOptions {
  /** Calendar name shown by the app that opens the file */
  name?: string;
  /** IANA zone the wall-clock times are in (this device's). Without it, times are "floating". */
  tz?: string;
  calendars: CalendarCategory[];
  /** Used to write the default alert for events that follow it */
  settings?: Pick<Settings, 'alertDefault' | 'allDayAlertDefault'>;
  /** To-dos on the calendar, written as events (used by the subscription feed) */
  tasks?: Task[];
  now?: Date;
}

export function buildIcs(events: CalEvent[], opts: IcsExportOptions): string {
  const now = opts.now ?? new Date();
  const tz = opts.tz;
  const stamp = icsUtc(now.getTime());
  const tagName = new Map(opts.calendars.map((c) => [c.id, c.name]));
  const out: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Daybook//Daybook Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];
  if (opts.name) out.push(`X-WR-CALNAME:${escapeText(opts.name)}`);
  if (tz) out.push(`X-WR-TIMEZONE:${tz}`);
  const scheduled = (opts.tasks ?? []).filter((t) => t.scheduledStart && t.status !== 'done');
  if (tz && (events.some((e) => !e.allDay) || scheduled.length)) out.push(...vtimezone(tz, now.getFullYear()));

  const timeProp = (name: string, wall: string) => (tz ? `${name};TZID=${tz}:${icsWall(wall)}` : `${name}:${icsWall(wall)}`);

  for (const ev of events) {
    const { start, end } = eventBounds(ev);
    out.push('BEGIN:VEVENT', `UID:${escapeText(ev.icsUid ?? `${ev.id}@daybook`)}`, `DTSTAMP:${stamp}`);
    if (ev.createdAt) out.push(`CREATED:${icsUtc(ev.createdAt)}`);
    if (ev.updatedAt) out.push(`LAST-MODIFIED:${icsUtc(ev.updatedAt)}`);
    if (ev.allDay) {
      out.push(`DTSTART;VALUE=DATE:${icsDate(toDateKey(start))}`, `DTEND;VALUE=DATE:${icsDate(toDateKey(end))}`);
    } else {
      out.push(timeProp('DTSTART', toLocalISO(start)), timeProp('DTEND', toLocalISO(end)));
    }
    out.push(`SUMMARY:${escapeText(ev.title)}`);
    if (ev.location) out.push(`LOCATION:${escapeText(ev.location)}`);
    if (ev.notes) out.push(`DESCRIPTION:${escapeText(ev.notes)}`);
    const tag = tagName.get(ev.calendarId);
    if (tag) out.push(`CATEGORIES:${escapeText(tag)}`);

    const r = ev.recurrence;
    if (r) {
      const rule = [`FREQ=${r.freq.toUpperCase()}`];
      if (r.interval > 1) rule.push(`INTERVAL=${r.interval}`);
      if (r.freq === 'weekly' && r.byWeekday?.length) rule.push(`BYDAY=${[...r.byWeekday].sort().map((d) => ICS_DAYS[d]).join(',')}`);
      if (r.freq === 'monthly' && r.nth && r.byWeekday?.length) rule.push(`BYDAY=${r.nth}${ICS_DAYS[r.byWeekday[0]]}`);
      if (r.until) {
        if (ev.allDay) rule.push(`UNTIL=${icsDate(r.until)}`);
        else if (tz) {
          const [y, mo, d] = r.until.split('-').map(Number);
          rule.push(`UNTIL=${icsUtc(zonedToInstant(tz, y, mo - 1, d, 23, 59, 59))}`);
        } else rule.push(`UNTIL=${icsDate(r.until)}T235959`);
      }
      out.push(`RRULE:${rule.join(';')}`);
      const ex = ev.exdates ?? [];
      if (ex.length) {
        if (ev.allDay) out.push(`EXDATE;VALUE=DATE:${ex.map(icsDate).join(',')}`);
        else {
          const time = toLocalISO(start).slice(10);
          const values = ex.map((k) => icsWall(k + time)).join(',');
          out.push(tz ? `EXDATE;TZID=${tz}:${values}` : `EXDATE:${values}`);
        }
      }
    }

    const alerts = opts.settings ? eventAlerts(ev, opts.settings) : (ev.reminders ?? []);
    for (const m of alerts) {
      out.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeText(ev.title)}`, `TRIGGER:${icsDuration(-m)}`, 'END:VALARM');
    }
    out.push('END:VEVENT');
  }

  for (const t of scheduled) {
    const b = taskBounds(t)!;
    out.push(
      'BEGIN:VEVENT',
      `UID:task-${t.id}@daybook`,
      `DTSTAMP:${stamp}`,
      timeProp('DTSTART', toLocalISO(b.start)),
      timeProp('DTEND', toLocalISO(b.end)),
      `SUMMARY:${escapeText(t.title)}`,
      'CATEGORIES:To-do',
    );
    if (t.notes) out.push(`DESCRIPTION:${escapeText(t.notes)}`);
    out.push('END:VEVENT');
  }

  out.push('END:VCALENDAR');
  return out.map(fold).join('\r\n') + '\r\n';
}

/** A file name from a title: "Team stand-up" → "team-stand-up.ics" */
export function icsFileName(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60);
  return `${slug || 'event'}.ics`;
}

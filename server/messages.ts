/**
 * The text of the bot's messages. Dates here are wall-clock times in the
 * user's zone (the server runs in UTC, so local getters read them directly).
 */
import { addDays, differenceInCalendarDays, format } from 'date-fns';
import type { CalEvent, Settings, Task } from '../src/types';
import type { DueAlert } from '../src/lib/reminders';
import { expandEvents } from '../src/lib/recurrence';
import { taskBounds } from '../src/lib/schedule';
import { fmtTime } from '../src/lib/dates';

type TF = Settings['timeFormat'];

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Today / Tomorrow / Friday / Fri 13 Nov */
export function dayWord(d: Date, now: Date): string {
  const diff = differenceInCalendarDays(d, now);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff > 1 && diff < 7) return format(d, 'EEEE');
  return format(d, 'EEE d MMM');
}

const span = (a: Date, b: Date, tf: TF) => `${fmtTime(a, tf)}–${fmtTime(b, tf)}`;

function lead(start: Date, now: Date): string {
  const mins = Math.round((start.getTime() - now.getTime()) / 60000);
  if (mins <= 0) return 'Now';
  if (mins < 60) return `In ${mins} min`;
  if (differenceInCalendarDays(start, now) === 0) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? `In ${h} h ${m} min` : `In ${h} hour${h === 1 ? '' : 's'}`;
  }
  return dayWord(start, now);
}

export function alertText(a: DueAlert, now: Date, tf: TF): string {
  const title = `<b>${esc(a.title)}</b>`;
  if (a.kind === 'task') return `☑️ ${title}\nPlanned to-do · ${span(a.start, a.end, tf)}`;
  if (a.allDay) return `🔔 ${title}\n${dayWord(a.start, now)} · all day`;
  let text = `🔔 ${title}\n${lead(a.start, now)} · ${span(a.start, a.end, tf)}`;
  if (a.location) text += `\n📍 ${esc(a.location)}`;
  return text;
}

/** One day: all-day events, then timed events and planned to-dos in order, then how many to-dos are open. */
export function agendaText(events: CalEvent[], tasks: Task[], tf: TF, day: Date, heading: string): string {
  const next = addDays(day, 1);
  const occ = expandEvents(events, day, next);
  const lines: string[] = [];
  for (const o of occ) if (o.event.allDay) lines.push(`All day · ${esc(o.event.title)}`);
  const timed: { at: number; line: string }[] = [];
  for (const o of occ) {
    if (o.event.allDay) continue;
    const when = o.start < day ? `…–${fmtTime(o.end, tf)}` : span(o.start, o.end, tf);
    const place = o.event.location ? ` · <i>${esc(o.event.location)}</i>` : '';
    timed.push({ at: o.start.getTime(), line: `${when} · ${esc(o.event.title)}${place}` });
  }
  for (const t of tasks) {
    const b = taskBounds(t);
    if (!b || b.start >= next || b.end <= day) continue;
    timed.push({ at: b.start.getTime(), line: `${span(b.start, b.end, tf)} · ${t.status === 'done' ? '☑︎' : '☐'} ${esc(t.title)}` });
  }
  timed.sort((a, b) => a.at - b.at);
  lines.push(...timed.map((x) => x.line));

  const doing = tasks.filter((t) => t.status === 'in_progress').length;
  const open = tasks.filter((t) => t.status === 'todo').length;
  const counts = [doing && `${doing} in progress`, open && `${open} to-do${open === 1 ? '' : 's'} not started`].filter(Boolean);
  return `<b>${esc(heading)}</b>\n\n${lines.length ? lines.join('\n') : 'Nothing on your calendar.'}${counts.length ? `\n\n${counts.join(', ')}.` : ''}`;
}

/** The next timed event or planned to-do after `now`, within 60 days. */
export function nextText(events: CalEvent[], tasks: Task[], tf: TF, now: Date): string {
  type Item = { start: Date; end: Date; title: string; location?: string; todo: boolean };
  const candidates: Item[] = [];
  // Occurrences come sorted by start, so the first timed one after now is the next event.
  const occ = expandEvents(events, now, addDays(now, 60)).find((o) => !o.event.allDay && o.start >= now);
  if (occ) candidates.push({ start: occ.start, end: occ.end, title: occ.event.title, location: occ.event.location, todo: false });
  for (const t of tasks) {
    const b = taskBounds(t);
    if (b && t.status !== 'done' && b.start >= now) candidates.push({ ...b, title: t.title, todo: true });
  }
  const best = candidates.sort((a, b) => a.start.getTime() - b.start.getTime())[0];
  if (!best) return 'Nothing coming up in the next 60 days.';
  let text = `Next: <b>${esc(best.title)}</b>${best.todo ? ' (to-do)' : ''}\n${lead(best.start, now)} · ${span(best.start, best.end, tf)}`;
  if (best.location) text += `\n📍 ${esc(best.location)}`;
  return text;
}

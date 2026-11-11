import { addYears, startOfDay } from 'date-fns';
import type { CalEvent, Task } from '../types';
import { eventBounds, expandEvents, type Occurrence } from './recurrence';

export interface EventHit {
  event: CalEvent;
  /** The next occurrence, or the first one when the event is over */
  start: Date;
  end: Date;
  dateKey: string;
  occurrence: Occurrence | null;
  upcoming: boolean;
}

const termsOf = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean);
const matches = (terms: string[], ...fields: (string | undefined)[]) => {
  const hay = fields.filter(Boolean).join(' ').toLowerCase();
  return terms.every((t) => hay.includes(t));
};

/** Events whose title, place or notes contain every word, coming up first (soonest first), then past ones (latest first). */
export function searchEvents(events: CalEvent[], q: string, now = new Date(), limit = 40): EventHit[] {
  const terms = termsOf(q);
  if (!terms.length) return [];
  const from = startOfDay(now);
  const hits: EventHit[] = [];
  for (const ev of events) {
    if (!matches(terms, ev.title, ev.location, ev.notes)) continue;
    let occ: Occurrence | null = null;
    if (ev.recurrence) occ = expandEvents([ev], from, addYears(from, 2)).find((o) => o.end > now) ?? null;
    const b = occ ?? eventBounds(ev);
    hits.push({
      event: ev,
      start: b.start,
      end: b.end,
      dateKey: occ?.dateKey ?? ev.start.slice(0, 10),
      occurrence: occ,
      upcoming: b.end > now,
    });
  }
  hits.sort((a, b) => {
    if (a.upcoming !== b.upcoming) return a.upcoming ? -1 : 1;
    return a.upcoming ? a.start.getTime() - b.start.getTime() : b.start.getTime() - a.start.getTime();
  });
  return hits.slice(0, limit);
}

/** To-dos whose title or notes contain every word: open ones first, newest first. */
export function searchTasks(tasks: Task[], q: string, limit = 30): Task[] {
  const terms = termsOf(q);
  if (!terms.length) return [];
  return tasks
    .filter((t) => matches(terms, t.title, t.notes))
    .sort((a, b) => Number(a.status === 'done') - Number(b.status === 'done') || b.createdAt - a.createdAt)
    .slice(0, limit);
}

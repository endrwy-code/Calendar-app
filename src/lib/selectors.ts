import { addDays, startOfDay } from 'date-fns';
import type { CalEvent, CalendarCategory, Task, TaskStatus } from '../types';
import { parseLocal, toLocalISO } from './dates';
import { expandEvents, type Occurrence } from './recurrence';
import { findFreeSlot, taskBounds, type Interval } from './schedule';

export function visibleEvents(events: CalEvent[], calendars: CalendarCategory[]): CalEvent[] {
  const hidden = new Set(calendars.filter((c) => !c.visible).map((c) => c.id));
  return hidden.size ? events.filter((e) => !hidden.has(e.calendarId)) : events;
}

/** Open to-dos newest first (the composer is at the top); done ones by completion, newest first. */
export function orderTodos(tasks: Task[]): Record<TaskStatus, Task[]> {
  const out: Record<TaskStatus, Task[]> = { todo: [], in_progress: [], done: [] };
  for (const t of tasks) out[t.status].push(t);
  out.todo.sort((a, b) => b.createdAt - a.createdAt);
  out.in_progress.sort((a, b) => b.createdAt - a.createdAt);
  out.done.sort((a, b) => (b.completedAt ?? b.updatedAt) - (a.completedAt ?? a.updatedAt));
  return out;
}

/** Busy intervals from timed events and scheduled tasks between two dates. */
export function busyIntervals(
  events: CalEvent[],
  tasks: Task[],
  from: Date,
  to: Date,
  excludeTaskId?: string,
): Interval[] {
  const occ = expandEvents(events, from, to).filter((o) => !o.event.allDay);
  const busy: Interval[] = occ.map((o) => ({ start: o.start, end: o.end }));
  for (const t of tasks) {
    if (t.id === excludeTaskId || t.status === 'done') continue;
    const b = taskBounds(t);
    if (b && b.end > from && b.start < to) busy.push(b);
  }
  return busy;
}

/**
 * Up to `count` suggested start times for a to-do, each on a different day:
 * the next free slot from now, then the first free slot on each following day.
 */
export function suggestSlots(
  task: Pick<Task, 'id' | 'durationMin'>,
  events: CalEvent[],
  tasks: Task[],
  dayStartHour: number,
  dayEndHour: number,
  count = 3,
  now = new Date(),
): string[] {
  const to = addDays(startOfDay(now), 15);
  const busy = busyIntervals(events, tasks, startOfDay(now), to, task.id);
  const out: string[] = [];
  let from = now;
  for (let i = 0; i < count; i++) {
    const slot = findFreeSlot({ busy, from, durationMin: task.durationMin || 30, dayStartHour, dayEndHour });
    if (!slot) break;
    out.push(toLocalISO(slot));
    from = addDays(startOfDay(slot), 1);
  }
  return out;
}

/** Earliest free slot for a task, starting now (or at the start of `fromDay` if later). */
export function suggestSlot(
  task: Pick<Task, 'id' | 'durationMin'>,
  events: CalEvent[],
  tasks: Task[],
  dayStartHour: number,
  dayEndHour: number,
  fromDay?: string,
): string | null {
  const now = new Date();
  let from = now;
  if (fromDay) {
    const d = parseLocal(fromDay);
    if (d > now) from = d;
  }
  const to = addDays(startOfDay(from), 15);
  const busy = busyIntervals(events, tasks, startOfDay(from), to, task.id);
  const slot = findFreeSlot({
    busy,
    from,
    durationMin: task.durationMin || 30,
    dayStartHour,
    dayEndHour,
  });
  return slot ? toLocalISO(slot) : null;
}

export type DayItem =
  | { kind: 'event'; key: string; start: Date; end: Date; occ: Occurrence }
  | { kind: 'task'; key: string; start: Date; end: Date; task: Task };

/** Timed events + scheduled to-dos for one day, in order. */
export function dayAgenda(occ: Occurrence[], tasks: Task[], dateKey: string): DayItem[] {
  const dayStart = parseLocal(dateKey);
  const dayEnd = addDays(dayStart, 1);
  const items: DayItem[] = [];
  for (const o of occ) {
    if (o.event.allDay) continue;
    if (o.start < dayEnd && o.end > dayStart) items.push({ kind: 'event', key: o.key, start: o.start, end: o.end, occ: o });
  }
  for (const t of tasks) {
    const b = taskBounds(t);
    if (b && b.start < dayEnd && b.end > dayStart) items.push({ kind: 'task', key: `t:${t.id}`, start: b.start, end: b.end, task: t });
  }
  return items.sort((a, b) => a.start.getTime() - b.start.getTime());
}

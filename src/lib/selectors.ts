import { addDays, startOfDay } from 'date-fns';
import type { CalEvent, CalendarCategory, Task, TaskStatus } from '../types';
import { parseLocal, toDateKey, toLocalISO } from './dates';
import { expandEvents, type Occurrence } from './recurrence';
import { findFreeSlot, taskBounds, type Interval } from './schedule';

export function visibleEvents(events: CalEvent[], calendars: CalendarCategory[]): CalEvent[] {
  const hidden = new Set(calendars.filter((c) => !c.visible).map((c) => c.id));
  return hidden.size ? events.filter((e) => !hidden.has(e.calendarId)) : events;
}

export function isTaskVisible(task: Task, calendars: CalendarCategory[]): boolean {
  if (!task.calendarId) return true;
  const c = calendars.find((x) => x.id === task.calendarId);
  return !c || c.visible;
}

export function countByStatus(tasks: Task[]): Record<TaskStatus, number> {
  const out: Record<TaskStatus, number> = { todo: 0, in_progress: 0, done: 0 };
  for (const t of tasks) out[t.status]++;
  return out;
}

const PRIORITY_RANK = { high: 0, medium: 1, low: 2, none: 3 } as const;

/** Open tasks first by priority, then by due date, then newest. Done tasks by completion time. */
export function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    if (a.status === 'done' && b.status === 'done') return (b.completedAt ?? 0) - (a.completedAt ?? 0);
    const p = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (p) return p;
    const ad = a.dueDate ?? a.scheduledStart?.slice(0, 10) ?? '9999';
    const bd = b.dueDate ?? b.scheduledStart?.slice(0, 10) ?? '9999';
    if (ad !== bd) return ad < bd ? -1 : 1;
    return b.createdAt - a.createdAt;
  });
}

/** Tasks scheduled within a day (time-blocked). */
export function scheduledTasksOn(tasks: Task[], dateKey: string): Task[] {
  return tasks.filter((t) => t.scheduledStart?.startsWith(dateKey));
}

/** Tasks due that day that have no time block (shown in the all-day row). */
export function dueTasksOn(tasks: Task[], dateKey: string): Task[] {
  return tasks.filter((t) => !t.scheduledStart && t.dueDate === dateKey);
}

export function isOverdue(t: Task, today = toDateKey(new Date())): boolean {
  return t.status !== 'done' && !!t.dueDate && t.dueDate < today;
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

/** Timed events + scheduled tasks for one day, in order. */
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

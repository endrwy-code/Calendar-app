import { addDays, startOfDay } from 'date-fns';
import type { Task } from '../types';
import { parseLocal, roundUpToStep } from './dates';

export interface Interval {
  start: Date;
  end: Date;
}

export function taskBounds(task: Task): Interval | null {
  if (!task.scheduledStart) return null;
  const start = parseLocal(task.scheduledStart);
  return { start, end: new Date(start.getTime() + Math.max(5, task.durationMin) * 60000) };
}

/** Sorts and merges overlapping intervals. */
export function mergeIntervals(list: Interval[]): Interval[] {
  const sorted = [...list].sort((a, b) => a.start.getTime() - b.start.getTime());
  const out: Interval[] = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv.start.getTime() <= last.end.getTime()) {
      if (iv.end > last.end) last.end = new Date(iv.end);
    } else {
      out.push({ start: new Date(iv.start), end: new Date(iv.end) });
    }
  }
  return out;
}

/** Free gaps of at least `minMinutes` inside [windowStart, windowEnd). */
export function freeGaps(
  busy: Interval[],
  windowStart: Date,
  windowEnd: Date,
  minMinutes = 15,
): Interval[] {
  const merged = mergeIntervals(
    busy.filter((b) => b.end > windowStart && b.start < windowEnd),
  );
  const gaps: Interval[] = [];
  let cursor = windowStart;
  for (const b of merged) {
    if (b.start > cursor) gaps.push({ start: cursor, end: b.start < windowEnd ? b.start : windowEnd });
    if (b.end > cursor) cursor = b.end;
    if (cursor >= windowEnd) break;
  }
  if (cursor < windowEnd) gaps.push({ start: cursor, end: windowEnd });
  return gaps.filter((g) => (g.end.getTime() - g.start.getTime()) / 60000 >= minMinutes);
}

/**
 * Finds the earliest start ≥ `from` where `durationMin` fits between busy
 * intervals, within daily working hours, looking ahead `days` days.
 */
export function findFreeSlot(opts: {
  busy: Interval[];
  from: Date;
  durationMin: number;
  dayStartHour: number;
  dayEndHour: number;
  days?: number;
  stepMin?: number;
}): Date | null {
  const { busy, from, durationMin, dayStartHour, dayEndHour, days = 14, stepMin = 15 } = opts;
  const endHour = Math.max(dayEndHour, dayStartHour + 1);
  for (let i = 0; i < days; i++) {
    const day = addDays(startOfDay(from), i);
    const dayStart = new Date(day);
    dayStart.setHours(dayStartHour, 0, 0, 0);
    const dayEnd = new Date(day);
    dayEnd.setHours(Math.min(endHour, 24), 0, 0, 0);
    let windowStart = dayStart;
    if (from > windowStart) windowStart = roundUpToStep(from, stepMin);
    if (windowStart >= dayEnd) continue;
    for (const gap of freeGaps(busy, windowStart, dayEnd, durationMin)) {
      const start = roundUpToStep(gap.start, stepMin);
      if (start.getTime() + durationMin * 60000 <= gap.end.getTime()) return start;
    }
  }
  return null;
}

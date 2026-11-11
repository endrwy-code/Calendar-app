import { describe, expect, it } from 'vitest';
import { alertLabel, alertsBetween } from '../reminders';
import { tzOffset, wallClock, zonedToInstant, resolveTimeZone } from '../tz';
import type { CalEvent, Task } from '../../types';

const ev = (p: Partial<CalEvent>): CalEvent => ({
  id: 'e',
  title: 'Stand-up',
  calendarId: 'c',
  start: '2026-11-11T09:30',
  end: '2026-11-11T10:00',
  allDay: false,
  createdAt: 0,
  updatedAt: 0,
  ...p,
});
const settings = { alertDefault: 10, allDayAlertDefault: -540, todoAlerts: true };
const at = (s: string) => new Date(s);

describe('alertsBetween', () => {
  it('uses the default alert unless the event has its own', () => {
    const due = alertsBetween([ev({}), ev({ id: 'own', reminders: [30] }), ev({ id: 'none', reminders: [] })], [], settings, at('2026-11-11T08:00'), at('2026-11-11T09:25'));
    expect(due.map((d) => `${d.key}`)).toEqual(['e:own:2026-11-11T09:30:30', 'e:e:2026-11-11T09:30:10']);
  });

  it('fires all-day alerts at 09:00 on the day', () => {
    const due = alertsBetween([ev({ id: 'ad', allDay: true, start: '2026-11-12', end: '2026-11-12' })], [], settings, at('2026-11-12T08:59'), at('2026-11-12T09:00'));
    expect(due).toHaveLength(1);
    expect(due[0].minutesBefore).toBe(-540);
  });

  it('includes each occurrence of a repeating event once', () => {
    const daily = ev({ recurrence: { freq: 'daily', interval: 1 } });
    const due = alertsBetween([daily], [], settings, at('2026-11-11T00:00'), at('2026-11-14T00:00'));
    expect(due.map((d) => d.start.getDate())).toEqual([11, 12, 13]);
  });

  it('reminds when a planned to-do starts, unless it is done', () => {
    const t = (p: Partial<Task>): Task => ({
      id: 't',
      title: 'Write report',
      status: 'todo',
      priority: 'none',
      durationMin: 30,
      subtasks: [],
      scheduledStart: '2026-11-11T14:00',
      createdAt: 0,
      updatedAt: 0,
      ...p,
    });
    const from = at('2026-11-11T13:59');
    const to = at('2026-11-11T14:00');
    expect(alertsBetween([], [t({})], settings, from, to)).toHaveLength(1);
    expect(alertsBetween([], [t({ status: 'done' })], settings, from, to)).toHaveLength(0);
    expect(alertsBetween([], [t({})], { ...settings, todoAlerts: false }, from, to)).toHaveLength(0);
  });
});

describe('alertLabel', () => {
  it('names common and unusual alerts', () => {
    expect(alertLabel(10, false)).toBe('10 min before');
    expect(alertLabel(-540, true)).toBe('On the day (09:00)');
    expect(alertLabel(180, false)).toBe('3 hours before');
  });
});

describe('time zones', () => {
  it('knows offsets across daylight saving', () => {
    expect(tzOffset('Europe/London', Date.UTC(2026, 0, 15))).toBe(0);
    expect(tzOffset('Europe/London', Date.UTC(2026, 6, 15))).toBe(60);
    expect(tzOffset('Asia/Singapore', Date.UTC(2026, 6, 15))).toBe(480);
  });

  it('converts wall clocks to instants and back', () => {
    const ms = zonedToInstant('America/New_York', 2026, 2, 8, 12, 0); // the day the clocks change
    expect(new Date(ms).toISOString()).toBe('2026-03-08T16:00:00.000Z');
    expect(wallClock('America/New_York', ms).toISOString()).toBe('2026-03-08T12:00:00.000Z');
  });

  it('resolves zone ids from other apps', () => {
    expect(resolveTimeZone('Europe/London')).toBe('Europe/London');
    expect(resolveTimeZone('GMT Standard Time')).toBe('Europe/London');
    expect(resolveTimeZone('/mozilla.org/20050126_1/Asia/Singapore')).toBe('Asia/Singapore');
    expect(resolveTimeZone('Not a zone')).toBeNull();
  });
});

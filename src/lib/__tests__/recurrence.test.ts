import { describe, expect, it } from 'vitest';
import { expandEvents } from '../recurrence';
import type { CalEvent } from '../../types';

const base = (p: Partial<CalEvent>): CalEvent => ({
  id: 'e1',
  title: 'Test',
  calendarId: 'c',
  start: '2026-11-02T09:30',
  end: '2026-11-02T10:00',
  allDay: false,
  createdAt: 0,
  updatedAt: 0,
  ...p,
});

const range = (a: string, b: string) => [new Date(a + 'T00:00'), new Date(b + 'T00:00')] as const;

describe('expandEvents', () => {
  it('returns a single event inside the range', () => {
    const [s, e] = range('2026-11-01', '2026-11-08');
    const occ = expandEvents([base({})], s, e);
    expect(occ).toHaveLength(1);
    expect(occ[0].dateKey).toBe('2026-11-02');
  });

  it('expands weekday-only weekly rules', () => {
    const ev = base({ recurrence: { freq: 'weekly', interval: 1, byWeekday: [1, 2, 3, 4, 5] } });
    const [s, e] = range('2026-11-02', '2026-11-16');
    const keys = expandEvents([ev], s, e).map((o) => o.dateKey);
    expect(keys).toEqual([
      '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06',
      '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13',
    ]);
  });

  it('respects exdates and until', () => {
    const ev = base({
      recurrence: { freq: 'daily', interval: 1, until: '2026-11-05' },
      exdates: ['2026-11-03'],
    });
    const [s, e] = range('2026-11-01', '2026-11-30');
    expect(expandEvents([ev], s, e).map((o) => o.dateKey)).toEqual(['2026-11-02', '2026-11-04', '2026-11-05']);
  });

  it('jumps ahead efficiently for far-future ranges', () => {
    const ev = base({ recurrence: { freq: 'daily', interval: 2 } });
    const [s, e] = range('2030-01-01', '2030-01-07');
    const occ = expandEvents([ev], s, e);
    expect(occ.length).toBe(3);
    for (const o of occ) expect(o.start.getHours()).toBe(9);
  });

  it('skips months without the day for monthly rules', () => {
    const ev = base({ start: '2026-01-31T08:00', end: '2026-01-31T09:00', recurrence: { freq: 'monthly', interval: 1 } });
    const [s, e] = range('2026-01-01', '2026-06-01');
    expect(expandEvents([ev], s, e).map((o) => o.dateKey)).toEqual(['2026-01-31', '2026-03-31', '2026-05-31']);
  });

  it('includes multi-day all-day events that started before the range', () => {
    const ev = base({ allDay: true, start: '2026-11-01', end: '2026-11-03' });
    const [s, e] = range('2026-11-02', '2026-11-09');
    const occ = expandEvents([ev], s, e);
    expect(occ).toHaveLength(1);
    expect(occ[0].end.getDate()).toBe(4);
  });
});

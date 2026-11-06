import { describe, expect, it } from 'vitest';
import { findFreeSlot, freeGaps, mergeIntervals } from '../schedule';
import { layoutDay } from '../layout';

const at = (s: string) => new Date(s);

describe('free time', () => {
  const busy = [
    { start: at('2026-11-06T09:00'), end: at('2026-11-06T10:00') },
    { start: at('2026-11-06T09:30'), end: at('2026-11-06T11:00') },
    { start: at('2026-11-06T12:00'), end: at('2026-11-06T13:00') },
  ];

  it('merges overlapping intervals', () => {
    expect(mergeIntervals(busy)).toHaveLength(2);
  });

  it('finds gaps between busy blocks', () => {
    const gaps = freeGaps(busy, at('2026-11-06T08:00'), at('2026-11-06T14:00'), 30);
    expect(gaps.map((g) => [g.start.getHours(), g.end.getHours()])).toEqual([
      [8, 9],
      [11, 12],
      [13, 14],
    ]);
  });

  it('places a task in the first gap that fits', () => {
    const slot = findFreeSlot({ busy, from: at('2026-11-06T08:40'), durationMin: 45, dayStartHour: 8, dayEndHour: 22 });
    expect(slot?.getHours()).toBe(11);
    expect(slot?.getMinutes()).toBe(0);
  });

  it('rolls over to the next day when today is full', () => {
    const slot = findFreeSlot({ busy: [], from: at('2026-11-06T21:50'), durationMin: 30, dayStartHour: 8, dayEndHour: 22 });
    expect(slot?.getDate()).toBe(7);
    expect(slot?.getHours()).toBe(8);
  });
});

describe('layoutDay', () => {
  it('puts overlapping items side by side and lets free items span', () => {
    const out = layoutDay([
      { id: 'a', startMin: 540, endMin: 600 },
      { id: 'b', startMin: 570, endMin: 630 },
      { id: 'c', startMin: 700, endMin: 760 },
    ]);
    const byId = Object.fromEntries(out.map((o) => [o.id, o]));
    expect(byId.a.cols).toBe(2);
    expect(byId.b.col).toBe(1);
    expect(byId.c.cols).toBe(1);
    expect(byId.c.span).toBe(1);
  });
});

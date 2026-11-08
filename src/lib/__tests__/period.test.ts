import { describe, expect, it } from 'vitest';
import { pageContains, periodTitle, shiftCursor } from '../period';

describe('shiftCursor', () => {
  it('moves by the page size of each view', () => {
    expect(shiftCursor('day', '2026-11-08', 1)).toBe('2026-11-09');
    expect(shiftCursor('3day', '2026-11-08', -1)).toBe('2026-11-05');
    expect(shiftCursor('week', '2026-11-08', 1)).toBe('2026-11-15');
    expect(shiftCursor('month', '2026-01-31', 1)).toBe('2026-02-28');
  });
});

describe('pageContains', () => {
  it('knows which dates are on the visible page', () => {
    // Week of Mon 2 – Sun 8 Nov 2026
    expect(pageContains('week', '2026-11-04', '2026-11-08', 1)).toBe(true);
    expect(pageContains('week', '2026-11-04', '2026-11-09', 1)).toBe(false);
    expect(pageContains('month', '2026-11-20', '2026-11-01', 1)).toBe(true);
    expect(pageContains('day', '2026-11-08', '2026-11-08', 1)).toBe(true);
  });
});

describe('periodTitle', () => {
  const now = new Date(2026, 10, 8);
  it('shows the month, or a range when a week spans two', () => {
    expect(periodTitle('week', '2026-11-04', 1, now)).toEqual({ main: 'November', year: null });
    expect(periodTitle('week', '2026-11-30', 1, now)).toEqual({ main: 'Nov – Dec', year: null });
  });
  it('adds the year when it is not this year', () => {
    expect(periodTitle('month', '2027-02-10', 1, now)).toEqual({ main: 'February', year: '2027' });
  });
});

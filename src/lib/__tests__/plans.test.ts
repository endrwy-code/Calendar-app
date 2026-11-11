import { describe, expect, it } from 'vitest';
import { describeWhen, normalizePlans, planToEvent, planToTask, redactContacts, type PlanItem } from '../plans';
import { expandEvents } from '../recurrence';
import type { CalEvent } from '../../types';

const item = (p: Partial<PlanItem>): PlanItem => ({
  kind: 'event',
  title: 'Briefing',
  date: '2026-11-14',
  endDate: null,
  startTime: '10:00',
  endTime: '12:00',
  location: null,
  notes: null,
  tagId: null,
  repeat: null,
  assumption: null,
  ...p,
});

describe('normalizePlans', () => {
  it('keeps well-formed plans and drops junk', () => {
    const out = normalizePlans(
      [
        { kind: 'event', title: '  Youth   camp ', date: '2026-11-27', endDate: '2026-11-29', startTime: null, endTime: null, location: 'Changi', notes: null, tagId: 'church', repeat: null, assumption: null },
        { kind: 'event', title: '', date: '2026-11-27' },
        { kind: 'party', title: 'Bad kind', date: '2026-02-30', startTime: '25:00' },
        'nonsense',
      ],
      ['church'],
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ title: 'Youth camp', endDate: '2026-11-29', tagId: 'church', startTime: null });
    // An invalid date turns an event into a to-do, and says so
    expect(out[1]).toMatchObject({ kind: 'todo', title: 'Bad kind', date: null, startTime: null });
    expect(out[1].assumption).toMatch(/No date/);
  });

  it('only keeps tags the person has, and repeats on events', () => {
    const out = normalizePlans(
      [
        { kind: 'event', title: 'A', date: '2026-11-14', tagId: 'made-up', repeat: { freq: 'weekly', interval: 0, byWeekday: [6, 6, 9], nth: 2, until: '2026-10-01' } },
        { kind: 'todo', title: 'B', repeat: { freq: 'daily', interval: 1, byWeekday: [], nth: null, until: null } },
      ],
      ['church'],
    );
    expect(out[0].tagId).toBeNull();
    expect(out[0].repeat).toEqual({ freq: 'weekly', interval: 1, byWeekday: [6], nth: null, until: null });
    expect(out[1].repeat).toBeNull();
  });
});

describe('planToEvent', () => {
  const opts = { defaultMinutes: 60, fallbackTag: 'personal' };

  it('makes timed, overnight and all-day events', () => {
    expect(planToEvent(item({}), opts)).toMatchObject({ allDay: false, start: '2026-11-14T10:00', end: '2026-11-14T12:00', calendarId: 'personal' });
    expect(planToEvent(item({ startTime: '22:00', endTime: '01:00' }), opts)).toMatchObject({ start: '2026-11-14T22:00', end: '2026-11-15T01:00' });
    expect(planToEvent(item({ endTime: null }), opts)).toMatchObject({ end: '2026-11-14T11:00' });
    expect(planToEvent(item({ startTime: null, endTime: null, endDate: '2026-11-16' }), opts)).toMatchObject({ allDay: true, start: '2026-11-14', end: '2026-11-16' });
  });

  it('repeats monthly on the first Sunday', () => {
    const ev = planToEvent(item({ date: '2026-12-06', repeat: { freq: 'monthly', interval: 1, byWeekday: [], nth: 1, until: null } }), opts);
    expect(ev.recurrence).toMatchObject({ freq: 'monthly', nth: 1, byWeekday: [0] });
    const full = { ...ev, id: 'x', createdAt: 0, updatedAt: 0 } as CalEvent;
    const days = expandEvents([full], new Date(2026, 11, 1), new Date(2027, 2, 1)).map((o) => o.dateKey);
    expect(days).toEqual(['2026-12-06', '2027-01-03', '2027-02-07']);
  });
});

describe('planToTask', () => {
  it('plans a to-do with a time, and notes a deadline without one', () => {
    expect(planToTask(item({ kind: 'todo', startTime: '14:00', endTime: '15:30' }))).toMatchObject({ scheduledStart: '2026-11-14T14:00', durationMin: 90 });
    const due = planToTask(item({ kind: 'todo', startTime: null, endTime: null, notes: 'Signed by parents' }));
    expect(due.scheduledStart).toBeNull();
    expect(due.notes).toBe('By Sat 14 Nov 2026\nSigned by parents');
  });
});

describe('describeWhen', () => {
  const now = new Date(2026, 10, 11);
  it('reads like a calendar line', () => {
    expect(describeWhen(item({}), '24h', now)).toBe('Sat 14 Nov · 10:00–12:00');
    expect(describeWhen(item({ startTime: null, endTime: null, endDate: '2026-11-16' }), '24h', now)).toBe('Sat 14 Nov – Mon 16 Nov · all day');
    expect(describeWhen(item({ kind: 'todo', startTime: null, endTime: null }), '24h', now)).toBe('To-do · by Sat 14 Nov');
    expect(describeWhen(item({ repeat: { freq: 'weekly', interval: 1, byWeekday: [2], nth: null, until: null } }), '12h', now)).toBe('Sat 14 Nov · 10 am–12 pm · Every week on Tue');
  });
});

describe('redactContacts', () => {
  it('removes contact details but keeps dates and times', () => {
    const text = 'Call Jo at +65 9123 4567 or 8123-4567, mail jo.tan@example.org. NRIC S1234567D. Meet 14/11 1300-1600, 2026-11-14, 7-9pm, Level 3, S123456.';
    expect(redactContacts(text)).toBe('Call Jo at [phone] or [phone], mail [email]. NRIC [ID number]. Meet 14/11 1300-1600, 2026-11-14, 7-9pm, Level 3, S123456.');
  });
});

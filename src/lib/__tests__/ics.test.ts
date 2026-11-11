import { describe, expect, it } from 'vitest';
import { buildIcs, parseDuration, parseIcs } from '../ics';
import { expandEvents } from '../recurrence';
import type { CalEvent } from '../../types';

const cal = (body: string, head = '') =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Test//EN', head, body, 'END:VCALENDAR'].filter(Boolean).join('\r\n');

const vevent = (...lines: string[]) => ['BEGIN:VEVENT', ...lines, 'END:VEVENT'].join('\r\n');

describe('parseIcs', () => {
  it('reads a timed event in another zone onto the target wall clock', () => {
    const text = cal(
      vevent('UID:a@x', 'DTSTART;TZID=Europe/London:20261111T090000', 'DTEND;TZID=Europe/London:20261111T103000', 'SUMMARY:Call\\, with notes', 'LOCATION:Room 1'),
      'X-WR-CALNAME:Work',
    );
    const r = parseIcs(text, { zone: 'Asia/Singapore' });
    expect(r.name).toBe('Work');
    expect(r.events).toHaveLength(1);
    const e = r.events[0];
    expect(e).toMatchObject({ icsUid: 'a@x', title: 'Call, with notes', start: '2026-11-11T17:00', end: '2026-11-11T18:30', allDay: false, location: 'Room 1' });
  });

  it('reads UTC and floating times, and Windows zone names', () => {
    const text = cal(
      [
        vevent('UID:u', 'DTSTART:20260701T120000Z', 'DURATION:PT45M', 'SUMMARY:UTC'),
        vevent('UID:f', 'DTSTART:20260701T120000', 'DTEND:20260701T130000', 'SUMMARY:Floating'),
        vevent('UID:w', 'DTSTART;TZID=Singapore Standard Time:20260701T090000', 'DTEND;TZID=Singapore Standard Time:20260701T100000', 'SUMMARY:Outlook'),
      ].join('\r\n'),
    );
    const r = parseIcs(text, { zone: 'Europe/London' });
    const by = Object.fromEntries(r.events.map((e) => [e.icsUid, e]));
    expect(by.u.start).toBe('2026-07-01T13:00'); // BST
    expect(by.u.end).toBe('2026-07-01T13:45');
    expect(by.f.start).toBe('2026-07-01T12:00');
    expect(by.w.start).toBe('2026-07-01T02:00');
  });

  it('turns exclusive all-day ends into the last day', () => {
    const r = parseIcs(cal(vevent('UID:d', 'DTSTART;VALUE=DATE:20261224', 'DTEND;VALUE=DATE:20261227', 'SUMMARY:Holiday')));
    expect(r.events[0]).toMatchObject({ allDay: true, start: '2026-12-24', end: '2026-12-26' });
  });

  it('unfolds long lines and keeps line breaks in notes', () => {
    const text = cal(vevent('UID:n', 'DTSTART;VALUE=DATE:20261224', 'SUMMARY:Long', 'DESCRIPTION:first line\\nsecond', ' line continues'));
    expect(parseIcs(text).events[0].notes).toBe('first line\nsecondline continues');
  });

  it('maps weekly, monthly-by-weekday and COUNT rules', () => {
    const text = cal(
      [
        vevent('UID:w', 'DTSTART:20261102T093000', 'DTEND:20261102T100000', 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20261130T235959Z', 'SUMMARY:W'),
        vevent('UID:m', 'DTSTART:20261110T190000', 'DTEND:20261110T210000', 'RRULE:FREQ=MONTHLY;BYDAY=2TU', 'SUMMARY:M'),
        vevent('UID:c', 'DTSTART;VALUE=DATE:20261101', 'RRULE:FREQ=DAILY;COUNT=3', 'SUMMARY:C'),
        vevent('UID:sp', 'DTSTART:20261101T110000', 'RRULE:FREQ=MONTHLY;BYDAY=SU;BYSETPOS=1', 'SUMMARY:First Sunday'),
      ].join('\r\n'),
    );
    const r = parseIcs(text, { zone: 'UTC' });
    expect(r.simplified).toBe(0);
    const by = Object.fromEntries(r.events.map((e) => [e.icsUid, e]));
    expect(by.w.recurrence).toMatchObject({ freq: 'weekly', byWeekday: [1, 3, 5], until: '2026-11-30' });
    expect(by.m.recurrence).toMatchObject({ freq: 'monthly', nth: 2, byWeekday: [2] });
    expect(by.c.recurrence?.until).toBe('2026-11-03');
    expect(by.sp.recurrence).toMatchObject({ freq: 'monthly', nth: 1, byWeekday: [0] });
  });

  it('counts rules it can only approximate', () => {
    const r = parseIcs(cal(vevent('UID:h', 'DTSTART:20261101T090000', 'RRULE:FREQ=HOURLY;INTERVAL=2', 'SUMMARY:Pills')));
    expect(r.simplified).toBe(1);
    expect(r.events[0].recurrence).toBeNull();
  });

  it('turns moved and cancelled occurrences into exceptions', () => {
    const text = cal(
      [
        vevent('UID:s', 'DTSTART:20261102T090000', 'DTEND:20261102T100000', 'RRULE:FREQ=DAILY', 'EXDATE:20261103T090000', 'SUMMARY:Daily'),
        vevent('UID:s', 'RECURRENCE-ID:20261104T090000', 'DTSTART:20261104T150000', 'DTEND:20261104T160000', 'SUMMARY:Daily (moved)'),
        vevent('UID:s', 'RECURRENCE-ID:20261105T090000', 'DTSTART:20261105T090000', 'STATUS:CANCELLED', 'SUMMARY:Daily'),
      ].join('\r\n'),
    );
    const r = parseIcs(text, { zone: 'UTC' });
    const master = r.events.find((e) => e.icsUid === 's')!;
    expect(master.exdates).toEqual(['2026-11-03', '2026-11-04', '2026-11-05']);
    const moved = r.events.find((e) => e.icsUid === 's/2026-11-04')!;
    expect(moved).toMatchObject({ title: 'Daily (moved)', start: '2026-11-04T15:00', recurrence: null });
  });

  it('reads alarms as alerts, including ones relative to the end', () => {
    const text = cal(
      vevent(
        'UID:a',
        'DTSTART:20261102T090000',
        'DTEND:20261102T100000',
        'SUMMARY:A',
        'BEGIN:VALARM',
        'TRIGGER:-PT15M',
        'ACTION:DISPLAY',
        'END:VALARM',
        'BEGIN:VALARM',
        'TRIGGER;RELATED=END:-PT30M',
        'ACTION:DISPLAY',
        'END:VALARM',
        'BEGIN:VALARM',
        'TRIGGER;VALUE=DATE-TIME:19760401T005545Z',
        'ACTION:NONE',
        'END:VALARM',
      ),
    );
    expect(parseIcs(text, { zone: 'UTC' }).events[0].reminders).toEqual([-30, 15]);
  });

  it('skips events it cannot read', () => {
    const r = parseIcs(cal(vevent('UID:x', 'SUMMARY:No start')));
    expect(r.skipped).toBe(1);
    expect(r.events).toHaveLength(0);
  });
});

describe('parseDuration', () => {
  it('reads signed durations', () => {
    expect(parseDuration('-PT15M')).toBe(-15);
    expect(parseDuration('P1DT2H')).toBe(1560);
    expect(parseDuration('P1W')).toBe(10080);
    expect(parseDuration('nonsense')).toBeNull();
  });
});

describe('buildIcs', () => {
  const ev = (p: Partial<CalEvent>): CalEvent => ({
    id: 'e1',
    title: 'Small group',
    calendarId: 'church',
    start: '2026-11-04T19:30',
    end: '2026-11-04T21:30',
    allDay: false,
    createdAt: 0,
    updatedAt: 0,
    ...p,
  });
  const calendars = [{ id: 'church', name: 'Church', color: 'coral' as const, visible: true }];

  it('round-trips events through parseIcs', () => {
    const events = [
      ev({ recurrence: { freq: 'weekly', interval: 1, byWeekday: [3], until: '2026-12-30' }, exdates: ['2026-11-11'], reminders: [10], location: 'Hall; level 2', notes: 'Bring snacks,\nand a friend' }),
      ev({ id: 'e2', title: 'Retreat', allDay: true, start: '2026-12-26', end: '2026-12-28' }),
      ev({ id: 'e3', title: 'Prayer', start: '2026-11-01T08:00', end: '2026-11-01T09:00', recurrence: { freq: 'monthly', interval: 1, nth: 1, byWeekday: [0] } }),
    ];
    const text = buildIcs(events, { calendars, tz: 'Asia/Singapore', name: 'Daybook' });
    expect(text).toContain('BEGIN:VTIMEZONE');
    expect(text.split('\r\n').every((l) => new TextEncoder().encode(l).length <= 75)).toBe(true);
    const back = parseIcs(text, { zone: 'Asia/Singapore' });
    expect(back.name).toBe('Daybook');
    const by = Object.fromEntries(back.events.map((e) => [e.icsUid, e]));
    expect(by['e1@daybook']).toMatchObject({
      start: '2026-11-04T19:30',
      end: '2026-11-04T21:30',
      location: 'Hall; level 2',
      notes: 'Bring snacks,\nand a friend',
      exdates: ['2026-11-11'],
      reminders: [10],
      categories: ['Church'],
      recurrence: { freq: 'weekly', byWeekday: [3], until: '2026-12-30' },
    });
    expect(by['e2@daybook']).toMatchObject({ allDay: true, start: '2026-12-26', end: '2026-12-28' });
    expect(by['e3@daybook'].recurrence).toMatchObject({ freq: 'monthly', nth: 1, byWeekday: [0] });
  });

  it('writes daylight-saving rules for zones that have them', () => {
    const text = buildIcs([ev({})], { calendars, tz: 'Europe/London', now: new Date(Date.UTC(2026, 5, 1)) });
    expect(text).toContain('RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU');
    expect(text).toContain('RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU');
    expect(text).toContain('TZOFFSETTO:+0100');
  });

  it('writes default alerts for events that follow the default', () => {
    const text = buildIcs([ev({})], { calendars, settings: { alertDefault: 10, allDayAlertDefault: null } });
    expect(text).toContain('TRIGGER:-PT10M');
  });
});

describe('monthly nth-weekday rules', () => {
  it('repeats on the first Sunday and the last Friday', () => {
    const first = ev2({ start: '2026-11-01T11:00', end: '2026-11-01T13:00', recurrence: { freq: 'monthly', interval: 1, nth: 1, byWeekday: [0] } });
    const last = ev2({ id: 'l', start: '2026-11-27T19:00', end: '2026-11-27T20:00', recurrence: { freq: 'monthly', interval: 1, nth: -1, byWeekday: [5] } });
    const keys = expandEvents([first, last], new Date(2026, 10, 1), new Date(2027, 2, 1)).map((o) => `${o.event.id}:${o.dateKey}`);
    expect(keys).toEqual([
      'f:2026-11-01',
      'l:2026-11-27',
      'f:2026-12-06',
      'l:2026-12-25',
      'f:2027-01-03',
      'l:2027-01-29',
      'f:2027-02-07',
      'l:2027-02-26',
    ]);
  });
});

function ev2(p: Partial<CalEvent>): CalEvent {
  return { id: 'f', title: 'T', calendarId: 'c', start: '', end: '', allDay: false, createdAt: 0, updatedAt: 0, ...p };
}

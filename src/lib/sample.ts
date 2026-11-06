import { addDays, startOfWeek } from 'date-fns';
import type { CalEvent, CalendarCategory, Task } from '../types';
import { toDateKey } from './dates';
import { uid } from './id';

export const DEFAULT_CALENDARS: CalendarCategory[] = [
  { id: 'personal', name: 'Personal', color: 'indigo', visible: true },
  { id: 'work', name: 'Work', color: 'teal', visible: true },
  { id: 'church', name: 'Church', color: 'coral', visible: true },
  { id: 'fitness', name: 'Fitness', color: 'amber', visible: true },
  { id: 'social', name: 'Social', color: 'violet', visible: true },
];

/** Generic example data placed around the current week so every view has something to show. */
export function buildSampleData(now = new Date()) {
  const monday = startOfWeek(now, { weekStartsOn: 1 });
  const day = (offset: number) => toDateKey(addDays(monday, offset));
  const today = toDateKey(now);
  const rel = (offset: number) => toDateKey(addDays(now, offset));
  const ts = Date.now();

  const ev = (
    p: Partial<CalEvent> & Pick<CalEvent, 'title' | 'calendarId' | 'start' | 'end'>,
  ): CalEvent => ({
    id: uid(),
    allDay: false,
    createdAt: ts,
    updatedAt: ts,
    sample: true,
    ...p,
  });

  const events: CalEvent[] = [
    ev({
      title: 'Morning run',
      calendarId: 'fitness',
      start: `${day(0)}T07:00`,
      end: `${day(0)}T07:45`,
      location: 'Park connector',
      recurrence: { freq: 'weekly', interval: 1, byWeekday: [1, 3, 5] },
    }),
    ev({
      title: 'Team stand-up',
      calendarId: 'work',
      start: `${day(0)}T09:30`,
      end: `${day(0)}T10:00`,
      recurrence: { freq: 'weekly', interval: 1, byWeekday: [1, 2, 3, 4, 5] },
    }),
    ev({ title: 'Project workshop', calendarId: 'work', start: `${day(1)}T14:00`, end: `${day(1)}T17:00`, location: 'Room 4B' }),
    ev({
      title: 'Small group',
      calendarId: 'church',
      start: `${day(2)}T19:30`,
      end: `${day(2)}T21:30`,
      recurrence: { freq: 'weekly', interval: 1 },
    }),
    ev({ title: 'Lunch with team', calendarId: 'social', start: `${day(3)}T12:30`, end: `${day(3)}T13:30` }),
    ev({ title: 'Haircut', calendarId: 'personal', start: `${day(3)}T18:00`, end: `${day(3)}T18:45` }),
    ev({ title: 'Design review', calendarId: 'work', start: `${day(4)}T15:00`, end: `${day(4)}T16:00` }),
    ev({ title: 'Dinner with friends', calendarId: 'social', start: `${day(4)}T19:30`, end: `${day(4)}T21:30` }),
    ev({ title: 'Farmers market', calendarId: 'personal', start: `${day(5)}T09:00`, end: `${day(5)}T10:30` }),
    ev({ title: 'Youth night', calendarId: 'church', start: `${day(5)}T16:00`, end: `${day(5)}T19:00` }),
    ev({
      title: 'Sunday service',
      calendarId: 'church',
      start: `${day(6)}T11:00`,
      end: `${day(6)}T13:00`,
      recurrence: { freq: 'weekly', interval: 1 },
    }),
    ev({ title: 'Family BBQ', calendarId: 'social', start: `${day(6)}T16:30`, end: `${day(6)}T20:00` }),
    ev({ title: 'Quarterly planning', calendarId: 'work', start: day(3), end: day(3), allDay: true }),
    ev({ title: 'Long weekend trip', calendarId: 'personal', start: day(12), end: day(13), allDay: true }),
  ];

  const task = (p: Partial<Task> & Pick<Task, 'title'>): Task => ({
    id: uid(),
    status: 'todo',
    priority: 'none',
    calendarId: null,
    dueDate: null,
    scheduledStart: null,
    durationMin: 30,
    subtasks: [],
    createdAt: ts,
    updatedAt: ts,
    completedAt: null,
    sample: true,
    ...p,
  });
  const sub = (title: string, done = false) => ({ id: uid(), title, done });

  const tasks: Task[] = [
    task({
      title: 'Prepare workshop slides',
      calendarId: 'work',
      priority: 'high',
      dueDate: rel(2),
      scheduledStart: `${today}T14:00`,
      durationMin: 90,
      subtasks: [sub('Outline', true), sub('Draft slides'), sub('Rehearse')],
    }),
    task({ title: 'Book dentist appointment', calendarId: 'personal', priority: 'medium', dueDate: rel(1) }),
    task({ title: 'Buy groceries', calendarId: 'personal', subtasks: [sub('Eggs'), sub('Oat milk'), sub('Coffee beans')] }),
    task({ title: 'Plan youth night games', calendarId: 'church', priority: 'medium', dueDate: day(5), durationMin: 60 }),
    task({ title: 'Return library books', calendarId: 'personal', priority: 'low', dueDate: rel(-1) }),
    task({ title: 'Renew gym membership', calendarId: 'fitness', durationMin: 15 }),
    task({
      title: 'Update portfolio website',
      calendarId: 'work',
      status: 'in_progress',
      priority: 'high',
      durationMin: 60,
      subtasks: [sub('New case study', true), sub('Refresh photos', true), sub('Fix contact form'), sub('Publish')],
    }),
    task({
      title: 'Read “Deep Work”',
      calendarId: 'personal',
      status: 'in_progress',
      scheduledStart: `${today}T21:30`,
      durationMin: 30,
    }),
    task({ title: 'Send meeting notes', calendarId: 'work', status: 'done', completedAt: ts - 3600000 }),
    task({ title: 'Set up new phone', calendarId: 'personal', status: 'done', completedAt: ts - 86400000 }),
    task({ title: 'Confirm usher roster', calendarId: 'church', status: 'done', completedAt: ts - 2 * 86400000 }),
    task({ title: 'Stretch routine', calendarId: 'fitness', status: 'done', completedAt: ts - 7200000 }),
  ];

  return { events, tasks };
}

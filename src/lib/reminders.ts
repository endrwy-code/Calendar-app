/**
 * Alerts ("remind me 10 minutes before"). Shared by the event form, the .ics
 * export, and the server that sends them as Telegram messages.
 *
 * An alert is a number of minutes before the start. All-day events start at
 * midnight, so their alerts are measured from midnight: -540 is "on the day at
 * 09:00" and 900 is "the day before at 09:00".
 */
import type { CalEvent, Settings, Task } from '../types';
import { expandEvents } from './recurrence';
import { taskBounds } from './schedule';
import { toLocalISO } from './dates';

export interface AlertOption {
  value: number | null;
  label: string;
}

export const TIMED_ALERTS: AlertOption[] = [
  { value: null, label: 'None' },
  { value: 0, label: 'At the start' },
  { value: 5, label: '5 min before' },
  { value: 10, label: '10 min before' },
  { value: 15, label: '15 min before' },
  { value: 30, label: '30 min before' },
  { value: 60, label: '1 hour before' },
  { value: 120, label: '2 hours before' },
  { value: 1440, label: '1 day before' },
  { value: 2880, label: '2 days before' },
  { value: 10080, label: '1 week before' },
];

export const ALL_DAY_ALERTS: AlertOption[] = [
  { value: null, label: 'None' },
  { value: -540, label: 'On the day (09:00)' },
  { value: 900, label: '1 day before (09:00)' },
  { value: 2340, label: '2 days before (09:00)' },
  { value: 9540, label: '1 week before (09:00)' },
];

/** "10 min before", "1 day before (09:00)", or a plain description for values from other apps. */
export function alertLabel(min: number, allDay: boolean): string {
  const list = allDay ? ALL_DAY_ALERTS : TIMED_ALERTS;
  const hit = list.find((o) => o.value === min);
  if (hit) return hit.label;
  if (min === 0) return 'At the start';
  const after = min < 0;
  const m = Math.abs(min);
  const amount =
    m % 10080 === 0 ? plural(m / 10080, 'week') : m % 1440 === 0 ? plural(m / 1440, 'day') : m % 60 === 0 ? plural(m / 60, 'hour') : `${m} min`;
  return `${amount} ${after ? 'after' : 'before'}`;
}

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;

/** The alerts an event actually has: its own, or the default from Settings. */
export function eventAlerts(ev: CalEvent, s: Pick<Settings, 'alertDefault' | 'allDayAlertDefault'>): number[] {
  if (ev.reminders) return ev.reminders;
  const d = ev.allDay ? s.allDayAlertDefault : s.alertDefault;
  return d === null || d === undefined ? [] : [d];
}

export interface DueAlert {
  /** Stable id for this alert, so it's only ever sent once */
  key: string;
  kind: 'event' | 'task';
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  location?: string;
  /** Minutes before the start (negative = after) */
  minutesBefore: number;
  fire: Date;
}

/**
 * Alerts that fall in (from, to]. Dates are wall-clock times in the user's zone.
 * Includes to-dos on the calendar (at their start) when `todoAlerts` is on.
 */
export function alertsBetween(
  events: CalEvent[],
  tasks: Task[],
  s: Pick<Settings, 'alertDefault' | 'allDayAlertDefault' | 'todoAlerts'>,
  from: Date,
  to: Date,
): DueAlert[] {
  const out: DueAlert[] = [];
  const withAlerts = events.map((ev) => ({ ev, alerts: eventAlerts(ev, s) })).filter((x) => x.alerts.length);
  if (withAlerts.length) {
    const all = withAlerts.flatMap((x) => x.alerts);
    const lo = Math.min(...all);
    const hi = Math.max(...all);
    // fire = start − m, so a start in (from + m, to + m] fires in (from, to]
    const rangeStart = new Date(from.getTime() + lo * 60000);
    const rangeEnd = new Date(to.getTime() + hi * 60000 + 60000);
    const alertsOf = new Map(withAlerts.map((x) => [x.ev.id, x.alerts]));
    for (const occ of expandEvents(
      withAlerts.map((x) => x.ev),
      rangeStart,
      rangeEnd,
    )) {
      for (const m of alertsOf.get(occ.event.id) ?? []) {
        const fire = new Date(occ.start.getTime() - m * 60000);
        if (fire > from && fire <= to) {
          out.push({
            key: `e:${occ.event.id}:${toLocalISO(occ.start)}:${m}`,
            kind: 'event',
            title: occ.event.title,
            start: occ.start,
            end: occ.end,
            allDay: occ.event.allDay,
            location: occ.event.location || undefined,
            minutesBefore: m,
            fire,
          });
        }
      }
    }
  }
  if (s.todoAlerts) {
    for (const t of tasks) {
      if (t.status === 'done') continue;
      const b = taskBounds(t);
      if (!b || b.start <= from || b.start > to) continue;
      out.push({
        key: `t:${t.id}:${t.scheduledStart}`,
        kind: 'task',
        title: t.title,
        start: b.start,
        end: b.end,
        allDay: false,
        minutesBefore: 0,
        fire: b.start,
      });
    }
  }
  return out.sort((a, b) => a.fire.getTime() - b.fire.getTime());
}

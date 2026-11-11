export type ID = string;

export type TaskStatus = 'todo' | 'in_progress' | 'done';
export type Priority = 'none' | 'low' | 'medium' | 'high';
export type Freq = 'daily' | 'weekly' | 'monthly' | 'yearly';
export type ViewMode = 'day' | '3day' | 'week' | 'month' | 'agenda';
export type Tab = 'todo' | 'calendar';

export const COLOR_KEYS = [
  'coral',
  'amber',
  'teal',
  'indigo',
  'violet',
  'green',
  'rose',
  'sky',
  'slate',
] as const;
export type ColorKey = (typeof COLOR_KEYS)[number];

export interface Recurrence {
  freq: Freq;
  interval: number;
  /** 0 = Sunday … 6 = Saturday. Only used for weekly rules. */
  byWeekday?: number[];
  /** Inclusive last date, YYYY-MM-DD */
  until?: string | null;
  /**
   * Monthly rules only: repeat on the nth weekday of the month (1–5, or -1 for
   * the last one) instead of on the same date. The weekday is byWeekday[0].
   */
  nth?: number | null;
}

export interface CalendarCategory {
  id: ID;
  name: string;
  color: ColorKey;
  visible: boolean;
  /** Set on every change, so syncing knows which copy is newest */
  updatedAt?: number;
}

export interface CalEvent {
  id: ID;
  title: string;
  calendarId: ID;
  /** Local wall-clock time "YYYY-MM-DDTHH:mm", or "YYYY-MM-DD" for all-day */
  start: string;
  /** Exclusive end for timed events; inclusive last day for all-day events */
  end: string;
  allDay: boolean;
  location?: string;
  notes?: string;
  recurrence?: Recurrence | null;
  /** Occurrence dates (YYYY-MM-DD) removed from a recurring series */
  exdates?: string[];
  /**
   * Alerts, in minutes before the start. Negative values are after the start,
   * which all-day events use for "on the day at 09:00" (-540). Left out, the
   * event follows the default alert in Settings; [] means no alert.
   */
  reminders?: number[];
  /** UID from an imported .ics file, so importing the same file again updates instead of duplicating */
  icsUid?: string;
  sample?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Subtask {
  id: ID;
  title: string;
  done: boolean;
}

/**
 * A to-do. The list itself is independent of dates; a to-do only shows on the
 * calendar once it's given a time block (`scheduledStart` + `durationMin`).
 * `priority`, `calendarId`, `dueDate` and `subtasks` come from the earlier
 * version and are kept so existing data isn't lost.
 */
export interface Task {
  id: ID;
  title: string;
  notes?: string;
  status: TaskStatus;
  priority: Priority;
  calendarId?: ID | null;
  /** YYYY-MM-DD (legacy) */
  dueDate?: string | null;
  /** "YYYY-MM-DDTHH:mm" — when the to-do is time-blocked on the calendar */
  scheduledStart?: string | null;
  durationMin: number;
  subtasks: Subtask[];
  createdAt: number;
  updatedAt: number;
  completedAt?: number | null;
  sample?: boolean;
}

export interface Settings {
  theme: 'system' | 'light' | 'dark';
  weekStartsOn: 0 | 1;
  timeFormat: '24h' | '12h';
  showWeekNumbers: boolean;
  defaultEventMinutes: number;
  /** Hours used when suggesting free slots for a to-do */
  dayStartHour: number;
  dayEndHour: number;
  calendarView: ViewMode;
  /** Height of one hour in the day and week views (pinch to change). null = automatic. Kept per device. */
  hourHeight: number | null;
  /** Default alert for timed events, in minutes before; null = none */
  alertDefault: number | null;
  /** Default alert for all-day events (see CalEvent.reminders); null = none */
  allDayAlertDefault: number | null;
  /** Remind me when a to-do I put on the calendar is about to start */
  todoAlerts: boolean;
  /** Send a summary of the day at this time ("07:30"); null = off */
  dailyAgenda: string | null;
  /** Send alerts as Telegram messages (needs the Daybook server) */
  telegramAlerts: boolean;
}

/** Settings that belong to one device and aren't synced. */
export const DEVICE_SETTINGS = ['calendarView', 'hourHeight'] as const satisfies readonly (keyof Settings)[];

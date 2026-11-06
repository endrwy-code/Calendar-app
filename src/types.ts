export type ID = string;

export type TaskStatus = 'todo' | 'in_progress' | 'done';
export type Priority = 'none' | 'low' | 'medium' | 'high';
export type Freq = 'daily' | 'weekly' | 'monthly' | 'yearly';
export type ViewMode = 'day' | '3day' | 'week' | 'month' | 'agenda';
export type Tab = 'today' | 'calendar' | 'tasks' | 'settings';

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
}

export interface CalendarCategory {
  id: ID;
  name: string;
  color: ColorKey;
  visible: boolean;
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
  sample?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Subtask {
  id: ID;
  title: string;
  done: boolean;
}

export interface Task {
  id: ID;
  title: string;
  notes?: string;
  status: TaskStatus;
  priority: Priority;
  calendarId?: ID | null;
  /** YYYY-MM-DD */
  dueDate?: string | null;
  /** "YYYY-MM-DDTHH:mm" — when the task is time-blocked on the calendar */
  scheduledStart?: string | null;
  durationMin: number;
  subtasks: Subtask[];
  createdAt: number;
  updatedAt: number;
  completedAt?: number | null;
  sample?: boolean;
}

export interface Settings {
  name: string;
  theme: 'system' | 'light' | 'dark';
  weekStartsOn: 0 | 1;
  timeFormat: '24h' | '12h';
  showWeekNumbers: boolean;
  showTasksOnCalendar: boolean;
  defaultEventMinutes: number;
  /** Hours used by "find a free slot" */
  dayStartHour: number;
  dayEndHour: number;
  calendarView: ViewMode;
}

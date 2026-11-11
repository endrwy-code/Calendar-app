import type { Settings } from '../types';

/** Settings for a new install. Shared with the server, which reads alerts settings from them. */
export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  weekStartsOn: 1,
  timeFormat: '24h',
  showWeekNumbers: false,
  defaultEventMinutes: 60,
  dayStartHour: 8,
  dayEndHour: 22,
  calendarView: 'week',
  hourHeight: null,
  alertDefault: 10,
  allDayAlertDefault: -540,
  todoAlerts: true,
  dailyAgenda: null,
  telegramAlerts: true,
};

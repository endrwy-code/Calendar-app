import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { addDays } from 'date-fns';
import type { CalEvent, CalendarCategory, ID, Settings, Subtask, Task, TaskStatus } from '../types';
import { uid } from '../lib/id';
import { DEFAULT_CALENDARS, buildSampleData } from '../lib/sample';
import { appStorage } from '../lib/telegram';
import { parseLocal, toDateKey, toLocalISO } from '../lib/dates';
import { eventBounds } from '../lib/recurrence';

export const DEFAULT_SETTINGS: Settings = {
  name: '',
  theme: 'system',
  weekStartsOn: 1,
  timeFormat: '24h',
  showWeekNumbers: true,
  showTasksOnCalendar: true,
  defaultEventMinutes: 60,
  dayStartHour: 8,
  dayEndHour: 22,
  calendarView: 'week',
};

export type EventInput = Omit<CalEvent, 'id' | 'createdAt' | 'updatedAt'>;
export type TaskInput = Partial<Omit<Task, 'id' | 'createdAt' | 'updatedAt'>> & { title: string };

export interface BackupFile {
  app: 'calendar-app';
  version: 1;
  exportedAt: string;
  calendars: CalendarCategory[];
  events: CalEvent[];
  tasks: Task[];
  settings: Settings;
}

interface DataState {
  calendars: CalendarCategory[];
  events: CalEvent[];
  tasks: Task[];
  settings: Settings;
  seeded: boolean;
  hydrated: boolean;

  // events
  addEvent(input: EventInput): CalEvent;
  updateEvent(id: ID, patch: Partial<CalEvent>): void;
  deleteEvent(id: ID): void;
  /** Removes one occurrence of a recurring event */
  skipOccurrence(id: ID, dateKey: string): void;
  /** Ends a recurring series before the given occurrence */
  endSeriesBefore(id: ID, dateKey: string): void;

  // tasks
  addTask(input: TaskInput): Task;
  updateTask(id: ID, patch: Partial<Task>): void;
  deleteTask(id: ID): void;
  setTaskStatus(id: ID, status: TaskStatus): void;
  toggleTaskDone(id: ID): boolean;
  toggleSubtask(taskId: ID, subId: ID): void;
  setSubtasks(taskId: ID, subtasks: Subtask[]): void;
  clearCompleted(): void;

  // calendars
  addCalendar(input: Omit<CalendarCategory, 'id' | 'visible'>): CalendarCategory;
  updateCalendar(id: ID, patch: Partial<CalendarCategory>): void;
  deleteCalendar(id: ID): void;
  toggleCalendar(id: ID): void;

  // settings & data
  updateSettings(patch: Partial<Settings>): void;
  seedIfNeeded(): void;
  removeSampleData(): void;
  loadSampleData(): void;
  importBackup(data: BackupFile): void;
  exportBackup(): BackupFile;
  resetAll(): void;
}

const now = () => Date.now();

export const useData = create<DataState>()(
  persist(
    (set, get) => ({
      calendars: DEFAULT_CALENDARS,
      events: [],
      tasks: [],
      settings: DEFAULT_SETTINGS,
      seeded: false,
      hydrated: false,

      addEvent(input) {
        const ev: CalEvent = { ...input, id: uid(), createdAt: now(), updatedAt: now() };
        set((s) => ({ events: [...s.events, ev] }));
        return ev;
      },
      updateEvent(id, patch) {
        set((s) => ({
          events: s.events.map((e) => (e.id === id ? { ...e, ...patch, updatedAt: now() } : e)),
        }));
      },
      deleteEvent(id) {
        set((s) => ({ events: s.events.filter((e) => e.id !== id) }));
      },
      skipOccurrence(id, dateKey) {
        set((s) => ({
          events: s.events.map((e) =>
            e.id === id
              ? { ...e, exdates: [...new Set([...(e.exdates ?? []), dateKey])], updatedAt: now() }
              : e,
          ),
        }));
      },
      endSeriesBefore(id, dateKey) {
        const ev = get().events.find((e) => e.id === id);
        if (!ev || !ev.recurrence) return;
        const until = toDateKey(addDays(parseLocal(dateKey), -1));
        if (until < ev.start.slice(0, 10)) {
          get().deleteEvent(id);
          return;
        }
        get().updateEvent(id, { recurrence: { ...ev.recurrence, until } });
      },

      addTask(input) {
        const t: Task = {
          status: 'todo',
          priority: 'none',
          calendarId: null,
          dueDate: null,
          scheduledStart: null,
          durationMin: 30,
          subtasks: [],
          completedAt: null,
          notes: '',
          ...input,
          id: uid(),
          createdAt: now(),
          updatedAt: now(),
        };
        if (t.status === 'done' && !t.completedAt) t.completedAt = now();
        set((s) => ({ tasks: [t, ...s.tasks] }));
        return t;
      },
      updateTask(id, patch) {
        set((s) => ({
          tasks: s.tasks.map((t) => {
            if (t.id !== id) return t;
            const next = { ...t, ...patch, updatedAt: now() };
            if (patch.status && patch.status !== t.status) {
              next.completedAt = patch.status === 'done' ? now() : null;
            }
            return next;
          }),
        }));
      },
      deleteTask(id) {
        set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) }));
      },
      setTaskStatus(id, status) {
        get().updateTask(id, { status });
      },
      toggleTaskDone(id) {
        const t = get().tasks.find((x) => x.id === id);
        if (!t) return false;
        const done = t.status !== 'done';
        get().updateTask(id, { status: done ? 'done' : 'todo' });
        return done;
      },
      toggleSubtask(taskId, subId) {
        const t = get().tasks.find((x) => x.id === taskId);
        if (!t) return;
        get().updateTask(taskId, {
          subtasks: t.subtasks.map((s) => (s.id === subId ? { ...s, done: !s.done } : s)),
          // Ticking a sub-step on a fresh to-do means work has started
          ...(t.status === 'todo' ? { status: 'in_progress' as const } : {}),
        });
      },
      setSubtasks(taskId, subtasks) {
        get().updateTask(taskId, { subtasks });
      },
      clearCompleted() {
        set((s) => ({ tasks: s.tasks.filter((t) => t.status !== 'done') }));
      },

      addCalendar(input) {
        const c: CalendarCategory = { ...input, id: uid(), visible: true };
        set((s) => ({ calendars: [...s.calendars, c] }));
        return c;
      },
      updateCalendar(id, patch) {
        set((s) => ({ calendars: s.calendars.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
      },
      deleteCalendar(id) {
        set((s) => {
          const calendars = s.calendars.filter((c) => c.id !== id);
          if (!calendars.length) return s;
          return {
            calendars,
            events: s.events.filter((e) => e.calendarId !== id),
            tasks: s.tasks.map((t) => (t.calendarId === id ? { ...t, calendarId: null } : t)),
          };
        });
      },
      toggleCalendar(id) {
        set((s) => ({
          calendars: s.calendars.map((c) => (c.id === id ? { ...c, visible: !c.visible } : c)),
        }));
      },

      updateSettings(patch) {
        set((s) => ({ settings: { ...s.settings, ...patch } }));
      },
      seedIfNeeded() {
        if (get().seeded) return;
        const { events, tasks } = buildSampleData();
        set((s) => ({ seeded: true, events: [...s.events, ...events], tasks: [...s.tasks, ...tasks] }));
      },
      removeSampleData() {
        set((s) => ({
          events: s.events.filter((e) => !e.sample),
          tasks: s.tasks.filter((t) => !t.sample),
        }));
      },
      loadSampleData() {
        const { events, tasks } = buildSampleData();
        set((s) => ({
          events: [...s.events.filter((e) => !e.sample), ...events],
          tasks: [...s.tasks.filter((t) => !t.sample), ...tasks],
        }));
      },
      importBackup(data) {
        set({
          calendars: data.calendars?.length ? data.calendars : DEFAULT_CALENDARS,
          events: data.events ?? [],
          tasks: data.tasks ?? [],
          settings: { ...DEFAULT_SETTINGS, ...data.settings },
          seeded: true,
        });
      },
      exportBackup() {
        const s = get();
        return {
          app: 'calendar-app',
          version: 1,
          exportedAt: new Date().toISOString(),
          calendars: s.calendars,
          events: s.events,
          tasks: s.tasks,
          settings: s.settings,
        };
      },
      resetAll() {
        set({
          calendars: DEFAULT_CALENDARS,
          events: [],
          tasks: [],
          settings: DEFAULT_SETTINGS,
          seeded: true,
        });
      },
    }),
    {
      name: 'calendar-app:data',
      version: 1,
      storage: createJSONStorage(() => appStorage),
      partialize: (s) => ({
        calendars: s.calendars,
        events: s.events,
        tasks: s.tasks,
        settings: s.settings,
        seeded: s.seeded,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<DataState>;
        return { ...current, ...p, settings: { ...DEFAULT_SETTINGS, ...(p.settings ?? {}) } };
      },
      onRehydrateStorage: () => () => {
        useData.setState({ hydrated: true });
        useData.getState().seedIfNeeded();
      },
    },
  ),
);

/** Moves an event so that its occurrence on `fromStart` starts at `toStart` (keeps duration). */
export function shiftedTimes(ev: CalEvent, deltaMs: number): Pick<CalEvent, 'start' | 'end'> {
  const { start, end } = eventBounds(ev);
  if (ev.allDay) {
    const days = Math.round(deltaMs / 86400000);
    return {
      start: toDateKey(addDays(start, days)),
      end: toDateKey(addDays(end, days - 1)),
    };
  }
  return {
    start: toLocalISO(new Date(start.getTime() + deltaMs)),
    end: toLocalISO(new Date(end.getTime() + deltaMs)),
  };
}

export const calendarById = (calendars: CalendarCategory[], id?: string | null) =>
  calendars.find((c) => c.id === id) ?? null;

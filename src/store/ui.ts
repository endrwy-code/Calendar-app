import { create } from 'zustand';
import type { CalEvent, Tab } from '../types';
import { todayKey } from '../lib/dates';
import type { IcsImport } from '../lib/ics';

export type EventEditorState = {
  id?: string;
  /** When editing one occurrence of a recurring series */
  occurrence?: { dateKey: string; start: string; end: string };
  draft?: Partial<CalEvent>;
} | null;

export interface Toast {
  id: number;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

interface UIState {
  tab: Tab;
  /** Date the calendar is focused on (YYYY-MM-DD) */
  cursor: string;
  eventEditor: EventEditorState;
  /** To-do whose details sheet is open */
  todoId: string | null;
  /** To-do being added to (or moved on) the calendar */
  scheduleId: string | null;
  settingsOpen: boolean;
  /** The side menu (views, calendars, settings) */
  menuOpen: boolean;
  searchOpen: boolean;
  /** An .ics file waiting for the user to confirm its import */
  importing: { fileName: string; result: IcsImport } | null;
  toasts: Toast[];
  setTab(tab: Tab): void;
  setCursor(dateKey: string): void;
  /** Switch to the calendar focused on a date */
  goToDate(dateKey: string): void;
  openEvent(e: NonNullable<EventEditorState>): void;
  closeEvent(): void;
  openTodo(id: string | null): void;
  openSchedule(id: string | null): void;
  setSettingsOpen(v: boolean): void;
  setMenuOpen(v: boolean): void;
  setSearchOpen(v: boolean): void;
  setImporting(v: UIState['importing']): void;
  toast(message: string, action?: { label: string; run: () => void }): void;
  dismissToast(id: number): void;
}

let toastId = 0;

export const useUI = create<UIState>()((set, get) => ({
  tab: 'todo',
  cursor: todayKey(),
  eventEditor: null,
  todoId: null,
  scheduleId: null,
  settingsOpen: false,
  menuOpen: false,
  searchOpen: false,
  importing: null,
  toasts: [],
  setTab: (tab) => set({ tab }),
  setCursor: (cursor) => set({ cursor }),
  goToDate: (cursor) => set({ cursor, tab: 'calendar' }),
  openEvent: (eventEditor) => set({ eventEditor }),
  closeEvent: () => set({ eventEditor: null }),
  openTodo: (todoId) => set({ todoId }),
  openSchedule: (scheduleId) => set({ scheduleId }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setMenuOpen: (menuOpen) => set({ menuOpen }),
  setSearchOpen: (searchOpen) => set({ searchOpen }),
  setImporting: (importing) => set({ importing }),
  toast(message, action) {
    const id = ++toastId;
    set({ toasts: [...get().toasts.slice(-1), { id, message, actionLabel: action?.label, onAction: action?.run }] });
    setTimeout(() => get().dismissToast(id), 4000);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

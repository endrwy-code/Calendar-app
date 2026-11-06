import { create } from 'zustand';
import type { CalEvent, Tab, Task, TaskStatus } from '../types';
import { todayKey } from '../lib/dates';

export type EditorState =
  | {
      kind: 'event';
      id?: string;
      /** When editing one occurrence of a recurring series */
      occurrence?: { dateKey: string; start: string; end: string };
      draft?: Partial<CalEvent>;
    }
  | { kind: 'task'; id?: string; draft?: Partial<Task> }
  | null;

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
  editor: EditorState;
  searchOpen: boolean;
  drawerOpen: boolean;
  tasksPanelOpen: boolean;
  taskTab: TaskStatus;
  /** Free time range the user wants to fill from the Today view */
  planSlot: { start: string; end: string } | null;
  toasts: Toast[];
  setTab(tab: Tab): void;
  setCursor(dateKey: string): void;
  goToDate(dateKey: string): void;
  openEditor(e: EditorState): void;
  closeEditor(): void;
  setSearchOpen(v: boolean): void;
  setDrawerOpen(v: boolean): void;
  setTasksPanelOpen(v: boolean): void;
  setTaskTab(s: TaskStatus): void;
  setPlanSlot(v: { start: string; end: string } | null): void;
  toast(message: string, action?: { label: string; run: () => void }): void;
  dismissToast(id: number): void;
}

let toastId = 0;

export const useUI = create<UIState>()((set, get) => ({
  tab: 'today',
  cursor: todayKey(),
  editor: null,
  searchOpen: false,
  drawerOpen: false,
  tasksPanelOpen: false,
  taskTab: 'todo',
  planSlot: null,
  toasts: [],
  setTab: (tab) => set({ tab, drawerOpen: false }),
  setCursor: (cursor) => set({ cursor }),
  goToDate: (cursor) => set({ cursor, tab: 'calendar', searchOpen: false, drawerOpen: false }),
  openEditor: (editor) => set({ editor, searchOpen: false }),
  closeEditor: () => set({ editor: null }),
  setSearchOpen: (searchOpen) => set({ searchOpen }),
  setDrawerOpen: (drawerOpen) => set({ drawerOpen }),
  setTasksPanelOpen: (tasksPanelOpen) => set({ tasksPanelOpen }),
  setTaskTab: (taskTab) => set({ taskTab }),
  setPlanSlot: (planSlot) => set({ planSlot }),
  toast(message, action) {
    const id = ++toastId;
    set({ toasts: [...get().toasts.slice(-2), { id, message, actionLabel: action?.label, onAction: action?.run }] });
    setTimeout(() => get().dismissToast(id), 4500);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

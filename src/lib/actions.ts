/** Cross-store actions with feedback (toasts, haptics, undo). */
import { useData } from '../store/data';
import { useUI } from '../store/ui';
import { haptic } from './telegram';
import { fmtTime, parseLocal, relativeDayLabel } from './dates';
import type { Task, TaskStatus } from '../types';

export const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: 'Not started',
  in_progress: 'In progress',
  done: 'Done',
};

const current = (id: string) => useData.getState().tasks.find((t) => t.id === id);

export function setStatus(task: Task, status: TaskStatus, quiet = false) {
  const prev = current(task.id)?.status ?? task.status;
  if (prev === status) return;
  useData.getState().setTaskStatus(task.id, status);
  if (status === 'done') haptic.success();
  else haptic.tap();
  if (quiet) return;
  const msg = status === 'done' ? 'Done' : status === 'in_progress' ? 'Started' : prev === 'done' ? 'Reopened' : 'Paused';
  useUI.getState().toast(`${msg} · ${task.title}`, {
    label: 'Undo',
    run: () => useData.getState().setTaskStatus(task.id, prev),
  });
}

export function toggleDone(task: Task) {
  const t = current(task.id) ?? task;
  setStatus(t, t.status === 'done' ? 'todo' : 'done');
}

/** Not started ⇄ In progress (Done goes back to In progress). */
export function toggleStarted(task: Task) {
  const t = current(task.id) ?? task;
  setStatus(t, t.status === 'in_progress' ? 'todo' : 'in_progress');
}

export function deleteTask(task: Task) {
  const snapshot = current(task.id) ?? task;
  useData.getState().deleteTask(task.id);
  haptic.tap();
  useUI.getState().toast('To-do deleted', {
    label: 'Undo',
    run: () => useData.setState((s) => ({ tasks: [snapshot, ...s.tasks.filter((t) => t.id !== snapshot.id)] })),
  });
}

export function scheduleTask(task: Task, start: string, durationMin: number) {
  const prev = current(task.id);
  useData.getState().updateTask(task.id, { scheduledStart: start, durationMin });
  haptic.success();
  const d = parseLocal(start);
  const tf = useData.getState().settings.timeFormat;
  useUI.getState().toast(`On your calendar · ${relativeDayLabel(d)}, ${fmtTime(d, tf)}`, {
    label: 'View',
    run: () => useUI.getState().goToDate(start.slice(0, 10)),
  });
  return prev;
}

export function unscheduleTask(task: Task) {
  const prev = current(task.id);
  if (!prev?.scheduledStart) return;
  const { scheduledStart, durationMin } = prev;
  useData.getState().updateTask(task.id, { scheduledStart: null });
  haptic.tap();
  useUI.getState().toast('Removed from calendar', {
    label: 'Undo',
    run: () => useData.getState().updateTask(task.id, { scheduledStart, durationMin }),
  });
}

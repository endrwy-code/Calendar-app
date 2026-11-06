/** Cross-store actions with feedback (toasts, haptics, undo). */
import { useData } from '../store/data';
import { useUI } from '../store/ui';
import { haptic } from './telegram';
import { suggestSlot } from './selectors';
import { fmtTime, parseLocal, relativeDayLabel } from './dates';
import type { Task, TaskStatus } from '../types';

const STATUS_LABEL: Record<TaskStatus, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  done: 'Done',
};

export function toggleDone(task: Task) {
  const prev = task.status;
  const done = useData.getState().toggleTaskDone(task.id);
  if (done) {
    haptic.success();
    useUI.getState().toast(`Completed “${task.title}”`, {
      label: 'Undo',
      run: () => useData.getState().setTaskStatus(task.id, prev),
    });
  } else {
    haptic.tap();
  }
}

export function moveTask(task: Task, status: TaskStatus) {
  if (task.status === status) return;
  const prev = task.status;
  useData.getState().setTaskStatus(task.id, status);
  status === 'done' ? haptic.success() : haptic.tap();
  useUI.getState().toast(`Moved to ${STATUS_LABEL[status]}`, {
    label: 'Undo',
    run: () => useData.getState().setTaskStatus(task.id, prev),
  });
}

/** Puts a task into the next free slot on the calendar. */
export function autoPlan(task: Task, fromDay?: string) {
  const { events, tasks, settings } = useData.getState();
  const slot = suggestSlot(task, events, tasks, settings.dayStartHour, settings.dayEndHour, fromDay);
  if (!slot) {
    useUI.getState().toast('No free slot found in the next two weeks');
    return;
  }
  const prev = task.scheduledStart ?? null;
  useData.getState().updateTask(task.id, { scheduledStart: slot });
  haptic.tap();
  const d = parseLocal(slot);
  useUI
    .getState()
    .toast(`Planned for ${relativeDayLabel(d)} · ${fmtTime(d, settings.timeFormat)}`, {
      label: 'Undo',
      run: () => useData.getState().updateTask(task.id, { scheduledStart: prev }),
    });
}

export { STATUS_LABEL };

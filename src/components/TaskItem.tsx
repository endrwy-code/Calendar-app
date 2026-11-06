import { Check, CalendarClock, Flag, ListChecks, Play, RotateCcw, Sparkles, AlarmClock } from 'lucide-react';
import type { DragEvent } from 'react';
import type { Task } from '../types';
import { useData, calendarById } from '../store/data';
import { useUI } from '../store/ui';
import { fmtDuration, fmtTime, parseLocal, relativeDayLabel, todayKey } from '../lib/dates';
import { autoPlan, moveTask, toggleDone } from '../lib/actions';

export function TaskCheck({ task, size }: { task: Task; size?: 'sm' }) {
  const cls = task.status === 'done' ? 'checked' : task.status === 'in_progress' ? 'progress' : '';
  return (
    <button
      className={`check ${cls} ${size ?? ''}`}
      onClick={(e) => {
        e.stopPropagation();
        toggleDone(task);
      }}
      aria-label={task.status === 'done' ? `Mark “${task.title}” as not done` : `Complete “${task.title}”`}
    >
      <Check size={size === 'sm' ? 11 : 14} strokeWidth={3} />
    </button>
  );
}

export function TaskMeta({ task, compact }: { task: Task; compact?: boolean }) {
  const calendars = useData((s) => s.calendars);
  const timeFormat = useData((s) => s.settings.timeFormat);
  const cal = calendarById(calendars, task.calendarId);
  const today = todayKey();
  const overdue = task.status !== 'done' && !!task.dueDate && task.dueDate < today;
  const subDone = task.subtasks.filter((s) => s.done).length;
  const chips = [];
  if (cal && !compact)
    chips.push(
      <span key="cal" className={`meta-chip tinted c-${cal.color}`}>
        <span className="dot" />
        {cal.name}
      </span>,
    );
  if (task.scheduledStart) {
    const d = parseLocal(task.scheduledStart);
    chips.push(
      <span key="sched" className="meta-chip tinted" style={{ ['--c' as string]: 'var(--teal)' }}>
        <CalendarClock size={12} />
        {relativeDayLabel(d)} · {fmtTime(d, timeFormat)}
        {!compact && ` · ${fmtDuration(task.durationMin)}`}
      </span>,
    );
  }
  if (task.dueDate && task.status !== 'done') {
    chips.push(
      <span key="due" className={`meta-chip ${overdue ? 'warn' : ''}`}>
        <AlarmClock size={12} />
        {overdue ? 'Overdue · ' : 'Due '}
        {relativeDayLabel(parseLocal(task.dueDate))}
      </span>,
    );
  }
  if (task.priority !== 'none' && task.status !== 'done') {
    const color = task.priority === 'high' ? 'var(--coral)' : task.priority === 'medium' ? 'var(--amber)' : 'var(--slate)';
    chips.push(
      <span key="pri" className="meta-chip tinted" style={{ ['--c' as string]: color }}>
        <Flag size={12} />
        {task.priority[0].toUpperCase() + task.priority.slice(1)}
      </span>,
    );
  }
  if (task.subtasks.length) {
    chips.push(
      <span key="sub" className="meta-chip">
        <ListChecks size={12} />
        {subDone}/{task.subtasks.length}
      </span>,
    );
  }
  if (!chips.length) return null;
  return <div className="task-meta">{chips}</div>;
}

export function TaskItem({
  task,
  draggable,
  showPlan,
  compact,
}: {
  task: Task;
  draggable?: boolean;
  showPlan?: boolean;
  compact?: boolean;
}) {
  const openEditor = useUI((s) => s.openEditor);
  const cal = useData((s) => calendarById(s.calendars, task.calendarId));

  const onDragStart = (e: DragEvent) => {
    e.dataTransfer.setData('text/task-id', task.id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const next =
    task.status === 'todo'
      ? { label: 'Start', icon: <Play size={14} />, to: 'in_progress' as const }
      : task.status === 'in_progress'
        ? { label: 'Done', icon: <Check size={14} />, to: 'done' as const }
        : { label: 'Reopen', icon: <RotateCcw size={14} />, to: 'todo' as const };

  return (
    <div
      className={`task-item ${task.status === 'done' ? 'is-done' : ''} ${compact ? 'compact' : ''} ${cal ? `c-${cal.color}` : ''}`}
      draggable={draggable}
      onDragStart={draggable ? onDragStart : undefined}
      onClick={() => openEditor({ kind: 'task', id: task.id })}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter') openEditor({ kind: 'task', id: task.id });
      }}
    >
      <TaskCheck task={task} />
      <div className="task-body">
        <div className="task-title">{task.title}</div>
        <TaskMeta task={task} compact={compact} />
      </div>
      <div className="task-actions">
        {showPlan && !task.scheduledStart && task.status !== 'done' && (
          <button
            className="mini-action plan"
            onClick={(e) => {
              e.stopPropagation();
              autoPlan(task);
            }}
            title="Put it in the next free slot"
            aria-label={`Plan “${task.title}” in the next free slot`}
          >
            <Sparkles size={14} />
            <span className="mini-action-label">Plan</span>
          </button>
        )}
        {!compact && (
          <button
            className="mini-action"
            onClick={(e) => {
              e.stopPropagation();
              moveTask(task, next.to);
            }}
            title={next.label}
            aria-label={`${next.label} “${task.title}”`}
          >
            {next.icon}
            <span className="mini-action-label">{next.label}</span>
          </button>
        )}
      </div>
    </div>
  );
}

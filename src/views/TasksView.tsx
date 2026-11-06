import { useState, type DragEvent } from 'react';
import { AlarmClock, CheckCircle2, Plus, Timer, Trash2 } from 'lucide-react';
import { useData } from '../store/data';
import { useUI } from '../store/ui';
import { countByStatus, isTaskVisible, sortTasks } from '../lib/selectors';
import { useIsDesktop } from '../lib/hooks';
import { haptic } from '../lib/telegram';
import { moveTask } from '../lib/actions';
import { TaskItem } from '../components/TaskItem';
import { ChoiceDialog } from '../components/Sheet';
import type { TaskStatus } from '../types';

const COLUMNS: { status: TaskStatus; label: string; icon: typeof AlarmClock; empty: string }[] = [
  { status: 'todo', label: 'To Do', icon: AlarmClock, empty: 'Nothing waiting. Add a to-do above.' },
  { status: 'in_progress', label: 'In Progress', icon: Timer, empty: 'Start a to-do to see it here.' },
  { status: 'done', label: 'Done', icon: CheckCircle2, empty: 'Finished tasks land here.' },
];

export function TasksView() {
  const tasks = useData((s) => s.tasks);
  const calendars = useData((s) => s.calendars);
  const addTask = useData((s) => s.addTask);
  const clearCompleted = useData((s) => s.clearCompleted);
  const ui = useUI();
  const isDesktop = useIsDesktop();
  const [title, setTitle] = useState('');
  const [filter, setFilter] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [dropTarget, setDropTarget] = useState<TaskStatus | null>(null);

  const vis = tasks.filter((t) => isTaskVisible(t, calendars) && (!filter || t.calendarId === filter));
  const counts = countByStatus(vis);
  const listFor = (s: TaskStatus) => sortTasks(vis.filter((t) => t.status === s));

  const add = (status: TaskStatus) => {
    const t = title.trim();
    if (!t) return;
    addTask({ title: t, status, calendarId: filter });
    haptic.tap();
    setTitle('');
  };

  const onDrop = (e: DragEvent, status: TaskStatus) => {
    e.preventDefault();
    setDropTarget(null);
    const id = e.dataTransfer.getData('text/task-id');
    const t = tasks.find((x) => x.id === id);
    if (t) moveTask(t, status);
  };

  const quickAdd = (status: TaskStatus) => (
    <form
      className="quick-add"
      onSubmit={(e) => {
        e.preventDefault();
        add(status);
      }}
    >
      <Plus size={18} />
      <input
        placeholder={status === 'in_progress' ? 'Add something you’re working on…' : 'Add a to-do…'}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      {title && (
        <button type="submit" className="btn btn-primary btn-sm">
          Add
        </button>
      )}
    </form>
  );

  const column = (c: (typeof COLUMNS)[number]) => {
    const list = listFor(c.status);
    const Icon = c.icon;
    return (
      <section
        key={c.status}
        className={`board-col st-${c.status} ${dropTarget === c.status ? 'drop' : ''}`}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes('text/task-id')) return;
          e.preventDefault();
          setDropTarget(c.status);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropTarget(null);
        }}
        onDrop={(e) => onDrop(e, c.status)}
      >
        {isDesktop && (
          <div className="board-head">
            <span className={`status-icon sm st-${c.status}`}>
              <Icon size={15} />
            </span>
            <h3>{c.label}</h3>
            <span className="section-count">{list.length}</span>
            <span className="spacer" />
            {c.status === 'done' && list.length > 0 && (
              <button className="icon-btn sm" aria-label="Clear done tasks" title="Clear done tasks" onClick={() => setConfirmClear(true)}>
                <Trash2 size={16} />
              </button>
            )}
          </div>
        )}
        {c.status !== 'done' && (isDesktop ? c.status === 'todo' : true) && quickAdd(c.status)}
        <div className="task-list">
          {list.map((t) => (
            <TaskItem key={t.id} task={t} draggable={isDesktop} showPlan={c.status !== 'done'} />
          ))}
        </div>
        {!list.length && <div className="empty">{c.empty}</div>}
        {!isDesktop && c.status === 'done' && list.length > 0 && (
          <button className="btn btn-sm btn-ghost clear-done" onClick={() => setConfirmClear(true)}>
            <Trash2 size={15} /> Clear done tasks
          </button>
        )}
      </section>
    );
  };

  return (
    <div className="screen tasks-screen">
      <header className="screen-header">
        <h1 className="screen-title">Tasks</h1>
        <span className="spacer" />
        <span className="header-sub">
          {counts.todo} to do · {counts.in_progress} in progress
        </span>
      </header>

      <div className="tasks-filters">
        <div className="chip-row nowrap">
          <button className="chip" aria-pressed={!filter} onClick={() => setFilter(null)}>
            All
          </button>
          {calendars.map((c) => (
            <button key={c.id} className={`chip c-${c.color}`} aria-pressed={filter === c.id} onClick={() => setFilter(filter === c.id ? null : c.id)}>
              <span className="dot" />
              {c.name}
            </button>
          ))}
        </div>
      </div>

      {isDesktop ? (
        <div className="board scroll-y">{COLUMNS.map(column)}</div>
      ) : (
        <>
          <div className="status-tabs" role="tablist">
            {COLUMNS.map((c) => (
              <button
                key={c.status}
                role="tab"
                aria-selected={ui.taskTab === c.status}
                className={`status-tab st-${c.status}`}
                onClick={() => {
                  haptic.select();
                  ui.setTaskTab(c.status);
                }}
              >
                {c.label}
                <span className="tab-count">{counts[c.status]}</span>
              </button>
            ))}
          </div>
          <div className="tasks-scroll scroll-y">{column(COLUMNS.find((c) => c.status === ui.taskTab)!)}</div>
        </>
      )}

      {confirmClear && (
        <ChoiceDialog
          title="Clear done tasks?"
          message={`This permanently removes ${counts.done} completed ${counts.done === 1 ? 'task' : 'tasks'}.`}
          choices={[
            {
              label: 'Clear done tasks',
              tone: 'danger',
              onSelect: () => {
                clearCompleted();
                setConfirmClear(false);
              },
            },
          ]}
          onCancel={() => setConfirmClear(false)}
        />
      )}
    </div>
  );
}

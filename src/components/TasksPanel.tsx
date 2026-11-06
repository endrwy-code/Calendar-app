import { useState } from 'react';
import { GripVertical, Plus } from 'lucide-react';
import { useData } from '../store/data';
import { useUI } from '../store/ui';
import { isTaskVisible, sortTasks } from '../lib/selectors';
import { TaskItem } from './TaskItem';
import { startTaskDrag } from '../views/TimeGrid';
import { useIsDesktop } from '../lib/hooks';
import { haptic } from '../lib/telegram';

/** Compact To Do / In Progress list shown next to the calendar. */
export function TasksPanel() {
  const tasks = useData((s) => s.tasks);
  const calendars = useData((s) => s.calendars);
  const addTask = useData((s) => s.addTask);
  const setTab = useUI((s) => s.setTab);
  const isDesktop = useIsDesktop();
  const [title, setTitle] = useState('');

  const vis = tasks.filter((t) => isTaskVisible(t, calendars));
  const inProgress = sortTasks(vis.filter((t) => t.status === 'in_progress'));
  const todo = sortTasks(vis.filter((t) => t.status === 'todo'));
  const unscheduled = todo.filter((t) => !t.scheduledStart);
  const scheduled = todo.filter((t) => t.scheduledStart);

  const add = () => {
    const t = title.trim();
    if (!t) return;
    addTask({ title: t });
    haptic.tap();
    setTitle('');
  };

  const Group = ({ label, items, hint }: { label: string; items: typeof todo; hint?: string }) =>
    items.length ? (
      <div className="panel-group">
        <div className="panel-label">
          {label} <span>{items.length}</span>
        </div>
        {hint && <div className="panel-hint">{hint}</div>}
        <div className="task-list">
          {items.map((t) => (
            <div
              key={t.id}
              className="drag-wrap"
              draggable={isDesktop}
              onDragStart={(e) => {
                startTaskDrag(t);
                e.dataTransfer.setData('text/plain', t.id);
                e.dataTransfer.effectAllowed = 'move';
              }}
            >
              {isDesktop && <GripVertical size={14} className="grip" />}
              <TaskItem task={t} compact showPlan />
            </div>
          ))}
        </div>
      </div>
    ) : null;

  return (
    <div className="tasks-panel">
      <form
        className="quick-add"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <Plus size={18} />
        <input placeholder="Add a to-do…" value={title} onChange={(e) => setTitle(e.target.value)} />
      </form>
      <Group label="In progress" items={inProgress} />
      <Group
        label="Needs a time"
        items={unscheduled}
        hint={isDesktop ? 'Drag a task onto the calendar to block time for it.' : 'Tap Plan to put it in your next free slot.'}
      />
      <Group label="Scheduled" items={scheduled} />
      {!inProgress.length && !todo.length && (
        <div className="empty">
          <strong>All clear</strong>
          No open tasks.
        </div>
      )}
      <button className="link-btn panel-all" onClick={() => setTab('tasks')}>
        Open task board →
      </button>
    </div>
  );
}

import { useEffect, useRef } from 'react';
import { format } from 'date-fns';
import { AlignLeft, CalendarClock, CalendarPlus, ChevronRight, X } from 'lucide-react';
import { useData } from '../store/data';
import { useUI } from '../store/ui';
import { fmtTime, parseLocal, relativeDayLabel } from '../lib/dates';
import { taskBounds } from '../lib/schedule';
import { deleteTask, setStatus } from '../lib/actions';
import { Sheet } from './Sheet';
import { Segmented } from './Segmented';
import { StatusGlyph } from './StatusCircle';
import { AutoGrow } from './Fields';
import type { TaskStatus } from '../types';

const STATUS_OPTS: { value: TaskStatus; label: string }[] = [
  { value: 'todo', label: 'Not started' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'done', label: 'Done' },
];

export function TodoSheet() {
  const id = useUI((s) => s.todoId);
  if (!id) return null;
  return <TodoSheetInner key={id} id={id} />;
}

function TodoSheetInner({ id }: { id: string }) {
  const task = useData((s) => s.tasks.find((t) => t.id === id));
  const updateTask = useData((s) => s.updateTask);
  const tf = useData((s) => s.settings.timeFormat);
  const openTodo = useUI((s) => s.openTodo);
  const openSchedule = useUI((s) => s.openSchedule);
  const latest = useRef(task);
  latest.current = task;

  // Changes save as you type; an emptied title falls back on close.
  useEffect(
    () => () => {
      const t = latest.current;
      if (t && !t.title.trim()) useData.getState().updateTask(t.id, { title: 'Untitled' });
    },
    [],
  );

  if (!task) {
    // Deleted (e.g. via undo elsewhere) while open
    queueMicrotask(() => openTodo(null));
    return null;
  }

  const b = taskBounds(task);

  return (
    <Sheet
      onClose={() => openTodo(null)}
      label="To-do details"
      right={(close) => (
        <button className="text-btn bold" onClick={close}>
          Done
        </button>
      )}
    >
      {(close) => (
        <div className="form">
          <div className="todo-sheet-title">
            <span className="todo-sheet-glyph">
              <StatusGlyph status={task.status} size={24} />
            </span>
            <AutoGrow
              className="title-input"
              value={task.title}
              label="Title"
              placeholder="Title"
              singleLine
              onChange={(v) => updateTask(task.id, { title: v })}
            />
          </div>

          <Segmented
            className="full"
            label="Status"
            options={STATUS_OPTS}
            value={task.status}
            onChange={(s) => setStatus(task, s, true)}
          />

          <div className="group rows">
            <button className="row" onClick={() => openSchedule(task.id)}>
              {b ? (
                <>
                  <CalendarClock size={20} strokeWidth={1.7} className="row-icon" />
                  <span className="row-main two">
                    <span>
                      {relativeDayLabel(b.start)}
                      {relativeDayLabel(b.start).includes(' ') ? '' : `, ${format(b.start, 'd MMM')}`}
                    </span>
                    <small>
                      {fmtTime(b.start, tf)} – {fmtTime(b.end, tf)}
                    </small>
                  </span>
                  <span className="row-value">Change</span>
                </>
              ) : (
                <>
                  <CalendarPlus size={20} strokeWidth={1.7} className="row-icon" />
                  <span className="row-main">Add to calendar</span>
                </>
              )}
              <ChevronRight size={18} className="row-chev" />
            </button>
            <div className="row top">
              <AlignLeft size={20} strokeWidth={1.7} className="row-icon" />
              <AutoGrow
                className="row-input area"
                value={task.notes ?? ''}
                label="Notes"
                placeholder="Add notes"
                onChange={(v) => updateTask(task.id, { notes: v })}
              />
            </div>
          </div>

          {(task.dueDate || task.subtasks.length > 0) && (
            <>
              <div className="group-label">From earlier</div>
              <div className="group">
                {task.dueDate && (
                  <div className="cell">
                    <span className="cell-main">Due {relativeDayLabel(parseLocal(task.dueDate))}</span>
                    <button className="icon-btn sm" aria-label="Remove due date" onClick={() => updateTask(task.id, { dueDate: null })}>
                      <X size={16} />
                    </button>
                  </div>
                )}
                {task.subtasks.map((s) => (
                  <div key={s.id} className="cell">
                    <button
                      className="todo-check sm"
                      aria-label={s.done ? 'Mark step not done' : 'Complete step'}
                      onClick={() =>
                        updateTask(task.id, { subtasks: task.subtasks.map((x) => (x.id === s.id ? { ...x, done: !x.done } : x)) })
                      }
                    >
                      <StatusGlyph status={s.done ? 'done' : 'todo'} size={20} />
                    </button>
                    <span className={`cell-main ${s.done ? 'struck' : ''}`}>{s.title}</span>
                    <button
                      className="icon-btn sm"
                      aria-label="Remove step"
                      onClick={() => updateTask(task.id, { subtasks: task.subtasks.filter((x) => x.id !== s.id) })}
                    >
                      <X size={16} />
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}

          <button
            className="quiet-danger"
            onClick={() => {
              close();
              deleteTask(task);
            }}
          >
            Delete to-do
          </button>
        </div>
      )}
    </Sheet>
  );
}

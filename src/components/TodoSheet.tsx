import { useEffect, useLayoutEffect, useRef } from 'react';
import { format } from 'date-fns';
import { CalendarClock, CalendarPlus, ChevronRight, X } from 'lucide-react';
import { useData } from '../store/data';
import { useUI } from '../store/ui';
import { fmtTime, parseLocal, relativeDayLabel } from '../lib/dates';
import { taskBounds } from '../lib/schedule';
import { deleteTask, setStatus, unscheduleTask } from '../lib/actions';
import { Sheet } from './Sheet';
import { Segmented } from './Segmented';
import { StatusGlyph } from './StatusCircle';
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

function AutoGrow(props: { value: string; onChange: (v: string) => void; className?: string; placeholder?: string; label: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
  }, [props.value]);
  return (
    <textarea
      ref={ref}
      rows={1}
      className={props.className}
      value={props.value}
      placeholder={props.placeholder}
      aria-label={props.label}
      onChange={(e) => props.onChange(e.target.value)}
    />
  );
}

function TodoSheetInner({ id }: { id: string }) {
  const task = useData((s) => s.tasks.find((t) => t.id === id));
  const updateTask = useData((s) => s.updateTask);
  const tf = useData((s) => s.settings.timeFormat);
  const openTodo = useUI((s) => s.openTodo);
  const openSchedule = useUI((s) => s.openSchedule);
  const goToDate = useUI((s) => s.goToDate);
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
      title="To-do"
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
              onChange={(v) => updateTask(task.id, { title: v.replace(/\n/g, ' ') })}
            />
          </div>

          <Segmented
            className="full"
            label="Status"
            options={STATUS_OPTS}
            value={task.status}
            onChange={(s) => setStatus(task, s, true)}
          />

          <div className="group-label">Calendar</div>
          <div className="group">
            {b ? (
              <>
                <div className="cell">
                  <CalendarClock size={18} className="cell-icon" />
                  <button className="cell-main link" onClick={() => {
                    close();
                    goToDate(task.scheduledStart!.slice(0, 10));
                  }}>
                    <span>{relativeDayLabel(b.start)}{relativeDayLabel(b.start).includes(' ') ? '' : `, ${format(b.start, 'd MMM')}`}</span>
                    <small>
                      {fmtTime(b.start, tf)} – {fmtTime(b.end, tf)}
                    </small>
                  </button>
                  <button className="text-btn" onClick={() => openSchedule(task.id)}>
                    Change
                  </button>
                </div>
                <button className="cell danger" onClick={() => unscheduleTask(task)}>
                  Remove from calendar
                </button>
              </>
            ) : (
              <button className="cell action" onClick={() => openSchedule(task.id)}>
                <CalendarPlus size={18} className="cell-icon" />
                <span className="cell-main">Add to calendar</span>
                <ChevronRight size={17} className="cell-chev" />
              </button>
            )}
          </div>

          <div className="group-label">Notes</div>
          <div className="group">
            <AutoGrow
              className="cell-textarea"
              value={task.notes ?? ''}
              label="Notes"
              placeholder="Anything to remember…"
              onChange={(v) => updateTask(task.id, { notes: v })}
            />
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

          <div className="group">
            <button
              className="cell danger center"
              onClick={() => {
                close();
                deleteTask(task);
              }}
            >
              Delete to-do
            </button>
          </div>
          <p className="form-foot">Written down {format(new Date(task.createdAt), 'd MMMM yyyy')}</p>
        </div>
      )}
    </Sheet>
  );
}

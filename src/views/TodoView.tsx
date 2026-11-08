import { useMemo, useRef, useState, type UIEvent } from 'react';
import { ChevronRight, Plus } from 'lucide-react';
import { useData } from '../store/data';
import { orderTodos } from '../lib/selectors';
import { useFlip } from '../lib/useFlip';
import { haptic } from '../lib/telegram';
import { ActionSheet } from '../components/Sheet';
import { TodoRow } from './TodoRow';
import type { Task, TaskStatus } from '../types';

const SECTIONS: { status: TaskStatus; label: string }[] = [
  { status: 'in_progress', label: 'In progress' },
  { status: 'todo', label: 'Not started' },
  { status: 'done', label: 'Done' },
];

type Item = { kind: 'head'; status: TaskStatus; label: string; count: number } | { kind: 'row'; task: Task };

export function TodoView() {
  const tasks = useData((s) => s.tasks);
  const addTask = useData((s) => s.addTask);
  const clearCompleted = useData((s) => s.clearCompleted);
  const [text, setText] = useState('');
  const [showDone, setShowDone] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [stuck, setStuck] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const groups = useMemo(() => orderTodos(tasks), [tasks]);
  useFlip(listRef);

  // One flat, keyed list so a row keeps its DOM node when it moves between sections.
  const items: Item[] = [];
  for (const s of SECTIONS) {
    const list = groups[s.status];
    if (!list.length) continue;
    items.push({ kind: 'head', status: s.status, label: s.label, count: list.length });
    if (s.status === 'done' && !showDone) continue;
    for (const t of list) items.push({ kind: 'row', task: t });
  }

  const add = () => {
    const title = text.trim();
    if (!title) return;
    addTask({ title });
    haptic.tap();
    setText('');
    inputRef.current?.focus();
  };

  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    const top = composerRef.current?.offsetTop ?? 0;
    const s = e.currentTarget.scrollTop > top - 1;
    if (s !== stuck) setStuck(s);
  };

  const open = groups.todo.length + groups.in_progress.length;

  return (
    <div className="todo-scroll scroll-y" onScroll={onScroll}>
      <div className="todo-wrap">
        <figure className="quote">
          <blockquote>If you fail to plan, you are planning to fail.</blockquote>
          <figcaption>Benjamin Franklin</figcaption>
        </figure>

        <form
          ref={composerRef}
          className={`composer ${stuck ? 'stuck' : ''}`}
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <span className="composer-icon" aria-hidden>
            <Plus size={16} strokeWidth={2} />
          </span>
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Write something down…"
            aria-label="New to-do"
            enterKeyHint="done"
          />
          <button type="submit" className={`composer-add ${text.trim() ? 'show' : ''}`} tabIndex={text.trim() ? 0 : -1}>
            Add
          </button>
        </form>

        <div className="todo-list" ref={listRef}>
          {items.map((it) =>
            it.kind === 'head' ? (
              <div key={`h:${it.status}`} data-flip={`h:${it.status}`} className={`todo-head h-${it.status}`}>
                {it.status === 'done' ? (
                  <button className="todo-head-toggle" onClick={() => setShowDone((v) => !v)} aria-expanded={showDone}>
                    <span>{it.label}</span>
                    <span className="todo-count">{it.count}</span>
                    <ChevronRight size={15} className={`chev ${showDone ? 'down' : ''}`} />
                  </button>
                ) : (
                  <>
                    <span>{it.label}</span>
                    <span className="todo-count">{it.count}</span>
                  </>
                )}
                {it.status === 'done' && showDone && (
                  <button className="text-btn small" onClick={() => setConfirmClear(true)}>
                    Clear
                  </button>
                )}
              </div>
            ) : (
              <TodoRow key={it.task.id} task={it.task} vanishOnDone={!showDone} />
            ),
          )}
        </div>

        {open === 0 && (
          <div className="todo-empty">
            {tasks.length ? 'All clear. Nice work.' : 'Nothing written down yet.'}
            <span>Anything on your mind? Add it above.</span>
          </div>
        )}

        {tasks.length > 0 && open > 0 && (
          <p className="todo-hint">Tap a circle to tick it off. Swipe right to start, left to schedule or delete.</p>
        )}
      </div>

      {confirmClear && (
        <ActionSheet
          title={`Clear ${groups.done.length} done ${groups.done.length === 1 ? 'to-do' : 'to-dos'}?`}
          message="They’ll be removed for good."
          choices={[
            {
              label: 'Clear done',
              tone: 'danger',
              onSelect: () => {
                clearCompleted();
                setConfirmClear(false);
                setShowDone(false);
              },
            },
          ]}
          onCancel={() => setConfirmClear(false)}
        />
      )}
    </div>
  );
}

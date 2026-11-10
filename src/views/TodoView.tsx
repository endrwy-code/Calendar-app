import { useMemo, useRef, useState, type UIEvent } from 'react';
import { format } from 'date-fns';
import { ChevronRight } from 'lucide-react';
import { useData } from '../store/data';
import { useUI } from '../store/ui';
import { orderTodos } from '../lib/selectors';
import { useFlip } from '../lib/useFlip';
import { haptic } from '../lib/telegram';
import { ActionSheet } from '../components/Sheet';
import { MenuIcon, PlusIcon } from '../components/Icons';
import { TodoRow, type RowPos } from './TodoRow';
import type { Task, TaskStatus } from '../types';

const SECTIONS: { status: TaskStatus; label: string }[] = [
  { status: 'in_progress', label: 'In progress' },
  { status: 'todo', label: 'Not started' },
  { status: 'done', label: 'Done' },
];

type Item = { kind: 'head'; status: TaskStatus; label: string; count: number } | { kind: 'row'; task: Task; pos: RowPos };

export function TodoView() {
  const tasks = useData((s) => s.tasks);
  const addTask = useData((s) => s.addTask);
  const clearCompleted = useData((s) => s.clearCompleted);
  const setMenuOpen = useUI((s) => s.setMenuOpen);
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
  // Each section is drawn as a card: rows know whether they open or close it.
  const items: Item[] = [];
  for (const s of SECTIONS) {
    const list = groups[s.status];
    if (!list.length) continue;
    items.push({ kind: 'head', status: s.status, label: s.label, count: list.length });
    if (s.status === 'done' && !showDone) continue;
    list.forEach((t, i) => {
      const pos: RowPos = list.length === 1 ? 'only' : i === 0 ? 'first' : i === list.length - 1 ? 'last' : 'mid';
      items.push({ kind: 'row', task: t, pos });
    });
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
    const s = e.currentTarget.scrollTop > top - 2;
    if (s !== stuck) setStuck(s);
  };

  const open = groups.todo.length + groups.in_progress.length;

  return (
    <>
      <header className="bar todo-bar">
        <button className="icon-btn bar-btn" aria-label="Menu" onClick={() => setMenuOpen(true)}>
          <MenuIcon />
        </button>
        <span className="bar-date">{format(new Date(), 'EEEE, d MMMM')}</span>
        <span className="bar-btn-space" />
      </header>
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
          <label className="composer-field">
            <span className="composer-icon" aria-hidden>
              <PlusIcon size={18} />
            </span>
            <input
              ref={inputRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Add a to-do"
              aria-label="New to-do"
              enterKeyHint="done"
            />
            <button type="submit" className={`composer-add ${text.trim() ? 'show' : ''}`} tabIndex={text.trim() ? 0 : -1}>
              Add
            </button>
          </label>
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
              <TodoRow key={it.task.id} task={it.task} pos={it.pos} vanishOnDone={!showDone} />
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
    </>
  );
}

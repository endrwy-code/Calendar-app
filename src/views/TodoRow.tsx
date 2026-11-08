import { memo, useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { CalendarClock, CalendarPlus, Pause, Play, Trash2 } from 'lucide-react';
import type { Task } from '../types';
import { useData } from '../store/data';
import { useUI } from '../store/ui';
import { fmtTime, parseLocal, relativeDayLabel, todayKey } from '../lib/dates';
import { deleteTask, setStatus, toggleDone, toggleStarted } from '../lib/actions';
import { animateSpring, project, rubberBand, VelocityTracker, type SpringAnimation } from '../lib/motion';
import { haptic } from '../lib/telegram';
import { StatusGlyph } from '../components/StatusCircle';

const ACTION_W = 74;
const LEAD_TRIGGER = 72;

/* Only one row is swiped open at a time; touching anything else closes it. */
let closeOpenRow: (() => void) | null = null;
if (typeof window !== 'undefined') {
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (closeOpenRow && !(e.target as HTMLElement).closest?.('.todo-row.is-open')) closeOpenRow();
    },
    true,
  );
}

export const TodoRow = memo(function TodoRow({ task, vanishOnDone }: { task: Task; vanishOnDone: boolean }) {
  const openTodo = useUI((s) => s.openTodo);
  const openSchedule = useUI((s) => s.openSchedule);
  const goToDate = useUI((s) => s.goToDate);
  const tf = useData((s) => s.settings.timeFormat);

  const rowRef = useRef<HTMLDivElement>(null);
  const faceRef = useRef<HTMLDivElement>(null);
  const leadRef = useRef<HTMLDivElement>(null);
  const trailRef = useRef<HTMLDivElement>(null);
  const x = useRef(0);
  const anim = useRef<SpringAnimation | null>(null);
  const [side, setSide] = useState<0 | 1 | -1>(0);
  const [armed, setArmed] = useState(false);
  const [open, setOpen] = useState(false);
  const [completing, setCompleting] = useState<'idle' | 'checked' | 'vanish'>('idle');
  const timers = useRef<number[]>([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  // A status change from elsewhere (sheet, undo) resets the pending tick.
  useEffect(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    setCompleting('idle');
  }, [task.status]);

  const apply = (v: number) => {
    x.current = v;
    if (faceRef.current) faceRef.current.style.transform = v ? `translate3d(${v}px,0,0)` : '';
    if (leadRef.current) leadRef.current.style.width = `${Math.max(0, v)}px`;
    if (trailRef.current) trailRef.current.style.width = `${Math.max(0, -v)}px`;
    const s = v > 0.5 ? 1 : v < -0.5 ? -1 : 0;
    setSide((p) => (p === s ? p : s));
  };

  const springTo = (to: number, velocity = 0, done?: () => void) => {
    anim.current?.stop();
    anim.current = animateSpring({
      from: x.current,
      to,
      velocity,
      dampingRatio: to === 0 ? 1 : 0.86,
      response: 0.34,
      restDelta: 0.5,
      restSpeed: 10,
      onUpdate: apply,
      onComplete: () => {
        anim.current = null;
        done?.();
      },
    });
  };

  const close = () => {
    setOpen(false);
    setArmed(false);
    if (closeOpenRow === close) closeOpenRow = null;
    springTo(0);
  };

  /* ---------- Swipe gesture ---------- */
  const g = useRef<{ id: number; x0: number; y0: number; base: number; mode: 'pending' | 'h' | 'v'; dragged: boolean } | null>(null);
  const tracker = useRef(new VelocityTracker());

  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' || g.current) return;
    anim.current?.stop();
    anim.current = null;
    g.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, base: x.current, mode: 'pending', dragged: false };
    tracker.current.reset();
    tracker.current.add(e.clientX, 0, e.timeStamp);
  };

  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    const s = g.current;
    if (!s || s.id !== e.pointerId) return;
    const dx = e.clientX - s.x0;
    const dy = e.clientY - s.y0;
    if (s.mode === 'pending') {
      if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 1.2) {
        s.mode = 'h';
        s.dragged = true;
        e.currentTarget.setPointerCapture(e.pointerId);
      } else if (Math.abs(dy) > 8) {
        s.mode = 'v';
        return;
      } else return;
    }
    if (s.mode !== 'h') return;
    tracker.current.add(e.clientX, 0, e.timeStamp);
    const w = rowRef.current?.offsetWidth ?? 360;
    let v = s.base + dx;
    if (v > 0) v = Math.min(v, LEAD_TRIGGER * 1.4) + (v > LEAD_TRIGGER * 1.4 ? rubberBand(v - LEAD_TRIGGER * 1.4, w) : 0);
    apply(v);
    const nowArmed = v > LEAD_TRIGGER || v < -w * 0.55;
    if (nowArmed !== armed) {
      setArmed(nowArmed);
      haptic.tap();
    }
  };

  const onPointerUp = (e: RPointerEvent<HTMLDivElement>) => {
    const s = g.current;
    if (!s || s.id !== e.pointerId) return;
    g.current = null;
    if (s.mode !== 'h') {
      if (x.current !== 0 && !open) springTo(0);
      return;
    }
    const w = rowRef.current?.offsetWidth ?? 360;
    tracker.current.add(e.clientX, 0, e.timeStamp);
    const vx = tracker.current.velocity(e.timeStamp).x;
    const projected = x.current + project(vx, 0.99);
    setArmed(false);
    if (x.current > 0) {
      // Leading: start / pause
      if (x.current > LEAD_TRIGGER || (projected > LEAD_TRIGGER * 1.8 && x.current > 24)) {
        toggleStarted(task);
      }
      setOpen(false);
      springTo(0, vx);
      return;
    }
    // Trailing: full swipe deletes, partial opens the buttons.
    if (x.current < -w * 0.55 || (projected < -w * 0.85 && x.current < -ACTION_W)) {
      springTo(-w, vx, () => deleteTask(task));
      return;
    }
    if (projected < -ACTION_W * 0.9) {
      setOpen(true);
      closeOpenRow?.();
      closeOpenRow = close;
      springTo(-ACTION_W * 2, vx);
    } else {
      setOpen(false);
      springTo(0, vx);
    }
  };

  const onPointerCancel = (e: RPointerEvent<HTMLDivElement>) => {
    if (g.current?.id !== e.pointerId) return;
    const wasH = g.current.mode === 'h';
    g.current = null;
    if (wasH && !open) springTo(0);
  };

  /* ---------- Tick off: check, pause a beat, then move to Done ---------- */
  const onCheck = () => {
    if (task.status === 'done') return toggleDone(task);
    if (completing !== 'idle') {
      timers.current.forEach(clearTimeout);
      timers.current = [];
      setCompleting('idle');
      return;
    }
    haptic.tap();
    setCompleting('checked');
    if (vanishOnDone) timers.current.push(window.setTimeout(() => setCompleting('vanish'), 560));
    timers.current.push(window.setTimeout(() => setStatus(task, 'done'), vanishOnDone ? 760 : 620));
  };

  const shownStatus = completing !== 'idle' ? 'done' : task.status;
  const sched = task.scheduledStart ? parseLocal(task.scheduledStart) : null;
  const late = !!sched && task.status !== 'done' && sched.getTime() + task.durationMin * 60000 < Date.now();
  const noteLine = task.notes?.split('\n').find((l) => l.trim());
  const subDone = task.subtasks.filter((s) => s.done).length;
  const due = task.dueDate && task.status !== 'done' ? parseLocal(task.dueDate) : null;

  return (
    <div
      ref={rowRef}
      className={`todo-row ${open ? 'is-open' : ''} ${completing === 'vanish' ? 'vanish' : ''}`}
      data-flip={task.id}
    >
      <div ref={leadRef} className={`swipe-lead ${task.status === 'in_progress' ? 'pause' : ''} ${armed && side === 1 ? 'armed' : ''}`} aria-hidden={side !== 1}>
        <span className="swipe-icon">{task.status === 'in_progress' ? <Pause size={18} /> : <Play size={18} />}</span>
        <span className="swipe-label">{task.status === 'in_progress' ? 'Pause' : 'Start'}</span>
      </div>
      <div ref={trailRef} className={`swipe-trail ${armed && side === -1 ? 'armed' : ''}`} aria-hidden={side !== -1}>
        <button
          className="swipe-btn cal"
          tabIndex={-1}
          onClick={() => {
            close();
            openSchedule(task.id);
          }}
        >
          <CalendarPlus size={18} />
          <span>Calendar</span>
        </button>
        <button className="swipe-btn del" tabIndex={-1} onClick={() => springTo(-(rowRef.current?.offsetWidth ?? 360), 0, () => deleteTask(task))}>
          <Trash2 size={18} />
          <span>Delete</span>
        </button>
      </div>

      <div
        ref={faceRef}
        className={`todo-face s-${shownStatus}`}
        role="button"
        tabIndex={0}
        aria-label={`${task.title}. Open details`}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && e.target === e.currentTarget) openTodo(task.id);
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onClick={(e) => {
          if (open) {
            e.stopPropagation();
            close();
            return;
          }
          if ((e.target as HTMLElement).closest('button')) return;
          openTodo(task.id);
        }}
      >
        <button
          className="todo-check"
          onClick={onCheck}
          aria-label={task.status === 'done' ? `Mark “${task.title}” as not done` : `Complete “${task.title}”`}
        >
          <StatusGlyph status={shownStatus} />
        </button>
        <div className="todo-text">
          <span className="todo-title">{task.title}</span>
          {(sched || noteLine || due || task.subtasks.length > 0) && (
            <span className="todo-meta">
              {sched && (
                <button
                  className={`todo-when ${late ? 'late' : ''}`}
                  onClick={() => goToDate(task.scheduledStart!.slice(0, 10))}
                  aria-label="Show on calendar"
                >
                  <CalendarClock size={12.5} />
                  {relativeDayLabel(sched)}, {fmtTime(sched, tf)}
                </button>
              )}
              {due && (
                <span className={`todo-due ${task.dueDate! < todayKey() ? 'late' : ''}`}>Due {relativeDayLabel(due)}</span>
              )}
              {task.subtasks.length > 0 && (
                <span>
                  {subDone}/{task.subtasks.length} steps
                </span>
              )}
              {noteLine && <span className="todo-note">{noteLine}</span>}
            </span>
          )}
        </div>
        <div className="todo-hover" aria-hidden>
          <button tabIndex={-1} title={task.status === 'in_progress' ? 'Pause' : 'Start'} onClick={() => toggleStarted(task)}>
            {task.status === 'in_progress' ? <Pause size={15} /> : <Play size={15} />}
          </button>
          <button tabIndex={-1} title="Add to calendar" onClick={() => openSchedule(task.id)}>
            <CalendarPlus size={15} />
          </button>
          <button tabIndex={-1} title="Delete" onClick={() => deleteTask(task)}>
            <Trash2 size={15} />
          </button>
        </div>
      </div>
    </div>
  );
});

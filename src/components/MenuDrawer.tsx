import { useCallback, useEffect, useLayoutEffect, useRef, type PointerEvent as RPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { format } from 'date-fns';
import { Check, Settings } from 'lucide-react';
import { useData } from '../store/data';
import { useUI } from '../store/ui';
import { animateSpring, project, rubberBand, VelocityTracker, type SpringAnimation } from '../lib/motion';
import { haptic } from '../lib/telegram';
import { overlayStack } from './Sheet';
import { ViewIcon } from './Icons';
import type { ViewMode } from '../types';

export const VIEW_LABELS: Record<ViewMode, string> = {
  day: 'Day',
  '3day': '3 days',
  week: 'Week',
  month: 'Month',
  agenda: 'List',
};

export function MenuDrawer() {
  const open = useUI((s) => s.menuOpen);
  const setOpen = useUI((s) => s.setMenuOpen);
  if (!open) return null;
  return <Drawer onClose={() => setOpen(false)} />;
}

/**
 * Side menu that slides in from the left (as in Proton and Google Calendar).
 * It follows the finger when dragged closed and settles with a spring that
 * starts at the finger's speed.
 */
function Drawer({ onClose }: { onClose: () => void }) {
  const view = useData((s) => s.settings.calendarView);
  const calendars = useData((s) => s.calendars);
  const toggleCalendar = useData((s) => s.toggleCalendar);
  const updateSettings = useData((s) => s.updateSettings);
  const setTab = useUI((s) => s.setTab);
  const setSettingsOpen = useUI((s) => s.setSettingsOpen);

  const panelRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const progress = useRef(0);
  const anim = useRef<SpringAnimation | null>(null);
  const closing = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const apply = useCallback((p: number) => {
    progress.current = p;
    const el = panelRef.current;
    const bd = backdropRef.current;
    if (!el || !bd) return;
    const w = el.offsetWidth || 1;
    el.style.transform = `translate3d(${(p - 1) * w}px, 0, 0)`;
    bd.style.opacity = String(Math.max(0, Math.min(1, p)));
  }, []);

  const animateTo = useCallback(
    (to: number, velocity = 0, done?: () => void) => {
      anim.current?.stop();
      anim.current = animateSpring({
        from: progress.current,
        to,
        velocity,
        dampingRatio: to === 1 ? 0.9 : 1,
        response: to === 1 ? 0.4 : 0.3,
        restDelta: 0.0015,
        restSpeed: 0.02,
        onUpdate: apply,
        onComplete: () => {
          anim.current = null;
          done?.();
        },
      });
    },
    [apply],
  );

  const entry = useRef({ close: () => {} });
  const close = useCallback(
    (velocity = 0) => {
      if (closing.current) return;
      closing.current = true;
      overlayStack.remove(entry.current);
      animateTo(0, velocity, () => onCloseRef.current());
    },
    [animateTo],
  );
  entry.current.close = () => close(0);

  useLayoutEffect(() => {
    apply(0);
    animateTo(1);
    const e = entry.current;
    overlayStack.push(e);
    return () => {
      anim.current?.stop();
      overlayStack.remove(e);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && overlayStack.isTop(entry.current)) close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  /* ---------- Drag to close ---------- */
  const tracker = useRef(new VelocityTracker());
  const g = useRef<{ id: number; x0: number; y0: number; p0: number; mode: 'pending' | 'h' | 'v' } | null>(null);

  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (closing.current || g.current) return;
    g.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, p0: progress.current, mode: 'pending' };
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
        anim.current?.stop();
        anim.current = null;
        s.p0 = progress.current;
        s.x0 = e.clientX;
        e.currentTarget.setPointerCapture(e.pointerId);
      } else if (Math.abs(dy) > 8) {
        s.mode = 'v';
        return;
      } else return;
    }
    if (s.mode !== 'h') return;
    tracker.current.add(e.clientX, 0, e.timeStamp);
    const w = panelRef.current?.offsetWidth || 1;
    let x = (s.p0 - 1) * w + (e.clientX - s.x0);
    if (x > 0) x = rubberBand(x, w * 0.5);
    apply(1 + x / w);
  };
  const onPointerUp = (e: RPointerEvent<HTMLDivElement>) => {
    const s = g.current;
    if (!s || s.id !== e.pointerId) return;
    g.current = null;
    if (s.mode !== 'h') return;
    const w = panelRef.current?.offsetWidth || 1;
    tracker.current.add(e.clientX, 0, e.timeStamp);
    const vx = tracker.current.velocity(e.timeStamp).x;
    const x = (progress.current - 1) * w;
    if (x + project(vx, 0.99) < -w * 0.4 && vx < 50) close(vx / w);
    else animateTo(1, vx / w);
  };

  const pickView = (v: ViewMode) => {
    haptic.select();
    updateSettings({ calendarView: v });
    setTab('calendar');
    close();
  };

  const today = new Date();

  return createPortal(
    <div className="drawer-layer">
      <div className="sheet-backdrop" ref={backdropRef} onClick={() => close()} />
      <div
        ref={panelRef}
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="drawer-head">
          <div className="drawer-brand">Daybook</div>
          <div className="drawer-date">{format(today, 'EEEE, d MMMM')}</div>
        </div>

        <div className="drawer-body scroll-y">
          <div className="drawer-label">View</div>
          {(Object.keys(VIEW_LABELS) as ViewMode[]).map((v) => {
            const on = view === v;
            return (
              <button key={v} className={`drawer-item ${on ? 'on' : ''}`} aria-current={on || undefined} onClick={() => pickView(v)}>
                <ViewIcon view={v} />
                <span>{VIEW_LABELS[v]}</span>
              </button>
            );
          })}

          <div className="drawer-sep" />
          <div className="drawer-label">
            Tags
            <button
              className="drawer-link"
              onClick={() => {
                close();
                setSettingsOpen(true);
              }}
            >
              Edit
            </button>
          </div>
          {calendars.map((c) => (
            <button
              key={c.id}
              role="menuitemcheckbox"
              aria-checked={c.visible}
              className={`drawer-item cal c-${c.color} ${c.visible ? '' : 'off'}`}
              onClick={() => {
                haptic.select();
                toggleCalendar(c.id);
              }}
            >
              <span className="drawer-cal-dot" />
              <span>{c.name}</span>
              <span className="drawer-check">{c.visible && <Check size={18} strokeWidth={2.2} />}</span>
            </button>
          ))}

        </div>

        <div className="drawer-foot">
          <button
            className="drawer-item"
            onClick={() => {
              close();
              setSettingsOpen(true);
            }}
          >
            <Settings size={22} strokeWidth={1.6} />
            <span>Settings</span>
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

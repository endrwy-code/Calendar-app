import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useMediaQuery } from '../lib/hooks';
import { animateSpring, project, rubberBand, VelocityTracker, type SpringAnimation } from '../lib/motion';

/* Open sheets, top-most last. Telegram's back button and Escape close the top one with its animation. */
const stack: { close: () => void }[] = [];
export function closeTopSheet(): boolean {
  const top = stack[stack.length - 1];
  if (!top) return false;
  top.close();
  return true;
}

export function Sheet(props: {
  onClose: () => void;
  title?: ReactNode;
  /** Header slots, iOS style: e.g. Cancel on the left, Save on the right. Receive `close` to animate out first. */
  left?: (close: () => void) => ReactNode;
  right?: (close: () => void) => ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  size?: 'auto' | 'large';
  label?: string;
  className?: string;
}) {
  const { onClose, title, left, right, children, size = 'auto', label, className } = props;
  const wide = useMediaQuery('(min-width: 720px)');
  const sheetRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const progress = useRef(0);
  const anim = useRef<SpringAnimation | null>(null);
  const closing = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const wideRef = useRef(wide);
  wideRef.current = wide;

  /** p = 1 fully open, 0 fully closed. Above 1 = stretched upward. */
  const apply = useCallback((p: number) => {
    progress.current = p;
    const el = sheetRef.current;
    const bd = backdropRef.current;
    if (!el || !bd) return;
    if (wideRef.current) {
      el.style.opacity = String(Math.max(0, Math.min(1, p)));
      el.style.transform = `translate(-50%, -50%) scale(${0.94 + 0.06 * Math.min(1, p)})`;
    } else {
      const h = el.offsetHeight || 1;
      el.style.transform = `translate3d(0, ${(1 - p) * h}px, 0)`;
    }
    bd.style.opacity = String(Math.max(0, Math.min(1, p)));
  }, []);

  const animateTo = useCallback(
    (to: number, velocity = 0, done?: () => void) => {
      anim.current?.stop();
      anim.current = animateSpring({
        from: progress.current,
        to,
        velocity,
        dampingRatio: to === 1 ? 0.92 : 1,
        response: to === 1 ? 0.42 : 0.3,
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

  const entry = useRef<{ close: () => void }>({ close: () => {} });
  const close = useCallback(
    (velocity = 0) => {
      if (closing.current) return;
      closing.current = true;
      const i = stack.indexOf(entry.current);
      if (i >= 0) stack.splice(i, 1);
      animateTo(0, velocity, () => onCloseRef.current());
    },
    [animateTo],
  );
  const closePlain = useCallback(() => close(0), [close]);
  entry.current.close = closePlain;

  useLayoutEffect(() => {
    apply(0);
    animateTo(1);
    const e = entry.current;
    stack.push(e);
    return () => {
      anim.current?.stop();
      const i = stack.indexOf(e);
      if (i >= 0) stack.splice(i, 1);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && stack[stack.length - 1] === entry.current) close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  /* ---------- Drag to dismiss (phone layout) ---------- */
  const tracker = useRef(new VelocityTracker());
  const dragStart = useRef<{ y: number; p: number } | null>(null);

  const dragMove = (clientY: number, t: number) => {
    const el = sheetRef.current;
    const s = dragStart.current;
    if (!el || !s) return;
    const h = el.offsetHeight || 1;
    tracker.current.add(0, clientY, t);
    let y = (1 - s.p) * h + (clientY - s.y);
    if (y < 0) y = rubberBand(y, h * 0.6);
    apply(1 - y / h);
  };
  const dragEnd = (t: number) => {
    const el = sheetRef.current;
    if (!el || !dragStart.current) return;
    dragStart.current = null;
    const h = el.offsetHeight || 1;
    const vy = tracker.current.velocity(t).y;
    const y = (1 - progress.current) * h;
    const projected = y + project(vy, 0.99);
    if (projected > h * 0.45 && vy > -50) close(-vy / h);
    else animateTo(1, -vy / h);
  };
  const grab = (clientY: number, t: number) => {
    anim.current?.stop();
    anim.current = null;
    tracker.current.reset();
    tracker.current.add(0, clientY, t);
    dragStart.current = { y: clientY, p: progress.current };
  };

  // Header & grabber: pointer events
  const headHandlers = wide
    ? {}
    : {
        onPointerDown: (e: RPointerEvent) => {
          if ((e.target as HTMLElement).closest('button, input, textarea, select, a')) return;
          if (closing.current) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          grab(e.clientY, e.timeStamp);
        },
        onPointerMove: (e: RPointerEvent) => dragStart.current && dragMove(e.clientY, e.timeStamp),
        onPointerUp: (e: RPointerEvent) => dragEnd(e.timeStamp),
        onPointerCancel: (e: RPointerEvent) => dragEnd(e.timeStamp),
      };

  // Body: when it's scrolled to the top, pulling down drags the sheet instead of scrolling.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body || wide) return;
    let startY = 0;
    let atTop = false;
    let active = false;
    const start = (e: TouchEvent) => {
      if (e.touches.length !== 1 || closing.current) return;
      startY = e.touches[0].clientY;
      atTop = body.scrollTop <= 0;
      active = false;
    };
    const move = (e: TouchEvent) => {
      if (!atTop || closing.current) return;
      const y = e.touches[0].clientY;
      if (!active) {
        if (y - startY > 6 && body.scrollTop <= 0) {
          active = true;
          grab(y, e.timeStamp);
        } else if (y - startY < -4) {
          atTop = false;
          return;
        } else return;
      }
      e.preventDefault();
      dragMove(y, e.timeStamp);
    };
    const end = (e: TouchEvent) => {
      if (active) dragEnd(e.timeStamp);
      active = false;
    };
    body.addEventListener('touchstart', start, { passive: true });
    body.addEventListener('touchmove', move, { passive: false });
    body.addEventListener('touchend', end);
    body.addEventListener('touchcancel', end);
    return () => {
      body.removeEventListener('touchstart', start);
      body.removeEventListener('touchmove', move);
      body.removeEventListener('touchend', end);
      body.removeEventListener('touchcancel', end);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wide]);

  return createPortal(
    <div className="sheet-layer">
      <div className="sheet-backdrop" ref={backdropRef} onClick={() => close()} />
      <div
        ref={sheetRef}
        className={`sheet ${size === 'large' ? 'large' : ''} ${className ?? ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={label ?? (typeof title === 'string' ? title : undefined)}
      >
        <div className="sheet-head" {...headHandlers}>
          <div className="sheet-grabber" />
          <div className="sheet-bar">
            <div className="sheet-slot left">{left?.(closePlain)}</div>
            <h2 className="sheet-title">{title}</h2>
            <div className="sheet-slot right">{right?.(closePlain)}</div>
          </div>
        </div>
        <div className="sheet-body scroll-y" ref={bodyRef}>
          {typeof children === 'function' ? children(closePlain) : children}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export interface Choice {
  label: string;
  onSelect: () => void;
  tone?: 'default' | 'danger' | 'bold';
}

/** iOS-style action sheet: choices in one card, Cancel in its own card underneath. */
export function ActionSheet(props: { title?: string; message?: string; choices: Choice[]; onCancel: () => void }) {
  const { title, message, choices, onCancel } = props;
  const [leaving, setLeaving] = useState(false);
  const finish = (fn: () => void) => {
    setLeaving(true);
    setTimeout(fn, 180);
  };
  return createPortal(
    <div className={`action-layer ${leaving ? 'leaving' : ''}`}>
      <div className="sheet-backdrop" onClick={() => finish(onCancel)} />
      <div className="action-sheet" role="alertdialog" aria-modal="true" aria-label={title}>
        <div className="action-group">
          {(title || message) && (
            <div className="action-head">
              {title && <strong>{title}</strong>}
              {message && <p>{message}</p>}
            </div>
          )}
          {choices.map((c) => (
            <button key={c.label} className={`action-btn ${c.tone ?? ''}`} onClick={() => finish(c.onSelect)}>
              {c.label}
            </button>
          ))}
        </div>
        <button className="action-btn cancel" onClick={() => finish(onCancel)}>
          Cancel
        </button>
      </div>
    </div>,
    document.body,
  );
}

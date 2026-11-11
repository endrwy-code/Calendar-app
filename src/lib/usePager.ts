import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { animateSpring, project, VelocityTracker, type SpringAnimation } from './motion';

/**
 * Finger-tracking horizontal pager.
 *
 * The caller renders three panes (previous / current / next) inside one or
 * more "tracks" (e.g. the day-header row and the time grid). While a finger
 * drags sideways, every track moves 1:1 with it. On release, the momentum is
 * projected forward to decide whether to settle on the neighbour or spring
 * back, and the spring starts with the finger's velocity. Grabbing the
 * content while it's still moving catches it mid-flight.
 *
 * `onCommit(dir)` must update the period synchronously (use `flushSync`) so
 * the re-keyed panes and the reset of the track land in the same frame.
 */
export function usePager(opts: {
  rootRef: RefObject<HTMLElement | null>;
  trackRefs: RefObject<HTMLElement | null>[];
  getWidth: () => number;
  onCommit: (dir: 1 | -1) => void;
  onSettle?: () => void;
  enabled?: boolean;
  /** While true (e.g. during a pinch), finger movement doesn't page. */
  isBlocked?: () => boolean;
}) {
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const x = useRef(0);
  const anim = useRef<SpringAnimation | null>(null);
  const pendingDir = useRef<0 | 1 | -1>(0);

  const apply = useCallback((v: number) => {
    x.current = v;
    for (const r of optsRef.current.trackRefs) {
      const el = r.current;
      if (el) el.style.transform = v ? `translate3d(${v}px,0,0)` : '';
    }
  }, []);

  const commit = useCallback(
    (dir: 1 | -1) => {
      pendingDir.current = 0;
      optsRef.current.onCommit(dir);
      apply(0);
      optsRef.current.onSettle?.();
    },
    [apply],
  );

  /** Animate to a resting point: -width (next), 0 (stay) or +width (previous). */
  const settle = useCallback(
    (target: number, velocity = 0) => {
      anim.current?.stop();
      const dir: 0 | 1 | -1 = target < 0 ? 1 : target > 0 ? -1 : 0;
      pendingDir.current = dir;
      anim.current = animateSpring({
        from: x.current,
        to: target,
        velocity,
        dampingRatio: 1,
        response: dir ? 0.34 : 0.3,
        restDelta: 0.5,
        restSpeed: 20,
        onUpdate: apply,
        onComplete: () => {
          anim.current = null;
          if (dir) commit(dir);
          else {
            pendingDir.current = 0;
            optsRef.current.onSettle?.();
          }
        },
      });
    },
    [apply, commit],
  );

  /** Programmatic paging (arrow buttons, keyboard). Rapid presses finish the previous page first. */
  const go = useCallback(
    (dir: 1 | -1) => {
      if (anim.current) {
        anim.current.stop();
        anim.current = null;
        if (pendingDir.current) commit(pendingDir.current as 1 | -1);
      }
      const w = optsRef.current.getWidth();
      if (!w) {
        optsRef.current.onCommit(dir);
        return;
      }
      settle(-dir * w, 0);
    },
    [commit, settle],
  );

  useEffect(() => {
    const root = opts.rootRef.current;
    if (!root || opts.enabled === false) return;
    const tracker = new VelocityTracker();
    let id: number | null = null;
    let mode: 'idle' | 'pending' | 'h' | 'v' = 'idle';
    let downX = 0;
    let downY = 0;
    let base = 0;
    let suppressClick = false;

    const down = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' || id !== null) return;
      id = e.pointerId;
      mode = 'pending';
      downX = e.clientX;
      downY = e.clientY;
      suppressClick = false;
      // Catch a page that's still moving.
      if (anim.current) {
        anim.current.stop();
        anim.current = null;
        suppressClick = true;
      }
      base = x.current;
      tracker.reset();
      tracker.add(e.clientX, e.clientY, e.timeStamp);
    };

    const move = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      if (optsRef.current.isBlocked?.()) {
        id = null;
        if (mode === 'h' || x.current !== 0) release(0);
        mode = 'idle';
        return;
      }
      const dx = e.clientX - downX;
      const dy = e.clientY - downY;
      if (mode === 'pending') {
        if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 1.15) {
          mode = 'h';
          suppressClick = true;
          try {
            root.setPointerCapture(e.pointerId);
          } catch {
            /* ignore */
          }
        } else if (Math.abs(dy) > 8) {
          mode = 'v';
          if (x.current !== 0) release(0);
          return;
        } else return;
      }
      if (mode !== 'h') return;
      tracker.add(e.clientX, e.clientY, e.timeStamp);
      apply(base + dx);
    };

    const release = (vx: number) => {
      const w = optsRef.current.getWidth();
      const projected = x.current + project(vx, 0.996);
      let target = 0;
      if (Math.abs(projected) > w * 0.5 || (Math.abs(vx) > 650 && Math.sign(vx) === Math.sign(x.current))) {
        target = projected < 0 ? -w : w;
      }
      // Never fling more than one page from where the gesture started.
      settle(target, vx);
    };

    const up = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = null;
      const wasH = mode === 'h';
      mode = 'idle';
      if (wasH) {
        tracker.add(e.clientX, e.clientY, e.timeStamp);
        release(tracker.velocity(e.timeStamp).x);
      } else if (x.current !== 0 && !anim.current) {
        release(0);
      }
    };

    const cancel = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = null;
      mode = 'idle';
      if (x.current !== 0) release(0);
    };

    const click = (e: MouseEvent) => {
      if (suppressClick) {
        e.stopPropagation();
        e.preventDefault();
        suppressClick = false;
      }
    };

    root.addEventListener('pointerdown', down);
    root.addEventListener('pointermove', move);
    root.addEventListener('pointerup', up);
    root.addEventListener('pointercancel', cancel);
    root.addEventListener('click', click, true);
    return () => {
      root.removeEventListener('pointerdown', down);
      root.removeEventListener('pointermove', move);
      root.removeEventListener('pointerup', up);
      root.removeEventListener('pointercancel', cancel);
      root.removeEventListener('click', click, true);
    };
  }, [opts.rootRef, opts.enabled, apply, settle]);

  useEffect(() => () => anim.current?.stop(), []);

  return { go };
}

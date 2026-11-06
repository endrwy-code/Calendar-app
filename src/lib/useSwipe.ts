import { useEffect, type RefObject } from 'react';

/** Horizontal swipe detection for touch devices (ignores mostly-vertical gestures). */
export function useSwipe(ref: RefObject<HTMLElement | null>, onSwipe: (dir: 1 | -1) => void) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let x0 = 0;
    let y0 = 0;
    let t0 = 0;
    let tracking = false;
    const start = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      tracking = true;
      x0 = e.touches[0].clientX;
      y0 = e.touches[0].clientY;
      t0 = Date.now();
    };
    const end = (e: TouchEvent) => {
      if (!tracking) return;
      tracking = false;
      const t = e.changedTouches[0];
      const dx = t.clientX - x0;
      const dy = t.clientY - y0;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.6 && Date.now() - t0 < 700) {
        onSwipe(dx < 0 ? 1 : -1);
      }
    };
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchend', end, { passive: true });
    return () => {
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchend', end);
    };
  }, [ref, onSwipe]);
}

import { useLayoutEffect, useRef, type RefObject } from 'react';
import { prefersReducedMotion, springEasing, SPRING_MS } from './motion';

/**
 * FLIP list animation: children marked with `data-flip="<key>"` glide from
 * their previous position to their new one whenever the list re-renders, and
 * newly added children fade in. Positions use offsetTop (layout, not
 * transformed), so scrolling and in-flight animations don't confuse it.
 */
export function useFlip(containerRef: RefObject<HTMLElement | null>) {
  const prev = useRef<Map<string, number> | null>(null);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const nodes = el.querySelectorAll<HTMLElement>(':scope > [data-flip]');
    const next = new Map<string, number>();
    const before = prev.current;
    const animate = before && !prefersReducedMotion();
    nodes.forEach((n) => {
      const key = n.dataset.flip!;
      const top = n.offsetTop;
      next.set(key, top);
      if (!animate) return;
      const old = before.get(key);
      if (old === undefined) {
        n.animate([{ opacity: 0, transform: 'scale(0.985)' }, { opacity: 1, transform: 'none' }], {
          duration: 280,
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
        });
      } else if (old !== top) {
        for (const a of n.getAnimations()) a.cancel();
        n.animate([{ transform: `translate3d(0, ${old - top}px, 0)` }, { transform: 'none' }], {
          duration: SPRING_MS,
          easing: springEasing,
        });
      }
    });
    prev.current = next;
  });
}

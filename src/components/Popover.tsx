import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { prefersReducedMotion, springEasing } from '../lib/motion';

/**
 * A menu that grows out of the button that opened it (like iOS pull-down
 * menus) and shrinks back into it when dismissed.
 */
export function Popover(props: {
  anchor: HTMLElement;
  align?: 'left' | 'right';
  onClose: () => void;
  children: (close: () => void) => ReactNode;
  className?: string;
  label?: string;
}) {
  const { anchor, align = 'left', onClose, children, className, label } = props;
  const ref = useRef<HTMLDivElement>(null);
  const [pos] = useState(() => {
    const r = anchor.getBoundingClientRect();
    return align === 'left'
      ? { top: r.bottom + 8, left: Math.max(12, r.left), origin: `${Math.max(16, r.width / 2)}px top` }
      : { top: r.bottom + 8, right: Math.max(12, window.innerWidth - r.right), origin: `calc(100% - ${Math.max(16, r.width / 2)}px) top` };
  });
  const closing = useRef(false);

  useLayoutEffect(() => {
    if (prefersReducedMotion()) return;
    ref.current?.animate(
      [
        { opacity: 0, transform: 'scale(0.6)' },
        { opacity: 1, transform: 'none' },
      ],
      { duration: 420, easing: springEasing },
    );
  }, []);

  const close = () => {
    if (closing.current) return;
    closing.current = true;
    const el = ref.current;
    if (!el || prefersReducedMotion()) return onClose();
    const a = el.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(0.7)' }], {
      duration: 160,
      easing: 'cubic-bezier(0.4, 0, 1, 1)',
      fill: 'forwards',
    });
    a.onfinish = onClose;
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return createPortal(
    <>
      <div className="popover-catcher" onPointerDown={close} />
      <div
        ref={ref}
        role="menu"
        aria-label={label}
        className={`popover ${className ?? ''}`}
        style={{ top: pos.top, left: pos.left, right: pos.right, transformOrigin: pos.origin }}
      >
        {children(close)}
      </div>
    </>,
    document.body,
  );
}

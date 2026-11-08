import { useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { haptic } from '../lib/telegram';
import { rubberClamp } from '../lib/motion';

export interface SegOption<T extends string> {
  value: T;
  label: ReactNode;
  ariaLabel?: string;
}

/**
 * iOS-style segmented control. The thumb springs between segments, sinks a
 * little while pressed, and can be dragged: it follows the finger and snaps
 * to the nearest segment on release (with a selection tick on each crossing).
 */
export function Segmented<T extends string>(props: {
  options: SegOption<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  className?: string;
}) {
  const { options, value, onChange, label, className } = props;
  const n = options.length;
  const idx = Math.max(0, options.findIndex((o) => o.value === value));
  const rootRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLSpanElement>(null);
  const [pressed, setPressed] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const drag = useRef<{ id: number; x0: number; segW: number; moved: boolean; near: number } | null>(null);

  const segAt = (clientX: number) => {
    const r = rootRef.current!.getBoundingClientRect();
    return Math.max(0, Math.min(n - 1, Math.floor(((clientX - r.left) / r.width) * n)));
  };

  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const i = segAt(e.clientX);
    if (i !== idx) {
      setHover(i);
      return;
    }
    const r = rootRef.current!.getBoundingClientRect();
    drag.current = { id: e.pointerId, x0: e.clientX, segW: (r.width - 4) / n, moved: false, near: idx };
    e.currentTarget.setPointerCapture(e.pointerId);
    setPressed(true);
  };

  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x0;
    if (!d.moved && Math.abs(dx) < 4) return;
    d.moved = true;
    const max = (n - 1) * d.segW;
    const x = rubberClamp(idx * d.segW + dx, 0, max, d.segW);
    const t = thumbRef.current!;
    t.style.transition = 'transform 0s, scale .25s';
    t.style.transform = `translate3d(${x}px,0,0)`;
    const near = Math.max(0, Math.min(n - 1, Math.round(x / d.segW)));
    if (near !== d.near) {
      d.near = near;
      setHover(near);
      haptic.select();
    }
  };

  const end = (e: RPointerEvent<HTMLDivElement>, cancelled = false) => {
    const d = drag.current;
    if (d && d.id === e.pointerId) {
      drag.current = null;
      setPressed(false);
      const t = thumbRef.current!;
      t.style.transition = '';
      t.style.transform = '';
      if (!cancelled && d.moved && d.near !== idx) onChange(options[d.near].value);
      setHover(null);
      return;
    }
    if (cancelled) {
      setHover(null);
      return;
    }
    const i = segAt(e.clientX);
    setHover(null);
    if (i !== idx && hover === i) {
      haptic.select();
      onChange(options[i].value);
    }
  };

  const active = hover ?? idx;
  return (
    <div
      ref={rootRef}
      className={`seg ${className ?? ''}`}
      role="radiogroup"
      aria-label={label}
      style={{ ['--n' as string]: n, ['--i' as string]: idx }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => end(e)}
      onPointerCancel={(e) => end(e, true)}
      onPointerLeave={() => !drag.current && setHover(null)}
    >
      <span ref={thumbRef} className={`seg-thumb ${pressed ? 'pressed' : ''}`} aria-hidden />
      {options.map((o, i) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={i === idx}
          aria-label={o.ariaLabel}
          className={`seg-opt ${i === active ? 'on' : ''} ${hover === i && i !== idx && !drag.current ? 'pressing' : ''}`}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onChange(o.value);
            }
          }}
          tabIndex={i === idx ? 0 : -1}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

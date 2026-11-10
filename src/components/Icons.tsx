import { useId } from 'react';
import type { ViewMode } from '../types';

/*
 * A small, consistent icon set: 24px grid, 1.8px rounded strokes, the same
 * rounded-square silhouette for the two tabs. The selected tab gets a solid
 * version of its icon so the state reads at a glance, not just by colour.
 */

type P = { size?: number; className?: string };

const base = (size: number, className?: string) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  className,
  'aria-hidden': true,
});

export function MenuIcon({ size = 24, className }: P) {
  return (
    <svg {...base(size, className)}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

export function PlusIcon({ size = 24, className }: P) {
  return (
    <svg {...base(size, className)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

/** Proton-style "today" button: a rounded square holding today's date. */
export function TodayIcon({ day, size = 26, className }: P & { day: number }) {
  return (
    <svg {...base(size, className)} viewBox="0 0 26 26">
      <rect x="3" y="3" width="20" height="20" rx="5" />
      <text
        x="13"
        y="13.6"
        textAnchor="middle"
        dominantBaseline="central"
        fill="currentColor"
        stroke="none"
        fontSize="11.5"
        fontWeight="650"
        style={{ fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em' }}
      >
        {day}
      </text>
    </svg>
  );
}

/** To-do tab: a ticked box. Solid when selected. */
export function TodoTabIcon({ active, size = 24 }: P & { active: boolean }) {
  const id = useId();
  return (
    <svg {...base(size)} className={`tab-icon ${active ? 'on' : ''}`}>
      <mask id={id}>
        <rect width="24" height="24" fill="#fff" />
        <path d="m8.4 12.2 2.5 2.5 4.8-5.2" stroke="#000" strokeWidth="2" fill="none" />
      </mask>
      <rect className="ti-solid" x="3.5" y="3.5" width="17" height="17" rx="5" fill="currentColor" stroke="none" mask={`url(#${id})`} />
      <rect className="ti-line" x="3.5" y="3.5" width="17" height="17" rx="5" />
      <path className="ti-line" d="m8.4 12.2 2.5 2.5 4.8-5.2" />
    </svg>
  );
}

/** Calendar tab: a page with binder rings. Solid when selected. */
export function CalendarTabIcon({ active, size = 24 }: P & { active: boolean }) {
  const id = useId();
  return (
    <svg {...base(size)} className={`tab-icon ${active ? 'on' : ''}`}>
      <mask id={id}>
        <rect width="24" height="24" fill="#fff" />
        <path d="M3.5 9.5h17" stroke="#000" strokeWidth="1.8" />
        <circle cx="8.5" cy="14" r="1.15" fill="#000" />
        <circle cx="12" cy="14" r="1.15" fill="#000" />
        <circle cx="15.5" cy="14" r="1.15" fill="#000" />
        <circle cx="8.5" cy="17.3" r="1.15" fill="#000" />
        <circle cx="12" cy="17.3" r="1.15" fill="#000" />
      </mask>
      <rect className="ti-solid" x="3.5" y="5" width="17" height="15.5" rx="4" fill="currentColor" stroke="none" mask={`url(#${id})`} />
      <rect className="ti-line" x="3.5" y="5" width="17" height="15.5" rx="4" />
      <path className="ti-line" d="M3.5 9.5h17" />
      <g className="ti-line" fill="currentColor" stroke="none">
        <circle cx="8.5" cy="14" r="1.05" />
        <circle cx="12" cy="14" r="1.05" />
        <circle cx="15.5" cy="14" r="1.05" />
        <circle cx="8.5" cy="17.3" r="1.05" />
        <circle cx="12" cy="17.3" r="1.05" />
      </g>
      <path d="M8.5 3v3.6M15.5 3v3.6" />
    </svg>
  );
}

/** Small diagrams of each calendar layout, for the menu. */
export function ViewIcon({ view, size = 22 }: { view: ViewMode; size?: number }) {
  const inner: Record<ViewMode, string> = {
    day: 'M8 10.5h8',
    '3day': 'M9.5 5.5v13M14.5 5.5v13',
    week: 'M7.75 5.5v13M10.6 5.5v13M13.4 5.5v13M16.25 5.5v13',
    month: 'M9.5 5.5v13M14.5 5.5v13M4.5 10h15M4.5 14h15',
    agenda: 'M8 9h8M8 12h8M8 15h5',
  };
  return (
    <svg {...base(size)} strokeWidth={1.6}>
      <rect x="4.5" y="5.5" width="15" height="13" rx="3" />
      <path d={inner[view]} />
    </svg>
  );
}

/** Filled caret used after a tappable title (like a native dropdown). */
export function CaretIcon({ className }: { className?: string }) {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" className={className} aria-hidden>
      <path d="M1.6 3.4h6.8a.5.5 0 0 1 .38.82L5.38 8.1a.5.5 0 0 1-.76 0L1.22 4.22a.5.5 0 0 1 .38-.82Z" fill="currentColor" />
    </svg>
  );
}

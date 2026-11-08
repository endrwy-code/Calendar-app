import type { TaskStatus } from '../types';

/**
 * ○ not started · ◐ in progress · ● done (with a drawn check).
 * Purely visual; the parent decides what a tap does.
 */
export function StatusGlyph({ status, size = 22 }: { status: TaskStatus; size?: number }) {
  return (
    <svg className={`glyph s-${status}`} width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <circle className="g-ring" cx="12" cy="12" r="10" />
      <path className="g-half" d="M12 4.5 A7.5 7.5 0 0 1 12 19.5 Z" />
      <circle className="g-fill" cx="12" cy="12" r="10" />
      <path className="g-check" d="M7.6 12.4 10.6 15.3 16.6 9.1" pathLength={1} />
    </svg>
  );
}

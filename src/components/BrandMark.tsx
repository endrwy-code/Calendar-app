export function BrandMark({ size = 36 }: { size?: number }) {
  return (
    <span className="brand-mark" style={{ width: size, height: size }} aria-hidden>
      <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3.5" y="5" width="17" height="15.5" rx="3.5" />
        <path d="M8 3v4M16 3v4M3.5 10h17" />
        <path d="m9 15 2 2 4-4" />
      </svg>
    </span>
  );
}

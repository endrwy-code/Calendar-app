import { useEffect, useState } from 'react';
import { useUI, type Toast } from '../store/ui';

/** Small dark capsule at the bottom. Slides in, and fades away instead of vanishing. */
export function Toasts() {
  const toasts = useUI((s) => s.toasts);
  const dismiss = useUI((s) => s.dismissToast);
  const [shown, setShown] = useState<(Toast & { leaving?: boolean })[]>([]);

  useEffect(() => {
    setShown((prev) => {
      const ids = new Set(toasts.map((t) => t.id));
      const kept = prev.map((t) => (ids.has(t.id) ? t : { ...t, leaving: true }));
      const known = new Set(prev.map((t) => t.id));
      return [...kept, ...toasts.filter((t) => !known.has(t.id))];
    });
    const timer = setTimeout(() => setShown((prev) => prev.filter((t) => !t.leaving)), 260);
    return () => clearTimeout(timer);
  }, [toasts]);

  return (
    <div className="toasts" aria-live="polite">
      {shown.map((t) => (
        <div key={t.id} className={`toast ${t.leaving ? 'leaving' : ''}`}>
          <span className="toast-msg">{t.message}</span>
          {t.actionLabel && (
            <button
              onClick={() => {
                t.onAction?.();
                dismiss(t.id);
              }}
            >
              {t.actionLabel}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

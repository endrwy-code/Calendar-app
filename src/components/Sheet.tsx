import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export function Sheet(props: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  headerExtra?: ReactNode;
  tall?: boolean;
  label?: string;
}) {
  const { title, onClose, children, footer, headerExtra, tall, label } = props;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div
        className={`sheet${tall ? ' tall' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={label ?? (typeof title === 'string' ? title : undefined)}
      >
        <div className="sheet-handle" />
        <div className="sheet-head">
          <h2 className="sheet-title">{title}</h2>
          {headerExtra}
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>
        <div className="sheet-body scroll-y">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </>,
    document.body,
  );
}

export interface Choice {
  label: string;
  onSelect: () => void;
  tone?: 'primary' | 'danger' | 'default';
}

export function ChoiceDialog(props: {
  title: string;
  message?: string;
  choices: Choice[];
  onCancel: () => void;
}) {
  const { title, message, choices, onCancel } = props;
  return createPortal(
    <>
      <div className="sheet-backdrop" style={{ zIndex: 59 }} onClick={onCancel} />
      <div className="dialog" role="alertdialog" aria-modal="true" aria-label={title}>
        <h3>{title}</h3>
        {message && <p>{message}</p>}
        <div className="dialog-actions">
          {choices.map((c) => (
            <button
              key={c.label}
              className={`btn btn-block ${c.tone === 'primary' ? 'btn-primary' : c.tone === 'danger' ? 'btn-danger' : ''}`}
              onClick={c.onSelect}
            >
              {c.label}
            </button>
          ))}
          <button className="btn btn-block btn-ghost" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </>,
    document.body,
  );
}

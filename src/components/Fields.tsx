import { useLayoutEffect, useRef, type MouseEvent } from 'react';
import { format } from 'date-fns';
import { fmtTime, parseLocal } from '../lib/dates';

/*
 * Date and time fields that read like text ("Fri 13 Nov", "19:30") instead of
 * the browser's boxed "11/13/2026". The native input sits invisibly on top, so
 * a tap still opens the phone's own picker.
 */

const openPicker = (e: MouseEvent<HTMLInputElement>) => {
  try {
    e.currentTarget.showPicker?.();
  } catch {
    /* not supported, or already open: the native tap behaviour still works */
  }
};

export function DateField(props: { value: string; onChange: (v: string) => void; min?: string; label: string; className?: string }) {
  const d = parseLocal(props.value);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return (
    <label className={`dt ${props.className ?? ''}`}>
      <span>{format(d, sameYear ? 'EEE d MMM' : 'EEE d MMM yyyy')}</span>
      <input
        type="date"
        value={props.value}
        min={props.min}
        aria-label={props.label}
        onClick={openPicker}
        onChange={(e) => e.target.value && props.onChange(e.target.value)}
      />
    </label>
  );
}

export function TimeField(props: { value: string; onChange: (v: string) => void; label: string; timeFormat: '24h' | '12h' }) {
  const d = parseLocal(`2000-01-01T${props.value}`);
  return (
    <label className="dt time">
      <span>{fmtTime(d, props.timeFormat)}</span>
      <input
        type="time"
        value={props.value}
        aria-label={props.label}
        onClick={openPicker}
        onChange={(e) => e.target.value && props.onChange(e.target.value)}
      />
    </label>
  );
}

/** A textarea that grows with its text. */
export function AutoGrow(props: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  placeholder?: string;
  label: string;
  singleLine?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
  }, [props.value]);
  return (
    <textarea
      ref={ref}
      rows={1}
      className={props.className}
      value={props.value}
      placeholder={props.placeholder}
      aria-label={props.label}
      onChange={(e) => props.onChange(props.singleLine ? e.target.value.replace(/\n/g, ' ') : e.target.value)}
      onKeyDown={(e) => {
        if (props.singleLine && e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
    />
  );
}

import { useMemo, useState } from 'react';
import { addDays, addMonths, format, isSameMonth, startOfMonth, startOfWeek } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useData } from '../store/data';
import { parseLocal, toDateKey, todayKey } from '../lib/dates';
import { expandEvents } from '../lib/recurrence';
import { visibleEvents } from '../lib/selectors';

export function MiniMonth({ value, onSelect }: { value: string; onSelect: (dateKey: string) => void }) {
  const weekStartsOn = useData((s) => s.settings.weekStartsOn);
  const events = useData((s) => s.events);
  const calendars = useData((s) => s.calendars);
  const [month, setMonth] = useState(() => startOfMonth(parseLocal(value)));

  const days = useMemo(() => {
    const start = startOfWeek(month, { weekStartsOn });
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
  }, [month, weekStartsOn]);

  const busyDays = useMemo(() => {
    const occ = expandEvents(visibleEvents(events, calendars), days[0], addDays(days[41], 1));
    const set = new Set<string>();
    for (const o of occ) set.add(o.dateKey);
    return set;
  }, [events, calendars, days]);

  const today = todayKey();
  const lastRow = days.slice(35).every((d) => !isSameMonth(d, month)) ? 35 : 42;

  return (
    <div className="mini-month">
      <div className="mm-head">
        <strong>{format(month, 'MMMM yyyy')}</strong>
        <span className="spacer" />
        <button className="icon-btn sm" aria-label="Previous month" onClick={() => setMonth(addMonths(month, -1))}>
          <ChevronLeft size={18} />
        </button>
        <button className="icon-btn sm" aria-label="Next month" onClick={() => setMonth(addMonths(month, 1))}>
          <ChevronRight size={18} />
        </button>
      </div>
      <div className="mm-grid">
        {days.slice(0, 7).map((d) => (
          <span key={`h${d.getDay()}`} className="mm-dow">
            {format(d, 'EEEEE')}
          </span>
        ))}
        {days.slice(0, lastRow).map((d) => {
          const k = toDateKey(d);
          return (
            <button
              key={k}
              className={`mm-day ${isSameMonth(d, month) ? '' : 'other'} ${k === today ? 'today' : ''} ${k === value ? 'selected' : ''}`}
              onClick={() => onSelect(k)}
            >
              {d.getDate()}
              {busyDays.has(k) && <i className="mm-dot" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

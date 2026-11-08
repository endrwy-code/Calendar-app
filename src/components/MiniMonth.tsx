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
  const [dir, setDir] = useState(0);

  const days = useMemo(() => {
    const start = startOfWeek(month, { weekStartsOn });
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
  }, [month, weekStartsOn]);

  const busy = useMemo(() => {
    const set = new Set<string>();
    for (const o of expandEvents(visibleEvents(events, calendars), days[0], addDays(days[41], 1))) set.add(o.dateKey);
    return set;
  }, [events, calendars, days]);

  const today = todayKey();
  const shift = (d: 1 | -1) => {
    setDir(d);
    setMonth(addMonths(month, d));
  };

  return (
    <div className="mini">
      <div className="mini-head">
        <strong>{format(month, 'MMMM yyyy')}</strong>
        <span className="spacer" />
        <button className="icon-btn sm" aria-label="Previous month" onClick={() => shift(-1)}>
          <ChevronLeft size={18} />
        </button>
        <button className="icon-btn sm" aria-label="Next month" onClick={() => shift(1)}>
          <ChevronRight size={18} />
        </button>
      </div>
      <div className="mini-grid mini-dows">
        {days.slice(0, 7).map((d) => (
          <span key={d.getDay()}>{format(d, 'EEEEE')}</span>
        ))}
      </div>
      <div className={`mini-grid mini-days ${dir > 0 ? 'from-r' : dir < 0 ? 'from-l' : ''}`} key={toDateKey(month)}>
        {days.map((d) => {
          const k = toDateKey(d);
          return (
            <button
              key={k}
              className={`mini-day ${isSameMonth(d, month) ? '' : 'other'} ${k === today ? 'today' : ''} ${k === value ? 'sel' : ''}`}
              onClick={() => onSelect(k)}
            >
              {d.getDate()}
              {busy.has(k) && <i />}
            </button>
          );
        })}
      </div>
      {value !== today && (
        <button className="text-btn mini-today" onClick={() => onSelect(today)}>
          Go to today
        </button>
      )}
    </div>
  );
}

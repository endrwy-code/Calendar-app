import { useMemo, useState } from 'react';
import { addDays, startOfDay } from 'date-fns';
import { CalendarDays, Search } from 'lucide-react';
import { useData, calendarById } from '../store/data';
import { useUI } from '../store/ui';
import { fmtTime, relativeDayLabel, toLocalISO } from '../lib/dates';
import { expandEvents, eventBounds } from '../lib/recurrence';
import { Sheet } from './Sheet';
import { TaskItem } from './TaskItem';

export function SearchSheet() {
  const open = useUI((s) => s.searchOpen);
  const setOpen = useUI((s) => s.setSearchOpen);
  if (!open) return null;
  return <SearchInner onClose={() => setOpen(false)} />;
}

function SearchInner({ onClose }: { onClose: () => void }) {
  const events = useData((s) => s.events);
  const tasks = useData((s) => s.tasks);
  const calendars = useData((s) => s.calendars);
  const tf = useData((s) => s.settings.timeFormat);
  const ui = useUI();
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();

  const results = useMemo(() => {
    if (!query) return { events: [], tasks: [] };
    const match = (...fields: (string | undefined)[]) => fields.some((f) => f?.toLowerCase().includes(query));
    const evs = events
      .filter((e) => match(e.title, e.location, e.notes))
      .map((e) => {
        // Show the next upcoming occurrence for recurring events
        if (e.recurrence) {
          const from = startOfDay(new Date());
          const next = expandEvents([e], from, addDays(from, 400))[0];
          if (next) return { e, start: next.start, end: next.end, dateKey: next.dateKey };
        }
        const b = eventBounds(e);
        return { e, start: b.start, end: b.end, dateKey: undefined as string | undefined };
      })
      .sort((a, b) => b.start.getTime() - a.start.getTime())
      .slice(0, 30);
    const ts = tasks.filter((t) => match(t.title, t.notes, ...t.subtasks.map((s) => s.title))).slice(0, 30);
    return { events: evs, tasks: ts };
  }, [query, events, tasks]);

  return (
    <Sheet
      title={
        <div className="search-box">
          <Search size={18} />
          <input autoFocus placeholder="Search events and tasks" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      }
      label="Search"
      onClose={onClose}
      tall
    >
      {!query && <div className="empty">Search titles, places, notes and steps.</div>}
      {query && !results.events.length && !results.tasks.length && (
        <div className="empty">
          <strong>No matches</strong>Try a different word.
        </div>
      )}
      {results.tasks.length > 0 && (
        <div className="search-group">
          <div className="panel-label">
            Tasks <span>{results.tasks.length}</span>
          </div>
          <div className="task-list">
            {results.tasks.map((t) => (
              <TaskItem key={t.id} task={t} compact />
            ))}
          </div>
        </div>
      )}
      {results.events.length > 0 && (
        <div className="search-group">
          <div className="panel-label">
            Events <span>{results.events.length}</span>
          </div>
          {results.events.map(({ e, start, end, dateKey }) => {
            const cal = calendarById(calendars, e.calendarId);
            return (
              <button
                key={e.id}
                className={`search-event c-${cal?.color ?? 'slate'}`}
                onClick={() => {
                  ui.setCursor(toLocalISO(start).slice(0, 10));
                  ui.openEditor({
                    kind: 'event',
                    id: e.id,
                    occurrence: dateKey ? { dateKey, start: toLocalISO(start), end: toLocalISO(end) } : undefined,
                  });
                }}
              >
                <i className="ai-bar" />
                <span className="ai-main">
                  <span className="ai-title">{e.title}</span>
                  <span className="ai-sub">
                    <CalendarDays size={11} /> {relativeDayLabel(start)}
                    {!e.allDay && ` · ${fmtTime(start, tf)}`}
                    {e.recurrence && ' · repeats'}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </Sheet>
  );
}

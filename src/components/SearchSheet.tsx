import { useMemo, useState } from 'react';
import { Repeat, Search, X } from 'lucide-react';
import { useData } from '../store/data';
import { useUI } from '../store/ui';
import { fmtTime, relativeDayLabel, toLocalISO } from '../lib/dates';
import { searchEvents, searchTasks } from '../lib/search';
import { Sheet } from './Sheet';
import { StatusGlyph } from './StatusCircle';

/** Find an event or a to-do by any word in its title, place or notes. */
export function SearchSheet() {
  const open = useUI((s) => s.searchOpen);
  if (!open) return null;
  return <SearchInner />;
}

/** The first matching word, highlighted. */
function Highlight({ text, q }: { text: string; q: string }) {
  const term = q.trim().split(/\s+/)[0]?.toLowerCase();
  const i = term ? text.toLowerCase().indexOf(term) : -1;
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + term.length)}</mark>
      {text.slice(i + term.length)}
    </>
  );
}

function SearchInner() {
  const setOpen = useUI((s) => s.setSearchOpen);
  const goToDate = useUI((s) => s.goToDate);
  const openEvent = useUI((s) => s.openEvent);
  const openTodo = useUI((s) => s.openTodo);
  const events = useData((s) => s.events);
  const tasks = useData((s) => s.tasks);
  const calendars = useData((s) => s.calendars);
  const tf = useData((s) => s.settings.timeFormat);
  const [q, setQ] = useState('');

  const evHits = useMemo(() => searchEvents(events, q), [events, q]);
  const taskHits = useMemo(() => searchTasks(tasks, q), [tasks, q]);
  const colorOf = (id: string) => calendars.find((c) => c.id === id)?.color ?? 'slate';
  const searching = q.trim().length > 0;

  return (
    <Sheet
      onClose={() => setOpen(false)}
      size="large"
      title="Search"
      right={(close) => (
        <button className="text-btn bold" onClick={close}>
          Done
        </button>
      )}
    >
      {(close) => (
        <div className="form">
          <label className="search-field">
            <Search size={18} strokeWidth={2} aria-hidden />
            <input
              autoFocus
              type="search"
              enterKeyHint="search"
              placeholder="Events and to-dos"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search events and to-dos"
            />
            {searching && (
              <button className="search-clear" aria-label="Clear" onClick={() => setQ('')}>
                <X size={14} strokeWidth={2.6} />
              </button>
            )}
          </label>

          {searching && !evHits.length && !taskHits.length && <p className="search-empty">Nothing matches “{q.trim()}”.</p>}

          {evHits.length > 0 && (
            <>
              <div className="group-label">Events</div>
              <div className="group rows">
                {evHits.map((h) => (
                  <button
                    key={h.event.id}
                    className={`row c-${colorOf(h.event.calendarId)} ${h.upcoming ? '' : 'is-past'}`}
                    onClick={() => {
                      close();
                      goToDate(h.dateKey);
                      openEvent({
                        id: h.event.id,
                        occurrence: h.occurrence ? { dateKey: h.dateKey, start: toLocalISO(h.start), end: toLocalISO(h.end) } : undefined,
                      });
                    }}
                  >
                    <span className="row-icon tag-dot-lg" />
                    <span className="row-main two">
                      <span className="search-title">
                        <Highlight text={h.event.title} q={q} />
                      </span>
                      <small>
                        {relativeDayLabel(h.start)}
                        {!h.event.allDay && ` · ${fmtTime(h.start, tf)}`}
                        {h.event.location && ` · ${h.event.location}`}
                      </small>
                    </span>
                    {h.event.recurrence && <Repeat size={15} className="row-icon" aria-label="Repeats" />}
                  </button>
                ))}
              </div>
            </>
          )}

          {taskHits.length > 0 && (
            <>
              <div className="group-label">To-dos</div>
              <div className="group rows">
                {taskHits.map((t) => (
                  <button
                    key={t.id}
                    className={`row ${t.status === 'done' ? 'is-past' : ''}`}
                    onClick={() => {
                      close();
                      openTodo(t.id);
                    }}
                  >
                    <span className="row-icon">
                      <StatusGlyph status={t.status} size={20} />
                    </span>
                    <span className="row-main search-title">
                      <Highlight text={t.title} q={q} />
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}

          {!searching && <p className="form-foot center">Search titles, places and notes. On a computer, press / to search.</p>}
        </div>
      )}
    </Sheet>
  );
}

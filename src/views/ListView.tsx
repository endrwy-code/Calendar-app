import { useMemo, useState } from 'react';
import { addDays, format } from 'date-fns';
import { MapPin, Repeat } from 'lucide-react';
import { useData } from '../store/data';
import { useUI } from '../store/ui';
import { fmtTime, parseLocal, relativeDayLabel, toDateKey, toLocalISO, todayKey } from '../lib/dates';
import { expandEvents } from '../lib/recurrence';
import { dayAgenda, visibleEvents } from '../lib/selectors';
import { toggleDone } from '../lib/actions';
import { StatusGlyph } from '../components/StatusCircle';

/** Everything coming up, day by day, from the focused date. */
export function ListView() {
  const cursor = useUI((s) => s.cursor);
  const openEvent = useUI((s) => s.openEvent);
  const openTodo = useUI((s) => s.openTodo);
  const events = useData((s) => s.events);
  const tasks = useData((s) => s.tasks);
  const calendars = useData((s) => s.calendars);
  const tf = useData((s) => s.settings.timeFormat);
  const [span, setSpan] = useState(45);
  const today = todayKey();

  const days = useMemo(() => {
    const start = parseLocal(cursor);
    const end = addDays(start, span);
    const occ = expandEvents(visibleEvents(events, calendars), start, end);
    const scheduled = tasks.filter((t) => t.scheduledStart);
    const out = [];
    for (let i = 0; i < span; i++) {
      const d = addDays(start, i);
      const k = toDateKey(d);
      const dayStart = d.getTime();
      const dayEnd = addDays(d, 1).getTime();
      const allDay = occ.filter((o) => o.event.allDay && o.start.getTime() < dayEnd && o.end.getTime() > dayStart);
      const timed = dayAgenda(occ, scheduled, k);
      if (allDay.length || timed.length || k === today) out.push({ d, k, allDay, timed });
    }
    return out;
  }, [cursor, span, events, tasks, calendars, today]);

  const colorOf = (id: string) => calendars.find((c) => c.id === id)?.color ?? 'slate';

  return (
    <div className="list scroll-y">
      {days.map(({ d, k, allDay, timed }) => {
        const rel = relativeDayLabel(d);
        return (
          <section key={k} className={`list-day ${k === today ? 'today' : ''}`}>
            <h3 className="list-date">
              <span>{rel.includes(' ') ? format(d, 'EEEE') : rel}</span>
              <small>{format(d, 'd MMMM')}</small>
            </h3>
            {!allDay.length && !timed.length && <p className="list-empty">Nothing scheduled</p>}
            {allDay.map((o) => (
              <button key={o.key} className={`list-item c-${colorOf(o.event.calendarId)}`} onClick={() => openEvent({ id: o.event.id })}>
                <span className="li-time">All day</span>
                <i className="li-bar" />
                <span className="li-main">
                  <span className="li-title">{o.event.title}</span>
                </span>
              </button>
            ))}
            {timed.map((it) => {
              if (it.kind === 'task') {
                const t = it.task;
                return (
                  <div key={it.key} role="button" tabIndex={0} className={`list-item is-task ${t.status === 'done' ? 'is-done' : ''}`} onClick={() => openTodo(t.id)}>
                    <span className="li-time">{fmtTime(it.start, tf)}</span>
                    <button
                      className="li-check"
                      aria-label={`Complete ${t.title}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleDone(t);
                      }}
                    >
                      <StatusGlyph status={t.status} size={16} />
                    </button>
                    <span className="li-main">
                      <span className="li-title">{t.title}</span>
                      <span className="li-sub">To-do</span>
                    </span>
                  </div>
                );
              }
              const e = it.occ.event;
              return (
                <button
                  key={it.key}
                  className={`list-item c-${colorOf(e.calendarId)} ${it.end.getTime() < Date.now() ? 'past' : ''}`}
                  onClick={() =>
                    openEvent({
                      id: e.id,
                      occurrence: e.recurrence ? { dateKey: it.occ.dateKey, start: toLocalISO(it.start), end: toLocalISO(it.end) } : undefined,
                    })
                  }
                >
                  <span className="li-time">
                    {fmtTime(it.start, tf)}
                    <small>{fmtTime(it.end, tf)}</small>
                  </span>
                  <i className="li-bar" />
                  <span className="li-main">
                    <span className="li-title">{e.title}</span>
                    {(e.location || e.recurrence) && (
                      <span className="li-sub">
                        {e.recurrence && <Repeat size={11} />}
                        {e.location && (
                          <>
                            <MapPin size={11} /> {e.location}
                          </>
                        )}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </section>
        );
      })}
      <div className="list-more">
        <button className="btn btn-sm" onClick={() => setSpan(span + 45)}>
          Show more
        </button>
      </div>
    </div>
  );
}

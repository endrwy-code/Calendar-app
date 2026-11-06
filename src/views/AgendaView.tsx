import { useMemo, useState } from 'react';
import { addDays, format } from 'date-fns';
import { MapPin, Repeat } from 'lucide-react';
import { useData, calendarById } from '../store/data';
import { useUI } from '../store/ui';
import { fmtTime, parseLocal, relativeDayLabel, toDateKey, toLocalISO, todayKey } from '../lib/dates';
import { expandEvents } from '../lib/recurrence';
import { dayAgenda, dueTasksOn, isTaskVisible, visibleEvents } from '../lib/selectors';
import { TaskCheck } from '../components/TaskItem';

export function AgendaView({ cursor }: { cursor: string }) {
  const events = useData((s) => s.events);
  const tasks = useData((s) => s.tasks);
  const calendars = useData((s) => s.calendars);
  const settings = useData((s) => s.settings);
  const ui = useUI();
  const [span, setSpan] = useState(30);
  const tf = settings.timeFormat;
  const today = todayKey();

  const days = useMemo(() => {
    const start = parseLocal(cursor);
    const end = addDays(start, span);
    const occ = expandEvents(visibleEvents(events, calendars), start, end);
    const visTasks = settings.showTasksOnCalendar ? tasks.filter((t) => isTaskVisible(t, calendars)) : [];
    const out = [];
    for (let i = 0; i < span; i++) {
      const d = addDays(start, i);
      const k = toDateKey(d);
      const dayStart = d.getTime();
      const dayEnd = addDays(d, 1).getTime();
      const allDay = occ.filter((o) => o.event.allDay && o.start.getTime() < dayEnd && o.end.getTime() > dayStart);
      const timed = dayAgenda(occ, visTasks, k);
      const due = dueTasksOn(visTasks, k);
      if (allDay.length || timed.length || due.length) out.push({ d, k, allDay, timed, due });
    }
    return out;
  }, [cursor, span, events, tasks, calendars, settings.showTasksOnCalendar]);

  return (
    <div className="agenda scroll-y">
      {days.length === 0 && (
        <div className="empty" style={{ paddingTop: 60 }}>
          <strong>Nothing coming up</strong>
          No events or tasks in the next {span} days.
        </div>
      )}
      {days.map(({ d, k, allDay, timed, due }) => (
        <section key={k} className={`agenda-day ${k === today ? 'today' : ''}`}>
          <button className="agenda-date" onClick={() => ui.goToDate(k)}>
            <span className="ad-num">{d.getDate()}</span>
            <span className="ad-dow">{format(d, 'EEE')}</span>
          </button>
          <div className="agenda-items">
            <div className="agenda-label">{relativeDayLabel(d)}{relativeDayLabel(d).includes(' ') ? '' : ` · ${format(d, 'd MMMM')}`}</div>
            {allDay.map((o) => {
              const cal = calendarById(calendars, o.event.calendarId);
              return (
                <button key={o.key} className={`agenda-item filled c-${cal?.color ?? 'slate'}`} onClick={() => ui.openEditor({ kind: 'event', id: o.event.id })}>
                  <span className="ai-time">All day</span>
                  <span className="ai-title">{o.event.title}</span>
                </button>
              );
            })}
            {due.map((t) => {
              const cal = calendarById(calendars, t.calendarId);
              return (
                <div key={t.id} role="button" tabIndex={0} className={`agenda-item task c-${cal?.color ?? 'teal'} ${t.status === 'done' ? 'is-done' : ''}`} onClick={() => ui.openEditor({ kind: 'task', id: t.id })}>
                  <TaskCheck task={t} size="sm" />
                  <span className="ai-title">{t.title}</span>
                  <span className="ai-meta">Due</span>
                </div>
              );
            })}
            {timed.map((it) => {
              if (it.kind === 'event') {
                const e = it.occ.event;
                const cal = calendarById(calendars, e.calendarId);
                return (
                  <button
                    key={it.key}
                    className={`agenda-item c-${cal?.color ?? 'slate'}`}
                    onClick={() =>
                      ui.openEditor({
                        kind: 'event',
                        id: e.id,
                        occurrence: e.recurrence ? { dateKey: it.occ.dateKey, start: toLocalISO(it.start), end: toLocalISO(it.end) } : undefined,
                      })
                    }
                  >
                    <i className="ai-bar" />
                    <span className="ai-time">
                      {fmtTime(it.start, tf)}
                      <small>{fmtTime(it.end, tf)}</small>
                    </span>
                    <span className="ai-main">
                      <span className="ai-title">{e.title}</span>
                      {(e.location || e.recurrence) && (
                        <span className="ai-sub">
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
              }
              const t = it.task;
              const cal = calendarById(calendars, t.calendarId);
              return (
                <div key={it.key} role="button" tabIndex={0} className={`agenda-item task c-${cal?.color ?? 'teal'} ${t.status === 'done' ? 'is-done' : ''}`} onClick={() => ui.openEditor({ kind: 'task', id: t.id })}>
                  <TaskCheck task={t} size="sm" />
                  <span className="ai-time">{fmtTime(it.start, tf)}</span>
                  <span className="ai-title">{t.title}</span>
                </div>
              );
            })}
          </div>
        </section>
      ))}
      <div className="agenda-more">
        <button className="btn btn-sm" onClick={() => setSpan(span + 30)}>
          Show the next 30 days
        </button>
      </div>
    </div>
  );
}

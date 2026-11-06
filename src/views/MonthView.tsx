import { useEffect, useMemo, useRef, useState } from 'react';
import { addDays, format, isSameMonth, startOfMonth, startOfWeek } from 'date-fns';
import { useData, calendarById } from '../store/data';
import { useUI } from '../store/ui';
import { fmtTime, isoWeek, parseLocal, toDateKey, toLocalISO, todayKey } from '../lib/dates';
import { expandEvents } from '../lib/recurrence';
import { isTaskVisible, visibleEvents } from '../lib/selectors';
import { taskBounds } from '../lib/schedule';

type Item = { key: string; title: string; color: string; allDay: boolean; time?: Date; task?: boolean; done?: boolean; onOpen: () => void };

export function MonthView({ cursor }: { cursor: string }) {
  const events = useData((s) => s.events);
  const tasks = useData((s) => s.tasks);
  const calendars = useData((s) => s.calendars);
  const settings = useData((s) => s.settings);
  const ui = useUI();
  const gridRef = useRef<HTMLDivElement>(null);
  const [maxItems, setMaxItems] = useState(3);

  const month = startOfMonth(parseLocal(cursor));
  const start = startOfWeek(month, { weekStartsOn: settings.weekStartsOn });
  const days = useMemo(() => Array.from({ length: 42 }, (_, i) => addDays(start, i)), [start.getTime()]);
  const weeks = days.slice(35).every((d) => !isSameMonth(d, month)) ? 5 : 6;

  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const rowH = el.clientHeight / weeks;
      setMaxItems(Math.max(1, Math.floor((rowH - 26) / 18)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [weeks]);

  const byDay = useMemo(() => {
    const map = new Map<string, Item[]>();
    const push = (k: string, it: Item) => {
      const arr = map.get(k) ?? [];
      arr.push(it);
      map.set(k, arr);
    };
    const occ = expandEvents(visibleEvents(events, calendars), days[0], addDays(days[41], 1));
    for (const o of occ) {
      const cal = calendarById(calendars, o.event.calendarId);
      const open = () =>
        ui.openEditor({
          kind: 'event',
          id: o.event.id,
          occurrence: o.event.recurrence
            ? { dateKey: o.dateKey, start: toLocalISO(o.start), end: toLocalISO(o.end) }
            : undefined,
        });
      if (o.event.allDay) {
        for (let d = new Date(o.start); d < o.end; d = addDays(d, 1)) {
          push(toDateKey(d), { key: `${o.key}:${toDateKey(d)}`, title: o.event.title, color: cal?.color ?? 'slate', allDay: true, onOpen: open });
        }
      } else {
        push(o.dateKey, { key: o.key, title: o.event.title, color: cal?.color ?? 'slate', allDay: false, time: o.start, onOpen: open });
      }
    }
    if (settings.showTasksOnCalendar) {
      for (const t of tasks) {
        if (!isTaskVisible(t, calendars)) continue;
        const b = taskBounds(t);
        const k = b ? toDateKey(b.start) : t.dueDate;
        if (!k) continue;
        const cal = calendarById(calendars, t.calendarId);
        push(k, {
          key: `t:${t.id}`,
          title: t.title,
          color: cal?.color ?? 'teal',
          allDay: !b,
          time: b?.start,
          task: true,
          done: t.status === 'done',
          onOpen: () => ui.openEditor({ kind: 'task', id: t.id }),
        });
      }
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => Number(b.allDay) - Number(a.allDay) || (a.time?.getTime() ?? 0) - (b.time?.getTime() ?? 0));
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, tasks, calendars, days, settings.showTasksOnCalendar]);

  const today = todayKey();

  return (
    <div className={`month ${settings.showWeekNumbers ? 'with-wk' : ''}`}>
      <div className="month-head">
        {settings.showWeekNumbers && <span className="wk-col" />}
        {days.slice(0, 7).map((d) => (
          <span key={d.getDay()}>{format(d, 'EEE')}</span>
        ))}
      </div>
      <div className="month-grid" ref={gridRef} style={{ gridTemplateRows: `repeat(${weeks}, minmax(0, 1fr))` }}>
        {Array.from({ length: weeks }, (_, w) => (
          <div className="month-week" key={w}>
            {settings.showWeekNumbers && <span className="wk-col">{isoWeek(days[w * 7])}</span>}
            {days.slice(w * 7, w * 7 + 7).map((d) => {
              const k = toDateKey(d);
              const items = byDay.get(k) ?? [];
              const shown = items.length > maxItems ? items.slice(0, maxItems - 1) : items;
              const more = items.length - shown.length;
              return (
                <div
                  key={k}
                  className={`month-cell ${isSameMonth(d, month) ? '' : 'other'} ${k === today ? 'today' : ''}`}
                  onClick={() => {
                    ui.setCursor(k);
                    useData.getState().updateSettings({ calendarView: 'day' });
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <span className="mc-num">{d.getDate()}</span>
                  <div className="mc-items">
                    {shown.map((it) => (
                      <span
                        key={it.key}
                        className={`mc-item c-${it.color} ${it.allDay && !it.task ? 'filled' : ''} ${it.task ? 'task' : ''} ${it.done ? 'is-done' : ''}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          it.onOpen();
                        }}
                      >
                        {!it.allDay && <i className="dot" />}
                        {it.task && <i className="mc-check" />}
                        {it.time && <b className="mc-time">{fmtTime(it.time, settings.timeFormat)}</b>}
                        <span className="mc-title">{it.title}</span>
                      </span>
                    ))}
                    {more > 0 && <span className="mc-more">+{more} more</span>}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

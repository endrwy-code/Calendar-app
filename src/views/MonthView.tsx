import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { flushSync } from 'react-dom';
import { addDays, addMonths, format, isSameMonth, startOfMonth, startOfWeek } from 'date-fns';
import { useData } from '../store/data';
import { useUI } from '../store/ui';
import { isoWeek, parseLocal, toDateKey, toLocalISO, todayKey } from '../lib/dates';
import { expandEvents } from '../lib/recurrence';
import { visibleEvents } from '../lib/selectors';
import { taskBounds } from '../lib/schedule';
import { usePager } from '../lib/usePager';
import { useMediaQuery } from '../lib/hooks';
import { haptic } from '../lib/telegram';
import type { PagerControl } from './TimeGrid';

type Item = { key: string; title: string; color: string; allDay: boolean; time: number; done?: boolean; open: () => void };

const CHIP_H = 17;
const NUM_H = 26;

export function MonthView({ controlRef }: { controlRef: MutableRefObject<PagerControl | null> }) {
  const cursor = useUI((s) => s.cursor);
  const setCursor = useUI((s) => s.setCursor);
  const openEvent = useUI((s) => s.openEvent);
  const openTodo = useUI((s) => s.openTodo);
  const events = useData((s) => s.events);
  const tasks = useData((s) => s.tasks);
  const calendars = useData((s) => s.calendars);
  const weekStartsOn = useData((s) => s.settings.weekStartsOn);
  const showWeekNumbers = useData((s) => s.settings.showWeekNumbers);
  const updateSettings = useData((s) => s.updateSettings);
  const fine = useMediaQuery('(pointer: fine)');
  const today = todayKey();

  const month = startOfMonth(parseLocal(cursor));
  const monthK = toDateKey(month);
  const panes = useMemo(
    () =>
      [-1, 0, 1].map((offset) => {
        const m = addMonths(month, offset);
        const s = startOfWeek(m, { weekStartsOn });
        const days = Array.from({ length: 42 }, (_, i) => addDays(s, i));
        const weeks = days.slice(35).every((d) => !isSameMonth(d, m)) ? 5 : 6;
        return { offset, key: toDateKey(m), month: m, days: days.slice(0, weeks * 7), weeks };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [monthK, weekStartsOn],
  );

  const byDay = useMemo(() => {
    const map = new Map<string, Item[]>();
    const first = panes[0].days[0];
    const last = addDays(panes[2].days[panes[2].days.length - 1], 1);
    const push = (k: string, it: Item) => {
      const arr = map.get(k);
      if (arr) arr.push(it);
      else map.set(k, [it]);
    };
    const colorOf = new Map(calendars.map((c) => [c.id, c.color]));
    for (const o of expandEvents(visibleEvents(events, calendars), first, last)) {
      const color = colorOf.get(o.event.calendarId) ?? 'slate';
      const open = () =>
        openEvent({
          id: o.event.id,
          occurrence: o.event.recurrence ? { dateKey: o.dateKey, start: toLocalISO(o.start), end: toLocalISO(o.end) } : undefined,
        });
      if (o.event.allDay) {
        for (let d = new Date(o.start); d < o.end; d = addDays(d, 1)) {
          push(toDateKey(d), { key: `${o.key}:${toDateKey(d)}`, title: o.event.title, color, allDay: true, time: 0, open });
        }
      } else {
        push(o.dateKey, { key: o.key, title: o.event.title, color, allDay: false, time: o.start.getTime(), open });
      }
    }
    for (const t of tasks) {
      const b = taskBounds(t);
      if (!b) continue;
      push(toDateKey(b.start), {
        key: `t:${t.id}`,
        title: t.title,
        color: 'ink',
        allDay: false,
        time: b.start.getTime(),
        done: t.status === 'done',
        open: () => openTodo(t.id),
      });
    }
    for (const arr of map.values()) arr.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.time - b.time);
    return map;
  }, [events, tasks, calendars, panes, openEvent, openTodo]);

  /* ---------- Pager ---------- */
  const rootRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const vpRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(480);
  useEffect(() => {
    const el = vpRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { go } = usePager({
    rootRef,
    trackRefs: [trackRef],
    getWidth: () => vpRef.current?.clientWidth ?? 0,
    onCommit: (dir) => {
      const c = parseLocal(useUI.getState().cursor);
      flushSync(() => setCursor(toDateKey(startOfMonth(addMonths(c, dir)))));
      haptic.select();
    },
  });
  controlRef.current = { go };

  const openDay = (k: string) => {
    haptic.select();
    setCursor(k);
    updateSettings({ calendarView: 'day' });
  };

  const dows = panes[1].days.slice(0, 7);

  return (
    <div className={`month ${showWeekNumbers ? 'with-wk' : ''}`} ref={rootRef}>
      <div className="month-dows">
        {showWeekNumbers && <span className="wk-col" />}
        {dows.map((d) => (
          <span key={d.getDay()} className={d.getDay() % 6 === 0 ? 'we' : ''}>
            {format(d, 'EEE')}
          </span>
        ))}
      </div>
      <div className="month-vp" ref={vpRef}>
        <div className="month-track" ref={trackRef}>
          {panes.map((p) => {
            const rowH = height / p.weeks;
            const maxItems = Math.max(0, Math.floor((rowH - NUM_H - 2) / CHIP_H));
            return (
              <div key={p.key} className="month-pane" style={{ left: `${p.offset * 100}%`, gridTemplateRows: `repeat(${p.weeks}, minmax(0, 1fr))` }}>
                {Array.from({ length: p.weeks }, (_, w) => (
                  <div key={w} className="month-week">
                    {showWeekNumbers && <span className="wk-col">{isoWeek(p.days[w * 7])}</span>}
                    {p.days.slice(w * 7, w * 7 + 7).map((d) => {
                      const k = toDateKey(d);
                      const items = byDay.get(k) ?? [];
                      const shown = items.length > maxItems ? items.slice(0, Math.max(0, maxItems - 1)) : items;
                      const more = items.length - shown.length;
                      return (
                        <div
                          key={k}
                          role="button"
                          tabIndex={0}
                          className={`mc ${isSameMonth(d, p.month) ? '' : 'other'} ${k === today ? 'today' : ''} ${k < today ? 'past' : ''}`}
                          onClick={() => openDay(k)}
                          onKeyDown={(e) => e.key === 'Enter' && openDay(k)}
                          aria-label={format(d, 'EEEE d MMMM')}
                        >
                          <span className="mc-num">{d.getDate()}</span>
                          {shown.map((it) => (
                            <span
                              key={it.key}
                              className={`mc-chip c-${it.color} ${it.allDay ? 'all' : ''} ${it.done ? 'is-done' : ''}`}
                              onClick={
                                fine
                                  ? (e) => {
                                      e.stopPropagation();
                                      it.open();
                                    }
                                  : undefined
                              }
                            >
                              {it.title}
                            </span>
                          ))}
                          {more > 0 && <span className="mc-more">+{more}</span>}
                          {maxItems === 0 && items.length > 0 && <span className="mc-dot" />}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

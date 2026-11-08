import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent, type MutableRefObject } from 'react';
import { flushSync } from 'react-dom';
import { addDays, differenceInCalendarDays, format, isWeekend, startOfWeek } from 'date-fns';
import { useData } from '../store/data';
import { useUI } from '../store/ui';
import { useMediaQuery, useNow } from '../lib/hooks';
import { fmtHourLabel, fmtTime, isoWeek, minutesOfDay, parseLocal, toDateKey, toLocalISO } from '../lib/dates';
import { expandEvents, type Occurrence } from '../lib/recurrence';
import { layoutDay, type Positioned } from '../lib/layout';
import { visibleEvents } from '../lib/selectors';
import { taskBounds } from '../lib/schedule';
import { periodStart, shiftCursor, spanOf } from '../lib/period';
import { usePager } from '../lib/usePager';
import { toggleDone } from '../lib/actions';
import { haptic } from '../lib/telegram';
import { StatusGlyph } from '../components/StatusCircle';
import type { ColorKey, Task, ViewMode } from '../types';

export interface PagerControl {
  go(dir: 1 | -1): void;
  scrollToNow?(): void;
}

type Block = {
  key: string;
  kind: 'event' | 'task';
  startMin: number;
  endMin: number;
  start: Date;
  end: Date;
  title: string;
  color: ColorKey | 'ink';
  location?: string;
  recurring: boolean;
  occ?: Occurrence;
  task?: Task;
};

interface DayData {
  key: string;
  date: Date;
  blocks: (Block & Positioned)[];
  allDay: Occurrence[];
}

const AD_ROW = 22;

/* Shared between dragstart and drop (dataTransfer can't be read during dragover). Desktop only. */
let drag: { kind: 'event' | 'task'; id: string; grabMin: number; durationMin: number } | null = null;

export function TimeGrid({ view, controlRef }: { view: ViewMode; controlRef: MutableRefObject<PagerControl | null> }) {
  const cursor = useUI((s) => s.cursor);
  const setCursor = useUI((s) => s.setCursor);
  const openEvent = useUI((s) => s.openEvent);
  const openTodo = useUI((s) => s.openTodo);
  const draft = useUI((s) => (s.eventEditor && !s.eventEditor.id ? s.eventEditor.draft : undefined));
  const events = useData((s) => s.events);
  const tasks = useData((s) => s.tasks);
  const calendars = useData((s) => s.calendars);
  const weekStartsOn = useData((s) => s.settings.weekStartsOn);
  const tf = useData((s) => s.settings.timeFormat);
  const showWeekNumbers = useData((s) => s.settings.showWeekNumbers);
  const defaultMin = useData((s) => s.settings.defaultEventMinutes);
  const updateSettings = useData((s) => s.updateSettings);
  const wide = useMediaQuery('(min-width: 1024px)');
  const fine = useMediaQuery('(pointer: fine)');
  const hourH = wide ? 60 : 52;
  const ppm = hourH / 60;
  const now = useNow(30000);
  const todayK = toDateKey(now);
  const nowMin = minutesOfDay(now);

  const n = spanOf(view);
  const start = periodStart(view, parseLocal(cursor), weekStartsOn);
  const startK = toDateKey(start);
  const panes = useMemo(
    () =>
      [-1, 0, 1].map((offset) => {
        const s = addDays(start, offset * n);
        return { offset, key: `${view}:${toDateKey(s)}`, days: Array.from({ length: n }, (_, i) => addDays(s, i)) };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [startK, n, view],
  );

  /* ---------- Per-day data, cached so unchanged days keep their identity while paging ---------- */
  const visEv = useMemo(() => visibleEvents(events, calendars), [events, calendars]);
  const scheduled = useMemo(() => tasks.filter((t) => t.scheduledStart), [tasks]);
  const colorOf = useMemo(() => new Map(calendars.map((c) => [c.id, c.color])), [calendars]);
  const cache = useMemo(() => new Map<string, DayData>(), [visEv, scheduled, colorOf]);

  const getDay = (d: Date): DayData => {
    const key = toDateKey(d);
    const hit = cache.get(key);
    if (hit) return hit;
    const dayStart = d.getTime();
    const next = addDays(d, 1);
    const dayEnd = next.getTime();
    const occ = expandEvents(visEv, d, next);
    const blocks: Block[] = [];
    const allDay: Occurrence[] = [];
    for (const o of occ) {
      if (o.event.allDay) {
        allDay.push(o);
        continue;
      }
      blocks.push({
        key: o.key,
        kind: 'event',
        startMin: Math.max(0, (o.start.getTime() - dayStart) / 60000),
        endMin: Math.min(1440, (o.end.getTime() - dayStart) / 60000),
        start: o.start,
        end: o.end,
        title: o.event.title,
        color: colorOf.get(o.event.calendarId) ?? 'slate',
        location: o.event.location,
        recurring: !!o.event.recurrence,
        occ: o,
      });
    }
    for (const t of scheduled) {
      const b = taskBounds(t);
      if (!b || b.start.getTime() >= dayEnd || b.end.getTime() <= dayStart) continue;
      blocks.push({
        key: `t:${t.id}`,
        kind: 'task',
        startMin: Math.max(0, (b.start.getTime() - dayStart) / 60000),
        endMin: Math.min(1440, (b.end.getTime() - dayStart) / 60000),
        start: b.start,
        end: b.end,
        title: t.title,
        color: 'ink',
        recurring: false,
        task: t,
      });
    }
    const data = { key, date: d, blocks: layoutDay(blocks, 20), allDay };
    cache.set(key, data);
    return data;
  };

  /* ---------- All-day bars that span across columns ---------- */
  const allDayPanes = panes.map((p) => {
    const spans = new Map<string, { occ: Occurrence; startCol: number; endCol: number }>();
    p.days.forEach((d, col) => {
      for (const o of getDay(d).allDay) {
        const s = spans.get(o.key);
        if (s) s.endCol = col;
        else spans.set(o.key, { occ: o, startCol: col, endCol: col });
      }
    });
    const list = [...spans.values()].sort((a, b) => a.startCol - b.startCol || b.endCol - b.startCol - (a.endCol - a.startCol));
    const laneEnds: number[] = [];
    const bars = list.map((s) => {
      let lane = laneEnds.findIndex((e) => e < s.startCol);
      if (lane === -1) lane = laneEnds.push(s.endCol) - 1;
      else laneEnds[lane] = s.endCol;
      return { ...s, lane };
    });
    return { bars, lanes: laneEnds.length };
  });
  const adLanes = Math.max(...allDayPanes.map((a) => a.lanes));

  /* ---------- Pager ---------- */
  const rootRef = useRef<HTMLDivElement>(null);
  const headTrack = useRef<HTMLDivElement>(null);
  const adTrack = useRef<HTMLDivElement>(null);
  const bodyTrack = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef(view);
  viewRef.current = view;

  const { go } = usePager({
    rootRef,
    trackRefs: [headTrack, adTrack, bodyTrack],
    getWidth: () => viewportRef.current?.clientWidth ?? 0,
    onCommit: (dir) => {
      flushSync(() => setCursor(shiftCursor(viewRef.current, useUI.getState().cursor, dir)));
      haptic.select();
    },
  });

  const scrollToNow = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: Math.max(0, minutesOfDay(new Date()) * ppm - el.clientHeight * 0.3), behavior: 'smooth' });
  }, [ppm]);
  controlRef.current = { go, scrollToNow };

  // Open near the current time (or 7am on other days). Scroll is kept while paging.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const showsToday = panes[1].days.some((d) => toDateKey(d) === todayK);
    el.scrollTop = showsToday ? Math.max(0, nowMin * ppm - el.clientHeight * 0.3) : 7 * 60 * ppm;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- Interactions ---------- */
  const onSlot = useCallback(
    (dateKey: string, minutes: number) => {
      const min = Math.floor(minutes / 30) * 30;
      const s = parseLocal(dateKey);
      s.setMinutes(min);
      const e = new Date(s.getTime() + defaultMin * 60000);
      haptic.tap();
      openEvent({ draft: { start: toLocalISO(s), end: toLocalISO(e), allDay: false } });
    },
    [defaultMin, openEvent],
  );

  const onOpenBlock = useCallback(
    (b: Block) => {
      if (b.kind === 'task') return openTodo(b.task!.id);
      const o = b.occ!;
      openEvent({
        id: o.event.id,
        occurrence: o.event.recurrence ? { dateKey: o.dateKey, start: toLocalISO(o.start), end: toLocalISO(o.end) } : undefined,
      });
    },
    [openEvent, openTodo],
  );

  const onDropAt = useCallback(
    (dateKey: string, startMin: number) => {
      const d = drag;
      drag = null;
      if (!d) return;
      const s = parseLocal(dateKey);
      s.setMinutes(startMin);
      const { tasks: ts, events: evs, updateTask, updateEvent } = useData.getState();
      const toast = useUI.getState().toast;
      if (d.kind === 'task') {
        const prev = ts.find((t) => t.id === d.id)?.scheduledStart ?? null;
        updateTask(d.id, { scheduledStart: toLocalISO(s) });
        toast(`Moved to ${format(s, 'EEE d MMM')}, ${fmtTime(s, useData.getState().settings.timeFormat)}`, {
          label: 'Undo',
          run: () => useData.getState().updateTask(d.id, { scheduledStart: prev }),
        });
      } else {
        const ev = evs.find((x) => x.id === d.id);
        if (!ev) return;
        const prev = { start: ev.start, end: ev.end };
        updateEvent(d.id, { start: toLocalISO(s), end: toLocalISO(new Date(s.getTime() + d.durationMin * 60000)) });
        toast('Event moved', { label: 'Undo', run: () => useData.getState().updateEvent(d.id, prev) });
      }
    },
    [],
  );

  const ghostFor = (key: string) => {
    if (!draft?.start || draft.allDay || draft.start.slice(0, 10) !== key) return null;
    const s = parseLocal(draft.start);
    const e = draft.end ? parseLocal(draft.end) : new Date(s.getTime() + defaultMin * 60000);
    return { startMin: minutesOfDay(s), endMin: Math.max(minutesOfDay(s) + 15, (e.getTime() - parseLocal(key).getTime()) / 60000) };
  };

  const pastBefore = (d: Date) => {
    const k = toDateKey(d);
    return k < todayK ? Number.POSITIVE_INFINITY : k > todayK ? Number.NEGATIVE_INFINITY : now.getTime();
  };

  const currentHasToday = panes[1].days.some((d) => toDateKey(d) === todayK);
  const weekStrip = view === 'day' ? Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(start, { weekStartsOn }), i)) : [];
  const stripIdx = weekStrip.findIndex((d) => toDateKey(d) === cursor);

  return (
    <div className={`tg v-${view}`} ref={rootRef} style={{ ['--hour-h' as string]: `${hourH}px`, ['--n' as string]: n }}>
      {view === 'day' ? (
        <div className="tg-strip" style={{ ['--i' as string]: stripIdx }}>
          <span className="strip-sel" aria-hidden>
            <i />
          </span>
          {weekStrip.map((d) => {
            const k = toDateKey(d);
            return (
              <button
                key={k}
                className={`strip-day ${k === cursor ? 'sel' : ''} ${k === todayK ? 'today' : ''}`}
                onClick={() => {
                  const diff = differenceInCalendarDays(d, parseLocal(cursor));
                  if (Math.abs(diff) === 1) go(diff as 1 | -1);
                  else if (diff) {
                    haptic.select();
                    setCursor(k);
                  }
                }}
              >
                <span className="dh-dow">{format(d, 'EEEEE')}</span>
                <span className="dh-num">{d.getDate()}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="tg-head">
          <div className="tg-corner">{showWeekNumbers && view === 'week' && <span className="wk">W{isoWeek(start)}</span>}</div>
          <div className="tg-vp">
            <div className="tg-track" ref={headTrack}>
              {panes.map((p) => (
                <div key={p.key} className="tg-pane tg-dhs" style={{ left: `${p.offset * 100}%` }}>
                  {p.days.map((d) => {
                    const k = toDateKey(d);
                    return (
                      <button
                        key={k}
                        className={`tg-dh ${k === todayK ? 'today' : ''} ${k < todayK ? 'past' : ''}`}
                        onClick={() => {
                          haptic.select();
                          setCursor(k);
                          updateSettings({ calendarView: 'day' });
                        }}
                        aria-label={format(d, 'EEEE d MMMM')}
                      >
                        <span className="dh-dow">{format(d, n === 7 ? 'EEEEE' : 'EEE')}</span>
                        <span className="dh-num">{d.getDate()}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {view === 'day' && <div className="tg-dayline">{format(parseLocal(cursor), 'EEEE, d MMMM')}</div>}

      {adLanes > 0 && (
        <div className="tg-allday" style={{ height: adLanes * AD_ROW + 6 }}>
          <div className="tg-corner small">all-day</div>
          <div className="tg-vp">
            <div className="tg-track" ref={adTrack}>
              {panes.map((p, i) => (
                <div key={p.key} className="tg-pane" style={{ left: `${p.offset * 100}%` }}>
                  {allDayPanes[i].bars.map((b) => {
                    const cal = colorOf.get(b.occ.event.calendarId) ?? 'slate';
                    const clipL = b.occ.start < p.days[0];
                    const clipR = b.occ.end > addDays(p.days[n - 1], 1);
                    return (
                      <button
                        key={b.occ.key}
                        className={`ad-bar c-${cal} ${clipL ? 'clip-l' : ''} ${clipR ? 'clip-r' : ''}`}
                        style={{
                          left: `calc(${(b.startCol / n) * 100}% + 2px)`,
                          width: `calc(${((b.endCol - b.startCol + 1) / n) * 100}% - 4px)`,
                          top: b.lane * AD_ROW + 3,
                        }}
                        onClick={() =>
                          openEvent({
                            id: b.occ.event.id,
                            occurrence: b.occ.event.recurrence
                              ? { dateKey: b.occ.dateKey, start: toLocalISO(b.occ.start), end: toLocalISO(b.occ.end) }
                              : undefined,
                          })
                        }
                      >
                        {b.occ.event.title}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="tg-scroll scroll-y" ref={scrollRef}>
        <div className="tg-canvas" style={{ height: 24 * hourH }}>
          <div className="tg-gutter" aria-hidden>
            {Array.from({ length: 23 }, (_, i) => i + 1).map((h) => (
              <span
                key={h}
                className={`tg-hour ${currentHasToday && Math.abs(nowMin - h * 60) < 18 ? 'hide' : ''}`}
                style={{ top: h * hourH }}
              >
                {fmtHourLabel(h, tf)}
              </span>
            ))}
            {currentHasToday && (
              <span className="tg-nowlabel" style={{ transform: `translate3d(0, ${nowMin * ppm}px, 0) translateY(-50%)` }}>
                {fmtTime(now, tf)}
              </span>
            )}
          </div>
          <div className="tg-vp" ref={viewportRef}>
            <div className="tg-track" ref={bodyTrack}>
              {panes.map((p) => {
                const todayCol = p.days.findIndex((d) => toDateKey(d) === todayK);
                return (
                  <div key={p.key} className="tg-pane tg-cols" style={{ left: `${p.offset * 100}%` }}>
                    {p.days.map((d) => {
                      const data = getDay(d);
                      return (
                        <DayColumn
                          key={data.key}
                          data={data}
                          ppm={ppm}
                          pastBefore={pastBefore(d)}
                          weekend={n > 1 && isWeekend(d)}
                          narrow={n === 7 && !wide}
                          ghost={ghostFor(data.key)}
                          tf={tf}
                          fine={fine}
                          onSlot={onSlot}
                          onOpenBlock={onOpenBlock}
                          onDropAt={onDropAt}
                        />
                      );
                    })}
                    {todayCol >= 0 && (
                      <div className="now" style={{ transform: `translate3d(0, ${nowMin * ppm}px, 0)` }} aria-hidden>
                        <div className="now-rule" />
                        <div className="now-seg" style={{ left: `${(todayCol / n) * 100}%`, width: `${100 / n}%` }}>
                          <i />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const DayColumn = memo(function DayColumn(props: {
  data: DayData;
  ppm: number;
  pastBefore: number;
  weekend: boolean;
  narrow: boolean;
  ghost: { startMin: number; endMin: number } | null;
  tf: '24h' | '12h';
  fine: boolean;
  onSlot: (dateKey: string, minutes: number) => void;
  onOpenBlock: (b: Block) => void;
  onDropAt: (dateKey: string, startMin: number) => void;
}) {
  const { data, ppm, pastBefore, weekend, narrow, ghost, tf, fine, onSlot, onOpenBlock, onDropAt } = props;
  const [preview, setPreview] = useState<{ startMin: number; durationMin: number } | null>(null);

  const minutesAt = (clientY: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return Math.max(0, Math.min(1439, (clientY - r.top) / ppm));
  };

  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    onSlot(data.key, minutesAt(e.clientY, e.currentTarget));
  };

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!drag) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const startMin = Math.max(0, Math.min(1425, Math.round((minutesAt(e.clientY, e.currentTarget) - drag.grabMin) / 15) * 15));
    if (!preview || preview.startMin !== startMin) setPreview({ startMin, durationMin: drag.durationMin });
  };

  return (
    <div
      className={`tg-col ${weekend ? 'weekend' : ''}`}
      onClick={onClick}
      onDragOver={fine ? onDragOver : undefined}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setPreview(null);
      }}
      onDrop={(e) => {
        e.preventDefault();
        const p = preview;
        setPreview(null);
        if (p) onDropAt(data.key, p.startMin);
      }}
    >
      {data.blocks.map((b) => {
        const top = b.startMin * ppm + 1;
        const height = Math.max((b.endMin - b.startMin) * ppm - 2, 18);
        const done = b.task?.status === 'done';
        const canDrag = fine && !b.recurring;
        // Fit whole lines only: title lines first, then the time if there's room for it.
        const lineH = narrow ? 13 : 14;
        const inner = height - (narrow ? 4 : 6);
        const showTime = inner >= lineH * (narrow ? 3 : 2);
        const lines = Math.max(1, Math.floor((inner - (showTime ? 13 : 0)) / lineH));
        return (
          <div
            key={b.key}
            role="button"
            tabIndex={0}
            className={`ev c-${b.color} ${b.kind === 'task' ? 'is-task' : ''} ${done ? 'is-done' : ''} ${b.end.getTime() <= pastBefore ? 'past' : ''} ${height < 30 ? 'short' : ''}`}
            style={{
              top,
              height,
              left: `calc(${(b.col / b.cols) * 100}% + 1px)`,
              width: `calc(${(b.span / b.cols) * 100}% - 3px)`,
              ['--lines' as string]: lines,
            }}
            onClick={() => onOpenBlock(b)}
            onKeyDown={(e) => e.key === 'Enter' && onOpenBlock(b)}
            draggable={canDrag}
            onDragStart={
              canDrag
                ? (e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    drag = {
                      kind: b.kind,
                      id: b.kind === 'task' ? b.task!.id : b.occ!.event.id,
                      grabMin: Math.max(0, (e.clientY - r.top) / ppm),
                      durationMin: Math.round((b.end.getTime() - b.start.getTime()) / 60000),
                    };
                    e.dataTransfer.setData('text/plain', b.key);
                    e.dataTransfer.effectAllowed = 'move';
                  }
                : undefined
            }
            onDragEnd={() => {
              drag = null;
              setPreview(null);
            }}
          >
            <span className="ev-title">
              {b.kind === 'task' && (
                <span
                  className="ev-check"
                  role="checkbox"
                  aria-checked={done}
                  aria-label={`Complete ${b.title}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleDone(b.task!);
                  }}
                >
                  <StatusGlyph status={b.task!.status} size={12} />
                </span>
              )}
              {b.title}
            </span>
            {showTime && (
              <span className="ev-time">
                {narrow ? fmtTime(b.start, tf) : `${fmtTime(b.start, tf)} – ${fmtTime(b.end, tf)}`}
              </span>
            )}
            {!narrow && inner >= lineH * lines + 26 && b.location && <span className="ev-time">{b.location}</span>}
          </div>
        );
      })}
      {ghost && (
        <div className="ev ghost" style={{ top: ghost.startMin * ppm + 1, height: Math.max((ghost.endMin - ghost.startMin) * ppm - 2, 18) }}>
          <span className="ev-title">New event</span>
        </div>
      )}
      {preview && (
        <div className="ev ghost" style={{ top: preview.startMin * ppm + 1, height: Math.max(18, preview.durationMin * ppm - 2) }}>
          <span className="ev-title">{fmtTime(new Date(data.date.getFullYear(), data.date.getMonth(), data.date.getDate(), 0, preview.startMin), tf)}</span>
        </div>
      )}
    </div>
  );
});

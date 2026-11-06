import { useLayoutEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from 'react';
import { addDays, format } from 'date-fns';
import { Check } from 'lucide-react';
import { useData, calendarById } from '../store/data';
import { useUI } from '../store/ui';
import { useNow } from '../lib/hooks';
import { fmtHourLabel, fmtTime, isoWeek, minutesOfDay, toDateKey, toLocalISO, todayKey } from '../lib/dates';
import { expandEvents, type Occurrence } from '../lib/recurrence';
import { layoutDay } from '../lib/layout';
import { dueTasksOn, isTaskVisible, visibleEvents } from '../lib/selectors';
import { taskBounds } from '../lib/schedule';
import { toggleDone } from '../lib/actions';
import { haptic } from '../lib/telegram';
import type { Task } from '../types';

type Block =
  | { kind: 'event'; key: string; startMin: number; endMin: number; occ: Occurrence; start: Date; end: Date }
  | { kind: 'task'; key: string; startMin: number; endMin: number; task: Task; start: Date; end: Date };

/** Shared between dragstart and drop (dataTransfer can't be read during dragover). */
let drag: { type: 'task' | 'event'; id: string; grabMin: number; durationMin: number } | null = null;

export function startTaskDrag(task: Task) {
  drag = { type: 'task', id: task.id, grabMin: 0, durationMin: task.durationMin || 30 };
}

export function TimeGrid({ days }: { days: Date[] }) {
  const events = useData((s) => s.events);
  const tasks = useData((s) => s.tasks);
  const calendars = useData((s) => s.calendars);
  const settings = useData((s) => s.settings);
  const updateTask = useData((s) => s.updateTask);
  const updateEvent = useData((s) => s.updateEvent);
  const ui = useUI();
  const now = useNow(60000);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<{ day: number; startMin: number; durationMin: number } | null>(null);

  const tf = settings.timeFormat;
  const rangeStart = days[0];
  const rangeEnd = addDays(days[days.length - 1], 1);
  const hourH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hour-h')) || 52;
  const pxPerMin = hourH / 60;
  const today = todayKey();

  const occ = useMemo(
    () => expandEvents(visibleEvents(events, calendars), rangeStart, rangeEnd),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [events, calendars, toDateKey(rangeStart), days.length],
  );
  const visTasks = useMemo(
    () => (settings.showTasksOnCalendar ? tasks.filter((t) => isTaskVisible(t, calendars)) : []),
    [tasks, calendars, settings.showTasksOnCalendar],
  );

  const columns = useMemo(
    () =>
      days.map((day) => {
        const key = toDateKey(day);
        const dayStart = day.getTime();
        const dayEnd = addDays(day, 1).getTime();
        const blocks: Block[] = [];
        for (const o of occ) {
          if (o.event.allDay) continue;
          if (o.start.getTime() >= dayEnd || o.end.getTime() <= dayStart) continue;
          const s = Math.max(0, (o.start.getTime() - dayStart) / 60000);
          const e = Math.min(1440, (o.end.getTime() - dayStart) / 60000);
          blocks.push({ kind: 'event', key: o.key, startMin: s, endMin: e, occ: o, start: o.start, end: o.end });
        }
        for (const t of visTasks) {
          const b = taskBounds(t);
          if (!b || b.start.getTime() >= dayEnd || b.end.getTime() <= dayStart) continue;
          const s = Math.max(0, (b.start.getTime() - dayStart) / 60000);
          const e = Math.min(1440, (b.end.getTime() - dayStart) / 60000);
          blocks.push({ kind: 'task', key: `t:${t.id}`, startMin: s, endMin: e, task: t, start: b.start, end: b.end });
        }
        const allDay = occ.filter((o) => o.event.allDay && o.start.getTime() < dayEnd && o.end.getTime() > dayStart);
        const due = dueTasksOn(visTasks, key);
        return { day, key, blocks: layoutDay(blocks), allDay, due };
      }),
    [days, occ, visTasks],
  );

  const hasAllDay = columns.some((c) => c.allDay.length || c.due.length);

  // Scroll to a sensible hour on first render
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const showsToday = columns.some((c) => c.key === today);
    const target = showsToday ? Math.max(0, minutesOfDay(new Date()) - 90) : 7 * 60;
    el.scrollTop = target * pxPerMin;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const minutesFromEvent = (e: { clientY: number }, col: HTMLElement) => {
    const rect = col.getBoundingClientRect();
    return Math.max(0, Math.min(1439, (e.clientY - rect.top) / pxPerMin));
  };

  const onColumnClick = (e: MouseEvent<HTMLDivElement>, day: Date) => {
    if (e.target !== e.currentTarget) return;
    const min = Math.floor(minutesFromEvent(e, e.currentTarget) / 30) * 30;
    const start = new Date(day);
    start.setHours(0, min, 0, 0);
    const end = new Date(start.getTime() + settings.defaultEventMinutes * 60000);
    haptic.tap();
    ui.openEditor({ kind: 'event', draft: { start: toLocalISO(start), end: toLocalISO(end), allDay: false } });
  };

  const onDragOver = (e: DragEvent<HTMLDivElement>, dayIdx: number) => {
    if (!drag) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const raw = minutesFromEvent(e, e.currentTarget) - drag.grabMin;
    const startMin = Math.max(0, Math.min(1440 - 15, Math.round(raw / 15) * 15));
    if (!preview || preview.day !== dayIdx || preview.startMin !== startMin) {
      setPreview({ day: dayIdx, startMin, durationMin: drag.durationMin });
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>, day: Date) => {
    e.preventDefault();
    const p = preview;
    setPreview(null);
    const d = drag;
    drag = null;
    if (!d || !p) return;
    const start = new Date(day);
    start.setHours(0, p.startMin, 0, 0);
    if (d.type === 'task') {
      const t = tasks.find((x) => x.id === d.id);
      const prev = t?.scheduledStart ?? null;
      updateTask(d.id, { scheduledStart: toLocalISO(start) });
      ui.toast(`Scheduled for ${format(start, 'EEE d MMM')} · ${fmtTime(start, tf)}`, {
        label: 'Undo',
        run: () => useData.getState().updateTask(d.id, { scheduledStart: prev }),
      });
    } else {
      const ev = events.find((x) => x.id === d.id);
      if (!ev) return;
      const end = new Date(start.getTime() + d.durationMin * 60000);
      const prev = { start: ev.start, end: ev.end };
      updateEvent(d.id, { start: toLocalISO(start), end: toLocalISO(end) });
      ui.toast('Event moved', { label: 'Undo', run: () => useData.getState().updateEvent(d.id, prev) });
    }
  };

  const onBlockDragStart = (e: DragEvent<HTMLElement>, b: Block) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const grabMin = Math.max(0, (e.clientY - rect.top) / pxPerMin);
    const durationMin = Math.round((b.end.getTime() - b.start.getTime()) / 60000);
    drag =
      b.kind === 'task'
        ? { type: 'task', id: b.task.id, grabMin, durationMin }
        : { type: 'event', id: b.occ.event.id, grabMin, durationMin };
    e.dataTransfer.setData('text/plain', b.key);
    e.dataTransfer.effectAllowed = 'move';
  };

  const openBlock = (b: Block) => {
    if (b.kind === 'task') ui.openEditor({ kind: 'task', id: b.task.id });
    else
      ui.openEditor({
        kind: 'event',
        id: b.occ.event.id,
        occurrence: b.occ.event.recurrence
          ? { dateKey: b.occ.dateKey, start: toLocalISO(b.occ.start), end: toLocalISO(b.occ.end) }
          : undefined,
      });
  };

  const cols = `var(--gutter-w) repeat(${days.length}, minmax(0, 1fr))`;
  const nowMin = minutesOfDay(now);
  const single = days.length === 1;

  return (
    <div className={`tg ${single ? 'single' : ''} days-${days.length}`}>
      <div className="tg-head" style={{ gridTemplateColumns: cols }}>
        <div className="tg-corner">
          {settings.showWeekNumbers && <span className="wk-badge">{isoWeek(days[0])}</span>}
        </div>
        {columns.map((c) => (
          <button
            key={c.key}
            className={`tg-dayhead ${c.key === today ? 'today' : ''}`}
            onClick={() => {
              ui.setCursor(c.key);
              if (!single) useData.getState().updateSettings({ calendarView: 'day' });
            }}
          >
            <span className="dow">{format(c.day, single ? 'EEEE' : 'EEE')}</span>
            <span className="dnum">{c.day.getDate()}</span>
          </button>
        ))}
      </div>

      {hasAllDay && (
        <div className="tg-allday" style={{ gridTemplateColumns: cols }}>
          <div className="tg-corner small">all-day</div>
          {columns.map((c) => (
            <div key={c.key} className="tg-allday-cell">
              {c.allDay.map((o) => {
                const cal = calendarById(calendars, o.event.calendarId);
                return (
                  <button
                    key={o.key}
                    className={`ad-chip c-${cal?.color ?? 'slate'}`}
                    onClick={() =>
                      ui.openEditor({
                        kind: 'event',
                        id: o.event.id,
                        occurrence: o.event.recurrence
                          ? { dateKey: o.dateKey, start: toLocalISO(o.start), end: toLocalISO(o.end) }
                          : undefined,
                      })
                    }
                    title={o.event.title}
                  >
                    {o.event.title}
                  </button>
                );
              })}
              {c.due.map((t) => {
                const cal = calendarById(calendars, t.calendarId);
                return (
                  <button
                    key={t.id}
                    className={`ad-chip task c-${cal?.color ?? 'teal'} ${t.status === 'done' ? 'is-done' : ''}`}
                    onClick={() => ui.openEditor({ kind: 'task', id: t.id })}
                    draggable
                    onDragStart={(e) => {
                      startTaskDrag(t);
                      e.dataTransfer.setData('text/plain', t.id);
                    }}
                    title={`Due: ${t.title}`}
                  >
                    <span
                      className={`ad-check ${t.status === 'done' ? 'on' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleDone(t);
                      }}
                    >
                      {t.status === 'done' && <Check size={9} strokeWidth={4} />}
                    </span>
                    {t.title}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}

      <div className="tg-body scroll-y" ref={bodyRef}>
        <div className="tg-grid" style={{ gridTemplateColumns: cols, height: 24 * hourH }}>
          <div className="tg-gutter">
            {Array.from({ length: 23 }, (_, i) => i + 1).map((h) => (
              <span key={h} style={{ top: h * hourH }}>
                {fmtHourLabel(h, tf)}
              </span>
            ))}
          </div>
          {columns.map((c, idx) => (
            <div
              key={c.key}
              className={`tg-col ${c.key === today ? 'today' : ''}`}
              onClick={(e) => onColumnClick(e, c.day)}
              onDragOver={(e) => onDragOver(e, idx)}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setPreview(null);
              }}
              onDrop={(e) => onDrop(e, c.day)}
            >
              {c.blocks.map((b) => {
                const top = b.startMin * pxPerMin;
                const height = Math.max((b.endMin - b.startMin) * pxPerMin - 2, 18);
                const style = {
                  top,
                  height,
                  left: `calc(${(b.col / b.cols) * 100}% + 1px)`,
                  width: `calc(${(b.span / b.cols) * 100}% - 3px)`,
                };
                const roomy = height >= 40;
                if (b.kind === 'event') {
                  const ev = b.occ.event;
                  const cal = calendarById(calendars, ev.calendarId);
                  return (
                    <div
                      key={b.key}
                      className={`tg-block c-${cal?.color ?? 'slate'} ${b.end <= now ? 'past' : ''}`}
                      style={style}
                      onClick={() => openBlock(b)}
                      draggable={!ev.recurrence}
                      onDragStart={(e) => onBlockDragStart(e, b)}
                      onDragEnd={() => {
                        drag = null;
                        setPreview(null);
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      <span className="tb-title">{ev.title}</span>
                      {roomy && (
                        <span className="tb-time">
                          {fmtTime(b.start, tf)} – {fmtTime(b.end, tf)}
                        </span>
                      )}
                      {roomy && height > 64 && ev.location && <span className="tb-time">{ev.location}</span>}
                    </div>
                  );
                }
                const t = b.task;
                const cal = calendarById(calendars, t.calendarId);
                return (
                  <div
                    key={b.key}
                    className={`tg-block task c-${cal?.color ?? 'teal'} ${t.status === 'done' ? 'is-done' : ''}`}
                    style={style}
                    onClick={() => openBlock(b)}
                    draggable
                    onDragStart={(e) => onBlockDragStart(e, b)}
                    onDragEnd={() => {
                      drag = null;
                      setPreview(null);
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <span className="tb-title">
                      <span
                        className={`tb-check ${t.status === 'done' ? 'on' : ''}`}
                        role="checkbox"
                        aria-checked={t.status === 'done'}
                        aria-label={`Complete ${t.title}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleDone(t);
                        }}
                      >
                        {t.status === 'done' && <Check size={9} strokeWidth={4} />}
                      </span>
                      {t.title}
                    </span>
                    {roomy && (
                      <span className="tb-time">
                        {fmtTime(b.start, tf)} – {fmtTime(b.end, tf)}
                      </span>
                    )}
                  </div>
                );
              })}
              {preview && preview.day === idx && (
                <div
                  className="tg-preview"
                  style={{ top: preview.startMin * pxPerMin, height: Math.max(18, preview.durationMin * pxPerMin - 2) }}
                >
                  {fmtTime(new Date(c.day.getFullYear(), c.day.getMonth(), c.day.getDate(), 0, preview.startMin), tf)}
                </div>
              )}
              {c.key === today && (
                <div className="now-line" style={{ top: nowMin * pxPerMin }}>
                  <i />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

import { useMemo, useState, type UIEvent } from 'react';
import { addDays, differenceInMinutes, format, startOfDay } from 'date-fns';
import { AlarmClock, CalendarDays, CheckCircle2, ChevronRight, Clock3, MapPin, Plus, Search, Sparkles, Timer } from 'lucide-react';
import { useData, calendarById } from '../store/data';
import { useUI } from '../store/ui';
import { useNow } from '../lib/hooks';
import { fmtDuration, fmtTime, greeting, roundUpToStep, toDateKey, toLocalISO } from '../lib/dates';
import { expandEvents } from '../lib/recurrence';
import { countByStatus, dayAgenda, isOverdue, isTaskVisible, sortTasks, visibleEvents, type DayItem } from '../lib/selectors';
import { freeGaps } from '../lib/schedule';
import { ProgressRing } from '../components/ProgressRing';
import { TaskCheck, TaskItem } from '../components/TaskItem';
import type { TaskStatus } from '../types';

export function TodayView() {
  const now = useNow();
  const events = useData((s) => s.events);
  const tasks = useData((s) => s.tasks);
  const calendars = useData((s) => s.calendars);
  const settings = useData((s) => s.settings);
  const ui = useUI();
  const [scrim, setScrim] = useState<'none' | 'hero' | 'bg'>('none');

  const today = toDateKey(now);
  const dayStart = startOfDay(now);
  const visTasks = useMemo(() => tasks.filter((t) => isTaskVisible(t, calendars)), [tasks, calendars]);
  const occ = useMemo(
    () => expandEvents(visibleEvents(events, calendars), dayStart, addDays(dayStart, 1)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [events, calendars, today],
  );
  const agenda = useMemo(
    () => dayAgenda(occ, settings.showTasksOnCalendar ? visTasks : [], today),
    [occ, visTasks, today, settings.showTasksOnCalendar],
  );
  const allDay = occ.filter((o) => o.event.allDay);
  const counts = countByStatus(visTasks);

  const todays = visTasks.filter(
    (t) =>
      t.scheduledStart?.startsWith(today) ||
      t.dueDate === today ||
      (t.completedAt && toDateKey(new Date(t.completedAt)) === today),
  );
  const doneToday = todays.filter((t) => t.status === 'done').length;
  const progress = todays.length ? doneToday / todays.length : 0;
  const eventCount = occ.length;

  const overdue = sortTasks(visTasks.filter((t) => isOverdue(t, today)));
  const unscheduled = sortTasks(
    visTasks.filter((t) => t.status !== 'done' && !t.scheduledStart && !isOverdue(t, today)),
  );
  const dueSoon = visTasks.filter(
    (t) => t.status !== 'done' && t.dueDate && t.dueDate <= toDateKey(addDays(now, 2)),
  ).length;

  const current = agenda.find((i) => i.start <= now && i.end > now);
  const next = agenda.find((i) => i.start > now);

  // Timeline with free gaps (≥ 45 min, within planning hours, from now on)
  const timeline = useMemo(() => {
    const wStart = new Date(dayStart);
    wStart.setHours(settings.dayStartHour, 0, 0, 0);
    const wEnd = new Date(dayStart);
    wEnd.setHours(Math.min(24, settings.dayEndHour), 0, 0, 0);
    const from = roundUpToStep(now > wStart ? now : wStart, 15);
    const gaps =
      from < wEnd
        ? freeGaps(
            agenda.filter((i) => !(i.kind === 'task' && i.task.status === 'done')).map((i) => ({ start: i.start, end: i.end })),
            from,
            wEnd,
            45,
          )
        : [];
    type Row = { type: 'item'; item: DayItem } | { type: 'gap'; start: Date; end: Date };
    const rows: Row[] = [
      ...agenda.map((item) => ({ type: 'item' as const, item })),
      ...gaps.map((g) => ({ type: 'gap' as const, start: g.start, end: g.end })),
    ];
    return rows.sort(
      (a, b) =>
        (a.type === 'item' ? a.item.start : a.start).getTime() - (b.type === 'item' ? b.item.start : b.start).getTime(),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agenda, now.getHours(), now.getMinutes() - (now.getMinutes() % 15), settings.dayStartHour, settings.dayEndHour]);

  // Per-list progress (open tasks + tasks finished in the last 7 days)
  const weekAgo = Date.now() - 7 * 86400000;
  const lists = calendars
    .map((c) => {
      const ts = tasks.filter(
        (t) => t.calendarId === c.id && (t.status !== 'done' || (t.completedAt ?? 0) > weekAgo),
      );
      const done = ts.filter((t) => t.status === 'done').length;
      return { cal: c, total: ts.length, done };
    })
    .filter((l) => l.total > 0);

  const openTasks = (s: TaskStatus) => {
    ui.setTaskTab(s);
    ui.setTab('tasks');
  };

  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    const y = e.currentTarget.scrollTop;
    const heroH = (e.currentTarget.querySelector('.today-hero') as HTMLElement | null)?.offsetHeight ?? 240;
    setScrim(y < 4 ? 'none' : y < heroH - 40 ? 'hero' : 'bg');
  };

  const nextItem = current ?? next;
  const tf = settings.timeFormat;

  return (
    <div className="screen today">
      <div className={`top-scrim ${scrim}`} />
      <div className="scroll-y today-scroll" onScroll={onScroll}>
        <header className="today-hero">
          <div className="hero-top">
            <span className="hero-date">{format(now, 'EEEE, d MMMM')}</span>
            <span className="spacer" />
            <button className="icon-btn" aria-label="Search" onClick={() => ui.setSearchOpen(true)}>
              <Search size={21} />
            </button>
          </div>
          <div className="hero-main">
            <ProgressRing value={progress} size={96} stroke={7} color="var(--coral)" track="color-mix(in srgb, var(--hero-ink) 12%, transparent)">
              <div className="ring-inner">
                <strong>{Math.round(progress * 100)}%</strong>
                <span>today</span>
              </div>
            </ProgressRing>
            <div className="hero-text">
              <h1>
                {greeting(now)}
                {settings.name ? `, ${settings.name.split(' ')[0]}` : ''}
              </h1>
              <p>
                {eventCount} {eventCount === 1 ? 'event' : 'events'} · {doneToday} of {todays.length} tasks done
              </p>
            </div>
          </div>
          {nextItem && (
            <button
              className="next-up"
              onClick={() =>
                nextItem.kind === 'event'
                  ? ui.openEditor({
                      kind: 'event',
                      id: nextItem.occ.event.id,
                      occurrence: nextItem.occ.event.recurrence
                        ? { dateKey: nextItem.occ.dateKey, start: toLocalISO(nextItem.occ.start), end: toLocalISO(nextItem.occ.end) }
                        : undefined,
                    })
                  : ui.openEditor({ kind: 'task', id: nextItem.task.id })
              }
            >
              <span className="next-badge">{current ? 'Now' : 'Next'}</span>
              <span className="next-title">{nextItem.kind === 'event' ? nextItem.occ.event.title : nextItem.task.title}</span>
              <span className="next-time">
                {current
                  ? `until ${fmtTime(nextItem.end, tf)}`
                  : `${fmtTime(nextItem.start, tf)} · in ${fmtDuration(Math.max(1, differenceInMinutes(nextItem.start, now)))}`}
              </span>
            </button>
          )}
        </header>

        <div className="today-grid">
          <div className="today-col">
            <section className="section o-1">
              <div className="section-head">
                <h2>My Tasks</h2>
                <button className="round-btn" aria-label="Open calendar" onClick={() => ui.setTab('calendar')}>
                  <CalendarDays size={22} />
                </button>
              </div>
              <div className="status-rows">
                <button className="status-row" onClick={() => openTasks('todo')}>
                  <span className="status-icon st-todo">
                    <AlarmClock size={18} />
                  </span>
                  <span className="status-text">
                    <strong>To Do</strong>
                    <span>
                      {counts.todo} {counts.todo === 1 ? 'task' : 'tasks'} now · {dueSoon} due soon
                    </span>
                  </span>
                  <ChevronRight size={18} className="chev" />
                </button>
                <button className="status-row" onClick={() => openTasks('in_progress')}>
                  <span className="status-icon st-in_progress">
                    <Timer size={18} />
                  </span>
                  <span className="status-text">
                    <strong>In Progress</strong>
                    <span>
                      {counts.in_progress} {counts.in_progress === 1 ? 'task' : 'tasks'} now ·{' '}
                      {visTasks.filter((t) => t.status === 'in_progress' && t.scheduledStart).length} scheduled
                    </span>
                  </span>
                  <ChevronRight size={18} className="chev" />
                </button>
                <button className="status-row" onClick={() => openTasks('done')}>
                  <span className="status-icon st-done">
                    <CheckCircle2 size={18} />
                  </span>
                  <span className="status-text">
                    <strong>Done</strong>
                    <span>
                      {counts.done} {counts.done === 1 ? 'task' : 'tasks'} · {doneToday} today
                    </span>
                  </span>
                  <ChevronRight size={18} className="chev" />
                </button>
              </div>
            </section>

            {overdue.length > 0 && (
              <section className="section o-3">
                <div className="section-head">
                  <h3>Overdue</h3>
                  <span className="section-count warn">{overdue.length}</span>
                </div>
                <div className="task-list">
                  {overdue.slice(0, 4).map((t) => (
                    <TaskItem key={t.id} task={t} showPlan compact />
                  ))}
                </div>
              </section>
            )}

            <section className="section o-4">
              <div className="section-head">
                <h3>Needs a time</h3>
                {unscheduled.length > 0 && <span className="section-count">{unscheduled.length}</span>}
                <span className="spacer" />
                {unscheduled.length > 4 && (
                  <button className="link-btn" onClick={() => openTasks('todo')}>
                    See all
                  </button>
                )}
              </div>
              <p className="section-hint">
                <Sparkles size={13} /> Tap <b>Plan</b> to drop a to-do into your next free slot.
              </p>
              {unscheduled.length ? (
                <div className="task-list">
                  {unscheduled.slice(0, 4).map((t) => (
                    <TaskItem key={t.id} task={t} showPlan compact />
                  ))}
                </div>
              ) : (
                <div className="empty">
                  <strong>Everything has a time</strong>
                  Nice — all your open to-dos are planned.
                </div>
              )}
            </section>
          </div>

          <div className="today-col">
            <section className="section o-2">
              <div className="section-head">
                <h3>Today’s schedule</h3>
                <span className="spacer" />
                <button className="link-btn" onClick={() => ui.goToDate(today)}>
                  Open day
                </button>
              </div>
              {allDay.length > 0 && (
                <div className="allday-strip">
                  {allDay.map((o) => {
                    const cal = calendarById(calendars, o.event.calendarId);
                    return (
                      <button
                        key={o.key}
                        className={`allday-pill c-${cal?.color ?? 'slate'}`}
                        onClick={() => ui.openEditor({ kind: 'event', id: o.event.id })}
                      >
                        {o.event.title}
                      </button>
                    );
                  })}
                </div>
              )}
              {timeline.length ? (
                <div className="timeline">
                  {timeline.map((row) => {
                    if (row.type === 'gap') {
                      const mins = differenceInMinutes(row.end, row.start);
                      return (
                        <button
                          key={`gap-${row.start.getTime()}`}
                          className="tl-gap"
                          onClick={() => ui.setPlanSlot({ start: toLocalISO(row.start), end: toLocalISO(row.end) })}
                        >
                          <span className="tl-time">{fmtTime(row.start, tf)}</span>
                          <span className="tl-gap-body">
                            <Clock3 size={14} /> Free for {fmtDuration(mins)}
                            <span className="tl-gap-cta">
                              <Plus size={14} /> Plan
                            </span>
                          </span>
                        </button>
                      );
                    }
                    const item = row.item;
                    const past = item.end <= now;
                    const live = item.start <= now && item.end > now;
                    if (item.kind === 'event') {
                      const e = item.occ.event;
                      const cal = calendarById(calendars, e.calendarId);
                      return (
                        <button
                          key={item.key}
                          className={`tl-item c-${cal?.color ?? 'slate'} ${past ? 'past' : ''} ${live ? 'live' : ''}`}
                          onClick={() =>
                            ui.openEditor({
                              kind: 'event',
                              id: e.id,
                              occurrence: e.recurrence
                                ? { dateKey: item.occ.dateKey, start: toLocalISO(item.start), end: toLocalISO(item.end) }
                                : undefined,
                            })
                          }
                        >
                          <span className="tl-time">
                            {fmtTime(item.start, tf)}
                            <small>{fmtTime(item.end, tf)}</small>
                          </span>
                          <span className="tl-card">
                            <strong>{e.title}</strong>
                            <span className="tl-sub">
                              {e.location ? (
                                <>
                                  <MapPin size={12} /> {e.location}
                                </>
                              ) : (
                                cal?.name
                              )}
                            </span>
                          </span>
                        </button>
                      );
                    }
                    const t = item.task;
                    const cal = calendarById(calendars, t.calendarId);
                    return (
                      <div
                        key={item.key}
                        role="button"
                        tabIndex={0}
                        className={`tl-item is-task c-${cal?.color ?? 'teal'} ${past ? 'past' : ''} ${live ? 'live' : ''} ${t.status === 'done' ? 'is-done' : ''}`}
                        onClick={() => ui.openEditor({ kind: 'task', id: t.id })}
                      >
                        <span className="tl-time">
                          {fmtTime(item.start, tf)}
                          <small>{fmtTime(item.end, tf)}</small>
                        </span>
                        <span className="tl-card">
                          <span className="tl-task-row">
                            <TaskCheck task={t} size="sm" />
                            <strong>{t.title}</strong>
                          </span>
                          <span className="tl-sub">Task · {fmtDuration(t.durationMin)}</span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="empty">
                  <strong>Nothing scheduled</strong>
                  Your day is wide open.
                </div>
              )}
            </section>

            {lists.length > 0 && (
              <section className="section o-5">
                <div className="section-head">
                  <h3>Lists this week</h3>
                </div>
                <div className="list-cards">
                  {lists.map(({ cal, total, done }) => (
                    <button
                      key={cal.id}
                      className={`list-card c-${cal.color}`}
                      onClick={() => openTasks('todo')}
                    >
                      <ProgressRing value={done / total} size={64} stroke={5} color="#fff" track="rgba(255,255,255,.28)">
                        <span className="list-pct">{Math.round((done / total) * 100)}%</span>
                      </ProgressRing>
                      <span className="list-name">{cal.name}</span>
                      <span className="list-sub">
                        {done} of {total} done
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

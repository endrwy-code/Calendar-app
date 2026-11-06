import { useMemo, useState } from 'react';
import { addDays, addMinutes, differenceInMinutes } from 'date-fns';
import { CalendarDays, CheckSquare, Plus, Sparkles, Trash2, X } from 'lucide-react';
import type { CalEvent, Priority, Recurrence, Subtask, Task, TaskStatus } from '../types';
import { useData, shiftedTimes } from '../store/data';
import { useUI, type EditorState } from '../store/ui';
import { parseLocal, toDateKey, toLocalISO, todayKey } from '../lib/dates';
import { eventBounds } from '../lib/recurrence';
import { suggestSlot } from '../lib/selectors';
import { uid } from '../lib/id';
import { haptic } from '../lib/telegram';
import { Sheet, ChoiceDialog, type Choice } from './Sheet';
import { CalendarPicker } from './CalendarPicker';

type Kind = 'event' | 'task';
type Repeat = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly';

interface EventForm {
  title: string;
  calendarId: string;
  allDay: boolean;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  location: string;
  notes: string;
  repeat: Repeat;
  interval: number;
  byWeekday: number[];
  until: string;
}

interface TaskForm {
  title: string;
  status: TaskStatus;
  priority: Priority;
  calendarId: string | null;
  dueDate: string;
  scheduled: boolean;
  schedDate: string;
  schedTime: string;
  durationMin: number;
  subtasks: Subtask[];
  notes: string;
}

const WEEKDAYS = [
  { d: 1, l: 'M' },
  { d: 2, l: 'T' },
  { d: 3, l: 'W' },
  { d: 4, l: 'T' },
  { d: 5, l: 'F' },
  { d: 6, l: 'S' },
  { d: 0, l: 'S' },
];

const DURATIONS = [15, 30, 45, 60, 90, 120, 180];

const timeOf = (d: Date) => toLocalISO(d).slice(11);

function nextHour(dateKey: string): Date {
  const now = new Date();
  const base = dateKey === todayKey() ? now : parseLocal(`${dateKey}T09:00`);
  const d = new Date(base);
  if (dateKey === todayKey()) {
    d.setMinutes(0, 0, 0);
    d.setHours(d.getHours() + 1);
  }
  return d;
}

function eventFormFrom(editor: Extract<EditorState, { kind: 'event' }>, ev: CalEvent | undefined, cursor: string, defaultMin: number, firstCal: string): EventForm {
  if (ev) {
    const occStart = editor.occurrence ? parseLocal(editor.occurrence.start) : eventBounds(ev).start;
    const occEnd = editor.occurrence ? parseLocal(editor.occurrence.end) : eventBounds(ev).end;
    const r = ev.recurrence;
    let repeat: Repeat = 'none';
    if (r) {
      const days = [...(r.byWeekday ?? [])].sort().join(',');
      repeat = r.freq === 'weekly' && days === '1,2,3,4,5' ? 'weekdays' : r.freq;
    }
    return {
      title: ev.title,
      calendarId: ev.calendarId,
      allDay: ev.allDay,
      startDate: toDateKey(occStart),
      startTime: ev.allDay ? '09:00' : timeOf(occStart),
      endDate: toDateKey(ev.allDay ? addDays(occEnd, -1) : occEnd),
      endTime: ev.allDay ? '10:00' : timeOf(occEnd),
      location: ev.location ?? '',
      notes: ev.notes ?? '',
      repeat,
      interval: r?.interval ?? 1,
      byWeekday: r?.byWeekday?.length ? r.byWeekday : [occStart.getDay()],
      until: r?.until ?? '',
    };
  }
  const d = editor.draft ?? {};
  const allDay = !!d.allDay;
  const start = d.start ? parseLocal(d.start) : nextHour(cursor);
  const end = d.end && !allDay ? parseLocal(d.end) : addMinutes(start, defaultMin);
  return {
    title: d.title ?? '',
    calendarId: d.calendarId ?? firstCal,
    allDay,
    startDate: toDateKey(start),
    startTime: timeOf(start),
    endDate: allDay && d.end ? d.end.slice(0, 10) : toDateKey(end),
    endTime: timeOf(end),
    location: '',
    notes: '',
    repeat: 'none',
    interval: 1,
    byWeekday: [start.getDay()],
    until: '',
  };
}

function taskFormFrom(task: Task | undefined, draft: Partial<Task> | undefined): TaskForm {
  const t = task ?? draft ?? {};
  const sched = t.scheduledStart ? parseLocal(t.scheduledStart) : null;
  return {
    title: t.title ?? '',
    status: t.status ?? 'todo',
    priority: t.priority ?? 'none',
    calendarId: t.calendarId ?? null,
    dueDate: t.dueDate ?? '',
    scheduled: !!sched,
    schedDate: sched ? toDateKey(sched) : todayKey(),
    schedTime: sched ? timeOf(sched) : timeOf(nextHour(todayKey())),
    durationMin: t.durationMin ?? 30,
    subtasks: t.subtasks ? t.subtasks.map((s) => ({ ...s })) : [],
    notes: t.notes ?? '',
  };
}

export function EditorSheet() {
  const editor = useUI((s) => s.editor);
  if (!editor) return null;
  const key = `${editor.kind}:${editor.id ?? 'new'}:${editor.kind === 'event' ? editor.occurrence?.dateKey ?? '' : ''}`;
  return <EditorInner key={key} editor={editor} />;
}

function EditorInner({ editor }: { editor: NonNullable<EditorState> }) {
  const data = useData();
  const ui = useUI();
  const { settings, calendars } = data;
  const isNew = !editor.id;
  const existingEvent = editor.kind === 'event' && editor.id ? data.events.find((e) => e.id === editor.id) : undefined;
  const existingTask = editor.kind === 'task' && editor.id ? data.tasks.find((t) => t.id === editor.id) : undefined;
  const fromSlot = editor.kind === 'event' ? !!editor.draft?.start : !!editor.draft?.scheduledStart;

  const [kind, setKind] = useState<Kind>(editor.kind);
  const [ev, setEv] = useState<EventForm>(() =>
    eventFormFrom(
      editor.kind === 'event' ? editor : { kind: 'event' },
      existingEvent,
      ui.cursor,
      settings.defaultEventMinutes,
      calendars[0]?.id ?? 'personal',
    ),
  );
  const [tk, setTk] = useState<TaskForm>(() =>
    taskFormFrom(existingTask, editor.kind === 'task' ? editor.draft : undefined),
  );
  const [choice, setChoice] = useState<{ title: string; message?: string; choices: Choice[] } | null>(null);
  const [newSub, setNewSub] = useState('');

  const close = ui.closeEditor;

  const switchKind = (k: Kind) => {
    if (k === kind) return;
    haptic.select();
    if (k === 'task') {
      const minutes = Math.max(
        15,
        differenceInMinutes(parseLocal(`${ev.endDate}T${ev.endTime}`), parseLocal(`${ev.startDate}T${ev.startTime}`)),
      );
      setTk((t) => ({
        ...t,
        title: ev.title || t.title,
        calendarId: t.calendarId ?? ev.calendarId,
        ...(fromSlot && !ev.allDay
          ? { scheduled: true, schedDate: ev.startDate, schedTime: ev.startTime, durationMin: Math.min(minutes, 240) }
          : {}),
        ...(fromSlot && ev.allDay ? { dueDate: ev.startDate } : {}),
      }));
    } else {
      setEv((e) => {
        const next = { ...e, title: tk.title || e.title, calendarId: tk.calendarId ?? e.calendarId };
        if (tk.scheduled) {
          const s = parseLocal(`${tk.schedDate}T${tk.schedTime}`);
          const end = addMinutes(s, tk.durationMin);
          Object.assign(next, { allDay: false, startDate: tk.schedDate, startTime: tk.schedTime, endDate: toDateKey(end), endTime: timeOf(end) });
        }
        return next;
      });
    }
    setKind(k);
  };

  /* ---------------- Event save/delete ---------------- */
  const buildEvent = (): Omit<CalEvent, 'id' | 'createdAt' | 'updatedAt'> | null => {
    const title = ev.title.trim() || 'Untitled event';
    let start: string;
    let end: string;
    if (ev.allDay) {
      start = ev.startDate;
      end = ev.endDate < ev.startDate ? ev.startDate : ev.endDate;
    } else {
      const s = parseLocal(`${ev.startDate}T${ev.startTime}`);
      let e = parseLocal(`${ev.endDate}T${ev.endTime}`);
      if (e <= s) e = addMinutes(s, settings.defaultEventMinutes);
      start = toLocalISO(s);
      end = toLocalISO(e);
    }
    let recurrence: Recurrence | null = null;
    if (ev.repeat !== 'none') {
      recurrence = {
        freq: ev.repeat === 'weekdays' ? 'weekly' : ev.repeat,
        interval: ev.repeat === 'weekdays' ? 1 : Math.max(1, ev.interval || 1),
        until: ev.until || null,
      };
      if (ev.repeat === 'weekdays') recurrence.byWeekday = [1, 2, 3, 4, 5];
      if (ev.repeat === 'weekly') recurrence.byWeekday = ev.byWeekday.length ? ev.byWeekday : [parseLocal(start).getDay()];
    }
    return {
      title,
      calendarId: ev.calendarId,
      allDay: ev.allDay,
      start,
      end,
      location: ev.location.trim(),
      notes: ev.notes.trim(),
      recurrence,
      exdates: existingEvent?.exdates ?? [],
    };
  };

  const saveEvent = () => {
    const built = buildEvent();
    if (!built) return;
    if (!existingEvent) {
      data.addEvent(built);
      ui.toast('Event added');
      haptic.tap();
      close();
      return;
    }
    const occ = editor.kind === 'event' ? editor.occurrence : undefined;
    if (existingEvent.recurrence && occ) {
      setChoice({
        title: 'Save recurring event',
        message: 'Apply these changes to just this occurrence, or to every event in the series?',
        choices: [
          {
            label: 'Only this event',
            tone: 'primary',
            onSelect: () => {
              data.skipOccurrence(existingEvent.id, occ.dateKey);
              data.addEvent({ ...built, recurrence: null, exdates: [] });
              close();
            },
          },
          {
            label: 'All events',
            onSelect: () => {
              // Shift the series by however much this occurrence moved.
              const oldOccStart = parseLocal(occ.start);
              const newStart = parseLocal(built.start);
              const delta = newStart.getTime() - oldOccStart.getTime();
              const durMs = eventBounds({ ...existingEvent, ...built } as CalEvent).end.getTime() - newStart.getTime();
              const shifted = shiftedTimes(existingEvent, delta);
              let end = shifted.end;
              if (!built.allDay) end = toLocalISO(new Date(parseLocal(shifted.start).getTime() + durMs));
              else end = toDateKey(addDays(parseLocal(shifted.start), Math.round(durMs / 86400000) - 1));
              data.updateEvent(existingEvent.id, { ...built, start: shifted.start, end });
              close();
            },
          },
        ],
      });
      return;
    }
    data.updateEvent(existingEvent.id, built);
    close();
  };

  const deleteEvent = () => {
    if (!existingEvent) return;
    const snapshot = existingEvent;
    const restore = () => useData.setState((s) => ({ events: [...s.events.filter((e) => e.id !== snapshot.id), snapshot] }));
    const occ = editor.kind === 'event' ? editor.occurrence : undefined;
    if (existingEvent.recurrence && occ) {
      setChoice({
        title: 'Delete recurring event',
        choices: [
          {
            label: 'Only this event',
            tone: 'danger',
            onSelect: () => {
              data.skipOccurrence(snapshot.id, occ.dateKey);
              ui.toast('Event deleted', { label: 'Undo', run: restore });
              close();
            },
          },
          {
            label: 'This and following',
            tone: 'danger',
            onSelect: () => {
              data.endSeriesBefore(snapshot.id, occ.dateKey);
              ui.toast('Events deleted', { label: 'Undo', run: restore });
              close();
            },
          },
          {
            label: 'All events',
            tone: 'danger',
            onSelect: () => {
              data.deleteEvent(snapshot.id);
              ui.toast('Series deleted', { label: 'Undo', run: restore });
              close();
            },
          },
        ],
      });
      return;
    }
    data.deleteEvent(snapshot.id);
    ui.toast('Event deleted', { label: 'Undo', run: restore });
    close();
  };

  /* ---------------- Task save/delete ---------------- */
  const saveTask = () => {
    const title = tk.title.trim() || 'Untitled task';
    const pendingSub = newSub.trim();
    const subtasks = pendingSub ? [...tk.subtasks, { id: uid(), title: pendingSub, done: false }] : tk.subtasks;
    const payload: Partial<Task> & { title: string } = {
      title,
      status: tk.status,
      priority: tk.priority,
      calendarId: tk.calendarId,
      dueDate: tk.dueDate || null,
      scheduledStart: tk.scheduled ? `${tk.schedDate}T${tk.schedTime}` : null,
      durationMin: tk.durationMin,
      subtasks: subtasks.filter((s) => s.title.trim()),
      notes: tk.notes.trim(),
    };
    if (existingTask) data.updateTask(existingTask.id, payload);
    else {
      data.addTask(payload);
      ui.toast('Task added');
      haptic.tap();
    }
    close();
  };

  const deleteTask = () => {
    if (!existingTask) return;
    const snapshot = existingTask;
    data.deleteTask(snapshot.id);
    ui.toast('Task deleted', {
      label: 'Undo',
      run: () => useData.setState((s) => ({ tasks: [snapshot, ...s.tasks] })),
    });
    close();
  };

  const findSlot = () => {
    const slot = suggestSlot(
      { id: existingTask?.id ?? '__new__', durationMin: tk.durationMin },
      data.events,
      data.tasks,
      settings.dayStartHour,
      settings.dayEndHour,
      tk.scheduled ? tk.schedDate : undefined,
    );
    if (!slot) {
      ui.toast('No free slot found in the next two weeks');
      return;
    }
    haptic.tap();
    setTk((t) => ({ ...t, scheduled: true, schedDate: slot.slice(0, 10), schedTime: slot.slice(11) }));
  };

  const title = isNew ? (kind === 'event' ? 'New event' : 'New task') : kind === 'event' ? 'Edit event' : 'Edit task';
  const save = kind === 'event' ? saveEvent : saveTask;
  const onDelete = kind === 'event' ? deleteEvent : deleteTask;

  const quickDue = useMemo(
    () => [
      { label: 'Today', value: todayKey() },
      { label: 'Tomorrow', value: toDateKey(addDays(new Date(), 1)) },
      { label: 'Next week', value: toDateKey(addDays(new Date(), 7)) },
    ],
    [],
  );

  return (
    <Sheet
      title={title}
      onClose={close}
      tall
      footer={
        <>
          {!isNew && (
            <button className="btn btn-danger" onClick={onDelete}>
              <Trash2 size={16} /> Delete
            </button>
          )}
          <div className="spacer" />
          <button className="btn btn-ghost" onClick={close}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save}>
            Save
          </button>
        </>
      }
    >
      <div className="form">
        {isNew && (
          <div className="segmented kind-switch" role="group" aria-label="Item type">
            <button aria-pressed={kind === 'event'} onClick={() => switchKind('event')}>
              <CalendarDays size={15} /> Event
            </button>
            <button aria-pressed={kind === 'task'} onClick={() => switchKind('task')}>
              <CheckSquare size={15} /> Task
            </button>
          </div>
        )}

        <input
          className="title-input"
          placeholder={kind === 'event' ? 'Event title' : 'What needs doing?'}
          value={kind === 'event' ? ev.title : tk.title}
          autoFocus={isNew}
          onChange={(e) =>
            kind === 'event' ? setEv({ ...ev, title: e.target.value }) : setTk({ ...tk, title: e.target.value })
          }
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
          }}
        />

        {kind === 'event' ? (
          <>
            <div className="row-between">
              <span className="row-label">All day</span>
              <button
                className="switch"
                role="switch"
                aria-checked={ev.allDay}
                aria-label="All day"
                onClick={() => setEv({ ...ev, allDay: !ev.allDay })}
              />
            </div>
            <div className="dt-grid">
              <span className="row-label">Starts</span>
              <input
                className="input"
                type="date"
                value={ev.startDate}
                onChange={(e) => {
                  const v = e.target.value;
                  if (!v) return;
                  // Keep the same length when moving the start date
                  const shift = Math.round((parseLocal(v).getTime() - parseLocal(ev.startDate).getTime()) / 86400000);
                  setEv({ ...ev, startDate: v, endDate: toDateKey(addDays(parseLocal(ev.endDate), shift)) });
                }}
              />
              {!ev.allDay && (
                <input
                  className="input"
                  type="time"
                  value={ev.startTime}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (!v) return;
                    const oldS = parseLocal(`${ev.startDate}T${ev.startTime}`);
                    const oldE = parseLocal(`${ev.endDate}T${ev.endTime}`);
                    const dur = Math.max(15, differenceInMinutes(oldE, oldS));
                    const s = parseLocal(`${ev.startDate}T${v}`);
                    const end = addMinutes(s, dur);
                    setEv({ ...ev, startTime: v, endDate: toDateKey(end), endTime: timeOf(end) });
                  }}
                />
              )}
              <span className="row-label">Ends</span>
              <input
                className="input"
                type="date"
                value={ev.endDate}
                min={ev.startDate}
                onChange={(e) => e.target.value && setEv({ ...ev, endDate: e.target.value })}
              />
              {!ev.allDay && (
                <input
                  className="input"
                  type="time"
                  value={ev.endTime}
                  onChange={(e) => e.target.value && setEv({ ...ev, endTime: e.target.value })}
                />
              )}
            </div>

            <div className="field">
              <span className="field-label">Repeat</span>
              <select
                className="select"
                value={ev.repeat}
                onChange={(e) => setEv({ ...ev, repeat: e.target.value as Repeat })}
              >
                <option value="none">Does not repeat</option>
                <option value="daily">Daily</option>
                <option value="weekdays">Every weekday (Mon–Fri)</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
              {ev.repeat === 'weekly' && (
                <div className="weekday-picker" role="group" aria-label="Repeat on">
                  {WEEKDAYS.map(({ d, l }) => (
                    <button
                      key={d}
                      aria-pressed={ev.byWeekday.includes(d)}
                      aria-label={['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]}
                      onClick={() =>
                        setEv({
                          ...ev,
                          byWeekday: ev.byWeekday.includes(d)
                            ? ev.byWeekday.filter((x) => x !== d)
                            : [...ev.byWeekday, d],
                        })
                      }
                    >
                      {l}
                    </button>
                  ))}
                </div>
              )}
              {ev.repeat !== 'none' && (
                <div className="repeat-row">
                  {ev.repeat !== 'weekdays' && (
                    <label className="inline-field">
                      Every
                      <input
                        className="input"
                        type="number"
                        min={1}
                        max={99}
                        value={ev.interval}
                        onChange={(e) => setEv({ ...ev, interval: Number(e.target.value) || 1 })}
                      />
                      {{ daily: 'day(s)', weekly: 'week(s)', monthly: 'month(s)', yearly: 'year(s)' }[ev.repeat]}
                    </label>
                  )}
                  <label className="inline-field">
                    Until
                    <input
                      className="input"
                      type="date"
                      value={ev.until}
                      min={ev.startDate}
                      onChange={(e) => setEv({ ...ev, until: e.target.value })}
                    />
                  </label>
                </div>
              )}
            </div>

            <div className="field">
              <span className="field-label">Calendar</span>
              <CalendarPicker value={ev.calendarId} onChange={(id) => id && setEv({ ...ev, calendarId: id })} />
            </div>

            <div className="field">
              <span className="field-label">Location</span>
              <input
                className="input"
                placeholder="Add a place"
                value={ev.location}
                onChange={(e) => setEv({ ...ev, location: e.target.value })}
              />
            </div>
            <div className="field">
              <span className="field-label">Notes</span>
              <textarea
                className="textarea"
                placeholder="Details, links, people…"
                value={ev.notes}
                onChange={(e) => setEv({ ...ev, notes: e.target.value })}
              />
            </div>
          </>
        ) : (
          <>
            <div className="field">
              <span className="field-label">Status</span>
              <div className="segmented status-seg" role="group" aria-label="Status">
                {(
                  [
                    ['todo', 'To Do'],
                    ['in_progress', 'In Progress'],
                    ['done', 'Done'],
                  ] as const
                ).map(([s, l]) => (
                  <button key={s} className={`st-${s}`} aria-pressed={tk.status === s} onClick={() => setTk({ ...tk, status: s })}>
                    {l}
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <span className="field-label">Priority</span>
              <div className="chip-row">
                {(
                  [
                    ['none', 'None', 'slate'],
                    ['low', 'Low', 'sky'],
                    ['medium', 'Medium', 'amber'],
                    ['high', 'High', 'coral'],
                  ] as const
                ).map(([p, l, c]) => (
                  <button key={p} className={`chip c-${c}`} aria-pressed={tk.priority === p} onClick={() => setTk({ ...tk, priority: p })}>
                    {p !== 'none' && <span className="dot" />}
                    {l}
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <span className="field-label">List</span>
              <CalendarPicker allowNone value={tk.calendarId} onChange={(id) => setTk({ ...tk, calendarId: id })} />
            </div>

            <div className="field">
              <span className="field-label">Due date</span>
              <div className="chip-row">
                {quickDue.map((q) => (
                  <button key={q.label} className="chip" aria-pressed={tk.dueDate === q.value} onClick={() => setTk({ ...tk, dueDate: q.value })}>
                    {q.label}
                  </button>
                ))}
                <input
                  className="input chip-input"
                  type="date"
                  value={tk.dueDate}
                  onChange={(e) => setTk({ ...tk, dueDate: e.target.value })}
                  aria-label="Due date"
                />
                {tk.dueDate && (
                  <button className="icon-btn sm" onClick={() => setTk({ ...tk, dueDate: '' })} aria-label="Clear due date">
                    <X size={16} />
                  </button>
                )}
              </div>
            </div>

            <div className="schedule-card">
              <div className="row-between">
                <div>
                  <div className="row-label">Block time on calendar</div>
                  <div className="row-hint">Shows the task in your calendar as a time block</div>
                </div>
                <button
                  className="switch"
                  role="switch"
                  aria-checked={tk.scheduled}
                  aria-label="Block time on calendar"
                  onClick={() => setTk({ ...tk, scheduled: !tk.scheduled })}
                />
              </div>
              {tk.scheduled && (
                <div className="sched-grid">
                  <input className="input" type="date" value={tk.schedDate} onChange={(e) => e.target.value && setTk({ ...tk, schedDate: e.target.value })} aria-label="Date" />
                  <input className="input" type="time" value={tk.schedTime} onChange={(e) => e.target.value && setTk({ ...tk, schedTime: e.target.value })} aria-label="Start time" />
                  <select className="select" value={tk.durationMin} onChange={(e) => setTk({ ...tk, durationMin: Number(e.target.value) })} aria-label="Duration">
                    {[...new Set([...DURATIONS, tk.durationMin])].sort((a, b) => a - b).map((m) => (
                      <option key={m} value={m}>
                        {m < 60 ? `${m} min` : `${m / 60} hr${m > 60 ? 's' : ''}`}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <button className="btn btn-sm find-slot" onClick={findSlot}>
                <Sparkles size={14} /> Find the next free slot
              </button>
            </div>

            <div className="field">
              <span className="field-label">
                Steps {tk.subtasks.length > 0 && `· ${tk.subtasks.filter((s) => s.done).length}/${tk.subtasks.length}`}
              </span>
              <div className="subtasks">
                {tk.subtasks.map((s) => (
                  <div key={s.id} className="subtask">
                    <button
                      className={`check sm ${s.done ? 'checked' : ''}`}
                      onClick={() =>
                        setTk({ ...tk, subtasks: tk.subtasks.map((x) => (x.id === s.id ? { ...x, done: !x.done } : x)) })
                      }
                      aria-label={s.done ? 'Mark step not done' : 'Complete step'}
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4">
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    </button>
                    <input
                      className={`subtask-input ${s.done ? 'done' : ''}`}
                      value={s.title}
                      onChange={(e) =>
                        setTk({ ...tk, subtasks: tk.subtasks.map((x) => (x.id === s.id ? { ...x, title: e.target.value } : x)) })
                      }
                    />
                    <button className="icon-btn sm" onClick={() => setTk({ ...tk, subtasks: tk.subtasks.filter((x) => x.id !== s.id) })} aria-label="Remove step">
                      <X size={15} />
                    </button>
                  </div>
                ))}
                <div className="subtask add">
                  <Plus size={16} />
                  <input
                    className="subtask-input"
                    placeholder="Add a step"
                    value={newSub}
                    onChange={(e) => setNewSub(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newSub.trim()) {
                        setTk({ ...tk, subtasks: [...tk.subtasks, { id: uid(), title: newSub.trim(), done: false }] });
                        setNewSub('');
                      }
                    }}
                  />
                </div>
              </div>
            </div>

            <div className="field">
              <span className="field-label">Notes</span>
              <textarea className="textarea" placeholder="Anything to remember…" value={tk.notes} onChange={(e) => setTk({ ...tk, notes: e.target.value })} />
            </div>
          </>
        )}
      </div>
      {choice && <ChoiceDialog title={choice.title} message={choice.message} choices={choice.choices} onCancel={() => setChoice(null)} />}
    </Sheet>
  );
}

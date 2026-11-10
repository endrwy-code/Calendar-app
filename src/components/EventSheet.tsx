import { useState } from 'react';
import { addDays, addMinutes, differenceInMinutes, format, isSameDay } from 'date-fns';
import { AlignLeft, ChevronRight, Clock, MapPin, Repeat as RepeatIcon } from 'lucide-react';
import type { CalEvent, CalendarCategory, Recurrence } from '../types';
import { useData, shiftedTimes } from '../store/data';
import { useUI, type EventEditorState } from '../store/ui';
import { fmtDuration, fmtTime, parseLocal, toDateKey, toLocalISO, todayKey } from '../lib/dates';
import { eventBounds } from '../lib/recurrence';
import { scheduleTask } from '../lib/actions';
import { haptic } from '../lib/telegram';
import { ActionSheet, Sheet, type Choice } from './Sheet';
import { StatusGlyph } from './StatusCircle';
import { AutoGrow, DateField, TimeField } from './Fields';
import { TagPicker } from './TagPicker';

type Repeat = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly';

interface Form {
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

const WEEKDAYS = [
  { d: 1, l: 'M' },
  { d: 2, l: 'T' },
  { d: 3, l: 'W' },
  { d: 4, l: 'T' },
  { d: 5, l: 'F' },
  { d: 6, l: 'S' },
  { d: 0, l: 'S' },
];
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Every week on Mon, Wed until 3 Dec" */
function describeRepeat(f: Form): string {
  if (f.repeat === 'none') return '';
  const n = Math.max(1, f.interval || 1);
  const unit = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' } as const;
  let text =
    f.repeat === 'weekdays'
      ? 'Every weekday'
      : n === 1
        ? `Every ${unit[f.repeat]}`
        : `Every ${n} ${unit[f.repeat]}s`;
  if (f.repeat === 'weekly' && f.byWeekday.length) {
    const order = [1, 2, 3, 4, 5, 6, 0];
    text += ` on ${order.filter((d) => f.byWeekday.includes(d)).map((d) => DAY_SHORT[d]).join(', ')}`;
  }
  if (f.until) text += ` until ${format(parseLocal(f.until), 'd MMM')}`;
  return text;
}

const timeOf = (d: Date) => toLocalISO(d).slice(11);

function nextHour(dateKey: string): Date {
  if (dateKey !== todayKey()) return parseLocal(`${dateKey}T09:00`);
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d;
}

function formFrom(editor: NonNullable<EventEditorState>, ev: CalEvent | undefined, cursor: string, defaultMin: number, firstCal: string): Form {
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

export function EventSheet() {
  const editor = useUI((s) => s.eventEditor);
  if (!editor) return null;
  const key = `${editor.id ?? 'new'}:${editor.occurrence?.dateKey ?? ''}:${editor.draft?.start ?? ''}`;
  return <EventInner key={key} editor={editor} />;
}

function EventInner({ editor }: { editor: NonNullable<EventEditorState> }) {
  const events = useData((s) => s.events);
  const tasks = useData((s) => s.tasks);
  const calendars = useData((s) => s.calendars);
  const settings = useData((s) => s.settings);
  const data = useData.getState();
  const closeEvent = useUI((s) => s.closeEvent);
  const toast = useUI((s) => s.toast);
  const cursor = useUI((s) => s.cursor);
  const existing = editor.id ? events.find((e) => e.id === editor.id) : undefined;
  const isNew = !existing;
  const fromSlot = isNew && !!editor.draft?.start && !editor.draft.allDay;

  const [f, setF] = useState<Form>(() => formFrom(editor, existing, cursor, settings.defaultEventMinutes, calendars[0]?.id ?? 'personal'));
  const [choice, setChoice] = useState<{ title: string; message?: string; choices: Choice[] } | null>(null);
  // Tapping an event shows it first; editing is one tap away. New events open straight into the form.
  const [mode, setMode] = useState<'view' | 'edit'>(existing ? 'view' : 'edit');
  const [tagOpen, setTagOpen] = useState(false);
  const tag: CalendarCategory | undefined = calendars.find((c) => c.id === f.calendarId) ?? calendars[0];
  const tf = settings.timeFormat;
  const set = (patch: Partial<Form>) => setF((x) => ({ ...x, ...patch }));

  const build = (): Omit<CalEvent, 'id' | 'createdAt' | 'updatedAt'> => {
    let start: string;
    let end: string;
    if (f.allDay) {
      start = f.startDate;
      end = f.endDate < f.startDate ? f.startDate : f.endDate;
    } else {
      const s = parseLocal(`${f.startDate}T${f.startTime}`);
      let e = parseLocal(`${f.endDate}T${f.endTime}`);
      if (e <= s) e = addMinutes(s, settings.defaultEventMinutes);
      start = toLocalISO(s);
      end = toLocalISO(e);
    }
    let recurrence: Recurrence | null = null;
    if (f.repeat !== 'none') {
      recurrence = {
        freq: f.repeat === 'weekdays' ? 'weekly' : f.repeat,
        interval: f.repeat === 'weekdays' ? 1 : Math.max(1, f.interval || 1),
        until: f.until || null,
      };
      if (f.repeat === 'weekdays') recurrence.byWeekday = [1, 2, 3, 4, 5];
      if (f.repeat === 'weekly') recurrence.byWeekday = f.byWeekday.length ? f.byWeekday : [parseLocal(start).getDay()];
    }
    return {
      title: f.title.trim() || 'New event',
      calendarId: f.calendarId,
      allDay: f.allDay,
      start,
      end,
      location: f.location.trim(),
      notes: f.notes.trim(),
      recurrence,
      exdates: existing?.exdates ?? [],
    };
  };

  const save = (close: () => void) => {
    const built = build();
    if (!existing) {
      data.addEvent(built);
      haptic.success();
      close();
      return;
    }
    const occ = editor.occurrence;
    if (existing.recurrence && occ) {
      setChoice({
        title: 'This is a repeating event',
        message: 'Save your changes for this event only, or for all of them?',
        choices: [
          {
            label: 'This event only',
            tone: 'bold',
            onSelect: () => {
              data.skipOccurrence(existing.id, occ.dateKey);
              data.addEvent({ ...built, recurrence: null, exdates: [] });
              close();
            },
          },
          {
            label: 'All events',
            onSelect: () => {
              const delta = parseLocal(built.start).getTime() - parseLocal(occ.start).getTime();
              const durMs = eventBounds({ ...existing, ...built } as CalEvent).end.getTime() - parseLocal(built.start).getTime();
              const shifted = shiftedTimes(existing, delta);
              const end = built.allDay
                ? toDateKey(addDays(parseLocal(shifted.start), Math.round(durMs / 86400000) - 1))
                : toLocalISO(new Date(parseLocal(shifted.start).getTime() + durMs));
              data.updateEvent(existing.id, { ...built, start: shifted.start, end });
              close();
            },
          },
        ],
      });
      return;
    }
    data.updateEvent(existing.id, built);
    close();
  };

  const remove = (close: () => void) => {
    if (!existing) return;
    const snapshot = existing;
    const restore = () => useData.setState((s) => ({ events: [...s.events.filter((e) => e.id !== snapshot.id), snapshot] }));
    const occ = editor.occurrence;
    if (existing.recurrence && occ) {
      setChoice({
        title: 'Delete repeating event',
        choices: [
          {
            label: 'This event only',
            tone: 'danger',
            onSelect: () => {
              data.skipOccurrence(snapshot.id, occ.dateKey);
              toast('Event deleted', { label: 'Undo', run: restore });
              close();
            },
          },
          {
            label: 'This and following',
            tone: 'danger',
            onSelect: () => {
              data.endSeriesBefore(snapshot.id, occ.dateKey);
              toast('Events deleted', { label: 'Undo', run: restore });
              close();
            },
          },
          {
            label: 'All events',
            tone: 'danger',
            onSelect: () => {
              data.deleteEvent(snapshot.id);
              toast('Series deleted', { label: 'Undo', run: restore });
              close();
            },
          },
        ],
      });
      return;
    }
    data.deleteEvent(snapshot.id);
    toast('Event deleted', { label: 'Undo', run: restore });
    close();
  };

  // "Put a to-do here": open to-dos without a time, when creating from an empty slot
  const slotStart = fromSlot ? `${f.startDate}T${f.startTime}` : null;
  const slotMinutes = fromSlot
    ? Math.max(15, differenceInMinutes(parseLocal(`${f.endDate}T${f.endTime}`), parseLocal(`${f.startDate}T${f.startTime}`)))
    : 0;
  const candidates = fromSlot ? tasks.filter((t) => t.status !== 'done' && !t.scheduledStart).sort((a, b) => b.createdAt - a.createdAt) : [];

  if (mode === 'view' && existing) {
    return (
      <Sheet
        onClose={closeEvent}
        label="Event"
        left={(close) => (
          <button className="text-btn" onClick={close}>
            Close
          </button>
        )}
        right={() => (
          <button className="text-btn bold" onClick={() => setMode('edit')}>
            Edit
          </button>
        )}
      >
        {(close) => (
          <div className="form detail">
            <EventSummary f={f} tag={tag} timeFormat={tf} />
            {(f.location || f.notes) && (
              <div className="group rows">
                {f.location && (
                  <div className="row">
                    <MapPin size={20} strokeWidth={1.7} className="row-icon" />
                    <span className="row-main">{f.location}</span>
                  </div>
                )}
                {f.notes && (
                  <div className="row top">
                    <AlignLeft size={20} strokeWidth={1.7} className="row-icon" />
                    <span className="row-main notes">{f.notes}</span>
                  </div>
                )}
              </div>
            )}
            <button className="quiet-danger" onClick={() => remove(close)}>
              Delete event
            </button>
            {choice && <ActionSheet title={choice.title} message={choice.message} choices={choice.choices} onCancel={() => setChoice(null)} />}
          </div>
        )}
      </Sheet>
    );
  }

  return (
    <Sheet
      onClose={closeEvent}
      size={existing ? 'auto' : 'large'}
      title={isNew ? 'New event' : 'Edit event'}
      left={(close) => (
        <button className="text-btn" onClick={existing ? () => {
          setF(formFrom(editor, existing, cursor, settings.defaultEventMinutes, calendars[0]?.id ?? 'personal'));
          setMode('view');
        } : close}>
          Cancel
        </button>
      )}
      right={(close) => (
        <button className="text-btn bold" onClick={() => save(close)}>
          {isNew ? 'Add' : 'Save'}
        </button>
      )}
    >
      {(close) => (
        <div className="form edit">
          <div className="group">
            <input
              className="cell-input title"
              placeholder="Title"
              value={f.title}
              autoFocus={isNew && !fromSlot}
              onChange={(e) => set({ title: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && save(close)}
              aria-label="Title"
            />
          </div>

          {/* When */}
          <div className="group rows">
            <div className="row">
              <Clock size={20} strokeWidth={1.7} className="row-icon" />
              <span className="row-main">All day</span>
              <button className="switch" role="switch" aria-checked={f.allDay} aria-label="All day" onClick={() => set({ allDay: !f.allDay })} />
            </div>
            <div className="row sub">
              <DateField
                label="Start date"
                value={f.startDate}
                onChange={(v) => {
                  const shift = Math.round((parseLocal(v).getTime() - parseLocal(f.startDate).getTime()) / 86400000);
                  set({ startDate: v, endDate: toDateKey(addDays(parseLocal(f.endDate), shift)) });
                }}
              />
              {!f.allDay && (
                <TimeField
                  label="Start time"
                  timeFormat={tf}
                  value={f.startTime}
                  onChange={(v) => {
                    const dur = Math.max(15, differenceInMinutes(parseLocal(`${f.endDate}T${f.endTime}`), parseLocal(`${f.startDate}T${f.startTime}`)));
                    const end = addMinutes(parseLocal(`${f.startDate}T${v}`), dur);
                    set({ startTime: v, endDate: toDateKey(end), endTime: timeOf(end) });
                  }}
                />
              )}
            </div>
            <div className="row sub">
              <DateField label="End date" value={f.endDate} min={f.startDate} onChange={(v) => set({ endDate: v })} />
              {!f.allDay && <TimeField label="End time" timeFormat={tf} value={f.endTime} onChange={(v) => set({ endTime: v })} />}
            </div>
            <label className="row">
              <RepeatIcon size={20} strokeWidth={1.7} className="row-icon" />
              <span className="row-main">Repeat</span>
              <select className="cell-select" value={f.repeat} onChange={(e) => set({ repeat: e.target.value as Repeat })}>
                <option value="none">Never</option>
                <option value="daily">Every day</option>
                <option value="weekdays">Every weekday</option>
                <option value="weekly">Every week</option>
                <option value="monthly">Every month</option>
                <option value="yearly">Every year</option>
              </select>
            </label>
            {f.repeat === 'weekly' && (
              <div className="row sub">
                <div className="weekdays" role="group" aria-label="Repeat on">
                  {WEEKDAYS.map(({ d, l }) => (
                    <button
                      key={d}
                      aria-pressed={f.byWeekday.includes(d)}
                      aria-label={DAY_SHORT[d]}
                      onClick={() => set({ byWeekday: f.byWeekday.includes(d) ? f.byWeekday.filter((x) => x !== d) : [...f.byWeekday, d] })}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {f.repeat !== 'none' && f.repeat !== 'weekdays' && (
              <label className="row sub">
                <span className="row-main">Every</span>
                <input
                  className="pill-input num"
                  type="number"
                  min={1}
                  max={99}
                  value={f.interval}
                  onChange={(e) => set({ interval: Number(e.target.value) || 1 })}
                />
                <span className="cell-value">
                  {{ daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[f.repeat as 'daily']}
                  {f.interval === 1 ? '' : 's'}
                </span>
              </label>
            )}
            {f.repeat !== 'none' && (
              <div className="row sub">
                <span className="row-main">Until</span>
                {f.until ? (
                  <>
                    <DateField label="End repeat" value={f.until} min={f.startDate} onChange={(v) => set({ until: v })} />
                    <button className="text-btn small" onClick={() => set({ until: '' })}>
                      Clear
                    </button>
                  </>
                ) : (
                  <button className="text-btn row-value" onClick={() => set({ until: toDateKey(addDays(parseLocal(f.startDate), 28)) })}>
                    Forever
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Tag, place, notes */}
          <div className="group rows">
            <button className={`row c-${tag?.color ?? 'slate'}`} onClick={() => setTagOpen((v) => !v)} aria-expanded={tagOpen}>
              <span className="row-icon tag-dot-lg" />
              <span className="row-main">Tag</span>
              <span className="row-value">{tag?.name ?? 'None'}</span>
              <ChevronRight size={18} className={`row-chev ${tagOpen ? 'down' : ''}`} />
            </button>
            {tagOpen && (
              <TagPicker
                value={f.calendarId}
                onPick={(id) => {
                  set({ calendarId: id });
                  setTagOpen(false);
                }}
              />
            )}
            <div className="row">
              <MapPin size={20} strokeWidth={1.7} className="row-icon" />
              <input className="row-input" placeholder="Add a place" value={f.location} onChange={(e) => set({ location: e.target.value })} aria-label="Location" />
            </div>
            <div className="row top">
              <AlignLeft size={20} strokeWidth={1.7} className="row-icon" />
              <AutoGrow className="row-input area" placeholder="Add notes" value={f.notes} onChange={(v) => set({ notes: v })} label="Notes" />
            </div>
          </div>

          {fromSlot && candidates.length > 0 && (
            <>
              <div className="group-label">Or put a to-do here · {fmtDuration(slotMinutes)}</div>
              <div className="group rows">
                {candidates.slice(0, 4).map((t) => (
                  <button
                    key={t.id}
                    className="row"
                    onClick={() => {
                      scheduleTask(t, slotStart!, slotMinutes);
                      close();
                    }}
                  >
                    <span className="row-icon">
                      <StatusGlyph status={t.status} size={20} />
                    </span>
                    <span className="row-main">{t.title}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          {existing && (
            <button className="quiet-danger" onClick={() => remove(close)}>
              Delete event
            </button>
          )}

          {choice && <ActionSheet title={choice.title} message={choice.message} choices={choice.choices} onCancel={() => setChoice(null)} />}
        </div>
      )}
    </Sheet>
  );
}

/** Title, when, and tag, laid out to be read at a glance. */
function EventSummary({ f, tag, timeFormat }: { f: Form; tag?: CalendarCategory; timeFormat: '24h' | '12h' }) {
  const start = parseLocal(f.allDay ? f.startDate : `${f.startDate}T${f.startTime}`);
  const end = parseLocal(f.allDay ? f.endDate : `${f.endDate}T${f.endTime}`);
  const oneDay = isSameDay(start, end);
  const dateLine = oneDay
    ? format(start, 'EEEE, d MMMM')
    : `${format(start, 'EEE d MMM')} – ${format(end, 'EEE d MMM')}`;
  const timeLine = f.allDay
    ? 'All day'
    : oneDay
      ? `${fmtTime(start, timeFormat)} – ${fmtTime(end, timeFormat)} · ${fmtDuration(differenceInMinutes(end, start))}`
      : `${fmtTime(start, timeFormat)} – ${fmtTime(end, timeFormat)}`;
  const repeat = describeRepeat(f);
  return (
    <div className={`ev-summary c-${tag?.color ?? 'slate'}`}>
      <h2 className="ev-summary-title">{f.title || 'Untitled'}</h2>
      <div className="ev-summary-when">
        <span>{dateLine}</span>
        <span className="sub">{timeLine}</span>
        {repeat && (
          <span className="sub">
            <RepeatIcon size={14} strokeWidth={2} /> {repeat}
          </span>
        )}
      </div>
      {tag && (
        <span className="ev-summary-tag">
          <span className="tag-dot" />
          {tag.name}
        </span>
      )}
    </div>
  );
}

import { useMemo, useState } from 'react';
import { addMinutes } from 'date-fns';
import { useData } from '../store/data';
import { useUI } from '../store/ui';
import { fmtTime, parseLocal, relativeDayLabel, todayKey } from '../lib/dates';
import { suggestSlots } from '../lib/selectors';
import { scheduleTask, unscheduleTask } from '../lib/actions';
import { Sheet } from './Sheet';
import { Segmented } from './Segmented';
import { DateField, TimeField } from './Fields';

const DURATIONS = [
  { value: '15', label: '15 min' },
  { value: '30', label: '30 min' },
  { value: '60', label: '1 hour' },
  { value: '120', label: '2 hours' },
];

/**
 * "Add to calendar" for a to-do: pick how long it takes, then either one of
 * the next free slots on your calendar or a time of your own. The to-do stays
 * on the list and appears on the calendar as a time block; ticking it off in
 * either place updates both.
 */
export function ScheduleSheet() {
  const id = useUI((s) => s.scheduleId);
  if (!id) return null;
  return <ScheduleInner key={id} id={id} />;
}

function nearestDuration(min: number) {
  return DURATIONS.reduce((best, d) => (Math.abs(+d.value - min) < Math.abs(+best.value - min) ? d : best)).value;
}

function ScheduleInner({ id }: { id: string }) {
  const task = useData((s) => s.tasks.find((t) => t.id === id));
  const events = useData((s) => s.events);
  const tasks = useData((s) => s.tasks);
  const settings = useData((s) => s.settings);
  const openSchedule = useUI((s) => s.openSchedule);
  const [dur, setDur] = useState(() => nearestDuration(task?.durationMin || 30));

  const suggestions = useMemo(
    () =>
      task
        ? suggestSlots({ id: task.id, durationMin: +dur }, events, tasks, settings.dayStartHour, settings.dayEndHour, 3)
        : [],
    [task, dur, events, tasks, settings.dayStartHour, settings.dayEndHour],
  );

  const initial = task?.scheduledStart ?? suggestions[0] ?? `${todayKey()}T09:00`;
  const [date, setDate] = useState(initial.slice(0, 10));
  const [time, setTime] = useState(initial.slice(11, 16));

  if (!task) return null;
  const tf = settings.timeFormat;
  const close = () => openSchedule(null);

  return (
    <Sheet
      onClose={close}
      title={task.scheduledStart ? 'Move on calendar' : 'Add to calendar'}
      left={(c) => (
        <button className="text-btn" onClick={c}>
          Cancel
        </button>
      )}
    >
      {(c) => (
        <div className="form">
          <p className="sheet-sub">{task.title}</p>

          <div className="group-label">How long will it take?</div>
          <Segmented className="full" label="Duration" options={DURATIONS} value={dur} onChange={setDur} />

          {suggestions.length > 0 && (
            <>
              <div className="group-label">Free on your calendar</div>
              <div className="group rows">
                {suggestions.map((s) => {
                  const d = parseLocal(s);
                  return (
                    <button
                      key={s}
                      className="row"
                      onClick={() => {
                        scheduleTask(task, s, +dur);
                        c();
                      }}
                    >
                      <span className="row-main">{relativeDayLabel(d)}</span>
                      <span className="row-value">
                        {fmtTime(d, tf)} – {fmtTime(addMinutes(d, +dur), tf)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          <div className="group-label">Or pick a time</div>
          <div className="group rows">
            <div className="row">
              <DateField label="Date" value={date} onChange={setDate} />
              <TimeField label="Time" timeFormat={tf} value={time} onChange={setTime} />
              <span className="spacer" />
              <button
                className="btn btn-primary btn-sm"
                onClick={() => {
                  scheduleTask(task, `${date}T${time}`, +dur);
                  c();
                }}
              >
                Add
              </button>
            </div>
          </div>

          {task.scheduledStart && (
            <button
              className="quiet-danger"
              onClick={() => {
                unscheduleTask(task);
                c();
              }}
            >
              Remove from calendar
            </button>
          )}
        </div>
      )}
    </Sheet>
  );
}

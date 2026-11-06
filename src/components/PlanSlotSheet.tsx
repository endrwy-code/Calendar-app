import { differenceInMinutes } from 'date-fns';
import { CalendarPlus, ListPlus } from 'lucide-react';
import { useData, calendarById } from '../store/data';
import { useUI } from '../store/ui';
import { fmtDuration, fmtTime, parseLocal, toLocalISO } from '../lib/dates';
import { isTaskVisible, sortTasks } from '../lib/selectors';
import { haptic } from '../lib/telegram';
import { Sheet } from './Sheet';

/** "You have 2h free — what do you want to do with it?" */
export function PlanSlotSheet() {
  const slot = useUI((s) => s.planSlot);
  const setSlot = useUI((s) => s.setPlanSlot);
  const tasks = useData((s) => s.tasks);
  const calendars = useData((s) => s.calendars);
  const tf = useData((s) => s.settings.timeFormat);
  const ui = useUI();
  if (!slot) return null;

  const start = parseLocal(slot.start);
  const end = parseLocal(slot.end);
  const free = differenceInMinutes(end, start);
  const candidates = sortTasks(
    tasks.filter((t) => t.status !== 'done' && !t.scheduledStart && isTaskVisible(t, calendars)),
  );
  const close = () => setSlot(null);

  const place = (id: string, title: string, durationMin: number) => {
    const prev = useData.getState().tasks.find((t) => t.id === id)?.scheduledStart ?? null;
    useData.getState().updateTask(id, { scheduledStart: slot.start, durationMin: Math.min(durationMin, free) });
    haptic.success();
    ui.toast(`“${title}” planned at ${fmtTime(start, tf)}`, {
      label: 'Undo',
      run: () => useData.getState().updateTask(id, { scheduledStart: prev }),
    });
    close();
  };

  return (
    <Sheet title={`Free ${fmtTime(start, tf)} – ${fmtTime(end, tf)}`} onClose={close}>
      <p className="section-hint" style={{ marginBottom: 12 }}>
        {fmtDuration(free)} open. Drop a to-do in, or add something new.
      </p>
      <div className="btn-row" style={{ marginBottom: 16 }}>
        <button
          className="btn btn-sm"
          onClick={() => {
            close();
            ui.openEditor({
              kind: 'event',
              draft: { start: slot.start, end: toLocalISO(new Date(Math.min(end.getTime(), start.getTime() + 3600000))) },
            });
          }}
        >
          <CalendarPlus size={15} /> New event here
        </button>
        <button
          className="btn btn-sm"
          onClick={() => {
            close();
            ui.openEditor({ kind: 'task', draft: { scheduledStart: slot.start, durationMin: Math.min(60, free) } });
          }}
        >
          <ListPlus size={15} /> New task here
        </button>
      </div>
      {candidates.length ? (
        <div className="plan-list">
          <div className="panel-label">
            Unscheduled to-dos <span>{candidates.length}</span>
          </div>
          {candidates.map((t) => {
            const cal = calendarById(calendars, t.calendarId);
            const fits = t.durationMin <= free;
            return (
              <button key={t.id} className={`plan-item c-${cal?.color ?? 'slate'}`} onClick={() => place(t.id, t.title, t.durationMin)}>
                <span className="dot" />
                <span className="plan-title">{t.title}</span>
                <span className={`meta-chip ${fits ? '' : 'warn'}`}>{fmtDuration(t.durationMin)}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="empty">Every to-do already has a time.</div>
      )}
    </Sheet>
  );
}

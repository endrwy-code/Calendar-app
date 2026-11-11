import { useState } from 'react';
import { addMinutes } from 'date-fns';
import { AlignLeft, Check, Clock, MapPin, Repeat as RepeatIcon } from 'lucide-react';
import { useData } from '../store/data';
import { useUI } from '../store/ui';
import { parseLocal, toLocalISO } from '../lib/dates';
import { describeRepeat, planTimes, planToEvent, planToTask, type PlanDraft, type PlanItem } from '../lib/plans';
import { finishDraft } from '../lib/sync';
import { haptic } from '../lib/telegram';
import { Sheet } from './Sheet';
import { Segmented } from './Segmented';
import { AutoGrow, DateField, TimeField } from './Fields';

/**
 * Plans the bot read from a forwarded message. Each one can be edited or left
 * out before anything goes on the calendar; nothing is added until you tap Add.
 */
export function PlanReviewSheet() {
  const review = useUI((s) => s.review);
  if (!review) return null;
  return <ReviewInner key={review.id} draft={review} />;
}

const todayKey = () => toLocalISO(new Date()).slice(0, 10);

function ReviewInner({ draft }: { draft: PlanDraft }) {
  const setReview = useUI((s) => s.setReview);
  const calendars = useData((s) => s.calendars);
  const settings = useData((s) => s.settings);
  const [items, setItems] = useState<PlanItem[]>(() => draft.items.map((it) => ({ ...it })));
  const [on, setOn] = useState<boolean[]>(() => draft.items.map(() => true));
  const count = on.filter(Boolean).length;
  const tf = settings.timeFormat;
  const fallbackTag = calendars[0]?.id ?? 'personal';
  const open = draft.status === 'open';

  const update = (i: number, patch: Partial<PlanItem>) => setItems((list) => list.map((it, j) => (j === i ? { ...it, ...patch } : it)));

  const add = (close: () => void) => {
    const data = useData.getState();
    const chosen = items.filter((_, i) => on[i]);
    let firstDate: string | null = null;
    for (const it of chosen) {
      if (it.kind === 'event' && it.date) {
        data.addEvent(planToEvent(it, { defaultMinutes: settings.defaultEventMinutes, fallbackTag }));
        if (!firstDate || it.date < firstDate) firstDate = it.date;
      } else data.addTask(planToTask({ ...it, kind: 'todo' }));
    }
    void finishDraft(draft.id, { status: 'added', items: chosen });
    haptic.success();
    const ui = useUI.getState();
    ui.toast(`Added ${chosen.length} to Daybook`);
    if (firstDate) ui.goToDate(firstDate);
    else ui.setTab('todo');
    close();
  };

  const discard = (close: () => void) => {
    void finishDraft(draft.id, { status: 'cancelled' });
    useUI.getState().toast('Discarded. Nothing was added.');
    close();
  };

  return (
    <Sheet
      onClose={() => setReview(null)}
      size="large"
      title="Review plans"
      left={(close) =>
        open ? (
          <button className="text-btn" onClick={() => discard(close)}>
            Discard
          </button>
        ) : (
          <button className="text-btn" onClick={close}>
            Close
          </button>
        )
      }
      right={(close) =>
        open ? (
          <button className="text-btn bold" disabled={!count} onClick={() => add(close)}>
            {count ? `Add ${count}` : 'Add'}
          </button>
        ) : null
      }
    >
      <div className="form">
        {!open ? (
          <p className="plan-intro">{draft.status === 'added' ? 'These are already on your calendar.' : 'This draft was cancelled.'}</p>
        ) : (
          <p className="plan-intro">
            From the message you forwarded. Check the details, and untick anything you don’t want.
            {draft.note && <em> {draft.note}</em>}
          </p>
        )}

        {items.map((it, i) => {
          const included = on[i];
          const event = it.kind === 'event';
          const times = event && it.date ? planTimes(it, settings.defaultEventMinutes) : null;
          return (
            <div key={i} className={`group rows plan-card ${included ? '' : 'off'}`}>
              <div className="row plan-head">
                <button
                  className="plan-check"
                  role="checkbox"
                  aria-checked={included}
                  aria-label={included ? `Leave out ${it.title}` : `Include ${it.title}`}
                  disabled={!open}
                  onClick={() => {
                    haptic.select();
                    setOn((l) => l.map((v, j) => (j === i ? !v : v)));
                  }}
                >
                  {included && <Check size={14} strokeWidth={3} />}
                </button>
                <input className="row-input plan-title" value={it.title} onChange={(e) => update(i, { title: e.target.value })} aria-label="Title" disabled={!open} />
              </div>

              <fieldset className="plan-body" disabled={!open || !included}>
                <div className="row sub">
                  <Segmented
                    className="full"
                    label="Kind"
                    value={it.kind}
                    onChange={(kind) => update(i, kind === 'event' && !it.date ? { kind, date: todayKey() } : { kind })}
                    options={[
                      { value: 'event', label: 'Event' },
                      { value: 'todo', label: 'To-do' },
                    ]}
                  />
                </div>

                {event && it.date && (
                  <>
                    <div className="row">
                      <Clock size={20} strokeWidth={1.7} className="row-icon" />
                      <span className="row-main">All day</span>
                      <button
                        className="switch"
                        role="switch"
                        aria-checked={!it.startTime}
                        aria-label="All day"
                        onClick={() => update(i, it.startTime ? { startTime: null, endTime: null } : { startTime: '09:00', endTime: null, endDate: null })}
                      />
                    </div>
                    <div className="row sub">
                      <DateField label="Start date" value={it.date} onChange={(date) => update(i, { date, endDate: it.endDate && it.endDate > date ? it.endDate : null })} />
                      {it.startTime && <TimeField label="Start time" timeFormat={tf} value={it.startTime} onChange={(startTime) => update(i, { startTime })} />}
                    </div>
                    {times && (
                      <div className="row sub">
                        <DateField
                          label="End date"
                          value={times.allDay ? times.end : times.end.slice(0, 10)}
                          min={it.date}
                          onChange={(d) => update(i, { endDate: d > it.date! ? d : null })}
                        />
                        {it.startTime && (
                          <TimeField
                            label="End time"
                            timeFormat={tf}
                            value={times.end.slice(11)}
                            onChange={(endTime) => update(i, { endTime })}
                          />
                        )}
                      </div>
                    )}
                    {it.repeat && (
                      <div className="row">
                        <RepeatIcon size={20} strokeWidth={1.7} className="row-icon" />
                        <span className="row-main">{describeRepeat(it.repeat)}</span>
                        <button className="text-btn small" onClick={() => update(i, { repeat: null })}>
                          Don’t repeat
                        </button>
                      </div>
                    )}
                    <label className="row">
                      <span className={`row-icon tag-dot-lg c-${calendars.find((c) => c.id === (it.tagId ?? fallbackTag))?.color ?? 'slate'}`} />
                      <span className="row-main">Tag</span>
                      <select className="cell-select" value={it.tagId ?? fallbackTag} onChange={(e) => update(i, { tagId: e.target.value })}>
                        {calendars.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </>
                )}

                {!event && it.date && (
                  <div className="row">
                    <Clock size={20} strokeWidth={1.7} className="row-icon" />
                    <span className="row-main">{it.startTime ? 'Planned for' : 'By'}</span>
                    <DateField label="Date" value={it.date} onChange={(date) => update(i, { date })} />
                    {it.startTime && (
                      <TimeField
                        label="Time"
                        timeFormat={tf}
                        value={it.startTime}
                        onChange={(startTime) => {
                          // Keep the planned length when the start moves.
                          const len = it.endTime ? planTimes(it, 30) : null;
                          const mins = len ? (parseLocal(len.end).getTime() - parseLocal(len.start).getTime()) / 60000 : 30;
                          update(i, { startTime, endTime: toLocalISO(addMinutes(parseLocal(`${it.date}T${startTime}`), mins)).slice(11) });
                        }}
                      />
                    )}
                    <button className="text-btn small" onClick={() => update(i, { date: null, startTime: null, endTime: null, endDate: null })}>
                      Remove
                    </button>
                  </div>
                )}

                {(event || it.location) && (
                  <div className="row">
                    <MapPin size={20} strokeWidth={1.7} className="row-icon" />
                    <input className="row-input" placeholder="Add a place" value={it.location ?? ''} onChange={(e) => update(i, { location: e.target.value || null })} aria-label="Location" />
                  </div>
                )}
                <div className="row top">
                  <AlignLeft size={20} strokeWidth={1.7} className="row-icon" />
                  <AutoGrow className="row-input area" placeholder="Add notes" value={it.notes ?? ''} onChange={(v) => update(i, { notes: v || null })} label="Notes" />
                </div>
              </fieldset>
              {it.assumption && included && <p className="plan-guess">Guessed: {it.assumption}</p>}
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}

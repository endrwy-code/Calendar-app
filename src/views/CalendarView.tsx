import { useCallback, useMemo, useRef, useState } from 'react';
import { addDays, addMonths, format, isSameMonth, startOfWeek } from 'date-fns';
import { ChevronDown, ChevronLeft, ChevronRight, ListTodo, Menu, Plus, Search } from 'lucide-react';
import { useData } from '../store/data';
import { useUI } from '../store/ui';
import { parseLocal, toDateKey, todayKey } from '../lib/dates';
import { useIsDesktop } from '../lib/hooks';
import { useSwipe } from '../lib/useSwipe';
import { haptic } from '../lib/telegram';
import type { ViewMode } from '../types';
import { TimeGrid } from './TimeGrid';
import { MonthView } from './MonthView';
import { AgendaView } from './AgendaView';
import { MiniMonth } from '../components/MiniMonth';
import { TasksPanel } from '../components/TasksPanel';
import { Sheet } from '../components/Sheet';

export const VIEW_LABELS: Record<ViewMode, string> = {
  day: 'Day',
  '3day': '3 days',
  week: 'Week',
  month: 'Month',
  agenda: 'Schedule',
};

export function CalendarView() {
  const view = useData((s) => s.settings.calendarView);
  const weekStartsOn = useData((s) => s.settings.weekStartsOn);
  const updateSettings = useData((s) => s.updateSettings);
  const ui = useUI();
  const isDesktop = useIsDesktop();
  const [pickerOpen, setPickerOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const cursor = parseLocal(ui.cursor);

  const days = useMemo(() => {
    if (view === 'day') return [cursor];
    if (view === '3day') return [0, 1, 2].map((i) => addDays(cursor, i));
    const s = startOfWeek(cursor, { weekStartsOn });
    return Array.from({ length: 7 }, (_, i) => addDays(s, i));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui.cursor, view, weekStartsOn]);

  const navigate = useCallback(
    (dir: 1 | -1) => {
      const c = parseLocal(useUI.getState().cursor);
      const v = useData.getState().settings.calendarView;
      const next =
        v === 'month' ? addMonths(c, dir) : addDays(c, dir * (v === 'day' ? 1 : v === '3day' ? 3 : 7));
      haptic.select();
      useUI.getState().setCursor(toDateKey(next));
    },
    [],
  );
  useSwipe(bodyRef, navigate);

  const first = view === 'month' || view === 'agenda' ? cursor : days[0];
  const last = view === 'month' || view === 'agenda' ? cursor : days[days.length - 1];
  const sameYear = first.getFullYear() === new Date().getFullYear();
  const title = isSameMonth(first, last)
    ? format(first, sameYear ? 'MMMM' : 'MMMM yyyy')
    : `${format(first, 'MMM')} – ${format(last, sameYear ? 'MMM' : 'MMM yyyy')}`;

  const setView = (v: ViewMode) => {
    haptic.select();
    updateSettings({ calendarView: v });
  };

  const goToday = () => {
    haptic.tap();
    ui.setCursor(todayKey());
  };

  const newEvent = () => ui.openEditor({ kind: 'event' });

  return (
    <div className="screen calendar-screen">
      <header className="screen-header cal-header">
        {!isDesktop && (
          <button className="icon-btn" aria-label="Menu" onClick={() => ui.setDrawerOpen(true)}>
            <Menu size={22} />
          </button>
        )}
        <button className="title-btn" onClick={() => setPickerOpen((v) => !v)} aria-expanded={pickerOpen}>
          {title}
          <ChevronDown size={18} className={pickerOpen ? 'flip' : ''} />
        </button>
        {isDesktop && (
          <div className="nav-arrows">
            <button className="icon-btn" aria-label="Previous" onClick={() => navigate(-1)}>
              <ChevronLeft size={20} />
            </button>
            <button className="icon-btn" aria-label="Next" onClick={() => navigate(1)}>
              <ChevronRight size={20} />
            </button>
            <button className="btn btn-sm" onClick={goToday}>
              Today
            </button>
          </div>
        )}
        <span className="spacer" />
        {isDesktop && (
          <div className="segmented view-switch" role="group" aria-label="Calendar view">
            {(Object.keys(VIEW_LABELS) as ViewMode[]).map((v) => (
              <button key={v} aria-pressed={view === v} onClick={() => setView(v)}>
                {VIEW_LABELS[v]}
              </button>
            ))}
          </div>
        )}
        {!isDesktop && (
          <button className="icon-btn" aria-label="Tasks" onClick={() => ui.setTasksPanelOpen(true)}>
            <ListTodo size={21} />
          </button>
        )}
        <button className="icon-btn" aria-label="Search" onClick={() => ui.setSearchOpen(true)}>
          <Search size={20} />
        </button>
        {!isDesktop && (
          <button className="today-btn" aria-label="Go to today" onClick={goToday}>
            {new Date().getDate()}
          </button>
        )}
        {isDesktop && (
          <button className="btn btn-primary" onClick={newEvent}>
            <Plus size={18} /> New
          </button>
        )}
        {pickerOpen && (
          <>
            <div className="popover-catcher" onClick={() => setPickerOpen(false)} />
            <div className="popover date-popover">
              <MiniMonth
                value={ui.cursor}
                onSelect={(k) => {
                  ui.setCursor(k);
                  setPickerOpen(false);
                }}
              />
              {!isDesktop && (
                <div className="segmented view-switch small" role="group" aria-label="Calendar view">
                  {(Object.keys(VIEW_LABELS) as ViewMode[]).map((v) => (
                    <button
                      key={v}
                      aria-pressed={view === v}
                      onClick={() => {
                        setView(v);
                        setPickerOpen(false);
                      }}
                    >
                      {VIEW_LABELS[v]}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </header>

      <div className="cal-body">
        <div className="cal-main" ref={bodyRef}>
          {view === 'month' ? (
            <MonthView cursor={ui.cursor} />
          ) : view === 'agenda' ? (
            <AgendaView cursor={ui.cursor} />
          ) : (
            <TimeGrid key={view} days={days} />
          )}
        </div>
        {isDesktop && (
          <aside className="cal-aside scroll-y">
            <div className="aside-head">
              <h3>Tasks</h3>
            </div>
            <TasksPanel />
          </aside>
        )}
      </div>

      {!isDesktop && ui.tasksPanelOpen && (
        <Sheet title="Tasks" onClose={() => ui.setTasksPanelOpen(false)}>
          <TasksPanel />
        </Sheet>
      )}
    </div>
  );
}

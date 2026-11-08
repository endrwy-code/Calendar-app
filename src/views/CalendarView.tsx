import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useData } from '../store/data';
import { useUI } from '../store/ui';
import { todayKey } from '../lib/dates';
import { useMediaQuery } from '../lib/hooks';
import { haptic } from '../lib/telegram';
import { pageContains, periodTitle, shiftCursor } from '../lib/period';
import type { ViewMode } from '../types';
import { TimeGrid, type PagerControl } from './TimeGrid';
import { MonthView } from './MonthView';
import { ListView } from './ListView';
import { MiniMonth } from '../components/MiniMonth';
import { Popover } from '../components/Popover';

export const VIEW_LABELS: Record<ViewMode, string> = {
  day: 'Day',
  '3day': '3 Days',
  week: 'Week',
  month: 'Month',
  agenda: 'List',
};

export function CalendarView({ active }: { active: boolean }) {
  const view = useData((s) => s.settings.calendarView);
  const weekStartsOn = useData((s) => s.settings.weekStartsOn);
  const calendars = useData((s) => s.calendars);
  const toggleCalendar = useData((s) => s.toggleCalendar);
  const updateSettings = useData((s) => s.updateSettings);
  const cursor = useUI((s) => s.cursor);
  const setCursor = useUI((s) => s.setCursor);
  const openEvent = useUI((s) => s.openEvent);
  const wide = useMediaQuery('(min-width: 1024px)');
  const control = useRef<PagerControl | null>(null);
  const titleRef = useRef<HTMLButtonElement>(null);
  const viewRef = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState<null | 'date' | 'view'>(null);

  const title = periodTitle(view, cursor, weekStartsOn);
  const today = todayKey();
  const onToday = pageContains(view, cursor, today, weekStartsOn);

  const page = (dir: 1 | -1) => {
    if (control.current && view !== 'agenda') control.current.go(dir);
    else {
      haptic.select();
      setCursor(shiftCursor(view, cursor, dir));
    }
  };

  const goToday = () => {
    haptic.tap();
    if (onToday) {
      if (view === 'agenda' && cursor !== today) setCursor(today);
      else control.current?.scrollToNow?.();
      return;
    }
    // Slide if today is on the neighbouring page, otherwise jump.
    const dir = today < cursor ? -1 : 1;
    if (view !== 'agenda' && pageContains(view, shiftCursor(view, cursor, dir), today, weekStartsOn)) {
      control.current?.go(dir);
    } else setCursor(today);
  };

  const setView = (v: ViewMode) => {
    haptic.select();
    updateSettings({ calendarView: v });
  };

  // ← / → page on desktop
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable]') || document.querySelector('.sheet-layer')) return;
      if (e.key === 'ArrowLeft') page(-1);
      else if (e.key === 'ArrowRight') page(1);
      else if (e.key === 't') goToday();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="calendar">
      <div className="cal-bar">
        <button
          ref={titleRef}
          className="cal-title"
          onClick={() => setMenu(menu === 'date' ? null : 'date')}
          aria-expanded={menu === 'date'}
          aria-label="Pick a date"
        >
          <span className="cal-title-text" key={title.main + title.year}>
            {title.main}
            {title.year && <span className="cal-year">{title.year}</span>}
          </span>
          <ChevronDown size={16} strokeWidth={2.2} className={`cal-title-chev ${menu === 'date' ? 'up' : ''}`} />
        </button>
        <span className="spacer" />
        {wide && (
          <>
            <button className="icon-btn" aria-label="Previous" onClick={() => page(-1)}>
              <ChevronLeft size={20} />
            </button>
            <button className="icon-btn" aria-label="Next" onClick={() => page(1)}>
              <ChevronRight size={20} />
            </button>
          </>
        )}
        <button className={`pill ${onToday ? 'quiet' : ''}`} onClick={goToday}>
          Today
        </button>
        <button ref={viewRef} className="pill" onClick={() => setMenu(menu === 'view' ? null : 'view')} aria-expanded={menu === 'view'}>
          {VIEW_LABELS[view]}
          <ChevronDown size={14} strokeWidth={2.2} />
        </button>
      </div>

      <div className="cal-body">
        {view === 'month' ? (
          <MonthView controlRef={control} />
        ) : view === 'agenda' ? (
          <ListView />
        ) : (
          <TimeGrid view={view} controlRef={control} />
        )}
      </div>

      <button
        className="fab"
        aria-label="New event"
        onClick={() => {
          haptic.tap();
          openEvent({});
        }}
      >
        <Plus size={24} strokeWidth={2} />
      </button>

      {menu === 'date' && titleRef.current && (
        <Popover anchor={titleRef.current} align="left" onClose={() => setMenu(null)} className="date-pop" label="Pick a date">
          {(close) => (
            <MiniMonth
              value={cursor}
              onSelect={(k) => {
                haptic.select();
                setCursor(k);
                close();
              }}
            />
          )}
        </Popover>
      )}
      {menu === 'view' && viewRef.current && (
        <Popover anchor={viewRef.current} align="right" onClose={() => setMenu(null)} className="menu" label="Calendar view">
          {(close) => (
            <>
              {(Object.keys(VIEW_LABELS) as ViewMode[]).map((v) => (
                <button
                  key={v}
                  role="menuitemradio"
                  aria-checked={view === v}
                  className="menu-item"
                  onClick={() => {
                    setView(v);
                    close();
                  }}
                >
                  <span className="menu-check">{view === v && <Check size={15} strokeWidth={2.4} />}</span>
                  {VIEW_LABELS[v]}
                </button>
              ))}
              <div className="menu-sep" />
              <div className="menu-label">Calendars</div>
              {calendars.map((c) => (
                <button
                  key={c.id}
                  role="menuitemcheckbox"
                  aria-checked={c.visible}
                  className={`menu-item c-${c.color}`}
                  onClick={() => {
                    haptic.select();
                    toggleCalendar(c.id);
                  }}
                >
                  <span className="menu-check">{c.visible && <Check size={15} strokeWidth={2.4} />}</span>
                  {c.name}
                  <span className="dot" />
                </button>
              ))}
            </>
          )}
        </Popover>
      )}
    </div>
  );
}


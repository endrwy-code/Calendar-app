import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { useData } from '../store/data';
import { useUI } from '../store/ui';
import { todayKey } from '../lib/dates';
import { useMediaQuery } from '../lib/hooks';
import { haptic } from '../lib/telegram';
import { pageContains, periodTitle, shiftCursor } from '../lib/period';
import { TimeGrid, type PagerControl } from './TimeGrid';
import { MonthView } from './MonthView';
import { ListView } from './ListView';
import { MiniMonth } from '../components/MiniMonth';
import { Popover } from '../components/Popover';
import { CaretIcon, MenuIcon, PlusIcon, TodayIcon } from '../components/Icons';

export function CalendarView({ active }: { active: boolean }) {
  const view = useData((s) => s.settings.calendarView);
  const weekStartsOn = useData((s) => s.settings.weekStartsOn);
  const cursor = useUI((s) => s.cursor);
  const setCursor = useUI((s) => s.setCursor);
  const openEvent = useUI((s) => s.openEvent);
  const setMenuOpen = useUI((s) => s.setMenuOpen);
  const setSearchOpen = useUI((s) => s.setSearchOpen);
  const updateSettings = useData((s) => s.updateSettings);
  const wide = useMediaQuery('(min-width: 1024px)');
  const control = useRef<PagerControl | null>(null);
  const titleRef = useRef<HTMLButtonElement>(null);
  const [datePop, setDatePop] = useState(false);

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

  // Keyboard, on a computer: ← → page, T today, D 3 W M L views, N new event, / search, + − 0 zoom.
  useEffect(() => {
    if (!active) return;
    const views: Record<string, typeof view> = { d: 'day', '3': '3day', w: 'week', m: 'month', l: 'agenda' };
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable]') || document.querySelector('.sheet-layer, .drawer-layer')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (e.key === 'ArrowLeft') page(-1);
      else if (e.key === 'ArrowRight') page(1);
      else if (k === 't') goToday();
      else if (views[k]) updateSettings({ calendarView: views[k] });
      else if (k === 'n') {
        e.preventDefault();
        openEvent({});
      } else if (e.key === '/') {
        e.preventDefault();
        setSearchOpen(true);
      } else if (e.key === '+' || e.key === '=') control.current?.zoom?.(1);
      else if (e.key === '-' || e.key === '_') control.current?.zoom?.(-1);
      else if (e.key === '0') control.current?.zoom?.(0);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="calendar">
      {/* One row, like Proton: menu · month · today · new */}
      <header className="bar cal-bar">
        <button className="icon-btn bar-btn" aria-label="Menu" onClick={() => setMenuOpen(true)}>
          <MenuIcon />
        </button>
        <button
          ref={titleRef}
          className="cal-title"
          onClick={() => setDatePop(!datePop)}
          aria-expanded={datePop}
          aria-label="Pick a date"
        >
          <span className="cal-title-text" key={title.main + title.year}>
            {title.main}
            {title.year && <span className="cal-year">{title.year}</span>}
          </span>
          <CaretIcon className={`cal-title-caret ${datePop ? 'up' : ''}`} />
        </button>
        <span className="spacer" />
        <button className="icon-btn bar-btn" aria-label="Search" title="Search (/)" onClick={() => setSearchOpen(true)}>
          <Search size={21} strokeWidth={1.8} />
        </button>
        {wide && (
          <>
            <button className="icon-btn bar-btn" aria-label="Previous" onClick={() => page(-1)}>
              <ChevronLeft size={22} strokeWidth={1.8} />
            </button>
            <button className="icon-btn bar-btn" aria-label="Next" onClick={() => page(1)}>
              <ChevronRight size={22} strokeWidth={1.8} />
            </button>
          </>
        )}
        <button className={`icon-btn bar-btn today-btn ${onToday ? 'is-today' : ''}`} aria-label="Go to today" title="Today" onClick={goToday}>
          <TodayIcon day={Number(today.slice(8, 10))} />
        </button>
        <button
          className="icon-btn bar-btn"
          aria-label="New event"
          onClick={() => {
            haptic.tap();
            openEvent({});
          }}
        >
          <PlusIcon />
        </button>
      </header>

      <div className="cal-body">
        {view === 'month' ? (
          <MonthView controlRef={control} />
        ) : view === 'agenda' ? (
          <ListView />
        ) : (
          <TimeGrid view={view} controlRef={control} />
        )}
      </div>

      {datePop && titleRef.current && (
        <Popover anchor={titleRef.current} align="left" onClose={() => setDatePop(false)} className="date-pop" label="Pick a date">
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
    </div>
  );
}


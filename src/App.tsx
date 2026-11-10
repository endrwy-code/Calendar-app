import { useEffect, useState, useSyncExternalStore } from 'react';
import { useData } from './store/data';
import { useUI } from './store/ui';
import { useMediaQuery } from './lib/hooks';
import { bindBackButton, isTgSimulation, onTelegramThemeChange, setTelegramChrome, telegramColorScheme } from './lib/telegram';
import { haptic } from './lib/telegram';
import { Segmented } from './components/Segmented';
import { CalendarTabIcon, TodoTabIcon } from './components/Icons';
import { MenuDrawer } from './components/MenuDrawer';
import { closeTopSheet } from './components/Sheet';
import { EventSheet } from './components/EventSheet';
import { TodoSheet } from './components/TodoSheet';
import { ScheduleSheet } from './components/ScheduleSheet';
import { SettingsSheet } from './components/SettingsSheet';
import { Toasts } from './components/Toasts';
import { TgSim } from './components/TgSim';
import { TodoView } from './views/TodoView';
import { CalendarView } from './views/CalendarView';
import type { Tab } from './types';

const subscribeTgTheme = (cb: () => void) => onTelegramThemeChange(cb);

function useEffectiveTheme(): 'light' | 'dark' {
  const pref = useData((s) => s.settings.theme);
  const systemDark = useMediaQuery('(prefers-color-scheme: dark)');
  const tgScheme = useSyncExternalStore(subscribeTgTheme, telegramColorScheme, () => null);
  if (pref !== 'system') return pref;
  return tgScheme ?? (systemDark ? 'dark' : 'light');
}

function tabOptions(tab: Tab) {
  return [
    {
      value: 'todo' as Tab,
      label: (
        <>
          <span className="tab-pill">
            <TodoTabIcon active={tab === 'todo'} />
          </span>
          <span className="tab-label">To-do</span>
        </>
      ),
      ariaLabel: 'To-do',
    },
    {
      value: 'calendar' as Tab,
      label: (
        <>
          <span className="tab-pill">
            <CalendarTabIcon active={tab === 'calendar'} />
          </span>
          <span className="tab-label">Calendar</span>
        </>
      ),
      ariaLabel: 'Calendar',
    },
  ];
}

export default function App() {
  const hydrated = useData((s) => s.hydrated);
  const theme = useEffectiveTheme();
  const tab = useUI((s) => s.tab);
  const setTab = useUI((s) => s.setTab);
  const anySheet = useUI((s) => !!(s.eventEditor || s.todoId || s.scheduleId || s.settingsOpen || s.menuOpen));

  // The calendar mounts once the app is idle (or on first visit), then stays mounted to keep its scroll position.
  const [calendarReady, setCalendarReady] = useState(tab === 'calendar');
  useEffect(() => {
    if (calendarReady) return;
    if (tab === 'calendar') return setCalendarReady(true);
    const t = setTimeout(() => setCalendarReady(true), 600);
    return () => clearTimeout(t);
  }, [tab, calendarReady]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg);
    setTelegramChrome({ header: bg, background: bg, bottomBar: bg });
  }, [theme]);

  // Telegram's back button closes the top sheet, with its animation.
  useEffect(() => bindBackButton(anySheet ? () => closeTopSheet() : null), [anySheet]);

  if (!hydrated) return <div className="splash" />;

  return (
    <div className="app" data-tab={tab}>
      <main className="stage">
        <section className={`screen screen-todo ${tab === 'todo' ? 'is-active' : ''}`} inert={tab !== 'todo'} aria-label="To-do">
          <TodoView />
        </section>
        <section className={`screen screen-calendar ${tab === 'calendar' ? 'is-active' : ''}`} inert={tab !== 'calendar'} aria-label="Calendar">
          {calendarReady && <CalendarView active={tab === 'calendar'} />}
        </section>
      </main>

      {/* Two tabs at the bottom, in thumb reach. The highlight springs across and can be dragged. */}
      <nav className="tabbar">
        <Segmented
          className="tabbar-seg"
          label="Section"
          options={tabOptions(tab)}
          value={tab}
          onChange={(t) => {
            haptic.select();
            setTab(t);
          }}
        />
      </nav>

      <MenuDrawer />
      <TodoSheet />
      <ScheduleSheet />
      <EventSheet />
      <SettingsSheet />
      <Toasts />
      {isTgSimulation && <TgSim />}
    </div>
  );
}

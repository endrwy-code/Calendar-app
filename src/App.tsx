import { useEffect, useSyncExternalStore } from 'react';
import { useData } from './store/data';
import { useUI } from './store/ui';
import { useIsDesktop, useMediaQuery } from './lib/hooks';
import { bindBackButton, isTgSimulation, onTelegramThemeChange, setTelegramChrome, telegramColorScheme } from './lib/telegram';
import { Sidebar } from './components/Sidebar';
import { BottomNav } from './components/BottomNav';
import { EditorSheet } from './components/Editor';
import { SearchSheet } from './components/SearchSheet';
import { PlanSlotSheet } from './components/PlanSlotSheet';
import { Toasts } from './components/Toasts';
import { TgSim } from './components/TgSim';
import { TodayView } from './views/TodayView';
import { CalendarView } from './views/CalendarView';
import { TasksView } from './views/TasksView';
import { SettingsView } from './views/SettingsView';

const subscribeTgTheme = (cb: () => void) => onTelegramThemeChange(cb);

function useEffectiveTheme(): 'light' | 'dark' {
  const pref = useData((s) => s.settings.theme);
  const systemDark = useMediaQuery('(prefers-color-scheme: dark)');
  const tgScheme = useSyncExternalStore(subscribeTgTheme, telegramColorScheme, () => null);
  if (pref !== 'system') return pref;
  return tgScheme ?? (systemDark ? 'dark' : 'light');
}

export default function App() {
  const hydrated = useData((s) => s.hydrated);
  const theme = useEffectiveTheme();
  const isDesktop = useIsDesktop();
  const ui = useUI();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#121419' : '#fbf7ef');
  }, [theme]);

  // Match Telegram's status bar / background / nav bar to the current screen
  useEffect(() => {
    const css = getComputedStyle(document.documentElement);
    const v = (name: string) => css.getPropertyValue(name).trim();
    setTelegramChrome({
      header: ui.tab === 'today' ? v('--hero') : v('--bg'),
      background: v('--bg'),
      bottomBar: v('--surface'),
    });
  }, [theme, ui.tab]);

  // Telegram's native back button closes the top-most layer, then returns to Today
  const backHandler = ui.editor
    ? ui.closeEditor
    : ui.searchOpen
      ? () => ui.setSearchOpen(false)
      : ui.planSlot
        ? () => ui.setPlanSlot(null)
        : ui.tasksPanelOpen
          ? () => ui.setTasksPanelOpen(false)
          : ui.drawerOpen
            ? () => ui.setDrawerOpen(false)
            : ui.tab !== 'today' && !isDesktop
              ? () => ui.setTab('today')
              : null;
  useEffect(() => bindBackButton(backHandler), [backHandler]);

  if (!hydrated) return <div className="splash" />;

  return (
    <div className="app">
      {isDesktop && <Sidebar />}
      <main className="app-main">
        {ui.tab === 'today' && <TodayView />}
        {ui.tab === 'calendar' && <CalendarView />}
        {ui.tab === 'tasks' && <TasksView />}
        {ui.tab === 'settings' && <SettingsView />}
        {!isDesktop && <BottomNav />}
      </main>

      {!isDesktop && ui.drawerOpen && (
        <>
          <div className="drawer-backdrop" onClick={() => ui.setDrawerOpen(false)} />
          <Sidebar drawer />
        </>
      )}
      <EditorSheet />
      <SearchSheet />
      <PlanSlotSheet />
      <Toasts />
      {isTgSimulation && <TgSim />}
    </div>
  );
}

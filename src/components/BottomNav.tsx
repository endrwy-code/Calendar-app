import { CalendarDays, Home, ListTodo, Plus, Settings } from 'lucide-react';
import { useUI } from '../store/ui';
import { haptic } from '../lib/telegram';
import type { Tab } from '../types';

const ITEMS: { tab: Tab; label: string; icon: typeof Home }[] = [
  { tab: 'today', label: 'Today', icon: Home },
  { tab: 'calendar', label: 'Calendar', icon: CalendarDays },
  { tab: 'tasks', label: 'Tasks', icon: ListTodo },
  { tab: 'settings', label: 'Settings', icon: Settings },
];

export function BottomNav() {
  const tab = useUI((s) => s.tab);
  const setTab = useUI((s) => s.setTab);
  const openEditor = useUI((s) => s.openEditor);

  const item = ({ tab: t, label, icon: Icon }: (typeof ITEMS)[number]) => (
    <button
      key={t}
      className="nav-item"
      aria-current={tab === t ? 'page' : undefined}
      onClick={() => {
        if (tab !== t) haptic.select();
        setTab(t);
      }}
    >
      <span className="nav-icon">
        <Icon size={21} strokeWidth={tab === t ? 2.3 : 1.9} />
      </span>
      {label}
    </button>
  );

  return (
    <nav className="bottom-nav" aria-label="Main">
      {item(ITEMS[0])}
      {item(ITEMS[1])}
      <button
        className="nav-fab"
        aria-label={tab === 'calendar' ? 'New event' : 'New task'}
        onClick={() => {
          haptic.tap();
          openEditor({ kind: tab === 'calendar' ? 'event' : 'task' });
        }}
      >
        <Plus size={26} strokeWidth={2.4} />
      </button>
      {item(ITEMS[2])}
      {item(ITEMS[3])}
    </nav>
  );
}

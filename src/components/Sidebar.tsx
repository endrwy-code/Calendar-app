import { CalendarDays, CalendarRange, Check, Columns3, Home, LayoutGrid, List, ListTodo, Settings, Square } from 'lucide-react';
import { useData } from '../store/data';
import { useUI } from '../store/ui';
import { countByStatus } from '../lib/selectors';
import { MiniMonth } from './MiniMonth';
import { BrandMark } from './BrandMark';
import type { Tab, ViewMode } from '../types';

const VIEWS: { v: ViewMode; label: string; icon: typeof Square }[] = [
  { v: 'day', label: 'Day', icon: Square },
  { v: '3day', label: '3 days', icon: Columns3 },
  { v: 'week', label: 'Week', icon: CalendarRange },
  { v: 'month', label: 'Month', icon: LayoutGrid },
  { v: 'agenda', label: 'Schedule', icon: List },
];

const NAV: { tab: Tab; label: string; icon: typeof Home }[] = [
  { tab: 'today', label: 'Today', icon: Home },
  { tab: 'calendar', label: 'Calendar', icon: CalendarDays },
  { tab: 'tasks', label: 'Tasks', icon: ListTodo },
  { tab: 'settings', label: 'Settings', icon: Settings },
];

export function Sidebar({ drawer }: { drawer?: boolean }) {
  const calendars = useData((s) => s.calendars);
  const tasks = useData((s) => s.tasks);
  const view = useData((s) => s.settings.calendarView);
  const updateSettings = useData((s) => s.updateSettings);
  const toggleCalendar = useData((s) => s.toggleCalendar);
  const ui = useUI();
  const counts = countByStatus(tasks);

  const pickView = (v: ViewMode) => {
    updateSettings({ calendarView: v });
    ui.setTab('calendar');
  };

  return (
    <nav className={`sidebar ${drawer ? 'drawer scroll-y' : 'scroll-y'}`} aria-label="Main">
      <div className="brand">
        <BrandMark />
        <span className="brand-name">Daybook</span>
      </div>

      {!drawer && (
        <div className="side-section">
          {NAV.map(({ tab, label, icon: Icon }) => (
            <button key={tab} className="side-link" aria-current={ui.tab === tab ? 'page' : undefined} onClick={() => ui.setTab(tab)}>
              <Icon size={19} />
              {label}
              {tab === 'tasks' && <span className="count">{counts.todo + counts.in_progress}</span>}
            </button>
          ))}
        </div>
      )}

      {drawer && (
        <div className="side-section">
          <div className="side-heading">View</div>
          {VIEWS.map(({ v, label, icon: Icon }) => (
            <button key={v} className="side-link" aria-pressed={view === v} onClick={() => pickView(v)}>
              <Icon size={18} />
              {label}
            </button>
          ))}
        </div>
      )}

      <div className="side-section">
        <MiniMonth
          value={ui.cursor}
          onSelect={(k) => {
            ui.goToDate(k);
          }}
        />
      </div>

      <div className="side-section">
        <div className="side-heading">Calendars</div>
        {calendars.map((c) => (
          <button key={c.id} className={`cal-toggle c-${c.color}`} onClick={() => toggleCalendar(c.id)} aria-pressed={c.visible}>
            <span className={`cal-box ${c.visible ? 'on' : ''}`}>{c.visible && <Check size={12} strokeWidth={3.5} />}</span>
            {c.name}
          </button>
        ))}
        <button className="link-btn side-manage" onClick={() => ui.setTab('settings')}>
          Manage calendars
        </button>
      </div>
    </nav>
  );
}

import { useRef, useState, type ReactNode } from 'react';
import { Check, Copy, Download, Plus, Trash2, Upload } from 'lucide-react';
import { useData, type BackupFile } from '../store/data';
import { useUI } from '../store/ui';
import { COLOR_KEYS, type ColorKey } from '../types';
import { isTelegram, tg } from '../lib/telegram';
import { ChoiceDialog } from '../components/Sheet';

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="set-row">
      <div className="set-text">
        <span className="set-label">{label}</span>
        {hint && <span className="set-hint">{hint}</span>}
      </div>
      <div className="set-control">{children}</div>
    </div>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button className="switch" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} />;
}

const hours = Array.from({ length: 25 }, (_, h) => h);

export function SettingsView() {
  const data = useData();
  const toast = useUI((s) => s.toast);
  const s = data.settings;
  const set = data.updateSettings;
  const [newCal, setNewCal] = useState('');
  const [newColor, setNewColor] = useState<ColorKey>('green');
  const [editing, setEditing] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | 'reset' | 'sample' | { deleteCal: string }>(null);
  const [importText, setImportText] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const hasSample = data.events.some((e) => e.sample) || data.tasks.some((t) => t.sample);

  const backupJson = () => JSON.stringify(data.exportBackup(), null, 2);

  const download = () => {
    const blob = new Blob([backupJson()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `daybook-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(backupJson());
      toast('Backup copied to clipboard');
    } catch {
      toast('Couldn’t access the clipboard');
    }
  };

  const doImport = (text: string) => {
    try {
      const parsed = JSON.parse(text) as BackupFile;
      if (parsed.app !== 'calendar-app' || !Array.isArray(parsed.events) || !Array.isArray(parsed.tasks)) throw new Error();
      data.importBackup(parsed);
      setImportText('');
      toast(`Imported ${parsed.events.length} events and ${parsed.tasks.length} tasks`);
    } catch {
      toast('That doesn’t look like a Daybook backup');
    }
  };

  return (
    <div className="screen settings-screen">
      <header className="screen-header">
        <h1 className="screen-title">Settings</h1>
      </header>
      <div className="scroll-y settings-scroll">
        <div className="settings-wrap">
          <section className="set-group">
            <h3>You</h3>
            <Row label="Name" hint="Used for your greeting">
              <input className="input" style={{ maxWidth: 200 }} placeholder="Your name" value={s.name} onChange={(e) => set({ name: e.target.value })} />
            </Row>
          </section>

          <section className="set-group">
            <h3>Appearance</h3>
            <Row label="Theme" hint={isTelegram ? 'System follows your Telegram theme' : undefined}>
              <div className="segmented">
                {(['system', 'light', 'dark'] as const).map((t) => (
                  <button key={t} aria-pressed={s.theme === t} onClick={() => set({ theme: t })}>
                    {t[0].toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>
            </Row>
          </section>

          <section className="set-group">
            <h3>Calendar</h3>
            <Row label="Week starts on">
              <div className="segmented">
                <button aria-pressed={s.weekStartsOn === 1} onClick={() => set({ weekStartsOn: 1 })}>Monday</button>
                <button aria-pressed={s.weekStartsOn === 0} onClick={() => set({ weekStartsOn: 0 })}>Sunday</button>
              </div>
            </Row>
            <Row label="Time format">
              <div className="segmented">
                <button aria-pressed={s.timeFormat === '24h'} onClick={() => set({ timeFormat: '24h' })}>24h</button>
                <button aria-pressed={s.timeFormat === '12h'} onClick={() => set({ timeFormat: '12h' })}>12h</button>
              </div>
            </Row>
            <Row label="Show week numbers">
              <Toggle label="Show week numbers" on={s.showWeekNumbers} onChange={(v) => set({ showWeekNumbers: v })} />
            </Row>
            <Row label="Show tasks on calendar" hint="Scheduled and due tasks appear alongside events">
              <Toggle label="Show tasks on calendar" on={s.showTasksOnCalendar} onChange={(v) => set({ showTasksOnCalendar: v })} />
            </Row>
            <Row label="Default event length">
              <select className="select" value={s.defaultEventMinutes} onChange={(e) => set({ defaultEventMinutes: Number(e.target.value) })}>
                {[15, 30, 45, 60, 90, 120].map((m) => (
                  <option key={m} value={m}>
                    {m < 60 ? `${m} min` : `${m / 60} hr${m > 60 ? 's' : ''}`}
                  </option>
                ))}
              </select>
            </Row>
          </section>

          <section className="set-group">
            <h3>Planning</h3>
            <Row label="Plannable hours" hint="“Plan” and “Find a free slot” only use this window">
              <div className="hours-pick">
                <select className="select" value={s.dayStartHour} onChange={(e) => set({ dayStartHour: Number(e.target.value) })} aria-label="From">
                  {hours.slice(0, 24).map((h) => (
                    <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
                  ))}
                </select>
                <span>–</span>
                <select className="select" value={s.dayEndHour} onChange={(e) => set({ dayEndHour: Number(e.target.value) })} aria-label="To">
                  {hours.slice(1).filter((h) => h > s.dayStartHour).map((h) => (
                    <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
                  ))}
                </select>
              </div>
            </Row>
          </section>

          <section className="set-group">
            <h3>Calendars &amp; lists</h3>
            {data.calendars.map((c) => (
              <div key={c.id} className="cal-row">
                <span className={`cal-swatch c-${c.color}`} />
                {editing === c.id ? (
                  <input
                    className="input"
                    autoFocus
                    value={c.name}
                    onChange={(e) => data.updateCalendar(c.id, { name: e.target.value })}
                    onBlur={() => setEditing(null)}
                    onKeyDown={(e) => e.key === 'Enter' && setEditing(null)}
                  />
                ) : (
                  <button className="cal-name" onClick={() => setEditing(c.id)}>
                    {c.name}
                  </button>
                )}
                <div className="color-pick">
                  {COLOR_KEYS.map((k) => (
                    <button key={k} className={`swatch c-${k}`} aria-label={k} aria-pressed={c.color === k} onClick={() => data.updateCalendar(c.id, { color: k })}>
                      {c.color === k && <Check size={11} strokeWidth={3.5} />}
                    </button>
                  ))}
                </div>
                <button
                  className="icon-btn sm"
                  aria-label={`Delete ${c.name}`}
                  disabled={data.calendars.length <= 1}
                  onClick={() => setConfirm({ deleteCal: c.id })}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
            <form
              className="cal-row add"
              onSubmit={(e) => {
                e.preventDefault();
                if (!newCal.trim()) return;
                data.addCalendar({ name: newCal.trim(), color: newColor });
                setNewCal('');
              }}
            >
              <span className={`cal-swatch c-${newColor}`} />
              <input className="input" placeholder="New calendar" value={newCal} onChange={(e) => setNewCal(e.target.value)} />
              <div className="color-pick">
                {COLOR_KEYS.map((k) => (
                  <button type="button" key={k} className={`swatch c-${k}`} aria-label={k} aria-pressed={newColor === k} onClick={() => setNewColor(k)}>
                    {newColor === k && <Check size={11} strokeWidth={3.5} />}
                  </button>
                ))}
              </div>
              <button className="icon-btn sm" type="submit" aria-label="Add calendar">
                <Plus size={18} />
              </button>
            </form>
          </section>

          <section className="set-group">
            <h3>Data</h3>
            <p className="set-note">
              Everything is stored on this device{isTelegram ? ' (Telegram device storage)' : ''}. Export a backup to move it elsewhere.
            </p>
            <div className="btn-row">
              <button className="btn btn-sm" onClick={download}>
                <Download size={15} /> Download backup
              </button>
              <button className="btn btn-sm" onClick={copy}>
                <Copy size={15} /> Copy backup
              </button>
              <button className="btn btn-sm" onClick={() => fileRef.current?.click()}>
                <Upload size={15} /> Import file
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                hidden
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (f) doImport(await f.text());
                  e.target.value = '';
                }}
              />
            </div>
            <textarea className="textarea" placeholder="…or paste a backup here" value={importText} onChange={(e) => setImportText(e.target.value)} />
            {importText.trim() && (
              <button className="btn btn-primary btn-sm" onClick={() => doImport(importText)}>
                Import pasted backup
              </button>
            )}
            <div className="btn-row">
              {hasSample ? (
                <button className="btn btn-sm" onClick={() => setConfirm('sample')}>
                  Remove sample data
                </button>
              ) : (
                <button className="btn btn-sm" onClick={() => data.loadSampleData()}>
                  Load sample data
                </button>
              )}
              <button className="btn btn-sm btn-danger" onClick={() => setConfirm('reset')}>
                Erase everything
              </button>
            </div>
          </section>

          <p className="about">
            Daybook 0.1 · {isTelegram ? `Telegram Mini App (Bot API ${tg?.version}, ${tg?.platform})` : 'Web app'}
          </p>
        </div>
      </div>

      {confirm === 'sample' && (
        <ChoiceDialog
          title="Remove sample data?"
          message="Deletes the example events and tasks. Anything you created stays."
          choices={[{ label: 'Remove sample data', tone: 'danger', onSelect: () => { data.removeSampleData(); setConfirm(null); } }]}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm === 'reset' && (
        <ChoiceDialog
          title="Erase everything?"
          message="All events, tasks, calendars and settings on this device will be deleted. This can’t be undone."
          choices={[{ label: 'Erase everything', tone: 'danger', onSelect: () => { data.resetAll(); setConfirm(null); } }]}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm && typeof confirm === 'object' && (
        <ChoiceDialog
          title="Delete calendar?"
          message="Its events will be deleted. Tasks in it are kept without a list."
          choices={[{ label: 'Delete calendar', tone: 'danger', onSelect: () => { data.deleteCalendar(confirm.deleteCal); setConfirm(null); } }]}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}

import { useRef, useState } from 'react';
import { Check, ChevronRight, Trash2 } from 'lucide-react';
import { useData, type BackupFile } from '../store/data';
import { useUI } from '../store/ui';
import { COLOR_KEYS, type ColorKey } from '../types';
import { isTelegram, tg } from '../lib/telegram';
import { ActionSheet, Sheet } from './Sheet';
import { Segmented } from './Segmented';
import { nextTagColor } from './TagPicker';

const hours = Array.from({ length: 25 }, (_, h) => h);
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;

export function SettingsSheet() {
  const open = useUI((s) => s.settingsOpen);
  const setOpen = useUI((s) => s.setSettingsOpen);
  if (!open) return null;
  return <SettingsInner onClose={() => setOpen(false)} />;
}

function SettingsInner({ onClose }: { onClose: () => void }) {
  const data = useData();
  const toast = useUI((s) => s.toast);
  const s = data.settings;
  const set = data.updateSettings;
  const [newCal, setNewCal] = useState('');
  const [newColor, setNewColor] = useState<ColorKey | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [showData, setShowData] = useState(false);
  const addColor = newColor ?? nextTagColor(data.calendars);
  const [confirm, setConfirm] = useState<null | 'reset' | 'sample' | { deleteCal: string }>(null);
  const [importText, setImportText] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const hasSample = data.events.some((e) => e.sample) || data.tasks.some((t) => t.sample);

  const backupJson = () => JSON.stringify(data.exportBackup(), null, 2);
  const download = () => {
    const url = URL.createObjectURL(new Blob([backupJson()], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `daybook-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(backupJson());
      toast('Backup copied');
    } catch {
      toast('Couldn’t reach the clipboard');
    }
  };
  const doImport = (text: string) => {
    try {
      const parsed = JSON.parse(text) as BackupFile;
      if (parsed.app !== 'calendar-app' || !Array.isArray(parsed.events) || !Array.isArray(parsed.tasks)) throw new Error();
      data.importBackup(parsed);
      setImportText('');
      toast(`Imported ${parsed.events.length} events and ${parsed.tasks.length} to-dos`);
    } catch {
      toast('That doesn’t look like a Daybook backup');
    }
  };

  return (
    <Sheet
      onClose={onClose}
      size="large"
      title="Settings"
      right={(close) => (
        <button className="text-btn bold" onClick={close}>
          Done
        </button>
      )}
    >
      <div className="form">
        {/* Tags come first: they're yours to name, and the thing you'll change most. */}
        <div className="group-label">Tags</div>
        <div className="group rows">
          {data.calendars.map((c) => (
            <div key={c.id} className={`tag-row ${editing === c.id ? 'open' : ''}`}>
              <div className="row">
                <button className={`row-icon tag-dot-lg btn-dot c-${c.color}`} aria-label={`Colour for ${c.name}`} onClick={() => setEditing(editing === c.id ? null : c.id)} />
                <input className="row-input" value={c.name} onChange={(e) => data.updateCalendar(c.id, { name: e.target.value })} aria-label="Tag name" />
                <button className="icon-btn sm" aria-label={`Edit ${c.name}`} aria-expanded={editing === c.id} onClick={() => setEditing(editing === c.id ? null : c.id)}>
                  <ChevronRight size={18} className={`row-chev ${editing === c.id ? 'down' : ''}`} />
                </button>
              </div>
              {editing === c.id && (
                <div className="row sub palette">
                  {COLOR_KEYS.map((k) => (
                    <button key={k} className={`swatch c-${k}`} aria-label={k} aria-pressed={c.color === k} onClick={() => data.updateCalendar(c.id, { color: k })}>
                      {c.color === k && <Check size={12} strokeWidth={3} />}
                    </button>
                  ))}
                  <button className="tag-delete" disabled={data.calendars.length <= 1} onClick={() => setConfirm({ deleteCal: c.id })}>
                    <Trash2 size={15} /> Delete tag
                  </button>
                </div>
              )}
            </div>
          ))}
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              if (!newCal.trim()) return;
              data.addCalendar({ name: newCal.trim(), color: addColor });
              setNewCal('');
              setNewColor(null);
            }}
          >
            <button
              type="button"
              className={`row-icon tag-dot-lg btn-dot c-${addColor}`}
              aria-label="Next colour"
              onClick={() => setNewColor(COLOR_KEYS[(COLOR_KEYS.indexOf(addColor) + 1) % COLOR_KEYS.length])}
            />
            <input className="row-input" placeholder="New tag" value={newCal} onChange={(e) => setNewCal(e.target.value)} enterKeyHint="done" />
            {newCal.trim() && (
              <button className="text-btn bold" type="submit">
                Add
              </button>
            )}
          </form>
        </div>
        <p className="form-foot">Tap a name to rename it, or a dot for its colour. Show or hide tags from the ☰ menu.</p>

        <div className="group-label">Appearance</div>
        <Segmented
          className="full"
          label="Theme"
          value={s.theme}
          onChange={(theme) => set({ theme })}
          options={[
            { value: 'system', label: 'Automatic' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
        />

        <div className="group-label">Calendar</div>
        <div className="group rows">
          <div className="row">
            <span className="row-main">Week starts on</span>
            <Segmented
              label="Week starts on"
              value={String(s.weekStartsOn) as '0' | '1'}
              onChange={(v) => set({ weekStartsOn: Number(v) as 0 | 1 })}
              options={[
                { value: '1', label: 'Mon' },
                { value: '0', label: 'Sun' },
              ]}
            />
          </div>
          <div className="row">
            <span className="row-main">Clock</span>
            <Segmented
              label="Time format"
              value={s.timeFormat}
              onChange={(timeFormat) => set({ timeFormat })}
              options={[
                { value: '24h', label: '24h' },
                { value: '12h', label: '12h' },
              ]}
            />
          </div>
          <div className="row">
            <span className="row-main">Week numbers</span>
            <button className="switch" role="switch" aria-checked={s.showWeekNumbers} aria-label="Week numbers" onClick={() => set({ showWeekNumbers: !s.showWeekNumbers })} />
          </div>
          <label className="row">
            <span className="row-main">New events last</span>
            <select className="cell-select" value={s.defaultEventMinutes} onChange={(e) => set({ defaultEventMinutes: Number(e.target.value) })}>
              {[15, 30, 45, 60, 90, 120].map((m) => (
                <option key={m} value={m}>
                  {m < 60 ? `${m} min` : `${m / 60} hr${m > 60 ? 's' : ''}`}
                </option>
              ))}
            </select>
          </label>
          <div className="row">
            <span className="row-main">Suggest times</span>
            <select className="cell-select" value={s.dayStartHour} onChange={(e) => set({ dayStartHour: Number(e.target.value) })} aria-label="Suggest times from">
              {hours.slice(0, 24).map((h) => (
                <option key={h} value={h}>
                  {hh(h)}
                </option>
              ))}
            </select>
            <span className="row-dash">–</span>
            <select className="cell-select" value={s.dayEndHour} onChange={(e) => set({ dayEndHour: Number(e.target.value) })} aria-label="Suggest times until">
              {hours
                .slice(1)
                .filter((h) => h > s.dayStartHour)
                .map((h) => (
                  <option key={h} value={h}>
                    {hh(h)}
                  </option>
                ))}
            </select>
          </div>
        </div>
        <p className="form-foot">“Add to calendar” suggests free times between these hours.</p>

        <div className="group rows">
          <button className="row" onClick={() => setShowData((v) => !v)} aria-expanded={showData}>
            <span className="row-main">Backup and data</span>
            <ChevronRight size={18} className={`row-chev ${showData ? 'down' : ''}`} />
          </button>
          {showData && (
            <>
              <button className="row" onClick={download}>
                <span className="row-main">Download a backup</span>
              </button>
              <button className="row" onClick={copy}>
                <span className="row-main">Copy backup</span>
              </button>
              <button className="row" onClick={() => fileRef.current?.click()}>
                <span className="row-main">Import a backup file</span>
              </button>
              <div className="row top">
                <textarea
                  className="row-input area paste"
                  placeholder="…or paste a backup here"
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                />
              </div>
              {importText.trim() && (
                <button className="row bold" onClick={() => doImport(importText)}>
                  <span className="row-main">Import pasted backup</span>
                </button>
              )}
              {hasSample ? (
                <button className="row" onClick={() => setConfirm('sample')}>
                  <span className="row-main">Remove sample data</span>
                </button>
              ) : (
                <button className="row" onClick={() => data.loadSampleData()}>
                  <span className="row-main">Load sample data</span>
                </button>
              )}
              <button className="row danger" onClick={() => setConfirm('reset')}>
                <span className="row-main">Erase everything</span>
              </button>
            </>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (file) doImport(await file.text());
            e.target.value = '';
          }}
        />

        <p className="form-foot center">
          Everything stays on this device{isTelegram ? ' (in Telegram’s device storage)' : ''}. Nothing is sent to a server.
          <br />
          Daybook 0.3 · {isTelegram ? `Telegram (Bot API ${tg?.version}, ${tg?.platform})` : 'Web app'}
        </p>
      </div>

      {confirm === 'sample' && (
        <ActionSheet
          title="Remove sample data?"
          message="Deletes the example events and to-dos. Anything you added stays."
          choices={[{ label: 'Remove sample data', tone: 'danger', onSelect: () => (data.removeSampleData(), setConfirm(null)) }]}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm === 'reset' && (
        <ActionSheet
          title="Erase everything?"
          message="All events, to-dos, calendars and settings on this device will be deleted. This can’t be undone."
          choices={[{ label: 'Erase everything', tone: 'danger', onSelect: () => (data.resetAll(), setConfirm(null)) }]}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm && typeof confirm === 'object' && (
        <ActionSheet
          title="Delete this tag?"
          message="Events with this tag will be deleted too."
          choices={[{ label: 'Delete tag', tone: 'danger', onSelect: () => (data.deleteCalendar(confirm.deleteCal), setConfirm(null), setEditing(null)) }]}
          onCancel={() => setConfirm(null)}
        />
      )}
    </Sheet>
  );
}


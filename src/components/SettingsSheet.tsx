import { useRef, useState } from 'react';
import { formatDistanceToNowStrict } from 'date-fns';
import { Check, ChevronRight, Download, Link2, Send, Trash2, Upload } from 'lucide-react';
import { useData, type BackupFile } from '../store/data';
import { useUI } from '../store/ui';
import { COLOR_KEYS, type ColorKey } from '../types';
import { isTelegram, openTelegramLink, tg } from '../lib/telegram';
import { ALL_DAY_ALERTS, TIMED_ALERTS } from '../lib/reminders';
import { buildIcs } from '../lib/ics';
import { openIcsFiles, saveFile } from '../lib/files';
import { connectTelegramChat, createFeed, deleteFeed, loginLink, signOut, useSync } from '../lib/sync';
import { deviceTimeZone } from '../lib/tz';
import { useMediaQuery } from '../lib/hooks';
import { ActionSheet, Sheet } from './Sheet';
import { Segmented } from './Segmented';
import { nextTagColor } from './TagPicker';

const hours = Array.from({ length: 25 }, (_, h) => h);
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;
/** Times offered for the morning summary: 05:30 to 10:00 */
const AGENDA_TIMES = Array.from({ length: 10 }, (_, i) => {
  const m = 330 + i * 30;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
});

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
  const [confirm, setConfirm] = useState<null | 'reset' | 'sample' | 'signout' | 'export' | { deleteCal: string }>(null);
  const [importText, setImportText] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const icsRef = useRef<HTMLInputElement>(null);
  const hasSample = data.events.some((e) => e.sample) || data.tasks.some((t) => t.sample);
  const sync = useSync();
  const server = sync.mode === 'ready';
  const fine = useMediaQuery('(pointer: fine)');
  const botName = sync.bot ? `@${sync.bot}` : 'your Daybook bot';
  const [busy, setBusy] = useState(false);
  const today = new Date().toISOString().slice(0, 10);

  const backupJson = () => JSON.stringify(data.exportBackup(), null, 2);
  const download = () => void saveFile(`daybook-backup-${today}.json`, backupJson(), 'application/json');

  const exportEvents = (tagId: string | null) => {
    const tag = tagId ? data.calendars.find((c) => c.id === tagId) : null;
    const events = data.events.filter((e) => !e.sample && (!tagId || e.calendarId === tagId));
    if (!events.length) return toast(tag ? `No events tagged ${tag.name}` : 'No events to export yet');
    const text = buildIcs(events, { calendars: data.calendars, tz: deviceTimeZone(), settings: s, name: tag ? tag.name : 'Daybook' });
    void saveFile(`${tag ? tag.name.toLowerCase().replace(/[^\w]+/g, '-') : 'daybook'}-${today}.ics`, text, 'text/calendar');
  };

  const connect = async () => {
    setBusy(true);
    const r = await connectTelegramChat();
    setBusy(false);
    if (r === 'ok') toast('Sent you a test message in Telegram');
    else if (r === 'start-bot') {
      toast(`Open ${botName} and press Start, then try again`);
      if (sync.bot) openTelegramLink(`https://t.me/${sync.bot}`);
    } else toast('Couldn’t reach the server');
  };

  const copyText = async (text: string, done: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(done);
    } catch {
      toast('Couldn’t reach the clipboard');
    }
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
        <p className="form-foot">
          “Add to calendar” suggests free times between these hours. Pinch the day or week to zoom in and out
          {fine ? ' (or Ctrl + scroll, or the + and − keys)' : ''}.
        </p>

        <div className="group-label">Alerts</div>
        {server ? (
          <>
            <div className="group rows">
              <div className="row">
                <Send size={20} strokeWidth={1.7} className="row-icon" />
                <span className="row-main">Telegram messages</span>
                <button
                  className="switch"
                  role="switch"
                  aria-checked={s.telegramAlerts}
                  aria-label="Telegram messages"
                  onClick={() => {
                    set({ telegramAlerts: !s.telegramAlerts });
                    if (!s.telegramAlerts && !sync.chatOk) void connect();
                  }}
                />
              </div>
              {s.telegramAlerts && !sync.chatOk && (
                <button className="row bold" onClick={connect} disabled={busy}>
                  <span className="row-main">Let {botName} message you</span>
                </button>
              )}
              <label className="row">
                <span className="row-main">Events</span>
                <select className="cell-select" value={String(s.alertDefault)} onChange={(e) => set({ alertDefault: e.target.value === 'null' ? null : Number(e.target.value) })}>
                  {TIMED_ALERTS.map((o) => (
                    <option key={String(o.value)} value={String(o.value)}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="row">
                <span className="row-main">All-day events</span>
                <select className="cell-select" value={String(s.allDayAlertDefault)} onChange={(e) => set({ allDayAlertDefault: e.target.value === 'null' ? null : Number(e.target.value) })}>
                  {ALL_DAY_ALERTS.map((o) => (
                    <option key={String(o.value)} value={String(o.value)}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="row">
                <span className="row-main">When a planned to-do starts</span>
                <button className="switch" role="switch" aria-checked={s.todoAlerts} aria-label="When a planned to-do starts" onClick={() => set({ todoAlerts: !s.todoAlerts })} />
              </div>
              <label className="row">
                <span className="row-main">Morning summary</span>
                <select className="cell-select" value={s.dailyAgenda ?? ''} onChange={(e) => set({ dailyAgenda: e.target.value || null })}>
                  <option value="">Off</option>
                  {[...new Set([...AGENDA_TIMES, ...(s.dailyAgenda ? [s.dailyAgenda] : [])])].sort().map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              {sync.chatOk && s.telegramAlerts && (
                <button className="row" onClick={connect} disabled={busy}>
                  <span className="row-main">Send a test message</span>
                </button>
              )}
            </div>
            <p className="form-foot">
              Alerts arrive as messages from {botName}. These are the defaults; any event can have its own alert. The morning summary lists the day’s events and planned to-dos.
            </p>
          </>
        ) : (
          <p className="form-foot">Alerts and a morning summary arrive as Telegram messages once Daybook is running on its server.</p>
        )}

        <div className="group-label">Import and export</div>
        <div className="group rows">
          <button className="row" onClick={() => icsRef.current?.click()}>
            <Upload size={20} strokeWidth={1.7} className="row-icon" />
            <span className="row-main">Import a calendar (.ics)</span>
          </button>
          <button className="row" onClick={() => setConfirm('export')}>
            <Download size={20} strokeWidth={1.7} className="row-icon" />
            <span className="row-main">Export events (.ics)</span>
          </button>
          {server &&
            (sync.feedUrl ? (
              <>
                <div className="row top">
                  <Link2 size={20} strokeWidth={1.7} className="row-icon" />
                  <span className="row-main two">
                    <span>Subscription link</span>
                    <small className="feed-url">{sync.feedUrl}</small>
                  </span>
                </div>
                <button className="row sub-action" onClick={() => copyText(sync.feedUrl!, 'Link copied')}>
                  <span className="row-main">Copy link</span>
                </button>
                <button className="row sub-action danger" onClick={() => void deleteFeed().then(() => toast('Link turned off'))}>
                  <span className="row-main">Turn off link</span>
                </button>
              </>
            ) : (
              <button
                className="row"
                onClick={async () => {
                  if (await createFeed()) toast('Link ready');
                  else toast('Couldn’t reach the server');
                }}
              >
                <Link2 size={20} strokeWidth={1.7} className="row-icon" />
                <span className="row-main">Show Daybook in another calendar app</span>
              </button>
            ))}
        </div>
        <p className="form-foot">
          {fine ? 'You can also drop .ics files onto the window. ' : ''}
          {server && sync.feedUrl
            ? 'In Apple, Google or Outlook Calendar, choose “subscribe” or “add from URL” and paste the link. It updates by itself. Anyone with the link can see your events, so keep it private; turning it off stops it working.'
            : 'Importing the same file again updates the events instead of adding them twice.'}
        </p>
        <input
          ref={icsRef}
          type="file"
          accept=".ics,text/calendar"
          multiple
          hidden
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = '';
            if (files.length) {
              onClose();
              void openIcsFiles(files);
            }
          }}
        />

        {sync.mode !== 'off' && sync.mode !== 'connecting' && (
          <>
            <div className="group-label">Account</div>
            <div className="group rows">
              {server && sync.user ? (
                <>
                  <div className="row">
                    <span className="row-main two">
                      <span>
                        {sync.user.firstName}
                        {sync.user.username ? <span className="muted"> · @{sync.user.username}</span> : null}
                      </span>
                      <small>
                        {sync.offline
                          ? 'Offline. Changes will sync when you’re back.'
                          : sync.error
                            ? sync.error
                            : sync.syncing
                              ? 'Syncing…'
                              : sync.lastSync
                                ? `Synced ${Date.now() - sync.lastSync < 60000 ? 'just now' : formatDistanceToNowStrict(sync.lastSync, { addSuffix: true })}`
                                : 'Connected'}
                      </small>
                    </span>
                  </div>
                  <button className="row danger" onClick={() => setConfirm('signout')}>
                    <span className="row-main">Sign out of this device</span>
                  </button>
                </>
              ) : (
                <button
                  className="row bold"
                  onClick={() => {
                    const link = loginLink();
                    if (link) openTelegramLink(link);
                  }}
                >
                  <span className="row-main">Sign in with Telegram</span>
                </button>
              )}
            </div>
            {!server && (
              <p className="form-foot">
                {sync.error ? `${sync.error} ` : ''}Opens {botName} in Telegram, which sends you a sign-in link. Your calendar then syncs with your other devices.
              </p>
            )}
          </>
        )}

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
          {server
            ? 'Saved on this device and on your Daybook server.'
            : `Everything stays on this device${isTelegram ? ' (in Telegram’s device storage)' : ''}. Nothing is sent to a server.`}
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
      {confirm === 'export' && (
        <ActionSheet
          title="Export events"
          message="Saves an .ics file that Apple, Google and Outlook Calendar can open."
          choices={[
            { label: 'All events', tone: 'bold', onSelect: () => (exportEvents(null), setConfirm(null)) },
            ...data.calendars.map((c) => ({ label: `Only ${c.name}`, onSelect: () => (exportEvents(c.id), setConfirm(null)) })),
          ]}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm === 'signout' && (
        <ActionSheet
          title="Sign out of this device?"
          message="This device’s copy is cleared. Everything stays on your server, and comes back when you sign in again."
          choices={[{ label: 'Sign out', tone: 'danger', onSelect: () => (void signOut(), setConfirm(null)) }]}
          onCancel={() => setConfirm(null)}
        />
      )}
      {confirm === 'reset' && (
        <ActionSheet
          title="Erase everything?"
          message={`All events, to-dos, tags and settings ${server ? 'on this device and on your server' : 'on this device'} will be deleted. This can’t be undone.`}
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


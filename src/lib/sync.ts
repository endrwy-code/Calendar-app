/**
 * Sync with the Daybook server, when the app is served by one.
 *
 * The app stays local-first: everything is saved on the device as before and
 * works offline. When a server answers at ./api, this keeps the device and the
 * server in step:
 *
 *  - Each event, to-do, tag and the settings are one record. A small snapshot
 *    (record → hash of what the server last had) shows what changed here.
 *  - A sync sends those changes and gets back everything that changed on the
 *    server since the last sync (from other devices, or /todo in Telegram).
 *    When two devices edit the same record, the newest edit wins.
 *  - It runs a moment after each change, every 30 seconds while the app is
 *    open, and when it comes back online or to the foreground.
 *
 * Signing in: inside Telegram the app signs in with Telegram's launch data. In
 * a browser, the bot's /login command sends a one-time sign-in link.
 */
import { create } from 'zustand';
import { useData } from '../store/data';
import { DEVICE_SETTINGS, type Settings } from '../types';
import { hash } from './hash';
import { isTelegram, requestWriteAccess, telegramInitData, telegramUserId } from './telegram';
import { deviceTimeZone } from './tz';

export type SyncMode = 'off' | 'connecting' | 'signed-out' | 'ready';

export interface SyncUser {
  id: number;
  firstName: string;
  username: string | null;
}

interface Me {
  user: SyncUser;
  chatOk: boolean;
  feedUrl: string | null;
  bot: string | null;
}

export interface SyncState {
  /** off: no server (the app runs on its own) · signed-out · ready */
  mode: SyncMode;
  /** The bot's username, e.g. "daybook_bot" */
  bot: string | null;
  user: SyncUser | null;
  /** Whether the bot can send this user messages */
  chatOk: boolean;
  /** Private calendar subscription link, if turned on */
  feedUrl: string | null;
  lastSync: number | null;
  syncing: boolean;
  offline: boolean;
  error: string | null;
}

export const useSync = create<SyncState>(() => ({
  mode: 'off',
  bot: null,
  user: null,
  chatOk: false,
  feedUrl: null,
  lastSync: null,
  syncing: false,
  offline: false,
  error: null,
}));

/* ---------- Storage ---------- */

const TOKEN_KEY = 'daybook:session';
const ME_KEY = 'daybook:me';
const stateKey = (userId: number) => `daybook:sync:${userId}`;

const ls = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* storage unavailable */
    }
  },
  del(k: string) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  },
};

let token = ls.get(TOKEN_KEY);
function setToken(t: string | null) {
  token = t;
  if (t) ls.set(TOKEN_KEY, t);
  else ls.del(TOKEN_KEY);
}

/* ---------- API ---------- */

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`api/${path}`, {
    method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: 'no-store',
  });
  const isJson = (res.headers.get('content-type') ?? '').includes('application/json');
  const data = isJson ? await res.json().catch(() => null) : null;
  if (!res.ok) throw new HttpError(res.status, (data as { error?: string } | null)?.error ?? res.statusText);
  if (!isJson) throw new HttpError(res.status, 'Not a Daybook server');
  return data as T;
}

/* ---------- Records ---------- */

type Kind = 'event' | 'task' | 'tag' | 'settings';
interface Change {
  kind: Kind;
  id: string;
  data: unknown;
  updatedAt: number;
}

function syncedSettings(s: Settings): Partial<Settings> {
  const out: Partial<Settings> = { ...s };
  for (const k of DEVICE_SETTINGS) delete out[k];
  return out;
}

/** Every record that syncs. Sample data stays on the device. */
function localRecords(): Map<string, Change> {
  const s = useData.getState();
  const m = new Map<string, Change>();
  for (const e of s.events) if (!e.sample) m.set(`event:${e.id}`, { kind: 'event', id: e.id, data: e, updatedAt: e.updatedAt });
  for (const t of s.tasks) if (!t.sample) m.set(`task:${t.id}`, { kind: 'task', id: t.id, data: t, updatedAt: t.updatedAt });
  for (const c of s.calendars) m.set(`tag:${c.id}`, { kind: 'tag', id: c.id, data: c, updatedAt: c.updatedAt ?? 0 });
  m.set('settings:main', { kind: 'settings', id: 'main', data: syncedSettings(s.settings), updatedAt: s.settingsUpdatedAt });
  return m;
}

const hashOf = (data: unknown) => hash(JSON.stringify(data));

interface Persisted {
  /** Server revision we're up to date with */
  rev: number;
  /** record key → hash of the copy the server has */
  snap: Record<string, string>;
}

let persisted: Persisted = { rev: 0, snap: {} };
let persistedFor: number | null = null;

function loadPersisted(userId: number) {
  persistedFor = userId;
  try {
    const raw = ls.get(stateKey(userId));
    persisted = raw ? (JSON.parse(raw) as Persisted) : { rev: 0, snap: {} };
  } catch {
    persisted = { rev: 0, snap: {} };
  }
}
function savePersisted() {
  if (persistedFor !== null) ls.set(stateKey(persistedFor), JSON.stringify(persisted));
}

let applying = false;

/** Puts the server's copies into the store, except records edited here while the sync was in flight. */
function applyRemote(changes: Change[]) {
  if (!changes.length) return;
  const s = useData.getState();
  const events = new Map(s.events.map((e) => [e.id, e]));
  const tasks = new Map(s.tasks.map((t) => [t.id, t]));
  const tags = new Map(s.calendars.map((c) => [c.id, c]));
  let settings = s.settings;
  let settingsUpdatedAt = s.settingsUpdatedAt;
  const local = localRecords();

  for (const c of changes) {
    const key = `${c.kind}:${c.id}`;
    const current = local.has(key) ? hashOf(local.get(key)!.data) : null;
    const expected = persisted.snap[key] ?? null;
    if (current !== expected) continue; // changed here meanwhile: ours goes up next time
    if (c.data === null) delete persisted.snap[key];
    else persisted.snap[key] = hashOf(c.data);
    if (c.kind === 'settings') {
      if (c.data) {
        const keep = Object.fromEntries(DEVICE_SETTINGS.map((k) => [k, s.settings[k]]));
        settings = { ...settings, ...(c.data as Partial<Settings>), ...keep };
        settingsUpdatedAt = c.updatedAt;
      }
      continue;
    }
    const map = (c.kind === 'event' ? events : c.kind === 'task' ? tasks : tags) as Map<string, unknown>;
    if (c.data === null) map.delete(c.id);
    else map.set(c.id, c.data);
  }

  applying = true;
  try {
    useData.setState({
      events: [...events.values()],
      tasks: [...tasks.values()],
      calendars: tags.size ? [...tags.values()] : s.calendars,
      settings,
      settingsUpdatedAt,
    });
  } finally {
    applying = false;
  }
}

/* ---------- Sync loop ---------- */

let running = false;
let again = false;

export async function syncNow(): Promise<void> {
  const st = useSync.getState();
  if (st.mode !== 'ready' || !st.user) return;
  if (running) {
    again = true;
    return;
  }
  running = true;
  useSync.setState({ syncing: true });
  try {
    do {
      again = false;
      const local = localRecords();
      const changes: Change[] = [];
      const sent = new Map<string, string | null>();
      for (const [key, rec] of local) {
        const h = hashOf(rec.data);
        if (persisted.snap[key] !== h) {
          changes.push(rec);
          sent.set(key, h);
        }
      }
      for (const key of Object.keys(persisted.snap)) {
        if (local.has(key)) continue;
        const i = key.indexOf(':');
        changes.push({ kind: key.slice(0, i) as Kind, id: key.slice(i + 1), data: null, updatedAt: Date.now() });
        sent.set(key, null);
      }
      const res = await api<{ rev: number; reset?: boolean; changes: Change[] }>('sync', {
        body: { since: persisted.rev, tz: deviceTimeZone(), changes },
      });
      if (res.reset) {
        // The server's data was replaced (e.g. restored from a backup): start over.
        persisted = { rev: 0, snap: {} };
        savePersisted();
        again = true;
        continue;
      }
      for (const [key, h] of sent) {
        if (h === null) delete persisted.snap[key];
        else persisted.snap[key] = h;
      }
      applyRemote(res.changes);
      persisted.rev = res.rev;
      savePersisted();
      useSync.setState({ lastSync: Date.now(), offline: false, error: null });
    } while (again);
  } catch (e) {
    if (e instanceof HttpError && e.status === 401) {
      setToken(null);
      stopLoop();
      useSync.setState({ mode: 'signed-out', user: null, error: 'Signed out. Sign in again to keep syncing.' });
    } else if (e instanceof HttpError) {
      useSync.setState({ error: e.message || 'The server couldn’t save your changes.' });
    } else {
      useSync.setState({ offline: true });
    }
  } finally {
    running = false;
    useSync.setState({ syncing: false });
  }
}

let timer: ReturnType<typeof setTimeout> | undefined;
let interval: ReturnType<typeof setInterval> | undefined;
let unsubscribe: (() => void) | null = null;
const onVisible = () => {
  if (document.visibilityState === 'visible') void syncNow();
};
const onOnline = () => void syncNow();

function startLoop() {
  stopLoop();
  unsubscribe = useData.subscribe((state, prev) => {
    if (applying) return;
    if (state.events !== prev.events || state.tasks !== prev.tasks || state.calendars !== prev.calendars || state.settings !== prev.settings) {
      clearTimeout(timer);
      timer = setTimeout(() => void syncNow(), 1200);
    }
  });
  interval = setInterval(() => {
    if (document.visibilityState === 'visible') void syncNow();
  }, 30000);
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('online', onOnline);
}

function stopLoop() {
  unsubscribe?.();
  unsubscribe = null;
  clearTimeout(timer);
  clearInterval(interval);
  document.removeEventListener('visibilitychange', onVisible);
  window.removeEventListener('online', onOnline);
}

async function becomeReady(me: Me, offline = false) {
  ls.set(ME_KEY, JSON.stringify(me));
  useSync.setState({ mode: 'ready', user: me.user, chatOk: me.chatOk, feedUrl: me.feedUrl, bot: me.bot, offline, error: null });
  loadPersisted(me.user.id);
  const first = persisted.rev === 0;
  startLoop();
  await syncNow();
  if (first && useSync.getState().lastSync) {
    // Joining an account that already has data: the examples aren't needed.
    const d = useData.getState();
    if (d.events.some((e) => !e.sample) || d.tasks.some((t) => !t.sample)) d.removeSampleData();
  }
}

let started = false;

/** Finds the server and signs in. Call once, after the local data has loaded. */
export async function startSync(): Promise<void> {
  if (started) return;
  started = true;
  const cachedMe = (() => {
    try {
      return JSON.parse(ls.get(ME_KEY) ?? 'null') as Me | null;
    } catch {
      return null;
    }
  })();

  let bot: string | null = null;
  try {
    const health = await api<{ app: string; bot: string | null }>('health');
    if (health.app !== 'daybook') throw new Error();
    bot = health.bot;
  } catch {
    // No server answers. If this device was signed in before, we're just offline.
    if (token && cachedMe) await becomeReady(cachedMe, true);
    return;
  }
  useSync.setState({ mode: 'connecting', bot });

  // A one-time sign-in link from the bot (?login=…)
  const url = new URL(window.location.href);
  const code = url.searchParams.get('login');
  if (code) {
    url.searchParams.delete('login');
    window.history.replaceState(null, '', url.toString());
    try {
      const r = await api<{ token: string }>('auth/code', { body: { code } });
      setToken(r.token);
    } catch {
      useSync.setState({ error: 'That sign-in link has expired. Send /login to the bot for a new one.' });
    }
  }

  let me: Me | null = null;
  if (token) {
    try {
      me = await api<Me>('me');
    } catch (e) {
      if (e instanceof HttpError && e.status === 401) setToken(null);
      else if (cachedMe) return becomeReady(cachedMe, true);
    }
  }

  // Inside Telegram, sign in (again) with Telegram's launch data.
  const initData = telegramInitData();
  if (isTelegram && initData && (!me || me.user.id !== telegramUserId())) {
    try {
      const r = await api<{ token: string }>('auth/telegram', { body: { initData } });
      setToken(r.token);
      me = await api<Me>('me');
    } catch (e) {
      useSync.setState({ error: e instanceof HttpError && e.status === 403 ? 'This Daybook server is private.' : 'Couldn’t sign in with Telegram.' });
    }
  }

  if (!me) {
    useSync.setState({ mode: 'signed-out' });
    return;
  }
  await becomeReady({ ...me, bot: me.bot ?? bot });
}

/** Signs this device out and clears its copy of the data (the server keeps it). */
export async function signOut() {
  await syncNow().catch(() => {});
  try {
    await api('logout', { body: {} });
  } catch {
    /* already gone */
  }
  stopLoop();
  const user = useSync.getState().user;
  setToken(null);
  ls.del(ME_KEY);
  if (user) ls.del(stateKey(user.id));
  persisted = { rev: 0, snap: {} };
  persistedFor = null;
  applying = true;
  useData.getState().resetAll();
  applying = false;
  useSync.setState({ mode: 'signed-out', user: null, chatOk: false, feedUrl: null, lastSync: null, error: null });
}

/** "https://t.me/daybook_bot?start=login": opens the bot, which replies with a sign-in link. */
export function loginLink(): string | null {
  const bot = useSync.getState().bot;
  return bot ? `https://t.me/${bot}?start=login` : null;
}

export function botLink(): string | null {
  const bot = useSync.getState().bot;
  return bot ? `https://t.me/${bot}` : null;
}

/**
 * Lets the bot message you, and sends a test message.
 * 'start-bot' means you need to open the bot and press Start first.
 */
export async function connectTelegramChat(): Promise<'ok' | 'start-bot' | 'error'> {
  if (isTelegram) await requestWriteAccess();
  try {
    const r = await api<{ ok: boolean }>('notify/test', { body: {} });
    useSync.setState({ chatOk: r.ok });
    return r.ok ? 'ok' : 'start-bot';
  } catch {
    return 'error';
  }
}

export async function createFeed(): Promise<string | null> {
  try {
    const r = await api<{ url: string }>('feed', { body: {} });
    useSync.setState({ feedUrl: r.url });
    return r.url;
  } catch {
    return null;
  }
}

export async function deleteFeed(): Promise<void> {
  try {
    await api('feed', { method: 'DELETE' });
    useSync.setState({ feedUrl: null });
  } catch {
    /* try again later */
  }
}

/** Sends a file to your chat with the bot (Telegram's in-app browser can't download files). */
export async function sendFileToChat(name: string, content: string, mime: string): Promise<boolean> {
  try {
    await api('send-file', { body: { name, content, mime } });
    return true;
  } catch {
    return false;
  }
}

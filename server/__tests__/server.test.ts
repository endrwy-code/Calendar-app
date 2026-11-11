import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { checkInitData } from '../auth';
import { loadConfig, type Config } from '../config';
import { Store, type Change } from '../store';
import { createApp } from '../http';
import { Notifier } from '../notify';
import { Bot, type Messenger } from '../bot';
import { TelegramError, type BotApi } from '../telegram';
import { alertText, agendaText } from '../messages';
import type { CalEvent, Task } from '../../src/types';

// The server runs in UTC (see main.ts).
process.env.TZ = 'UTC';

const BOT_TOKEN = '123456:TEST-token';

function initData(user: { id: number; first_name: string; username?: string }, opts: { authDate?: number; token?: string; extra?: Record<string, string> } = {}) {
  const params = new URLSearchParams({
    auth_date: String(opts.authDate ?? Math.floor(Date.now() / 1000)),
    query_id: 'AAHdF6IQAAAAAN0XohDhrOrc',
    user: JSON.stringify(user),
    ...opts.extra,
  });
  const check = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(opts.token ?? BOT_TOKEN).digest();
  params.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
  return params.toString();
}

const ev = (p: Partial<CalEvent>): CalEvent => ({
  id: 'e1',
  title: 'Stand-up',
  calendarId: 'work',
  start: '2026-11-11T09:30',
  end: '2026-11-11T10:00',
  allDay: false,
  createdAt: 1,
  updatedAt: 1,
  ...p,
});

describe('checkInitData', () => {
  const alice = { id: 42, first_name: 'Alice', username: 'alice' };

  it('accepts launch data signed with the bot token', () => {
    expect(checkInitData(initData(alice), BOT_TOKEN)).toEqual({ id: 42, firstName: 'Alice', username: 'alice' });
  });

  it('accepts data that includes the newer signature field', () => {
    expect(checkInitData(initData(alice, { extra: { signature: 'abc' } }), BOT_TOKEN)?.id).toBe(42);
  });

  it('rejects tampered, foreign or stale data', () => {
    const tampered = initData(alice).replace('Alice', 'Mallory');
    expect(checkInitData(tampered, BOT_TOKEN)).toBeNull();
    expect(checkInitData(initData(alice, { token: '999:other' }), BOT_TOKEN)).toBeNull();
    expect(checkInitData(initData(alice, { authDate: Math.floor(Date.now() / 1000) - 2 * 86400 }), BOT_TOKEN)).toBeNull();
    expect(checkInitData('user=%7B%7D', BOT_TOKEN)).toBeNull();
  });
});

describe('Store sync', () => {
  let store: Store;
  beforeEach(() => {
    store = new Store(':memory:');
    store.upsertUser({ id: 1, firstName: 'A', username: null });
  });

  it('keeps the newest copy of each record', () => {
    store.applyChanges(1, [{ kind: 'event', id: 'e1', data: ev({ title: 'v2', updatedAt: 20 }), updatedAt: 20 }]);
    const kept = store.applyChanges(1, [{ kind: 'event', id: 'e1', data: ev({ title: 'v1', updatedAt: 10 }), updatedAt: 10 }]);
    expect(kept).toBe(0);
    expect(store.record<CalEvent>(1, 'event', 'e1')?.title).toBe('v2');
  });

  it('hands out changes after a revision, including deletions', () => {
    store.applyChanges(1, [
      { kind: 'event', id: 'a', data: ev({ id: 'a' }), updatedAt: 1 },
      { kind: 'event', id: 'b', data: ev({ id: 'b' }), updatedAt: 1 },
    ]);
    const rev = store.maxRev(1);
    store.applyChanges(1, [{ kind: 'event', id: 'a', data: null, updatedAt: 5 }]);
    const changes = store.changesSince(1, rev);
    expect(changes).toEqual([{ kind: 'event', id: 'a', data: null, updatedAt: 5 }]);
    expect(store.userData(1).events.map((e) => e.id)).toEqual(['b']);
  });

  it('ignores deletions of records it never had', () => {
    expect(store.applyChanges(1, [{ kind: 'task', id: 'x', data: null, updatedAt: 5 }])).toBe(0);
    expect(store.maxRev(1)).toBe(0);
  });

  it('fills in default settings', () => {
    store.applyChanges(1, [{ kind: 'settings', id: 'main', data: { alertDefault: 30 }, updatedAt: 1 }]);
    const s = store.userData(1).settings;
    expect(s.alertDefault).toBe(30);
    expect(s.allDayAlertDefault).toBe(-540);
  });
});

describe('HTTP API', () => {
  let dir: string;
  let store: Store;
  let server: Server;
  let base: string;
  let cfg: Config;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'daybook-'));
    const dist = path.join(dir, 'dist');
    mkdirSync(path.join(dist, 'assets'), { recursive: true });
    writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>Daybook</title>');
    writeFileSync(path.join(dist, 'assets', 'app-1234.js'), 'console.log("hi");'.repeat(200));
    cfg = loadConfig({ BOT_TOKEN, DATA_DIR: dir, STATIC_DIR: dist, BOT_POLLING: '0', TRUST_PROXY: '0', APP_URL: 'https://daybook.test', ALLOWED_USERS: '42, @bob' });
    store = new Store(path.join(dir, 'test.db'));
    server = createApp({ store, cfg, bot: null });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => {
    server.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const call = async (p: string, init: { method?: string; body?: unknown; token?: string } = {}) => {
    const res = await fetch(base + p, {
      method: init.method ?? (init.body ? 'POST' : 'GET'),
      headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    const text = await res.text();
    let data: unknown = text;
    try {
      data = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    return { status: res.status, data: data as Record<string, unknown>, headers: res.headers };
  };

  const signIn = async (user = { id: 42, first_name: 'Alice' }) => {
    const r = await call('/api/auth/telegram', { body: { initData: initData(user) } });
    expect(r.status).toBe(200);
    return r.data.token as string;
  };

  it('says it is a Daybook server', async () => {
    expect((await call('/api/health')).data).toMatchObject({ app: 'daybook', ok: true });
  });

  it('signs in with Telegram, and only allowed users', async () => {
    const token = await signIn();
    const me = await call('/api/me', { token });
    expect(me.data.user).toEqual({ id: 42, firstName: 'Alice', username: null });
    const bob = await call('/api/auth/telegram', { body: { initData: initData({ id: 7, first_name: 'Bob', username: 'bob' }) } });
    expect(bob.status).toBe(200);
    const eve = await call('/api/auth/telegram', { body: { initData: initData({ id: 666, first_name: 'Eve' }) } });
    expect(eve.status).toBe(403);
    expect((await call('/api/me')).status).toBe(401);
    expect((await call('/api/me', { token: 'x'.repeat(43) })).status).toBe(401);
  });

  it('signs in once with a code from the bot', async () => {
    store.upsertUser({ id: 42, firstName: 'Alice', username: null });
    const { sha256 } = await import('../auth');
    store.createCode(sha256('c'.repeat(32)), 42, Date.now() + 60000);
    expect((await call('/api/auth/code', { body: { code: 'c'.repeat(32) } })).status).toBe(200);
    expect((await call('/api/auth/code', { body: { code: 'c'.repeat(32) } })).status).toBe(401);
  });

  it('syncs two devices, newest edit winning', async () => {
    const phone = await signIn();
    const laptop = await signIn();
    const sync = (token: string, since: number, changes: Change[]) => call('/api/sync', { token, body: { since, tz: 'Asia/Singapore', changes } });

    const a = await sync(phone, 0, [{ kind: 'event', id: 'e1', data: ev({ updatedAt: 100 }), updatedAt: 100 }]);
    expect(a.status).toBe(200);
    const rev1 = a.data.rev as number;

    const b = await sync(laptop, 0, []);
    expect((b.data.changes as Change[]).map((c) => c.id)).toContain('e1');

    // The laptop edits later; the phone's older edit arrives after it.
    await sync(laptop, b.data.rev as number, [{ kind: 'event', id: 'e1', data: ev({ title: 'Laptop', updatedAt: 300 }), updatedAt: 300 }]);
    const c = await sync(phone, rev1, [{ kind: 'event', id: 'e1', data: ev({ title: 'Phone', updatedAt: 200 }), updatedAt: 200 }]);
    const back = (c.data.changes as Change[]).find((x) => x.id === 'e1')!;
    expect((back.data as CalEvent).title).toBe('Laptop');
    expect(store.user(42)?.tz).toBe('Asia/Singapore');
  });

  it('tells a device to start over when it is ahead of the server', async () => {
    const token = await signIn();
    const r = await call('/api/sync', { token, body: { since: 999999, changes: [] } });
    expect(r.data.reset).toBe(true);
  });

  it('rejects malformed changes', async () => {
    const token = await signIn();
    const bad = await call('/api/sync', { token, body: { since: 0, changes: [{ kind: 'event', id: 'x', data: ev({ id: 'y' }), updatedAt: 1 }] } });
    expect(bad.status).toBe(400);
    const kind = await call('/api/sync', { token, body: { since: 0, changes: [{ kind: 'users', id: 'x', data: {}, updatedAt: 1 }] } });
    expect(kind.status).toBe(400);
  });

  it('serves a private calendar feed that can be turned off', async () => {
    const token = await signIn();
    const on = await call('/api/feed', { token, body: {} });
    const url = on.data.url as string;
    expect(url).toMatch(/^https:\/\/daybook\.test\/api\/feed\/[\w-]+\.ics$/);
    const feedPath = new URL(url).pathname;
    const feed = await fetch(base + feedPath);
    expect(feed.headers.get('content-type')).toContain('text/calendar');
    const text = await feed.text();
    expect(text).toContain('BEGIN:VCALENDAR');
    expect(text).toContain('SUMMARY:Laptop');
    await call('/api/feed', { token, method: 'DELETE' });
    expect((await fetch(base + feedPath)).status).toBe(404);
  });

  it('serves the app with security headers, caching and compression', async () => {
    const html = await fetch(base + '/some/page');
    expect(await html.text()).toContain('<title>Daybook</title>');
    expect(html.headers.get('content-security-policy')).toContain("frame-ancestors 'self' https://web.telegram.org");
    expect(html.headers.get('referrer-policy')).toBe('no-referrer');
    const js = await fetch(base + '/assets/app-1234.js', { headers: { 'Accept-Encoding': 'gzip' } });
    expect(js.headers.get('cache-control')).toContain('immutable');
    expect(js.headers.get('content-encoding')).toBe('gzip');
    expect((await fetch(base + '/assets/missing.js')).status).toBe(404);
    expect((await fetch(base + '/%2e%2e/%2e%2e/etc/passwd.txt')).status).toBe(404);
  });

  it('needs a bot for messages and files', async () => {
    const token = await signIn();
    expect((await call('/api/notify/test', { token, body: {} })).status).toBe(503);
    expect((await call('/api/send-file', { token, body: { name: 'a.ics', content: 'x', mime: 'text/calendar' } })).status).toBe(503);
  });
});

describe('Notifier', () => {
  let store: Store;
  let sent: string[];
  let fail: TelegramError | null;
  const messenger: Messenger = {
    async send(_chat, html) {
      if (fail) throw fail;
      sent.push(html);
    },
  };
  const cfg = loadConfig({ BOT_POLLING: '0', DEFAULT_TZ: 'UTC' });
  // 2026-11-11 09:20 in Singapore = 01:20 UTC
  const at = (sgTime: string) => Date.parse(`2026-11-11T${sgTime}:00+08:00`);

  beforeEach(() => {
    sent = [];
    fail = null;
    store = new Store(':memory:');
    store.upsertUser({ id: 5, firstName: 'Sam', username: null });
    store.setChatOk(5, true);
    store.setTz(5, 'Asia/Singapore');
    store.applyChanges(5, [
      { kind: 'event', id: 'e1', data: ev({ location: 'Room 1' }), updatedAt: 1 },
      { kind: 'settings', id: 'main', data: { alertDefault: 10, dailyAgenda: '07:30' }, updatedAt: 1 },
    ]);
  });

  it('sends an alert once, in the user’s time zone', async () => {
    const n = new Notifier(store, messenger, cfg);
    await n.tick(at('09:19'));
    expect(sent).toHaveLength(1); // only the morning summary (07:30): it's still within its 3-hour grace period
    await n.tick(at('09:20'));
    expect(sent).toHaveLength(2);
    expect(sent[1]).toContain('<b>Stand-up</b>');
    expect(sent[1]).toContain('In 10 min · 09:30–10:00');
    await n.tick(at('09:21'));
    expect(sent).toHaveLength(2);
  });

  it('sends the morning summary once at its time', async () => {
    const n = new Notifier(store, messenger, cfg);
    await n.tick(at('07:29'));
    expect(sent).toHaveLength(0);
    await n.tick(at('07:30'));
    expect(sent[0]).toContain('Good morning');
    expect(sent[0]).toContain('09:30–10:00 · Stand-up · <i>Room 1</i>');
    await n.tick(at('07:31'));
    expect(sent).toHaveLength(1);
  });

  it('stops messaging someone who blocked the bot', async () => {
    fail = new TelegramError(403, 'Forbidden: bot was blocked by the user');
    await new Notifier(store, messenger, cfg).tick(at('09:20'));
    expect(store.user(5)?.chatOk).toBe(false);
  });

  it('respects the Telegram messages switch', async () => {
    store.applyChanges(5, [{ kind: 'settings', id: 'main', data: { telegramAlerts: false }, updatedAt: 2 }]);
    await new Notifier(store, messenger, cfg).tick(at('09:20'));
    expect(sent).toHaveLength(0);
  });
});

describe('Bot', () => {
  let store: Store;
  let calls: { method: string; params: Record<string, unknown> }[];
  let bot: Bot;
  const fakeApi = {
    async call(method: string, params: Record<string, unknown> = {}) {
      calls.push({ method, params });
      return {};
    },
    async sendDocument() {},
  } as unknown as BotApi;
  const msg = (text: string, id = 9) => ({ update_id: 1, message: { message_id: 1, from: { id, first_name: 'Kim' }, chat: { id, type: 'private' }, text } });

  beforeEach(() => {
    calls = [];
    store = new Store(':memory:');
    bot = new Bot(fakeApi, store, loadConfig({ APP_URL: 'https://daybook.test', BOT_POLLING: '0' }));
  });

  const lastText = () => calls.filter((c) => c.method === 'sendMessage').pop()?.params.text as string;

  it('adds a to-do from any message, with undo', async () => {
    await bot.handle(msg('Buy milk\neggs too'));
    const [task] = store.userData(9).tasks;
    expect(task).toMatchObject({ title: 'Buy milk', notes: 'eggs too', status: 'todo' });
    expect(store.user(9)?.chatOk).toBe(true);
    const markup = calls.at(-1)!.params.reply_markup as { inline_keyboard: { callback_data: string }[][] };
    await bot.handle({ update_id: 2, callback_query: { id: 'q', from: { id: 9, first_name: 'Kim' }, data: markup.inline_keyboard[0][0].callback_data } });
    expect(store.userData(9).tasks).toHaveLength(0);
  });

  it('won’t let one user undo another’s to-do', async () => {
    await bot.handle(msg('/todo Private thing'));
    const id = store.userData(9).tasks[0].id;
    await bot.handle({ update_id: 3, callback_query: { id: 'q', from: { id: 10, first_name: 'Other' }, data: `undo:${id}` } });
    expect(store.userData(9).tasks).toHaveLength(1);
  });

  it('sends a one-time sign-in link', async () => {
    await bot.handle(msg('/start login'));
    const markup = calls.at(-1)!.params.reply_markup as { inline_keyboard: { url: string }[][] };
    expect(markup.inline_keyboard[0][0].url).toMatch(/^https:\/\/daybook\.test\/\?login=[\w-]{30,}$/);
  });

  it('shows today’s agenda', async () => {
    store.upsertUser({ id: 9, firstName: 'Kim', username: null });
    const today = new Date().toISOString().slice(0, 10);
    store.applyChanges(9, [{ kind: 'event', id: 'e1', data: ev({ start: `${today}T09:30`, end: `${today}T10:00` }), updatedAt: 1 }]);
    await bot.handle(msg('/today'));
    expect(lastText()).toContain('09:30–10:00 · Stand-up');
  });
});

describe('messages', () => {
  it('escapes titles and words alerts naturally', () => {
    const now = new Date('2026-11-11T08:00:00Z');
    const text = alertText(
      { key: 'k', kind: 'event', title: 'Q&A <live>', start: new Date('2026-11-11T09:30:00Z'), end: new Date('2026-11-11T10:00:00Z'), allDay: false, minutesBefore: 90, fire: now },
      now,
      '24h',
    );
    expect(text).toBe('🔔 <b>Q&amp;A &lt;live&gt;</b>\nIn 1 h 30 min · 09:30–10:00');
  });

  it('lists planned to-dos and open counts in the agenda', () => {
    const t = (p: Partial<Task>): Task => ({ id: 't', title: 'Write', status: 'todo', priority: 'none', durationMin: 30, subtasks: [], createdAt: 0, updatedAt: 0, ...p });
    const text = agendaText([], [t({ scheduledStart: '2026-11-11T14:00' }), t({ id: 'u', status: 'in_progress' })], '24h', new Date('2026-11-11T00:00:00Z'), 'Today');
    expect(text).toBe('<b>Today</b>\n\n14:00–14:30 · ☐ Write\n\n1 in progress, 1 to-do not started.');
  });
});

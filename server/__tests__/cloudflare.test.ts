/**
 * What the Cloudflare version relies on, tested on Node: the API as a plain
 * fetch handler (no Node server), the Telegram webhook, paged sync, the
 * headers file, and the bot setting itself up.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApi, SYNC_PAGE } from '../api';
import { Bot, webhookSecret } from '../bot';
import { PlanReader } from '../claude';
import { loadConfig } from '../config';
import { cloudflareHeadersFile, CSP } from '../headers';
import { NodeSql } from '../sqlite-node';
import { Store, type Change } from '../store';
import type { BotApi, TgUpdate } from '../telegram';
import { newToken, sha256 } from '../auth';

process.env.TZ = 'UTC';

const BOT_TOKEN = '123456:TEST-token';

let store: Store;
let calls: { method: string; params: Record<string, unknown> }[];
const fakeApi = {
  async call(method: string, params: Record<string, unknown> = {}) {
    calls.push({ method, params });
    if (method === 'getMe') return { id: 1, first_name: 'Daybook', username: 'daybook_test_bot' };
    if (method === 'getWebhookInfo') return { url: webhookUrl };
    return {};
  },
  async sendDocument() {},
} as unknown as BotApi;
let webhookUrl = '';

beforeEach(() => {
  calls = [];
  webhookUrl = '';
  store = new Store(new NodeSql(':memory:'));
});

const cfg = loadConfig({ BOT_TOKEN, APP_URL: 'https://daybook.test', BOT_POLLING: '0', TRUST_PROXY: '0' });

async function session(userId = 9) {
  store.upsertUser({ id: userId, firstName: 'Kim', username: null });
  const token = newToken();
  store.createSession(await sha256(token), userId);
  return token;
}

const req = (path: string, init: { body?: unknown; token?: string; headers?: Record<string, string> } = {}) =>
  new Request(`https://daybook.test${path}`, {
    method: init.body !== undefined ? 'POST' : 'GET',
    headers: {
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
      ...init.headers,
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });

const ev = (i: number): Change => ({
  kind: 'event',
  id: `e${i}`,
  data: { id: `e${i}`, title: `Event ${i}`, calendarId: 'work', start: '2026-11-20T09:00', end: '2026-11-20T10:00', allDay: false, createdAt: 1, updatedAt: 1 },
  updatedAt: 1,
});

describe('sync in pages', () => {
  it('sends long histories in parts that pick up where they left off', async () => {
    const api = createApi({ store, cfg, bot: null });
    const token = await session();
    const total = SYNC_PAGE + 120;
    type Page = { changes: Change[]; more: boolean; rev: number };
    const first = (await (await api(req('/api/sync', { token, body: { since: 0, changes: Array.from({ length: total }, (_, i) => ev(i)) } }), '1.2.3.4')).json()) as Page;
    expect(first.changes).toHaveLength(SYNC_PAGE);
    expect(first.more).toBe(true);
    expect(first.rev).toBe(SYNC_PAGE);
    const second = (await (await api(req('/api/sync', { token, body: { since: first.rev, changes: [] } }), '1.2.3.4')).json()) as Page;
    expect(second.changes).toHaveLength(120);
    expect(second.more).toBe(false);
    expect(second.rev).toBe(total);
    const ids = new Set([...first.changes, ...second.changes].map((c) => c.id));
    expect(ids.size).toBe(total);
  });
});

describe('Telegram webhook', () => {
  let bot: Bot;
  let secret: string;
  let api: ReturnType<typeof createApi>;
  const update = (id: number, text: string): TgUpdate => ({
    update_id: id,
    message: { message_id: id, from: { id: 9, first_name: 'Kim' }, chat: { id: 9, type: 'private' }, text },
  });
  const settle = () => new Promise((r) => setTimeout(r, 20));

  beforeEach(async () => {
    bot = new Bot(fakeApi, store, cfg);
    secret = await webhookSecret(BOT_TOKEN);
    api = createApi({ store, cfg, bot, webhookSecret: secret });
  });

  it('uses a secret Telegram accepts', () => {
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
  });

  it('only takes updates that carry the secret', async () => {
    expect((await api(req('/api/telegram', { body: update(1, 'Buy milk') }), 'x')).status).toBe(401);
    expect((await api(req('/api/telegram', { body: update(1, 'Buy milk'), headers: { 'x-telegram-bot-api-secret-token': 'guess' } }), 'x')).status).toBe(401);
    await settle();
    expect(store.userData(9).tasks).toHaveLength(0);
  });

  it('answers at once, handles the update, and ignores Telegram sending it again', async () => {
    const headers = { 'x-telegram-bot-api-secret-token': secret };
    expect((await api(req('/api/telegram', { body: update(5, 'Buy milk'), headers }), 'x')).status).toBe(200);
    await api(req('/api/telegram', { body: update(5, 'Buy milk'), headers }), 'x');
    await settle();
    expect(store.userData(9).tasks.map((t) => t.title)).toEqual(['Buy milk']);
  });

  it('slows down someone guessing the secret', async () => {
    const guess = () => api(req('/api/telegram', { body: update(1, 'x'), headers: { 'x-telegram-bot-api-secret-token': 'guess' } }), '6.6.6.6');
    for (let i = 0; i < 30; i++) expect((await guess()).status).toBe(401);
    expect((await guess()).status).toBe(429);
  });

  it('isn’t there when the bot polls instead', async () => {
    const polling = createApi({ store, cfg, bot, webhookSecret: null });
    expect((await polling(req('/api/telegram', { body: update(1, 'x'), headers: { 'x-telegram-bot-api-secret-token': secret } }), 'x')).status).toBe(404);
  });

  it('sets itself up once, and again if the webhook was changed elsewhere', async () => {
    webhookUrl = 'https://daybook.test/api/telegram';
    const hook = { url: webhookUrl, secret };
    expect(await bot.ensureWebhook(hook)).toBe(true);
    expect(calls.map((c) => c.method)).toEqual(['getMe', 'setMyCommands', 'setChatMenuButton', 'setWebhook']);
    expect(calls[3].params).toMatchObject({ url: webhookUrl, secret_token: secret, allowed_updates: ['message', 'callback_query'] });
    expect(bot.username).toBe('daybook_test_bot');

    calls = [];
    expect(await bot.ensureWebhook(hook)).toBe(true);
    expect(calls).toHaveLength(0);

    // Hours later, another copy of the bot has taken the webhook away.
    store.setMeta('bot_checked_at', '0');
    webhookUrl = '';
    await bot.ensureWebhook(hook);
    expect(calls.map((c) => c.method)).toContain('setWebhook');
  });
});

describe('Cloudflare headers file', () => {
  it('carries the same CSP as the Node server, and caches built assets', () => {
    const file = cloudflareHeadersFile();
    expect(file).toContain(`/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer`);
    expect(file).toContain(`Content-Security-Policy: ${CSP}`);
    expect(file).toContain('/assets/*\n  Cache-Control: public, max-age=31536000, immutable');
  });
});

describe('PlanReader on Workers', () => {
  it('calls fetch on its own, not as a method (Workers would refuse)', async () => {
    const seen: unknown[] = [];
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(function (this: unknown) {
      seen.push(this);
      return Promise.resolve(
        new Response(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"items":[],"note":null}' }] }), { headers: { 'content-type': 'application/json' } }),
      );
    });
    try {
      const reader = new PlanReader({ apiKey: 'k', model: 'claude-haiku-5-5' });
      await reader.read({ texts: ['hi'], images: [] }, { now: new Date(), tz: 'UTC', sentAt: null, tags: [], weekStartsOn: 1 });
      expect(seen).toHaveLength(1);
      expect(seen[0] === undefined || seen[0] === globalThis).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('Claude budget', () => {
  it('holds across restarts (it’s counted in the database)', async () => {
    store.upsertUser({ id: 9, firstName: 'Kim', username: null });
    store.applyChanges(9, [{ kind: 'settings', id: 'main', data: { aiPlans: true }, updatedAt: 1 }]);
    let reads = 0;
    const reader = { model: 'm', read: async () => (reads++, { items: [], note: null }) } as unknown as PlanReader;
    const user = store.user(9)!;
    for (let i = 0; i < 30; i++) await new Bot(fakeApi, store, cfg, reader).plans!.planText(user, 'Dinner Friday 7pm');
    expect(reads).toBe(30);
    // A fresh bot, as after a restart or a Durable Object waking up again
    await new Bot(fakeApi, store, cfg, reader).plans!.planText(user, 'One more');
    expect(reads).toBe(30);
    expect(calls.filter((c) => c.method === 'sendMessage').at(-1)!.params.text).toContain('a lot of messages this hour');
  });
});

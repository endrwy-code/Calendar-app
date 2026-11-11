import { beforeEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { PlanReader, ClaudeError, type ReadContext } from '../claude';
import { Bot } from '../bot';
import { loadConfig } from '../config';
import { Store } from '../store';
import { createApp } from '../http';
import { checkInitData } from '../auth';
import type { BotApi, TgUpdate } from '../telegram';
import type { PlanItem } from '../../src/lib/plans';

process.env.TZ = 'UTC';

const ctx: ReadContext = {
  now: new Date('2026-11-11T14:05:00Z'),
  tz: 'Asia/Singapore',
  sentAt: new Date('2026-11-09T09:12:00Z'),
  tags: [{ id: 'church', name: 'Church' }],
  weekStartsOn: 1,
};

const plan = (p: Partial<PlanItem>): PlanItem => ({
  kind: 'event',
  title: 'Camp briefing',
  date: '2026-11-14',
  endDate: null,
  startTime: '10:00',
  endTime: '12:00',
  location: 'Level 3',
  notes: null,
  tagId: 'church',
  repeat: null,
  assumption: null,
  ...p,
});

function fakeFetch(responses: { status: number; body: unknown; headers?: Record<string, string> }[]) {
  const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
    const r = responses[Math.min(calls.length - 1, responses.length - 1)];
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json', ...r.headers } });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const ok = (items: unknown[], note: string | null = null) => ({
  status: 200,
  body: {
    stop_reason: 'end_turn',
    content: [
      { type: 'thinking', thinking: '' },
      { type: 'text', text: JSON.stringify({ items, note }) },
    ],
    usage: { input_tokens: 900, output_tokens: 300 },
  },
});

describe('PlanReader', () => {
  it('sends a structured-output request with fallbacks and the message context', async () => {
    const f = fakeFetch([ok([plan({})])]);
    const reader = new PlanReader({ apiKey: 'sk-test', model: 'claude-opus-5-5' }, f.fn);
    const out = await reader.read({ texts: ['Briefing this Sat 10am-12pm at Level 3'], images: [{ mediaType: 'image/jpeg', data: 'AAAA' }] }, ctx);
    expect(out.items).toHaveLength(1);
    const [call] = f.calls;
    expect(call.url).toBe('https://api.anthropic.com/v1/messages');
    expect(call.headers).toMatchObject({ 'x-api-key': 'sk-test', 'anthropic-version': '2026-10-21', 'anthropic-beta': 'server-side-fallback-2026-07-01' });
    expect(call.body).toMatchObject({ model: 'claude-opus-5-5', fallbacks: 'default', output_config: { effort: 'medium', format: { type: 'json_schema' } } });
    expect(call.body).not.toHaveProperty('thinking');
    expect(call.body).not.toHaveProperty('temperature');
    const content = (call.body.messages as { content: { type: string; text?: string }[] }[])[0].content;
    expect(content[0].type).toBe('image');
    expect(content[1].text).toContain('The message was sent on Monday 9 November 2026 at 09:12');
    expect(content[1].text).toContain('church: Church');
    expect(content[1].text).toContain('<message index="1">');
  });

  it('leaves out fallbacks for models without them', async () => {
    const f = fakeFetch([ok([])]);
    await new PlanReader({ apiKey: 'k', model: 'claude-haiku-5-5' }, f.fn).read({ texts: ['hi'], images: [] }, ctx);
    expect(f.calls[0].body).not.toHaveProperty('fallbacks');
    expect(f.calls[0].headers).not.toHaveProperty('anthropic-beta');
  });

  it('retries when overloaded, and names failures', async () => {
    const busy = { status: 529, body: { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }, headers: { 'retry-after': '0.01' } };
    const f = fakeFetch([busy, ok([plan({})])]);
    const out = await new PlanReader({ apiKey: 'k', model: 'claude-opus-5-5' }, f.fn).read({ texts: ['x'], images: [] }, ctx);
    expect(f.calls).toHaveLength(2);
    expect(out.items).toHaveLength(1);

    const refused = fakeFetch([{ status: 200, body: { stop_reason: 'refusal', content: [] } }]);
    await expect(new PlanReader({ apiKey: 'k', model: 'claude-opus-5-5' }, refused.fn).read({ texts: ['x'], images: [] }, ctx)).rejects.toMatchObject({ kind: 'refused' });

    const denied = fakeFetch([{ status: 401, body: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } }]);
    await expect(new PlanReader({ apiKey: 'k', model: 'claude-opus-5-5' }, denied.fn).read({ texts: ['x'], images: [] }, ctx)).rejects.toBeInstanceOf(ClaudeError);
  });

  it('refuses rather than cutting a long message short', async () => {
    const f = fakeFetch([ok([])]);
    await expect(new PlanReader({ apiKey: 'k', model: 'claude-opus-5-5' }, f.fn).read({ texts: ['x'.repeat(20001)], images: [] }, ctx)).rejects.toMatchObject({ kind: 'too_long' });
    expect(f.calls).toHaveLength(0);
  });
});

describe('plans in the chat', () => {
  let store: Store;
  let bot: Bot;
  let sent: { method: string; params: Record<string, unknown> }[];
  let reads: { texts: string[] }[];
  let revisions: string[];
  let nextItems: PlanItem[];
  let msgId: number;

  const fakeApi = {
    async call(method: string, params: Record<string, unknown> = {}) {
      sent.push({ method, params });
      return method === 'sendMessage' ? { message_id: ++msgId } : {};
    },
    async downloadFile() {
      return Buffer.from('jpeg');
    },
    async sendDocument() {},
  } as unknown as BotApi;
  const fakeReader = {
    model: 'claude-opus-5-5',
    async read(input: { texts: string[] }) {
      reads.push(input);
      return { items: nextItems, note: null };
    },
    async revise(_items: PlanItem[], request: string) {
      revisions.push(request);
      return { items: nextItems, note: null };
    },
  } as unknown as PlanReader;

  const cfg = loadConfig({ APP_URL: 'https://daybook.test', BOT_POLLING: '0', DEFAULT_TZ: 'Asia/Singapore' });
  const fwd = (text: string, id = 9): TgUpdate => ({
    update_id: 1,
    message: { message_id: 100, from: { id, first_name: 'Kim' }, chat: { id, type: 'private' }, text, forward_origin: { type: 'user', date: 1762650000 } },
  });
  const button = (data: string, from = 9): TgUpdate => ({ update_id: 2, callback_query: { id: 'q', from: { id: from, first_name: 'X' }, data } });
  const posts = () => sent.filter((s) => s.method === 'sendMessage');
  const lastPost = () => posts().at(-1)!.params;
  const buttonsOf = (p: Record<string, unknown>) =>
    ((p.reply_markup as { inline_keyboard: { text: string; callback_data?: string; web_app?: { url: string } }[][] }) ?? { inline_keyboard: [] }).inline_keyboard.flat();

  beforeEach(() => {
    sent = [];
    reads = [];
    revisions = [];
    msgId = 0;
    nextItems = [plan({}), plan({ kind: 'todo', title: 'Bring consent form', startTime: null, endTime: null, location: null })];
    store = new Store(':memory:');
    bot = new Bot(fakeApi, store, cfg, fakeReader, 0);
    store.upsertUser({ id: 9, firstName: 'Kim', username: null });
    // The app uploads your tags on its first sync
    store.applyChanges(9, [
      { kind: 'tag', id: 'personal', data: { id: 'personal', name: 'Personal', color: 'indigo', visible: true }, updatedAt: 1 },
      { kind: 'tag', id: 'church', data: { id: 'church', name: 'Church', color: 'coral', visible: true }, updatedAt: 1 },
    ]);
  });
  const enable = () => store.applyChanges(9, [{ kind: 'settings', id: 'main', data: { aiPlans: true }, updatedAt: 1 }]);

  it('asks you to turn it on first', async () => {
    await bot.handle(fwd('Camp briefing Sat 10am'));
    await bot.plans!.flush(9);
    expect(reads).toHaveLength(0);
    expect(lastPost().text).toContain('Plans from messages');
  });

  it('reads forwards together, without contact details, and shows a draft', async () => {
    enable();
    await bot.handle(fwd('Camp briefing this Sat 10am-12pm, Level 3'));
    await bot.handle(fwd('Questions? Call Jo at 9123 4567'));
    await bot.plans!.flush(9);
    expect(reads).toHaveLength(1);
    expect(reads[0].texts).toEqual(['Camp briefing this Sat 10am-12pm, Level 3', 'Questions? Call Jo at [phone]']);
    const p = lastPost();
    expect(p.text).toContain('I found 2 plans');
    expect(p.text).toContain('<b>Camp briefing</b>');
    expect(p.text).toContain('Sat 14 Nov · 10:00–12:00 · Level 3 · Church');
    const btns = buttonsOf(p);
    expect(btns.map((b) => b.text)).toEqual(['Add all 2', 'Edit in Daybook', 'Cancel']);
    expect(btns[1].web_app?.url).toMatch(/^https:\/\/daybook\.test\/\?review=[\w-]+$/);
    expect(store.userData(9).events).toHaveLength(0); // nothing added yet
  });

  it('adds everything on confirm, with undo', async () => {
    enable();
    await bot.handle(fwd('…'));
    await bot.plans!.flush(9);
    const add = buttonsOf(lastPost())[0].callback_data!;
    await bot.handle(button(add));
    const data = store.userData(9);
    expect(data.events).toEqual([expect.objectContaining({ title: 'Camp briefing', start: '2026-11-14T10:00', end: '2026-11-14T12:00', calendarId: 'church', location: 'Level 3' })]);
    expect(data.tasks).toEqual([expect.objectContaining({ title: 'Bring consent form', notes: 'By Sat 14 Nov 2026', status: 'todo' })]);
    const edited = sent.filter((s) => s.method === 'editMessageText').at(-1)!.params;
    expect(edited.text).toContain('Added to Daybook ✓');
    const undo = buttonsOf(edited)[0].callback_data!;
    await bot.handle(button(undo));
    expect(store.userData(9).events).toHaveLength(0);
    expect(store.userData(9).tasks).toHaveLength(0);
  });

  it('won’t let someone else add your draft', async () => {
    enable();
    await bot.handle(fwd('…'));
    await bot.plans!.flush(9);
    store.upsertUser({ id: 10, firstName: 'Other', username: null });
    await bot.handle(button(buttonsOf(lastPost())[0].callback_data!, 10));
    expect(store.userData(9).events).toHaveLength(0);
    expect(store.userData(10).events).toHaveLength(0);
  });

  it('changes a draft when you reply to it', async () => {
    enable();
    await bot.handle(fwd('…'));
    await bot.plans!.flush(9);
    const draftMsg = posts().at(-1)!;
    const draftMsgId = msgId;
    nextItems = [plan({ startTime: '15:00', endTime: '17:00' })];
    await bot.handle({
      update_id: 3,
      message: { message_id: 101, from: { id: 9, first_name: 'Kim' }, chat: { id: 9, type: 'private' }, text: 'make it 3pm and drop the form', reply_to_message: { message_id: draftMsgId, chat: { id: 9, type: 'private' } } },
    });
    expect(revisions).toEqual(['make it 3pm and drop the form']);
    expect(lastPost().text).toContain('15:00–17:00');
    expect(lastPost()).not.toBe(draftMsg.params);
    expect(buttonsOf(lastPost())[0].text).toBe('Add it');
  });

  it('still adds plain typed text as a to-do', async () => {
    enable();
    await bot.handle({ update_id: 4, message: { message_id: 5, from: { id: 9, first_name: 'Kim' }, chat: { id: 9, type: 'private' }, text: 'Buy milk' } });
    expect(reads).toHaveLength(0);
    expect(store.userData(9).tasks.map((t) => t.title)).toEqual(['Buy milk']);
  });

  it('lets the app review a draft and report back', async () => {
    enable();
    await bot.handle(fwd('…'));
    await bot.plans!.flush(9);
    const id = new URL(buttonsOf(lastPost())[1].web_app!.url).searchParams.get('review')!;

    const { createHmac } = await import('node:crypto');
    const token = '1:T';
    const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: 9, first_name: 'Kim' }) });
    const check = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('\n');
    params.set('hash', createHmac('sha256', createHmac('sha256', 'WebAppData').update(token).digest()).update(check).digest('hex'));
    expect(checkInitData(params.toString(), token)?.id).toBe(9);

    const server = createApp({ store, cfg: { ...cfg, botToken: token, trustProxy: false }, bot });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const post = (p: string, body: unknown, auth?: string) =>
      fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${auth}` } : {}) }, body: JSON.stringify(body) });
    try {
      const { token: session } = (await (await post('/api/auth/telegram', { initData: params.toString() })).json()) as { token: string };
      const me = (await (await fetch(base + '/api/me', { headers: { authorization: `Bearer ${session}` } })).json()) as { ai: boolean };
      expect(me.ai).toBe(true);
      const draft = (await (await fetch(`${base}/api/drafts/${id}`, { headers: { authorization: `Bearer ${session}` } })).json()) as { items: PlanItem[]; status: string };
      expect(draft.status).toBe('open');
      expect(draft.items).toHaveLength(2);
      const done = await post(`/api/drafts/${id}`, { status: 'added', items: [draft.items[0]] }, session);
      expect(done.status).toBe(200);
      expect(store.draft(9, id)?.status).toBe('added');
      expect(sent.filter((s) => s.method === 'editMessageText').at(-1)!.params.text).toContain('Added to Daybook from the app ✓');
      // Someone else can't read it
      store.upsertUser({ id: 10, firstName: 'Other', username: null });
      expect((await fetch(`${base}/api/drafts/${id}`, { headers: { authorization: 'Bearer nope-nope-nope-nope-nope' } })).status).toBe(401);
    } finally {
      server.close();
    }
  });
});

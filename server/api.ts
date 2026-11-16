/**
 * The JSON API under /api, as a standard fetch handler (Request in, Response
 * out), so it runs the same on Node (server/http.ts) and in the Cloudflare
 * Durable Object (worker/index.ts).
 *
 *   GET  /api/health          is this a Daybook server, and which bot
 *   POST /api/auth/telegram   sign in with Telegram's launch data
 *   POST /api/auth/code       sign in with a one-time link from the bot (/login)
 *   POST /api/logout
 *   GET  /api/me
 *   POST /api/sync            send changes, get everything changed since a revision
 *   POST /api/feed            turn on (or renew) the private calendar link
 *   DEL  /api/feed            turn it off
 *   GET  /api/feed/<token>.ics  the calendar, for Apple/Google/Outlook to subscribe to
 *   POST /api/notify/test     send a test message
 *   POST /api/send-file       have the bot send you a file (Telegram can't download)
 *   GET  /api/drafts/<id>     plans read from a forwarded message, to review
 *   POST /api/drafts/<id>     {status: "added", items} or {status: "cancelled"}
 *   POST /api/telegram        updates from Telegram, when the bot uses a webhook (Cloudflare)
 *
 * Signed-in requests carry `Authorization: Bearer <session token>`.
 */
import { buildIcs } from '../src/lib/ics';
import { normalizePlans } from '../src/lib/plans';
import { isValidTimeZone } from '../src/lib/tz';
import { isAllowed, type Config } from './config';
import { checkInitData, newToken, sameSecret, sha256 } from './auth';
import type { Bot } from './bot';
import { baseHeaders } from './headers';
import { KINDS, type Change, type Kind, type Store, type User } from './store';
import { TelegramError, type TgUpdate } from './telegram';

export interface Ctx {
  store: Store;
  cfg: Config;
  bot: Bot | null;
  /**
   * Telegram webhook (Cloudflare): the secret Telegram sends with each update.
   * null when the bot polls for updates instead (Node).
   */
  webhookSecret?: string | null;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const MAX_RECORDS = 100000;
const MAX_RECORD_BYTES = 256 * 1024;
/** Changes sent back per sync; the device asks again for the rest. Keeps each request small (Cloudflare's CPU limits). */
export const SYNC_PAGE = 500;

/** Checks the changes a device sends, so nothing malformed reaches the database. */
export function validateChanges(raw: unknown, now = Date.now()): Change[] {
  if (!Array.isArray(raw)) return [];
  if (raw.length > 20000) throw new HttpError(413, 'Too many changes at once');
  const out: Change[] = [];
  for (const c of raw as Record<string, unknown>[]) {
    if (!c || typeof c !== 'object') throw new HttpError(400, 'Bad change');
    const { kind, id, data, updatedAt } = c;
    if (!KINDS.includes(kind as Kind)) throw new HttpError(400, 'Bad record kind');
    if (typeof id !== 'string' || !id || id.length > 200) throw new HttpError(400, 'Bad record id');
    if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt) || updatedAt < 0) throw new HttpError(400, 'Bad timestamp');
    if (data !== null) {
      if (typeof data !== 'object' || Array.isArray(data)) throw new HttpError(400, 'Bad record');
      if (kind !== 'settings' && (data as { id?: unknown }).id !== id) throw new HttpError(400, 'Record id mismatch');
      if (JSON.stringify(data).length > MAX_RECORD_BYTES) throw new HttpError(413, 'Record too large');
    }
    // A device whose clock runs fast can't make its edits win forever.
    out.push({ kind: kind as Kind, id, data, updatedAt: Math.min(updatedAt, now + 60000) });
  }
  return out;
}

/** In memory, so it starts afresh when the server restarts (or the Durable Object is woken). */
class RateLimiter {
  private hits = new Map<string, { n: number; reset: number }>();
  take(key: string, max: number, windowMs: number): boolean {
    const now = Date.now();
    let h = this.hits.get(key);
    if (!h || h.reset < now) {
      h = { n: 0, reset: now + windowMs };
      this.hits.set(key, h);
    }
    h.n++;
    if (this.hits.size > 20000) for (const [k, v] of this.hits) if (v.reset < now) this.hits.delete(k);
    return h.n <= max;
  }
}

/** Reads a request body as text, stopping as soon as it's larger than `limit` bytes. */
async function readText(req: Request, limit: number): Promise<string> {
  if (Number(req.headers.get('content-length')) > limit) throw new HttpError(413, 'Too large');
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      throw new HttpError(413, 'Too large');
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

async function readJson(req: Request, limit = 64 * 1024): Promise<Record<string, unknown>> {
  if (!(req.headers.get('content-type') ?? '').includes('application/json')) throw new HttpError(415, 'Send JSON');
  const text = await readText(req, limit);
  try {
    const v = JSON.parse(text || '{}');
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error();
    return v as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'Bad JSON');
  }
}

const bearer = (req: Request) => /^Bearer ([\w-]{20,128})$/.exec(req.headers.get('authorization') ?? '')?.[1] ?? null;

/**
 * Builds the API handler. `ip` is the client's address, worked out by whoever
 * received the request (it's only used for rate limits).
 */
export function createApi(ctx: Ctx): (req: Request, ip: string) => Promise<Response> {
  const { store, cfg } = ctx;
  const limiter = new RateLimiter();
  const security = baseHeaders(!!cfg.appUrl?.startsWith('https://'));

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...security, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

  const baseUrl = (req: Request) => cfg.appUrl ?? new URL(req.url).origin;

  const signedIn = async (req: Request): Promise<User> => {
    const token = bearer(req);
    const user = token ? store.sessionUser(await sha256(token)) : null;
    if (!user) throw new HttpError(401, 'Please sign in again');
    if (!isAllowed(cfg, user)) throw new HttpError(403, 'This Daybook is private');
    return user;
  };

  const startSession = async (user: { id: number; username: string | null }) => {
    if (!isAllowed(cfg, user)) throw new HttpError(403, 'This Daybook is private');
    const token = newToken();
    store.createSession(await sha256(token), user.id);
    return token;
  };

  const me = (user: User, req: Request) => ({
    user: { id: user.id, firstName: user.firstName, username: user.username },
    chatOk: user.chatOk,
    feedUrl: user.feedToken ? `${baseUrl(req)}/api/feed/${user.feedToken}.ics` : null,
    bot: ctx.bot?.username ?? null,
    ai: !!ctx.bot?.plans,
  });

  async function route(req: Request, ip: string): Promise<Response> {
    const p = new URL(req.url).pathname;
    const route = `${req.method} ${p}`;

    // Telegram's webhook is checked by its secret, not rate-limited by address.
    if (route === 'POST /api/telegram') {
      if (!ctx.bot || !ctx.webhookSecret) throw new HttpError(404, 'Not found');
      const given = req.headers.get('x-telegram-bot-api-secret-token') ?? '';
      if (!(await sameSecret(given, ctx.webhookSecret))) {
        if (!limiter.take(`tg-bad:${ip}`, 30, 10 * 60000)) throw new HttpError(429, 'Too many requests');
        throw new HttpError(401, 'Not from Telegram');
      }
      const update = (await readJson(req, 1024 * 1024)) as unknown as TgUpdate;
      if (typeof update.update_id !== 'number') throw new HttpError(400, 'Not an update');
      // Answer Telegram straight away; the bot carries on in the background
      // (Durable Objects keep running after a response, for up to 15 minutes).
      void ctx.bot.receive(update).catch((e) => console.error('Telegram: couldn’t handle an update:', (e as Error).message));
      return json(200, { ok: true });
    }

    if (!limiter.take(`api:${ip}`, 600, 60000)) throw new HttpError(429, 'Too many requests, slow down');

    if (route === 'GET /api/health') return json(200, { app: 'daybook', ok: true, bot: ctx.bot?.username ?? null });

    if (p.startsWith('/api/auth/') && !limiter.take(`auth:${ip}`, 30, 10 * 60000)) throw new HttpError(429, 'Too many sign-in attempts, wait a few minutes');

    if (route === 'POST /api/auth/telegram') {
      if (!cfg.botToken) throw new HttpError(503, 'The server has no BOT_TOKEN');
      const body = await readJson(req);
      const tgUser = typeof body.initData === 'string' ? await checkInitData(body.initData, cfg.botToken) : null;
      if (!tgUser) throw new HttpError(401, 'Couldn’t verify Telegram sign-in');
      if (!isAllowed(cfg, tgUser)) throw new HttpError(403, 'This Daybook is private');
      const user = store.upsertUser(tgUser);
      return json(200, { token: await startSession(user) });
    }

    if (route === 'POST /api/auth/code') {
      const body = await readJson(req);
      const code = typeof body.code === 'string' && /^[\w-]{20,100}$/.test(body.code) ? body.code : null;
      const user = code ? store.takeCode(await sha256(code)) : null;
      if (!user) throw new HttpError(401, 'That sign-in link has expired');
      return json(200, { token: await startSession(user) });
    }

    if (route === 'POST /api/logout') {
      const token = bearer(req);
      if (token) store.deleteSession(await sha256(token));
      return json(200, { ok: true });
    }

    const feed = /^\/api\/feed\/([\w-]{20,100})(?:\.ics)?$/.exec(p);
    if (feed && (req.method === 'GET' || req.method === 'HEAD')) {
      if (!limiter.take(`feed:${ip}`, 60, 60000)) throw new HttpError(429, 'Too many requests');
      const user = store.userByFeedToken(feed[1]);
      if (!user) throw new HttpError(404, 'This calendar link was turned off');
      const data = store.userData(user.id);
      const tz = user.tz && isValidTimeZone(user.tz) ? user.tz : cfg.defaultTz;
      const ics = buildIcs(data.events, { name: 'Daybook', tz, calendars: data.calendars, settings: data.settings, tasks: data.tasks });
      return new Response(req.method === 'HEAD' ? null : ics, {
        headers: {
          ...security,
          'Content-Type': 'text/calendar; charset=utf-8',
          'Content-Disposition': 'inline; filename="daybook.ics"',
          'Cache-Control': 'private, max-age=300',
        },
      });
    }

    // Everything below needs a signed-in user.
    const user = await signedIn(req);

    if (route === 'GET /api/me') return json(200, me(user, req));

    if (route === 'POST /api/sync') {
      const body = await readJson(req, 12 * 1024 * 1024);
      if (typeof body.tz === 'string' && body.tz !== user.tz && isValidTimeZone(body.tz)) store.setTz(user.id, body.tz);
      const since = typeof body.since === 'number' && Number.isSafeInteger(body.since) && body.since >= 0 ? body.since : 0;
      const changes = validateChanges(body.changes);
      const before = store.maxRev(user.id);
      // The device is ahead of the server (the database was restored): it should start over.
      if (since > before) return json(200, { rev: before, reset: true, changes: [] });
      if (changes.some((c) => c.data !== null) && store.countLive(user.id) + changes.length > MAX_RECORDS) throw new HttpError(413, 'That’s more records than this server keeps');
      store.applyChanges(user.id, changes);
      // `rev` is the last revision included, so a device that stops early simply picks up from there next time.
      const page = store.changesPage(user.id, since, SYNC_PAGE);
      return json(200, { rev: page.rev, changes: page.changes, more: page.more });
    }

    if (route === 'POST /api/feed') {
      const token = newToken(24);
      store.setFeedToken(user.id, token);
      return json(200, { url: `${baseUrl(req)}/api/feed/${token}.ics` });
    }
    if (route === 'DELETE /api/feed') {
      store.setFeedToken(user.id, null);
      return json(200, { ok: true });
    }

    if (route === 'POST /api/notify/test') {
      if (!ctx.bot) throw new HttpError(503, 'The server has no Telegram bot');
      try {
        await ctx.bot.send(user.id, '✅ Alerts are on. They’ll arrive here.', { app: true });
        store.setChatOk(user.id, true);
        return json(200, { ok: true });
      } catch (e) {
        if (e instanceof TelegramError && (e.code === 403 || e.code === 400)) {
          store.setChatOk(user.id, false);
          return json(200, { ok: false });
        }
        throw new HttpError(502, 'Couldn’t reach Telegram');
      }
    }

    if (route === 'POST /api/send-file') {
      if (!ctx.bot) throw new HttpError(503, 'The server has no Telegram bot');
      if (!limiter.take(`file:${user.id}`, 20, 10 * 60000)) throw new HttpError(429, 'Too many files, wait a few minutes');
      const body = await readJson(req, 6 * 1024 * 1024);
      const name = typeof body.name === 'string' ? body.name.replace(/[^\w .-]/g, '').slice(0, 100) : '';
      const mime = body.mime === 'text/calendar' || body.mime === 'application/json' ? body.mime : null;
      if (!/\.(ics|json)$/i.test(name) || !mime || typeof body.content !== 'string') throw new HttpError(400, 'Only .ics and .json files');
      try {
        await ctx.bot.sendFile(user.id, name, body.content, mime);
        return json(200, { ok: true });
      } catch (e) {
        if (e instanceof TelegramError && e.code === 403) store.setChatOk(user.id, false);
        throw new HttpError(502, 'Couldn’t send the file');
      }
    }

    const draftPath = /^\/api\/drafts\/([\w-]{10,64})$/.exec(p);
    if (draftPath) {
      const draft = store.draft(user.id, draftPath[1]);
      if (!draft) throw new HttpError(404, 'This draft has expired');
      if (req.method === 'GET') return json(200, { id: draft.id, items: draft.items, note: draft.note, status: draft.status });
      if (req.method === 'POST') {
        const body = await readJson(req, 256 * 1024);
        if (body.status === 'cancelled') {
          if (ctx.bot?.plans) await ctx.bot.plans.closedInApp(user, draft.id, 'cancelled');
          else if (draft.status === 'open') store.updateDraft(user.id, draft.id, { status: 'cancelled' });
        } else if (body.status === 'added') {
          const items = normalizePlans(body.items, store.userData(user.id).calendars.map((c) => c.id));
          if (ctx.bot?.plans) await ctx.bot.plans.closedInApp(user, draft.id, { added: items });
          else if (draft.status === 'open') store.updateDraft(user.id, draft.id, { status: 'added' });
        } else throw new HttpError(400, 'Unknown status');
        return json(200, { ok: true });
      }
    }

    throw new HttpError(404, 'Not found');
  }

  return async (req, ip) => {
    try {
      return await route(req, ip);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error('Request failed:', (e as Error).message);
      return json(status, { error: e instanceof HttpError ? e.message : 'Something went wrong' });
    } finally {
      // Let go of a body that wasn't needed (a refused request), before answering.
      if (req.body && !req.bodyUsed) await req.body.cancel().catch(() => {});
    }
  };
}

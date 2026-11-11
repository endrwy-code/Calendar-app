/**
 * The web server: the app itself (dist/) and a small JSON API under /api.
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
 *
 * Signed-in requests carry `Authorization: Bearer <session token>`.
 */
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { buildIcs } from '../src/lib/ics';
import { isValidTimeZone } from '../src/lib/tz';
import { isAllowed, type Config } from './config';
import { checkInitData, newToken, sha256 } from './auth';
import type { Bot } from './bot';
import { KINDS, type Change, type Kind, type Store, type User } from './store';
import { TelegramError } from './telegram';

export interface Ctx {
  store: Store;
  cfg: Config;
  bot: Bot | null;
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

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
};

/** The app only loads its own files, plus Telegram's Mini App script, and may be framed by Telegram Web. */
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://telegram.org",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'self' https://web.telegram.org https://*.telegram.org",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

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

interface StaticFile {
  body: Buffer;
  gz: Buffer | null;
  type: string;
  etag: string;
}

export function createApp(ctx: Ctx): http.Server {
  const { store, cfg } = ctx;
  const limiter = new RateLimiter();
  const files = new Map<string, StaticFile | null>();
  const root = path.resolve(cfg.staticDir);

  const clientIp = (req: IncomingMessage) => {
    const fwd = req.headers['x-forwarded-for'];
    if (cfg.trustProxy && typeof fwd === 'string') return fwd.split(',').pop()!.trim();
    return req.socket.remoteAddress ?? 'unknown';
  };

  const baseUrl = (req: IncomingMessage) => {
    if (cfg.appUrl) return cfg.appUrl;
    const proto = cfg.trustProxy && req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
    return `${proto}://${req.headers.host ?? 'localhost'}`;
  };

  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };

  const readJson = async (req: IncomingMessage, limit = 64 * 1024): Promise<Record<string, unknown>> => {
    if (!(req.headers['content-type'] ?? '').includes('application/json')) throw new HttpError(415, 'Send JSON');
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > limit) throw new HttpError(413, 'Too large');
      chunks.push(chunk as Buffer);
    }
    try {
      const v = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error();
      return v as Record<string, unknown>;
    } catch {
      throw new HttpError(400, 'Bad JSON');
    }
  };

  const signedIn = (req: IncomingMessage): User => {
    const m = /^Bearer ([\w-]{20,128})$/.exec(req.headers.authorization ?? '');
    const user = m ? store.sessionUser(sha256(m[1])) : null;
    if (!user) throw new HttpError(401, 'Please sign in again');
    if (!isAllowed(cfg, user)) throw new HttpError(403, 'This Daybook is private');
    return user;
  };

  const startSession = (user: { id: number; username: string | null }) => {
    if (!isAllowed(cfg, user)) throw new HttpError(403, 'This Daybook is private');
    const token = newToken();
    store.createSession(sha256(token), user.id);
    return token;
  };

  const me = (user: User, req: IncomingMessage) => ({
    user: { id: user.id, firstName: user.firstName, username: user.username },
    chatOk: user.chatOk,
    feedUrl: user.feedToken ? `${baseUrl(req)}/api/feed/${user.feedToken}.ics` : null,
    bot: ctx.bot?.username ?? null,
  });

  async function api(req: IncomingMessage, res: ServerResponse, p: string) {
    const ip = clientIp(req);
    if (!limiter.take(`api:${ip}`, 600, 60000)) throw new HttpError(429, 'Too many requests, slow down');
    const route = `${req.method} ${p}`;

    if (route === 'GET /api/health') return json(res, 200, { app: 'daybook', ok: true, bot: ctx.bot?.username ?? null });

    if (p.startsWith('/api/auth/') && !limiter.take(`auth:${ip}`, 30, 10 * 60000)) throw new HttpError(429, 'Too many sign-in attempts, wait a few minutes');

    if (route === 'POST /api/auth/telegram') {
      if (!cfg.botToken) throw new HttpError(503, 'The server has no BOT_TOKEN');
      const body = await readJson(req);
      const tgUser = typeof body.initData === 'string' ? checkInitData(body.initData, cfg.botToken) : null;
      if (!tgUser) throw new HttpError(401, 'Couldn’t verify Telegram sign-in');
      if (!isAllowed(cfg, tgUser)) throw new HttpError(403, 'This Daybook is private');
      const user = store.upsertUser(tgUser);
      return json(res, 200, { token: startSession(user) });
    }

    if (route === 'POST /api/auth/code') {
      const body = await readJson(req);
      const code = typeof body.code === 'string' && /^[\w-]{20,100}$/.test(body.code) ? body.code : null;
      const user = code ? store.takeCode(sha256(code)) : null;
      if (!user) throw new HttpError(401, 'That sign-in link has expired');
      return json(res, 200, { token: startSession(user) });
    }

    if (route === 'POST /api/logout') {
      const m = /^Bearer ([\w-]{20,128})$/.exec(req.headers.authorization ?? '');
      if (m) store.deleteSession(sha256(m[1]));
      return json(res, 200, { ok: true });
    }

    const feed = /^\/api\/feed\/([\w-]{20,100})(?:\.ics)?$/.exec(p);
    if (feed && req.method === 'GET') {
      if (!limiter.take(`feed:${ip}`, 60, 60000)) throw new HttpError(429, 'Too many requests');
      const user = store.userByFeedToken(feed[1]);
      if (!user) throw new HttpError(404, 'This calendar link was turned off');
      const data = store.userData(user.id);
      const tz = user.tz && isValidTimeZone(user.tz) ? user.tz : cfg.defaultTz;
      const ics = buildIcs(data.events, { name: 'Daybook', tz, calendars: data.calendars, settings: data.settings, tasks: data.tasks });
      res.writeHead(200, {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'inline; filename="daybook.ics"',
        'Cache-Control': 'private, max-age=300',
      });
      return res.end(ics);
    }

    // Everything below needs a signed-in user.
    const user = signedIn(req);

    if (route === 'GET /api/me') return json(res, 200, me(user, req));

    if (route === 'POST /api/sync') {
      const body = await readJson(req, 12 * 1024 * 1024);
      if (typeof body.tz === 'string' && body.tz !== user.tz && isValidTimeZone(body.tz)) store.setTz(user.id, body.tz);
      const since = typeof body.since === 'number' && Number.isSafeInteger(body.since) && body.since >= 0 ? body.since : 0;
      const changes = validateChanges(body.changes);
      const before = store.maxRev(user.id);
      // The device is ahead of the server (the database was restored): it should start over.
      if (since > before) return json(res, 200, { rev: before, reset: true, changes: [] });
      if (changes.some((c) => c.data !== null) && store.countLive(user.id) + changes.length > MAX_RECORDS) throw new HttpError(413, 'That’s more records than this server keeps');
      store.applyChanges(user.id, changes);
      return json(res, 200, { rev: store.maxRev(user.id), changes: store.changesSince(user.id, since) });
    }

    if (route === 'POST /api/feed') {
      const token = newToken(24);
      store.setFeedToken(user.id, token);
      return json(res, 200, { url: `${baseUrl(req)}/api/feed/${token}.ics` });
    }
    if (route === 'DELETE /api/feed') {
      store.setFeedToken(user.id, null);
      return json(res, 200, { ok: true });
    }

    if (route === 'POST /api/notify/test') {
      if (!ctx.bot) throw new HttpError(503, 'The server has no Telegram bot');
      try {
        await ctx.bot.send(user.id, '✅ Alerts are on. They’ll arrive here.', { app: true });
        store.setChatOk(user.id, true);
        return json(res, 200, { ok: true });
      } catch (e) {
        if (e instanceof TelegramError && (e.code === 403 || e.code === 400)) {
          store.setChatOk(user.id, false);
          return json(res, 200, { ok: false });
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
        return json(res, 200, { ok: true });
      } catch (e) {
        if (e instanceof TelegramError && e.code === 403) store.setChatOk(user.id, false);
        throw new HttpError(502, 'Couldn’t send the file');
      }
    }

    throw new HttpError(404, 'Not found');
  }

  const loadFile = async (file: string): Promise<StaticFile | null> => {
    if (files.has(file)) return files.get(file)!;
    let entry: StaticFile | null = null;
    try {
      const st = await fsp.stat(file);
      if (st.isFile()) {
        const body = await fsp.readFile(file);
        const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
        const compressible = /^(text\/|application\/(json|manifest)|image\/svg)/.test(type) && body.length > 1024;
        entry = { body, gz: compressible ? gzipSync(body) : null, type, etag: `"${createHash('sha1').update(body).digest('hex').slice(0, 20)}"` };
      }
    } catch {
      entry = null;
    }
    // Built files don't change while the server runs; a deploy restarts it.
    files.set(file, entry);
    return entry;
  };

  async function serveStatic(req: IncomingMessage, res: ServerResponse, p: string) {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
    let rel: string;
    try {
      rel = decodeURIComponent(p);
    } catch {
      throw new HttpError(400, 'Bad path');
    }
    if (rel.includes('\0')) throw new HttpError(400, 'Bad path');
    let file = path.join(root, path.normalize(rel));
    if (file !== root && !file.startsWith(root + path.sep)) throw new HttpError(404, 'Not found');
    if (rel.endsWith('/')) file = path.join(file, 'index.html');
    let entry = await loadFile(file);
    if (!entry) {
      if (path.extname(rel)) throw new HttpError(404, 'Not found');
      file = path.join(root, 'index.html');
      entry = await loadFile(file);
      if (!entry) throw new HttpError(404, 'The app isn’t built yet: run npm run build');
    }
    const isHtml = entry.type.startsWith('text/html');
    const headers: Record<string, string> = {
      'Content-Type': entry.type,
      ETag: entry.etag,
      Vary: 'Accept-Encoding',
      'Cache-Control': rel.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : isHtml ? 'no-cache' : 'public, max-age=3600',
    };
    if (isHtml) headers['Content-Security-Policy'] = CSP;
    if (req.headers['if-none-match'] === entry.etag) {
      res.writeHead(304, headers);
      return res.end();
    }
    const gz = entry.gz && /\bgzip\b/.test(String(req.headers['accept-encoding'] ?? ''));
    if (gz) headers['Content-Encoding'] = 'gzip';
    const body = gz ? entry.gz! : entry.body;
    headers['Content-Length'] = String(body.length);
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  return http.createServer((req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Sign-in links and feed links are secrets: never pass them on as a referrer.
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (cfg.appUrl?.startsWith('https://')) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
    const p = (req.url ?? '/').split('?')[0];
    const isApi = p === '/api' || p.startsWith('/api/');
    (isApi ? api(req, res, p) : serveStatic(req, res, p)).catch((e: unknown) => {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error('Request failed:', (e as Error).message);
      const message = e instanceof HttpError ? e.message : 'Something went wrong';
      if (res.headersSent) return res.end();
      if (isApi) json(res, status, { error: message });
      else {
        res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(message);
      }
    });
  });
}

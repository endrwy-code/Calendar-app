/**
 * Daybook on Cloudflare Workers.
 *
 *  - The app's files (dist/) are served by Workers Static Assets, with the
 *    headers from dist/_headers. They never reach this code.
 *  - /api/* comes here, and goes on to one Durable Object ("Daybook"). It
 *    keeps everything in its own SQLite database and runs the same API, bot
 *    and alerts as the Node server (server/), so the two behave alike.
 *  - Telegram sends the bot's updates to /api/telegram (a webhook, checked by
 *    a secret), because there's no long-running process to poll for them.
 *  - A Cron Trigger wakes the Durable Object once a minute to send alerts
 *    and the morning summary, and to tidy up now and then.
 *
 * Settings are the Worker's variables and secrets (see DEPLOY.md, Option D).
 */
import { DurableObject } from 'cloudflare:workers';
import { createApi } from '../server/api';
import { Bot, webhookSecret, type Webhook } from '../server/bot';
import { PlanReader } from '../server/claude';
import { loadConfig, type Config } from '../server/config';
import { Notifier } from '../server/notify';
import type { Row, Sql, SqlValue } from '../server/sql';
import { Store } from '../server/store';
import { BotApi } from '../server/telegram';

export interface Env {
  DAYBOOK: DurableObjectNamespace<Daybook>;
  ASSETS: Fetcher;
  BOT_TOKEN?: string;
  APP_URL?: string;
  ALLOWED_USERS?: string;
  DEFAULT_TZ?: string;
  ANTHROPIC_API_KEY?: string;
  AI_MODEL?: string;
}

/** The client's address, as Cloudflare saw it. Set by the Worker on every request, so it can't be faked. */
const CLIENT_IP = 'x-daybook-client-ip';
/** How often the Cron Trigger also tidies up (old alert marks, tombstones, sessions, drafts) */
const PRUNE_EVERY_MS = 6 * 3600000;

/** The Store's database: the Durable Object's own SQLite storage. */
class DurableSql implements Sql {
  constructor(private storage: DurableObjectStorage) {}

  get(sql: string, ...params: SqlValue[]): Row | undefined {
    return this.storage.sql.exec(sql, ...params).toArray()[0] as Row | undefined;
  }

  all(sql: string, ...params: SqlValue[]): Row[] {
    return this.storage.sql.exec(sql, ...params).toArray() as Row[];
  }

  run(sql: string, ...params: SqlValue[]): void {
    this.storage.sql.exec(sql, ...params).toArray();
  }

  tx<T>(fn: () => T): T {
    return this.storage.transactionSync(fn);
  }
}

/** Only the Worker's text variables and secrets, not its bindings. */
function vars(env: Env): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) if (typeof v === 'string') out[k] = v;
  return out;
}

/**
 * One Durable Object holds everyone's calendar (a Daybook is for one person
 * or a handful). It handles one thing at a time, like the Node server's
 * single process, so the Store stays simple and synchronous.
 */
export class Daybook extends DurableObject<Env> {
  private cfg: Config;
  private store: Store;
  private bot: Bot | null = null;
  private notifier: Notifier | null = null;
  private api: ((req: Request, ip: string) => Promise<Response>) | null = null;
  private secret: string | null = null;
  private ready: Promise<void> | null = null;
  private botReady = false;
  /** When to try connecting the bot again after a failure (a wrong token, Telegram down); doubles up to an hour */
  private botRetryAt = 0;
  private botRetryMs = 60000;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // No polling here (Telegram uses the webhook), and the client address comes from the Worker.
    this.cfg = loadConfig({ ...vars(env), BOT_POLLING: '0', TRUST_PROXY: '0' });
    this.store = new Store(new DurableSql(ctx.storage));
    // Without APP_URL, use the address the app was first opened at (see learnAppUrl).
    this.cfg.appUrl ??= this.store.getMeta('app_url');
    if (this.cfg.botToken) {
      const reader = this.cfg.anthropicKey
        ? new PlanReader({ apiKey: this.cfg.anthropicKey, model: this.cfg.aiModel, baseUrl: this.cfg.anthropicBaseUrl ?? undefined })
        : null;
      this.bot = new Bot(new BotApi(this.cfg.botToken), this.store, this.cfg, reader);
      this.bot.username = this.store.getMeta('bot_username');
      this.notifier = new Notifier(this.store, this.bot, this.cfg);
    }
  }

  /** Work that needs a moment (the webhook secret is a hash), done once per wake-up. */
  private init(): Promise<void> {
    this.ready ??= (async () => {
      if (this.cfg.botToken) this.secret = await webhookSecret(this.cfg.botToken);
      this.api = createApi({ store: this.store, cfg: this.cfg, bot: this.bot, webhookSecret: this.secret });
    })();
    return this.ready;
  }

  /**
   * With no APP_URL set, the first https address the app is opened at
   * becomes the bot's link and webhook address. Requests only reach this
   * Worker through its own routes (workers.dev or your domain), so the
   * address can be trusted. Set APP_URL to choose another (a custom domain).
   */
  private learnAppUrl(url: URL) {
    if (this.cfg.appUrl || url.protocol !== 'https:') return;
    this.cfg.appUrl = url.origin;
    this.store.setMeta('app_url', url.origin);
    console.log(`Using ${url.origin} as this Daybook’s address (set APP_URL to change it).`);
  }

  private webhook(): Webhook | null {
    if (!this.secret || !this.cfg.appUrl?.startsWith('https://')) return null;
    return { url: `${this.cfg.appUrl}/api/telegram`, secret: this.secret };
  }

  /** Connects the bot to Telegram (commands, menu button, webhook) if it isn't already. */
  private async setupBot() {
    const hook = this.webhook();
    if (!this.bot || !hook || Date.now() < this.botRetryAt) return;
    this.botReady = await this.bot.ensureWebhook(hook).catch((e) => {
      console.error('Telegram:', (e as Error).message);
      return false;
    });
    if (this.botReady) this.botRetryMs = 60000;
    else {
      this.botRetryAt = Date.now() + this.botRetryMs;
      this.botRetryMs = Math.min(this.botRetryMs * 2, 3600000);
    }
  }

  async fetch(req: Request): Promise<Response> {
    this.learnAppUrl(new URL(req.url));
    await this.init();
    // The first request after a deploy connects the bot, without holding up the reply.
    if (this.bot && !this.botReady) this.ctx.waitUntil(this.setupBot());
    return this.api!(req, req.headers.get(CLIENT_IP) ?? 'unknown');
  }

  /** Called by the Cron Trigger once a minute. */
  async tick(): Promise<void> {
    await this.init();
    await this.setupBot();
    // Alerts only need the bot to send messages, so they go out even if the webhook isn't set yet.
    await this.notifier?.tick().catch((e) => console.error('Alerts:', (e as Error).message));
    const now = Date.now();
    if (now - Number(this.store.getMeta('pruned_at') ?? 0) > PRUNE_EVERY_MS) {
      this.store.prune(now);
      this.store.setMeta('pruned_at', String(now));
    }
  }
}

/** The largest request body passed on (a full sync is allowed up to 12 MB) */
const MAX_BODY_BYTES = 13 * 1024 * 1024;

/** The whole body, or null if it's larger than `limit` bytes (stops reading as soon as it is). */
async function readCapped(req: Request, limit: number): Promise<ArrayBuffer | null> {
  if (Number(req.headers.get('content-length')) > limit) return null;
  if (!req.body) return new ArrayBuffer(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out.buffer;
}

/** Everyone shares one Daybook object. */
const daybook = (env: Env) => env.DAYBOOK.get(env.DAYBOOK.idFromName('daybook'));

export default {
  async fetch(req, env): Promise<Response> {
    const { pathname } = new URL(req.url);
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      const headers = new Headers(req.headers);
      headers.set(CLIENT_IP, req.headers.get('cf-connecting-ip') ?? 'unknown');
      // Passed on whole rather than streamed, so a request the API turns down
      // early doesn't leave a half-read stream behind. The API checks each
      // route's own limit; this just stops anything far bigger at the door.
      let body: ArrayBuffer | null = null;
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        body = await readCapped(req, MAX_BODY_BYTES);
        if (!body) return Response.json({ error: 'Too large' }, { status: 413 });
      }
      return daybook(env).fetch(new Request(req.url, { method: req.method, headers, body }));
    }
    // Only reached if the assets settings change; the app's files are normally served before the Worker runs.
    return env.ASSETS.fetch(req);
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(daybook(env).tick());
  },
} satisfies ExportedHandler<Env>;

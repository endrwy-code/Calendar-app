import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isValidTimeZone } from '../src/lib/tz';

export interface Config {
  port: number;
  /** Where the SQLite database and its backups live */
  dataDir: string;
  /** The built app (dist/) */
  staticDir: string;
  /** From @BotFather. Without it there's no sign-in and no alerts. */
  botToken: string | null;
  /** Public https address of this server, e.g. https://daybook.example.com */
  appUrl: string | null;
  /** Telegram user ids or @usernames allowed to use this server; null = anyone */
  allowed: Set<string> | null;
  /** Time zone for users whose devices haven't reported one yet */
  defaultTz: string;
  /** Behind a reverse proxy (Caddy, Railway…): read the client address from X-Forwarded-For */
  trustProxy: boolean;
  /** Fetch Telegram updates (commands, messages). Off for tests. */
  polling: boolean;
}

const here = path.dirname(fileURLToPath(import.meta.url));

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const list = (env.ALLOWED_USERS ?? '')
    .split(/[\s,]+/)
    .map((s) => s.trim().replace(/^@/, '').toLowerCase())
    .filter(Boolean);
  const appUrl = (env.APP_URL ?? '').trim().replace(/\/+$/, '') || null;
  const tz = env.DEFAULT_TZ?.trim();
  return {
    port: Number(env.PORT) || 8080,
    dataDir: path.resolve(env.DATA_DIR || 'data'),
    staticDir: path.resolve(env.STATIC_DIR || path.join(here, '..', 'dist')),
    botToken: env.BOT_TOKEN?.trim() || null,
    appUrl,
    allowed: list.length ? new Set(list) : null,
    defaultTz: tz && isValidTimeZone(tz) ? tz : 'UTC',
    trustProxy: env.TRUST_PROXY !== '0',
    polling: env.BOT_POLLING !== '0',
  };
}

export function isAllowed(cfg: Config, user: { id: number; username?: string | null }): boolean {
  if (!cfg.allowed) return true;
  return cfg.allowed.has(String(user.id)) || (!!user.username && cfg.allowed.has(user.username.toLowerCase()));
}

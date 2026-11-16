import { isValidTimeZone } from '../src/lib/tz';

/** Settings come from environment variables (Node) or the Worker's variables and secrets (Cloudflare). */
export type Env = Record<string, string | undefined>;

export interface Config {
  /** Node only: the port to listen on */
  port: number;
  /** Node only: where the SQLite database and its backups live */
  dataDir: string;
  /** Node only: the built app (dist/); null = next to the server bundle */
  staticDir: string | null;
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
  /** Anthropic API key: lets Claude read plans from forwarded messages. null = off. */
  anthropicKey: string | null;
  /** Claude model for reading plans */
  aiModel: string;
  /** Another address for the Messages API (tests, a proxy); null = Anthropic's */
  anthropicBaseUrl: string | null;
}

export function loadConfig(env: Env): Config {
  const list = (env.ALLOWED_USERS ?? '')
    .split(/[\s,]+/)
    .map((s) => s.trim().replace(/^@/, '').toLowerCase())
    .filter(Boolean);
  const appUrl = (env.APP_URL ?? '').trim().replace(/\/+$/, '') || null;
  const tz = env.DEFAULT_TZ?.trim();
  return {
    port: Number(env.PORT) || 8080,
    dataDir: env.DATA_DIR || 'data',
    staticDir: env.STATIC_DIR || null,
    botToken: env.BOT_TOKEN?.trim() || null,
    appUrl,
    allowed: list.length ? new Set(list) : null,
    defaultTz: tz && isValidTimeZone(tz) ? tz : 'UTC',
    trustProxy: env.TRUST_PROXY !== '0',
    polling: env.BOT_POLLING !== '0',
    anthropicKey: env.ANTHROPIC_API_KEY?.trim() || null,
    aiModel: env.AI_MODEL?.trim() || 'claude-opus-5-5',
    anthropicBaseUrl: env.ANTHROPIC_BASE_URL?.trim() || null,
  };
}

export function isAllowed(cfg: Config, user: { id: number; username?: string | null }): boolean {
  if (!cfg.allowed) return true;
  return cfg.allowed.has(String(user.id)) || (!!user.username && cfg.allowed.has(user.username.toLowerCase()));
}

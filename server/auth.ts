import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export interface TelegramUser {
  id: number;
  firstName: string;
  username: string | null;
}

/**
 * Checks the launch data Telegram gives a Mini App (WebApp.initData): it is
 * signed with a key derived from the bot token, so only Telegram can produce
 * it. Returns the user, or null if the signature is wrong or it's too old.
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function checkInitData(initData: string, botToken: string, maxAgeSec = 86400, now = Date.now()): TelegramUser | null {
  if (!initData || initData.length > 8192) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) return null;
  params.delete('hash');

  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const matches = (p: URLSearchParams) => {
    const dataCheck = [...p.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');
    const expected = createHmac('sha256', secret).update(dataCheck).digest();
    return timingSafeEqual(expected, Buffer.from(hash, 'hex'));
  };
  let ok = matches(params);
  if (!ok && params.has('signature')) {
    // Some clients sign without the newer third-party `signature` field.
    const without = new URLSearchParams(params);
    without.delete('signature');
    ok = matches(without);
  }
  if (!ok) return null;

  const authDate = Number(params.get('auth_date'));
  if (!Number.isFinite(authDate) || now / 1000 - authDate > maxAgeSec) return null;
  try {
    const u = JSON.parse(params.get('user') ?? 'null') as { id?: number; first_name?: string; username?: string } | null;
    if (!u || typeof u.id !== 'number') return null;
    return { id: u.id, firstName: u.first_name ?? '', username: u.username ?? null };
  } catch {
    return null;
  }
}

/** A random secret for sessions, sign-in links and feed links. */
export const newToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

/** Secrets are stored hashed, so a copy of the database can't be used to sign in. */
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

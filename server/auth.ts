/**
 * Sign-in checks and secrets, with the Web Crypto API only, so the same code
 * runs on Node and on Cloudflare Workers.
 */

export interface TelegramUser {
  id: number;
  firstName: string;
  username: string | null;
}

const enc = new TextEncoder();

function hmacKey(secret: string | Uint8Array<ArrayBuffer>) {
  const raw = typeof secret === 'string' ? enc.encode(secret) : secret;
  return crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

const hexToBytes = (hex: string) => Uint8Array.from(hex.match(/../g)!.map((b) => parseInt(b, 16)));
const bytesToHex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');

/**
 * Checks the launch data Telegram gives a Mini App (WebApp.initData): it is
 * signed with a key derived from the bot token, so only Telegram can produce
 * it. Returns the user, or null if the signature is wrong or it's too old.
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export async function checkInitData(initData: string, botToken: string, maxAgeSec = 86400, now = Date.now()): Promise<TelegramUser | null> {
  if (!initData || initData.length > 8192) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) return null;
  params.delete('hash');

  const secret = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey('WebAppData'), enc.encode(botToken)));
  const key = await hmacKey(secret);
  const expected = hexToBytes(hash);
  // crypto.subtle.verify compares in constant time.
  const matches = (p: URLSearchParams) => {
    const dataCheck = [...p.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');
    return crypto.subtle.verify('HMAC', key, expected, enc.encode(dataCheck));
  };
  let ok = await matches(params);
  if (!ok && params.has('signature')) {
    // Some clients sign without the newer third-party `signature` field.
    const without = new URLSearchParams(params);
    without.delete('signature');
    ok = await matches(without);
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

/** A random secret for sessions, sign-in links and feed links (base64url). */
export function newToken(bytes = 32): string {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Secrets are stored hashed, so a copy of the database can't be used to sign in. */
export async function sha256(s: string): Promise<string> {
  return bytesToHex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
}

/** Compares two secrets without leaking, through timing, how much of them matched. */
export async function sameSecret(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

/** Base64 of some bytes (for photos sent to Claude), without Node's Buffer. */
export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

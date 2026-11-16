/**
 * Security and caching headers for the app's pages, in one place. The Node
 * server sends them itself; on Cloudflare they're written into dist/_headers
 * at build time (see vite.config.ts), which Workers Static Assets applies.
 */

/** The app only loads its own files, plus Telegram's Mini App script, and may be framed by Telegram Web. */
export const CSP = [
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

/** On every response. Sign-in links and feed links are secrets: never pass them on as a referrer. */
export function baseHeaders(https: boolean): Record<string, string> {
  return {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    ...(https ? { 'Strict-Transport-Security': 'max-age=15552000' } : {}),
  };
}

/** Built files under /assets/ have a hash in their name, so they never change. */
export const IMMUTABLE = 'public, max-age=31536000, immutable';

/** The _headers file for Cloudflare (Workers Static Assets). */
export function cloudflareHeadersFile(): string {
  const block = (pattern: string, headers: Record<string, string>) =>
    [pattern, ...Object.entries(headers).map(([k, v]) => `  ${k}: ${v}`)].join('\n');
  return [
    '# Written by the build from server/headers.ts. Cloudflare applies it to the app\'s files.',
    block('/*', { ...baseHeaders(true), 'Content-Security-Policy': CSP }),
    block('/assets/*', { 'Cache-Control': IMMUTABLE }),
    '',
  ].join('\n\n');
}

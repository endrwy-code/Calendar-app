/**
 * The Node web server: serves the app itself (dist/) and passes /api requests
 * to the shared API handler (api.ts). On Cloudflare, Workers Static Assets
 * serves the app and the Worker passes /api on instead (worker/index.ts).
 */
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { createApi, HttpError, type Ctx } from './api';
import { baseHeaders, CSP, IMMUTABLE } from './headers';

export { HttpError, validateChanges, type Ctx } from './api';

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

/** Cloudflare's settings files in dist/, which aren't part of the app */
const NOT_SERVED = new Set(['/_headers', '/_redirects']);

/** Headers that describe one hop of a connection, not the request itself */
const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'proxy-connection', 'te', 'trailer']);

interface StaticFile {
  body: Buffer;
  gz: Buffer | null;
  type: string;
  etag: string;
}

const here = path.dirname(fileURLToPath(import.meta.url));

export function createApp(ctx: Ctx): http.Server {
  const { cfg } = ctx;
  const api = createApi(ctx);
  const files = new Map<string, StaticFile | null>();
  const root = path.resolve(cfg.staticDir ?? path.join(here, '..', 'dist'));
  const security = baseHeaders(!!cfg.appUrl?.startsWith('https://'));

  const clientIp = (req: IncomingMessage) => {
    const fwd = req.headers['x-forwarded-for'];
    if (cfg.trustProxy && typeof fwd === 'string') return fwd.split(',').pop()!.trim();
    return req.socket.remoteAddress ?? 'unknown';
  };

  /** The address the request was made to, as the browser saw it. */
  const origin = (req: IncomingMessage) => {
    const proto = cfg.trustProxy && req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
    const host = /^[\w.:[\]-]+$/.test(req.headers.host ?? '') ? req.headers.host : 'localhost';
    return `${proto}://${host}`;
  };

  /** Node's request, as a standard Request for the API. */
  const toRequest = (req: IncomingMessage): Request => {
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (v === undefined || HOP_BY_HOP.has(k)) continue;
      for (const x of Array.isArray(v) ? v : [v]) headers.append(k, x);
    }
    const method = req.method ?? 'GET';
    const body = method === 'GET' || method === 'HEAD' ? undefined : (Readable.toWeb(req) as ReadableStream<Uint8Array>);
    return new Request(origin(req) + (req.url ?? '/'), { method, headers, body, duplex: 'half' } as RequestInit);
  };

  const send = async (res: ServerResponse, r: Response, head: boolean) => {
    const body = head || r.body === null ? null : Buffer.from(await r.arrayBuffer());
    const headers: Record<string, string> = {};
    r.headers.forEach((v, k) => (headers[k] = v));
    if (body) headers['content-length'] = String(body.length);
    res.writeHead(r.status, headers);
    res.end(body ?? undefined);
  };

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
    if (NOT_SERVED.has(rel)) throw new HttpError(404, 'Not found');
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
      'Cache-Control': rel.startsWith('/assets/') ? IMMUTABLE : isHtml ? 'no-cache' : 'public, max-age=3600',
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
    for (const [k, v] of Object.entries(security)) res.setHeader(k, v);
    const p = (req.url ?? '/').split('?')[0];
    const isApi = p === '/api' || p.startsWith('/api/');
    const work = isApi
      ? Promise.resolve()
          .then(() => api(toRequest(req), clientIp(req)))
          .then((r) => send(res, r, req.method === 'HEAD'))
      : serveStatic(req, res, p);
    work.catch((e: unknown) => {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error('Request failed:', (e as Error).message);
      if (res.headersSent) return res.end();
      res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(e instanceof HttpError ? e.message : 'Something went wrong');
    });
  });
}

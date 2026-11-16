/**
 * The database: SQLite, through a small driver (see sql.ts), so the same code
 * runs on Node (one file on disk) and in a Cloudflare Durable Object.
 *
 * Every event, to-do, tag and the settings are stored as one JSON record per
 * user. Each write gets the next revision number, so a device can ask for
 * "everything after revision N". Deletions are kept as empty records
 * (tombstones) for a while, so every device hears about them.
 */
import type { CalEvent, CalendarCategory, Settings, Task } from '../src/types';
import { DEFAULT_SETTINGS } from '../src/lib/defaults';
import type { PlanDraft, PlanItem } from '../src/lib/plans';
import type { Row, Sql } from './sql';

export type Kind = 'event' | 'task' | 'tag' | 'settings';
export const KINDS: readonly Kind[] = ['event', 'task', 'tag', 'settings'];

export interface User {
  id: number;
  firstName: string;
  username: string | null;
  tz: string | null;
  chatOk: boolean;
  feedToken: string | null;
}

export interface Change {
  kind: Kind;
  id: string;
  /** null = deleted */
  data: unknown;
  updatedAt: number;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY,          -- Telegram user id
  first_name  TEXT NOT NULL DEFAULT '',
  username    TEXT,
  tz          TEXT,
  chat_ok     INTEGER NOT NULL DEFAULT 0,   -- the bot may message this user
  feed_token  TEXT UNIQUE,
  created_at  INTEGER NOT NULL,
  seen_at     INTEGER
)`,
  `CREATE TABLE IF NOT EXISTS records (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  id          TEXT NOT NULL,
  data        TEXT,                         -- JSON, NULL once deleted
  updated_at  INTEGER NOT NULL,
  rev         INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind, id)
)`,
  `CREATE INDEX IF NOT EXISTS records_by_rev ON records(user_id, rev)`,
  `CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  used_at     INTEGER NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS login_codes (
  code_hash   TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  INTEGER NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS sent (
  user_id     INTEGER NOT NULL,
  key         TEXT NOT NULL,
  at          INTEGER NOT NULL,
  PRIMARY KEY (user_id, key)
)`,
  `CREATE TABLE IF NOT EXISTS drafts (
  id          TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  items       TEXT NOT NULL,                -- JSON PlanItem[] (the message text itself isn't kept)
  note        TEXT,
  status      TEXT NOT NULL DEFAULT 'open', -- open | added | cancelled
  message_id  INTEGER,                      -- the bot's message showing the draft
  added       TEXT,                         -- JSON [{kind, id}] added by "Add all", for Undo
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS meta (
  key         TEXT PRIMARY KEY,
  value       TEXT
)`,
];

const SESSION_IDLE_MS = 180 * 86400000;

function toUser(r: Row | undefined): User | null {
  if (!r) return null;
  return {
    id: Number(r.id),
    firstName: String(r.first_name ?? ''),
    username: (r.username as string | null) ?? null,
    tz: (r.tz as string | null) ?? null,
    chatOk: Number(r.chat_ok) === 1,
    feedToken: (r.feed_token as string | null) ?? null,
  };
}

function toChange(r: Row): Change {
  return {
    kind: r.kind as Kind,
    id: String(r.id),
    data: r.data === null ? null : JSON.parse(String(r.data)),
    updatedAt: Number(r.updated_at),
  };
}

export class Store {
  constructor(readonly sql: Sql) {
    for (const stmt of SCHEMA) sql.run(stmt);
  }

  /* ---------- Users ---------- */

  upsertUser(u: { id: number; firstName: string; username: string | null }): User {
    const now = Date.now();
    this.sql.run(
      `INSERT INTO users (id, first_name, username, created_at, seen_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET first_name = excluded.first_name, username = excluded.username, seen_at = excluded.seen_at`,
      u.id,
      u.firstName,
      u.username,
      now,
      now,
    );
    return this.user(u.id)!;
  }

  user(id: number): User | null {
    return toUser(this.sql.get('SELECT * FROM users WHERE id = ?', id));
  }

  setTz(id: number, tz: string) {
    this.sql.run('UPDATE users SET tz = ? WHERE id = ?', tz, id);
  }

  setChatOk(id: number, ok: boolean) {
    this.sql.run('UPDATE users SET chat_ok = ? WHERE id = ?', ok ? 1 : 0, id);
  }

  setFeedToken(id: number, token: string | null) {
    this.sql.run('UPDATE users SET feed_token = ? WHERE id = ?', token, id);
  }

  userByFeedToken(token: string): User | null {
    return toUser(this.sql.get('SELECT * FROM users WHERE feed_token = ?', token));
  }

  /** Users the bot can message. */
  reachableUsers(): User[] {
    return this.sql.all('SELECT * FROM users WHERE chat_ok = 1').map((r) => toUser(r)!);
  }

  /* ---------- Sessions and sign-in codes (stored as hashes) ---------- */

  createSession(tokenHash: string, userId: number) {
    const now = Date.now();
    this.sql.run('INSERT INTO sessions (token_hash, user_id, created_at, used_at) VALUES (?, ?, ?, ?)', tokenHash, userId, now, now);
  }

  sessionUser(tokenHash: string): User | null {
    const row = this.sql.get('SELECT user_id, used_at FROM sessions WHERE token_hash = ?', tokenHash);
    if (!row) return null;
    const now = Date.now();
    if (now - Number(row.used_at) > SESSION_IDLE_MS) {
      this.deleteSession(tokenHash);
      return null;
    }
    if (now - Number(row.used_at) > 3600000) this.sql.run('UPDATE sessions SET used_at = ? WHERE token_hash = ?', now, tokenHash);
    return this.user(Number(row.user_id));
  }

  deleteSession(tokenHash: string) {
    this.sql.run('DELETE FROM sessions WHERE token_hash = ?', tokenHash);
  }

  createCode(codeHash: string, userId: number, expiresAt: number) {
    this.sql.run('INSERT INTO login_codes (code_hash, user_id, expires_at) VALUES (?, ?, ?)', codeHash, userId, expiresAt);
  }

  /** Uses up a sign-in code. Returns its user, or null if unknown or expired. */
  takeCode(codeHash: string): User | null {
    const row = this.sql.get('SELECT user_id, expires_at FROM login_codes WHERE code_hash = ?', codeHash);
    if (!row) return null;
    this.sql.run('DELETE FROM login_codes WHERE code_hash = ?', codeHash);
    return Number(row.expires_at) < Date.now() ? null : this.user(Number(row.user_id));
  }

  /* ---------- Records ---------- */

  maxRev(userId: number): number {
    const r = this.sql.get('SELECT COALESCE(MAX(rev), 0) AS rev FROM records WHERE user_id = ?', userId)!;
    return Number(r.rev);
  }

  countLive(userId: number): number {
    const r = this.sql.get('SELECT COUNT(*) AS n FROM records WHERE user_id = ? AND data IS NOT NULL', userId)!;
    return Number(r.n);
  }

  /**
   * Saves changes from a device. The newest edit of a record wins, so an older
   * copy arriving late doesn't overwrite a newer one. Returns how many were kept.
   */
  applyChanges(userId: number, changes: Change[]): number {
    const put = `INSERT INTO records (user_id, kind, id, data, updated_at, rev) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, kind, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, rev = excluded.rev`;
    return this.sql.tx(() => {
      let rev = this.maxRev(userId);
      let kept = 0;
      for (const c of changes) {
        const cur = this.sql.get('SELECT updated_at FROM records WHERE user_id = ? AND kind = ? AND id = ?', userId, c.kind, c.id);
        if (cur ? c.updatedAt <= Number(cur.updated_at) : c.data === null) continue;
        this.sql.run(put, userId, c.kind, c.id, c.data === null ? null : JSON.stringify(c.data), c.updatedAt, ++rev);
        kept++;
      }
      return kept;
    });
  }

  /** A change made on the server itself (e.g. a to-do sent to the bot). Always wins, even within the same millisecond. */
  putRecord(userId: number, kind: Kind, id: string, data: unknown) {
    const cur = this.sql.get('SELECT updated_at FROM records WHERE user_id = ? AND kind = ? AND id = ?', userId, kind, id);
    const updatedAt = Math.max(Date.now(), cur ? Number(cur.updated_at) + 1 : 0);
    this.applyChanges(userId, [{ kind, id, data, updatedAt }]);
  }

  record<T>(userId: number, kind: Kind, id: string): T | null {
    const r = this.sql.get('SELECT data FROM records WHERE user_id = ? AND kind = ? AND id = ?', userId, kind, id);
    return r?.data ? (JSON.parse(String(r.data)) as T) : null;
  }

  changesSince(userId: number, since: number): Change[] {
    return this.sql.all('SELECT kind, id, data, updated_at FROM records WHERE user_id = ? AND rev > ? ORDER BY rev', userId, since).map(toChange);
  }

  /**
   * At most `limit` changes after `since`, and the revision they bring a device
   * up to. When there are more, `rev` is the last one included, so asking again
   * from `rev` continues where this left off.
   */
  changesPage(userId: number, since: number, limit: number): { changes: Change[]; rev: number; more: boolean } {
    const rows = this.sql.all('SELECT kind, id, data, updated_at, rev FROM records WHERE user_id = ? AND rev > ? ORDER BY rev LIMIT ?', userId, since, limit + 1);
    const more = rows.length > limit;
    const page = more ? rows.slice(0, limit) : rows;
    return { changes: page.map(toChange), rev: more ? Number(page[page.length - 1].rev) : this.maxRev(userId), more };
  }

  live<T>(userId: number, kind: Kind): T[] {
    const rows = this.sql.all('SELECT data FROM records WHERE user_id = ? AND kind = ? AND data IS NOT NULL', userId, kind);
    return rows.map((r) => JSON.parse(String(r.data)) as T);
  }

  /** A user's calendar, as the app sees it. */
  userData(userId: number): { events: CalEvent[]; tasks: Task[]; calendars: CalendarCategory[]; settings: Settings } {
    const saved = this.record<Partial<Settings>>(userId, 'settings', 'main');
    return {
      events: this.live<CalEvent>(userId, 'event'),
      tasks: this.live<Task>(userId, 'task'),
      calendars: this.live<CalendarCategory>(userId, 'tag'),
      settings: { ...DEFAULT_SETTINGS, ...saved },
    };
  }

  /* ---------- Drafts of plans read from messages ---------- */

  createDraft(id: string, userId: number, items: PlanItem[], note: string | null): void {
    const now = Date.now();
    this.sql.run(
      'INSERT INTO drafts (id, user_id, items, note, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id,
      userId,
      JSON.stringify(items),
      note,
      'open',
      now,
      now,
    );
  }

  /** A user's draft (null if it isn't theirs). */
  draft(userId: number, id: string): (PlanDraft & { messageId: number | null; added: { kind: Kind; id: string }[] }) | null {
    const r = this.sql.get('SELECT * FROM drafts WHERE id = ? AND user_id = ?', id, userId);
    if (!r) return null;
    return {
      id: String(r.id),
      items: JSON.parse(String(r.items)) as PlanItem[],
      note: (r.note as string | null) ?? null,
      status: r.status as PlanDraft['status'],
      messageId: r.message_id === null ? null : Number(r.message_id),
      added: r.added ? (JSON.parse(String(r.added)) as { kind: Kind; id: string }[]) : [],
    };
  }

  draftByMessage(userId: number, messageId: number): string | null {
    const r = this.sql.get('SELECT id FROM drafts WHERE user_id = ? AND message_id = ?', userId, messageId);
    return r ? String(r.id) : null;
  }

  updateDraft(userId: number, id: string, patch: { items?: PlanItem[]; note?: string | null; status?: PlanDraft['status']; messageId?: number | null; added?: { kind: Kind; id: string }[] }) {
    const sets: string[] = ['updated_at = ?'];
    const vals: (string | number | null)[] = [Date.now()];
    if (patch.items) sets.push('items = ?') && vals.push(JSON.stringify(patch.items));
    if (patch.note !== undefined) sets.push('note = ?') && vals.push(patch.note);
    if (patch.status) sets.push('status = ?') && vals.push(patch.status);
    if (patch.messageId !== undefined) sets.push('message_id = ?') && vals.push(patch.messageId);
    if (patch.added) sets.push('added = ?') && vals.push(JSON.stringify(patch.added));
    this.sql.run(`UPDATE drafts SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`, ...vals, id, userId);
  }

  /* ---------- Alerts already sent ---------- */

  wasSent(userId: number, key: string): boolean {
    return !!this.sql.get('SELECT 1 FROM sent WHERE user_id = ? AND key = ?', userId, key);
  }

  markSent(userId: number, key: string) {
    this.sql.run('INSERT OR IGNORE INTO sent (user_id, key, at) VALUES (?, ?, ?)', userId, key, Date.now());
  }

  /** How many marks starting with `prefix` were made since `since` (e.g. Claude calls in the last hour). */
  countSentSince(userId: number, prefix: string, since: number): number {
    const r = this.sql.get('SELECT COUNT(*) AS n FROM sent WHERE user_id = ? AND key >= ? AND key < ? AND at >= ?', userId, prefix, `${prefix}\uffff`, since)!;
    return Number(r.n);
  }

  /* ---------- Housekeeping ---------- */

  getMeta(key: string): string | null {
    const r = this.sql.get('SELECT value FROM meta WHERE key = ?', key);
    return (r?.value as string | undefined) ?? null;
  }

  setMeta(key: string, value: string) {
    this.sql.run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
  }

  /** Clears out old sent-alert marks, tombstones, expired codes and idle sessions. */
  prune(now = Date.now()) {
    this.sql.run('DELETE FROM sent WHERE at < ?', now - 45 * 86400000);
    this.sql.run('DELETE FROM records WHERE data IS NULL AND updated_at < ?', now - 120 * 86400000);
    this.sql.run('DELETE FROM login_codes WHERE expires_at < ?', now);
    this.sql.run('DELETE FROM sessions WHERE used_at < ?', now - SESSION_IDLE_MS);
    this.sql.run('DELETE FROM drafts WHERE updated_at < ?', now - 14 * 86400000);
  }
}

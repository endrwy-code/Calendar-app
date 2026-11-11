/**
 * The database: one SQLite file (Node's built-in node:sqlite, no extra packages).
 *
 * Every event, to-do, tag and the settings are stored as one JSON record per
 * user. Each write gets the next revision number, so a device can ask for
 * "everything after revision N". Deletions are kept as empty records
 * (tombstones) for a while, so every device hears about them.
 */
import { DatabaseSync } from 'node:sqlite';
import type { CalEvent, CalendarCategory, Settings, Task } from '../src/types';
import { DEFAULT_SETTINGS } from '../src/lib/defaults';

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

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY,          -- Telegram user id
  first_name  TEXT NOT NULL DEFAULT '',
  username    TEXT,
  tz          TEXT,
  chat_ok     INTEGER NOT NULL DEFAULT 0,   -- the bot may message this user
  feed_token  TEXT UNIQUE,
  created_at  INTEGER NOT NULL,
  seen_at     INTEGER
);
CREATE TABLE IF NOT EXISTS records (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  id          TEXT NOT NULL,
  data        TEXT,                         -- JSON; NULL once deleted
  updated_at  INTEGER NOT NULL,
  rev         INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind, id)
);
CREATE INDEX IF NOT EXISTS records_by_rev ON records(user_id, rev);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  used_at     INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS login_codes (
  code_hash   TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sent (
  user_id     INTEGER NOT NULL,
  key         TEXT NOT NULL,
  at          INTEGER NOT NULL,
  PRIMARY KEY (user_id, key)
);
CREATE TABLE IF NOT EXISTS meta (
  key         TEXT PRIMARY KEY,
  value       TEXT
);
`;

const SESSION_IDLE_MS = 180 * 86400000;

type Row = Record<string, unknown>;

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

export class Store {
  readonly db: DatabaseSync;

  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    this.db.exec(SCHEMA);
  }

  close() {
    this.db.close();
  }

  /** Runs `fn` in one transaction. */
  tx<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const out = fn();
      this.db.exec('COMMIT');
      return out;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  /* ---------- Users ---------- */

  upsertUser(u: { id: number; firstName: string; username: string | null }): User {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO users (id, first_name, username, created_at, seen_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET first_name = excluded.first_name, username = excluded.username, seen_at = excluded.seen_at`,
      )
      .run(u.id, u.firstName, u.username, now, now);
    return this.user(u.id)!;
  }

  user(id: number): User | null {
    return toUser(this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Row | undefined);
  }

  setTz(id: number, tz: string) {
    this.db.prepare('UPDATE users SET tz = ? WHERE id = ?').run(tz, id);
  }

  setChatOk(id: number, ok: boolean) {
    this.db.prepare('UPDATE users SET chat_ok = ? WHERE id = ?').run(ok ? 1 : 0, id);
  }

  setFeedToken(id: number, token: string | null) {
    this.db.prepare('UPDATE users SET feed_token = ? WHERE id = ?').run(token, id);
  }

  userByFeedToken(token: string): User | null {
    return toUser(this.db.prepare('SELECT * FROM users WHERE feed_token = ?').get(token) as Row | undefined);
  }

  /** Users the bot can message. */
  reachableUsers(): User[] {
    return (this.db.prepare('SELECT * FROM users WHERE chat_ok = 1').all() as Row[]).map((r) => toUser(r)!);
  }

  /* ---------- Sessions and sign-in codes (stored as hashes) ---------- */

  createSession(tokenHash: string, userId: number) {
    const now = Date.now();
    this.db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, used_at) VALUES (?, ?, ?, ?)').run(tokenHash, userId, now, now);
  }

  sessionUser(tokenHash: string): User | null {
    const row = this.db.prepare('SELECT user_id, used_at FROM sessions WHERE token_hash = ?').get(tokenHash) as Row | undefined;
    if (!row) return null;
    const now = Date.now();
    if (now - Number(row.used_at) > SESSION_IDLE_MS) {
      this.deleteSession(tokenHash);
      return null;
    }
    if (now - Number(row.used_at) > 3600000) this.db.prepare('UPDATE sessions SET used_at = ? WHERE token_hash = ?').run(now, tokenHash);
    return this.user(Number(row.user_id));
  }

  deleteSession(tokenHash: string) {
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
  }

  createCode(codeHash: string, userId: number, expiresAt: number) {
    this.db.prepare('INSERT INTO login_codes (code_hash, user_id, expires_at) VALUES (?, ?, ?)').run(codeHash, userId, expiresAt);
  }

  /** Uses up a sign-in code. Returns its user, or null if unknown or expired. */
  takeCode(codeHash: string): User | null {
    const row = this.db.prepare('SELECT user_id, expires_at FROM login_codes WHERE code_hash = ?').get(codeHash) as Row | undefined;
    if (!row) return null;
    this.db.prepare('DELETE FROM login_codes WHERE code_hash = ?').run(codeHash);
    return Number(row.expires_at) < Date.now() ? null : this.user(Number(row.user_id));
  }

  /* ---------- Records ---------- */

  maxRev(userId: number): number {
    const r = this.db.prepare('SELECT COALESCE(MAX(rev), 0) AS rev FROM records WHERE user_id = ?').get(userId) as Row;
    return Number(r.rev);
  }

  countLive(userId: number): number {
    const r = this.db.prepare('SELECT COUNT(*) AS n FROM records WHERE user_id = ? AND data IS NOT NULL').get(userId) as Row;
    return Number(r.n);
  }

  /**
   * Saves changes from a device. The newest edit of a record wins, so an older
   * copy arriving late doesn't overwrite a newer one. Returns how many were kept.
   */
  applyChanges(userId: number, changes: Change[]): number {
    const get = this.db.prepare('SELECT updated_at FROM records WHERE user_id = ? AND kind = ? AND id = ?');
    const put = this.db.prepare(
      `INSERT INTO records (user_id, kind, id, data, updated_at, rev) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, kind, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, rev = excluded.rev`,
    );
    return this.tx(() => {
      let rev = this.maxRev(userId);
      let kept = 0;
      for (const c of changes) {
        const cur = get.get(userId, c.kind, c.id) as Row | undefined;
        if (cur ? c.updatedAt <= Number(cur.updated_at) : c.data === null) continue;
        put.run(userId, c.kind, c.id, c.data === null ? null : JSON.stringify(c.data), c.updatedAt, ++rev);
        kept++;
      }
      return kept;
    });
  }

  /** A change made on the server itself (e.g. a to-do sent to the bot). Always wins. */
  putRecord(userId: number, kind: Kind, id: string, data: unknown) {
    this.applyChanges(userId, [{ kind, id, data, updatedAt: Date.now() }]);
  }

  record<T>(userId: number, kind: Kind, id: string): T | null {
    const r = this.db.prepare('SELECT data FROM records WHERE user_id = ? AND kind = ? AND id = ?').get(userId, kind, id) as Row | undefined;
    return r?.data ? (JSON.parse(String(r.data)) as T) : null;
  }

  changesSince(userId: number, since: number): Change[] {
    const rows = this.db.prepare('SELECT kind, id, data, updated_at FROM records WHERE user_id = ? AND rev > ? ORDER BY rev').all(userId, since) as Row[];
    return rows.map((r) => ({
      kind: r.kind as Kind,
      id: String(r.id),
      data: r.data === null ? null : JSON.parse(String(r.data)),
      updatedAt: Number(r.updated_at),
    }));
  }

  live<T>(userId: number, kind: Kind): T[] {
    const rows = this.db.prepare('SELECT data FROM records WHERE user_id = ? AND kind = ? AND data IS NOT NULL').all(userId, kind) as Row[];
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

  /* ---------- Alerts already sent ---------- */

  wasSent(userId: number, key: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM sent WHERE user_id = ? AND key = ?').get(userId, key);
  }

  markSent(userId: number, key: string) {
    this.db.prepare('INSERT OR IGNORE INTO sent (user_id, key, at) VALUES (?, ?, ?)').run(userId, key, Date.now());
  }

  /* ---------- Housekeeping ---------- */

  getMeta(key: string): string | null {
    const r = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as Row | undefined;
    return (r?.value as string | undefined) ?? null;
  }

  setMeta(key: string, value: string) {
    this.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
  }

  /** Clears out old sent-alert marks, tombstones, expired codes and idle sessions. */
  prune(now = Date.now()) {
    this.db.prepare('DELETE FROM sent WHERE at < ?').run(now - 45 * 86400000);
    this.db.prepare('DELETE FROM records WHERE data IS NULL AND updated_at < ?').run(now - 120 * 86400000);
    this.db.prepare('DELETE FROM login_codes WHERE expires_at < ?').run(now);
    this.db.prepare('DELETE FROM sessions WHERE used_at < ?').run(now - SESSION_IDLE_MS);
  }

  /** Writes a consistent copy of the database to `file`. */
  backupTo(file: string) {
    this.db.prepare('VACUUM INTO ?').run(file);
  }
}

/** The Store's database on Node: one SQLite file through the built-in node:sqlite. */
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import type { Row, Sql, SqlValue } from './sql';

export class NodeSql implements Sql {
  readonly db: DatabaseSync;
  private statements = new Map<string, StatementSync>();

  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  }

  private stmt(sql: string): StatementSync {
    let s = this.statements.get(sql);
    if (!s) {
      s = this.db.prepare(sql);
      this.statements.set(sql, s);
    }
    return s;
  }

  get(sql: string, ...params: SqlValue[]): Row | undefined {
    return this.stmt(sql).get(...params) as Row | undefined;
  }

  all(sql: string, ...params: SqlValue[]): Row[] {
    return this.stmt(sql).all(...params) as Row[];
  }

  run(sql: string, ...params: SqlValue[]): void {
    this.stmt(sql).run(...params);
  }

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

  /** Writes a consistent copy of the database to `file`. */
  backupTo(file: string) {
    this.db.prepare('VACUUM INTO ?').run(file);
  }

  close() {
    this.db.close();
  }
}

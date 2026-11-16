/**
 * The few things the Store needs from a SQLite database. Two drivers provide
 * them: Node's built-in node:sqlite (server/sqlite-node.ts, for Docker, a VPS
 * and the tests) and a Cloudflare Durable Object's own SQLite storage
 * (worker/index.ts). Both are synchronous, so the Store is too.
 */

export type SqlValue = string | number | null;
export type Row = Record<string, unknown>;

export interface Sql {
  /** The first row, or undefined */
  get(sql: string, ...params: SqlValue[]): Row | undefined;
  all(sql: string, ...params: SqlValue[]): Row[];
  run(sql: string, ...params: SqlValue[]): void;
  /** Runs `fn` in one transaction: all of its writes happen, or none do. */
  tx<T>(fn: () => T): T;
}

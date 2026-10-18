import Database from 'better-sqlite3';
import { DumpDataset, type SqlReader } from '@courmap/core';
import { createClient, type CourmapClient } from './client.js';

/** A SqlReader over better-sqlite3, with statements prepared once. */
export function sqliteReader(db: Database.Database): SqlReader {
  const stmts = new Map<string, Database.Statement>();
  const prep = (sql: string) => {
    let s = stmts.get(sql);
    if (!s) stmts.set(sql, (s = db.prepare(sql)));
    return s;
  };
  return {
    all: <T>(sql: string, params: readonly unknown[] = []) => prep(sql).all(...params) as T[],
    get: <T>(sql: string, params: readonly unknown[] = []) => prep(sql).get(...params) as T | undefined,
  };
}

/** A Dataset reading a compiled SQLite dump, opened read-only. */
export class SqliteDataset extends DumpDataset {
  private readonly db: Database.Database;

  constructor(dumpPath: string) {
    const db = new Database(dumpPath, { readonly: true, fileMustExist: true });
    try {
      super(sqliteReader(db), dumpPath);
    } catch (err) {
      db.close();
      throw err;
    }
    this.db = db;
  }

  close(): void {
    this.db.close();
  }
}

/** A client over a downloaded SQLite dump. No network access at all. */
export function createOfflineClient(dumpPath: string): CourmapClient {
  const dataset = new SqliteDataset(dumpPath);
  return createClient(dataset, () => dataset.close());
}

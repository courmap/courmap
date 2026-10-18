import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import Database from 'better-sqlite3';
import { DumpDataset, type SqlReader } from '@courmap/core';

export interface ReleaseAssets {
  dataVersion: string;
  /** File names in outDir, in the order they are listed in SHA256SUMS. */
  files: string[];
  sha256: Record<string, string>;
}

function reader(db: Database.Database): SqlReader {
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

/** gzip with a zeroed timestamp and no file name, so the same input gives the same bytes. */
const gzip = (b: Buffer) => {
  const out = gzipSync(b, { level: 9 });
  out.writeUInt32LE(0, 4); // MTIME
  return out;
};

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

/**
 * Builds the GitHub release assets for one data version (docs/SPEC.md, "Release"):
 *   courmap-<v>.sqlite.gz   the SQLite dump
 *   courmap-<v>.json.gz     the same data as JSON: meta, works, sequences, groups
 *   LICENSE                 the data license (ODbL 1.0 + DbCL 1.0)
 *   ATTRIBUTION.md
 *   SHA256SUMS              sha256sum -c compatible, covering every file above
 * Output is deterministic for a given dump.
 */
export async function buildAssets(dumpPath: string, outDir: string, repoRoot: string): Promise<ReleaseAssets> {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  const db = new Database(dumpPath, { readonly: true, fileMustExist: true });
  let dataVersion: string;
  let json: Buffer;
  try {
    const ds = new DumpDataset(reader(db), dumpPath);
    const meta = await ds.meta();
    dataVersion = meta.data_version;
    const works = [];
    for (const id of ds.listWorkIds()) works.push(await ds.getWork(id));
    const sequences = [];
    for (const id of ds.listSequenceIds()) sequences.push(await ds.getSequence(id));
    json = Buffer.from(JSON.stringify({ meta, works, sequences, groups: await ds.groups() }), 'utf8');
  } finally {
    db.close();
  }
  const base = `courmap-${dataVersion}`;
  const files: string[] = [];
  const add = async (name: string, body: Buffer) => {
    await writeFile(path.join(outDir, name), body);
    files.push(name);
  };
  await add(`${base}.sqlite.gz`, gzip(await readFile(dumpPath)));
  await add(`${base}.json.gz`, gzip(json));
  await copyFile(path.join(repoRoot, 'DATA_LICENSE'), path.join(outDir, 'LICENSE'));
  files.push('LICENSE');
  await copyFile(path.join(repoRoot, 'ATTRIBUTION.md'), path.join(outDir, 'ATTRIBUTION.md'));
  files.push('ATTRIBUTION.md');

  const sums: Record<string, string> = {};
  for (const f of files) sums[f] = sha256(await readFile(path.join(outDir, f)));
  await writeFile(path.join(outDir, 'SHA256SUMS'), files.map((f) => `${sums[f]}  ${f}\n`).join(''));
  return { dataVersion, files: [...files, 'SHA256SUMS'], sha256: sums };
}

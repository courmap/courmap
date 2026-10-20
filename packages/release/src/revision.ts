import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import Database from 'better-sqlite3';
import { DumpDataset, type SqlReader } from '@courmap/core';

/**
 * Revision releases (decided by Xwolv, 2026-10-20). A data version is the ISO week (2026.43). When the
 * data compiled from main differs from the latest release of the same week, the next release is a
 * revision of it: 2026.43.1, then 2026.43.2. The tag is data-<version>; a new week starts again at
 * its bare number.
 */

/** The revision of a release tag within a week: 0 for data-2026.43, 2 for data-2026.43.2, null for any other week. */
export function revisionOf(tag: string, base: string): number | null {
  const prefix = `data-${base}`;
  if (tag === prefix) return 0;
  const m = new RegExp(`^${prefix.replace(/\./g, '\\.')}\\.(\\d+)$`).exec(tag);
  return m ? Number(m[1]) : null;
}

/** The newest release of the week, by revision, or null when the week has none yet. */
export function latestOfWeek(tags: readonly string[], base: string): { tag: string; revision: number } | null {
  let best: { tag: string; revision: number } | null = null;
  for (const tag of tags) {
    const revision = revisionOf(tag, base);
    if (revision !== null && (best === null || revision > best.revision)) best = { tag, revision };
  }
  return best;
}

/** The version to publish: the bare week for a first release, the latest one again when nothing changed, else the next revision. */
export function nextVersion(base: string, tags: readonly string[], unchanged: boolean): { version: string; changed: boolean } {
  const latest = latestOfWeek(tags, base);
  if (latest === null) return { version: base, changed: true };
  if (unchanged) return { version: latest.tag.slice('data-'.length), changed: false };
  return { version: `${base}.${latest.revision + 1}`, changed: true };
}

function reader(db: Database.Database): SqlReader {
  return {
    all: <T>(sql: string, params: readonly unknown[] = []) => db.prepare(sql).all(...params) as T[],
    get: <T>(sql: string, params: readonly unknown[] = []) => db.prepare(sql).get(...params) as T | undefined,
  };
}

/** The data in a dump, without its meta: what two releases of the same week are compared by. */
export async function dumpData(dumpPath: string): Promise<{ dataVersion: string; data: string }> {
  const db = new Database(dumpPath, { readonly: true, fileMustExist: true });
  try {
    const ds = new DumpDataset(reader(db), dumpPath);
    const meta = await ds.meta();
    const works = [];
    for (const id of ds.listWorkIds()) works.push(await ds.getWork(id));
    const sequences = [];
    for (const id of ds.listSequenceIds()) sequences.push(await ds.getSequence(id));
    return { dataVersion: meta.data_version, data: JSON.stringify({ works, sequences, groups: await ds.groups() }) };
  } finally {
    db.close();
  }
}

/** The data of a published release's JSON dump (courmap-<version>.json.gz), without its meta. */
export async function releasedData(jsonGzPath: string): Promise<string> {
  const j = JSON.parse(gunzipSync(await readFile(jsonGzPath)).toString('utf8')) as { works: unknown; sequences: unknown; groups: unknown };
  return JSON.stringify({ works: j.works, sequences: j.sequences, groups: j.groups });
}

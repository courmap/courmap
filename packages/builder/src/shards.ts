import { existsSync, readdirSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { DumpDataset, refShard, type Provider, type SqlReader } from '@courmap/core';

export interface ShardReport {
  files: number;
  works: number;
  sequences: number;
  groups: number;
  refShards: Partial<Record<Provider, number>>;
}

// Same adapter as the offline client's; kept local so the builder does not depend on the client.
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

/**
 * Writes the static shards (docs/SPEC.md, "Hosting") from a compiled dump into outDir, which
 * becomes the /v1/ root. Every file is exactly what the offline client returns for the same
 * record. meta.json is written last, so a reader never sees a half-written version.
 * aliases.json.zst (for resolve and search) arrives with build step 7.
 */
export async function generateShards(dumpPath: string, outDir: string): Promise<ShardReport> {
  if (existsSync(outDir) && readdirSync(outDir).length > 0 && !existsSync(path.join(outDir, 'meta.json'))) {
    throw new Error(`${outDir} is not empty and holds no meta.json; refusing to replace it`);
  }
  await rm(outDir, { recursive: true, force: true });
  const db = new Database(dumpPath, { readonly: true, fileMustExist: true });
  try {
    const ds = new DumpDataset(reader(db), dumpPath);
    // Tens of thousands of small files: write them through a bounded pool, creating each directory once.
    let files = 0;
    const dirs = new Map<string, Promise<unknown>>();
    const pending = new Set<Promise<void>>();
    const write = async (rel: string, value: unknown) => {
      const file = path.join(outDir, rel);
      const dir = path.dirname(file);
      if (!dirs.has(dir)) dirs.set(dir, mkdir(dir, { recursive: true }));
      const body = JSON.stringify(value);
      const job = dirs.get(dir)!.then(() => writeFile(file, body)).finally(() => pending.delete(job));
      pending.add(job);
      files++;
      if (pending.size >= 64) await Promise.race(pending);
    };
    const flush = () => Promise.all(pending);

    const workIds = ds.listWorkIds();
    for (const id of workIds) await write(`works/${id}.json`, await ds.getWork(id));

    const refs = new Map<string, Record<string, string[]>>();
    for (const r of ds.listRefs()) {
      const key = `${r.provider}/${refShard(r.provider, r.provider_id)}`;
      const shard = refs.get(key) ?? {};
      (shard[r.provider_id] ??= []).push(r.work_id); // listRefs is ordered, so work ids stay sorted
      refs.set(key, shard);
    }
    const refShards: ShardReport['refShards'] = {};
    for (const [key, shard] of refs) {
      await write(`refs/${key}.json`, shard);
      const provider = key.split('/')[0] as Provider;
      refShards[provider] = (refShards[provider] ?? 0) + 1;
    }

    const sequenceIds = ds.listSequenceIds();
    for (const id of sequenceIds) await write(`sequences/${id}.json`, await ds.getSequence(id));
    const groupIds = ds.listGroupIds();
    for (const id of groupIds) await write(`groups/${id}.json`, await ds.getGroup(id));

    await flush(); // every shard is on disk before meta.json
    const providerRefs: Partial<Record<Provider, number>> = {};
    for (const r of ds.listRefs()) providerRefs[r.provider] = (providerRefs[r.provider] ?? 0) + 1;
    await write('meta.json', {
      ...(await ds.meta()),
      counts: { works: workIds.length, sequences: sequenceIds.length, groups: groupIds.length, provider_refs: providerRefs },
      // Filled in by the release workflow (build step 8).
      dumps: null,
    });
    await flush();
    return { files, works: workIds.length, sequences: sequenceIds.length, groups: groupIds.length, refShards };
  } finally {
    db.close();
  }
}

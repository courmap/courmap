import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { PROJECTION_PROVIDERS, normalizeTitle, type Meta } from '@courmap/core';
import type { CheckedFiles } from './checks.js';
import type { Records } from './records.js';
import { SCHEMA_SQL, SCHEMA_VERSION, TABLES, type Table } from './sql.js';

export interface CompileOptions {
  /** Default: ISO year and week of builtAt, e.g. 2026.42. */
  dataVersion?: string;
  /** ISO timestamp. Default: now. */
  builtAt?: string;
  /** Default: $GITHUB_SHA, then `git rev-parse HEAD`, then "unknown". */
  gitSha?: string;
}

export interface CompileReport {
  meta: Meta;
  counts: Record<Table, number>;
}

/** ISO 8601 week-numbering year and week, formatted YYYY.WW. */
export function isoWeekVersion(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day); // Thursday of this week decides the year
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}.${String(week).padStart(2, '0')}`;
}

function gitSha(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return 'unknown';
  }
}

/** Row counts computed straight from the YAML, independently of the records the compiler writes. */
export function expectedCounts(files: CheckedFiles): Record<Table, number> {
  let refs = 0;
  let projections = 0;
  let aliases = 0;
  for (const { data: w } of files.works) {
    refs += Object.keys(w.ids ?? {}).length;
    for (const p of PROJECTION_PROVIDERS) projections += w.projections?.[p]?.length ?? 0;
    aliases += new Set([w.titles?.romaji, w.titles?.english, w.titles?.native, ...(w.aliases ?? [])].filter((a) => a !== undefined)).size;
  }
  return {
    meta: 4,
    works: files.works.length,
    provider_refs: refs,
    projections,
    sequences: files.sequences.length,
    sequence_members: files.sequences.reduce((n, s) => n + s.data.members.length, 0),
    aliases,
    alias_trigrams: aliases,
    groups: files.groups.length,
    group_aliases: files.groups.reduce((n, g) => n + (g.data.aliases?.length ?? 0), 0),
    group_overrides: files.groups.reduce((n, g) => n + (g.data.overrides?.length ?? 0), 0),
  };
}

/**
 * Writes validated records to a fresh SQLite file, then verifies it: row counts must match
 * the YAML, PRAGMA integrity_check must return ok and foreign keys must hold. Throws on any
 * mismatch. Nothing writes to the file after this.
 */
export function compile(records: Records, files: CheckedFiles, outPath: string, opts: CompileOptions = {}): CompileReport {
  const builtAt = opts.builtAt ?? new Date().toISOString();
  const meta: Meta = {
    data_version: opts.dataVersion ?? isoWeekVersion(new Date(builtAt)),
    git_sha: opts.gitSha ?? gitSha(),
    built_at: builtAt,
    schema_version: SCHEMA_VERSION,
  };

  mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  for (const suffix of ['', '-journal', '-wal', '-shm']) rmSync(outPath + suffix, { force: true });

  const db = new Database(outPath);
  try {
    db.pragma('journal_mode = DELETE');
    db.pragma('foreign_keys = ON');
    db.exec(SCHEMA_SQL);
    db.transaction(() => insertAll(db, records, meta))();

    const counts = Object.fromEntries(
      TABLES.map((t) => [t, (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n]),
    ) as Record<Table, number>;
    const expected = expectedCounts(files);
    const wrong = TABLES.filter((t) => counts[t] !== expected[t]);
    if (wrong.length > 0) {
      throw new Error(`row counts do not match the YAML: ${wrong.map((t) => `${t} has ${counts[t]}, expected ${expected[t]}`).join('; ')}`);
    }
    const integrity = db.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') throw new Error(`PRAGMA integrity_check failed: ${String(integrity)}`);
    const fk = db.pragma('foreign_key_check') as unknown[];
    if (fk.length > 0) throw new Error(`PRAGMA foreign_key_check found ${fk.length} violation(s): ${JSON.stringify(fk.slice(0, 5))}`);
    db.exec('ANALYZE');
    return { meta, counts };
  } finally {
    db.close();
  }
}

function insertAll(db: Database.Database, records: Records, meta: Meta): void {
  db.pragma('defer_foreign_keys = ON'); // works may reference a prequel inserted later

  const insMeta = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(meta)) insMeta.run(k, v);

  const insWork = db.prepare(`INSERT INTO works (id, type, status, year, episodes, specials, title_romaji, title_english, title_native, prequel_id)
    VALUES (@id, @type, @status, @year, @episodes, @specials, @romaji, @english, @native, @prequel)`);
  const insRef = db.prepare('INSERT INTO provider_refs (work_id, provider, provider_id, origin) VALUES (?, ?, ?, ?)');
  const insProj = db.prepare(`INSERT INTO projections (work_id, provider, kind, ep_from, ep_to, season, target_from, target_to, origin)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insAlias = db.prepare('INSERT INTO aliases (work_id, alias, normalized, origin) VALUES (?, ?, ?, ?)');
  const insTrigram = db.prepare('INSERT INTO alias_trigrams (normalized, work_id) VALUES (?, ?)');

  for (const w of records.works.values()) {
    const origin = records.origins.works.get(w.id)!;
    insWork.run({
      id: w.id,
      type: w.type,
      status: w.status,
      year: w.year,
      episodes: w.episodes,
      specials: w.specials,
      romaji: w.titles.romaji,
      english: w.titles.english,
      native: w.titles.native,
      prequel: w.prequel,
    });
    for (const [provider, id] of Object.entries(w.ids)) insRef.run(w.id, provider, id, origin);
    for (const p of PROJECTION_PROVIDERS) {
      for (const r of w.projections[p] ?? []) {
        insProj.run(w.id, p, r.kind, r.ep_from, r.ep_to, r.season, r.target_from, r.target_to, origin);
      }
    }
    for (const alias of w.aliases) {
      const normalized = normalizeTitle(alias);
      insAlias.run(w.id, alias, normalized, origin);
      insTrigram.run(normalized, w.id);
    }
  }

  const insSeq = db.prepare('INSERT INTO sequences (id, origin) VALUES (?, ?)');
  const insMember = db.prepare(
    'INSERT INTO sequence_members (sequence_id, work_id, ep_from, ep_to, absolute_start, is_default, origin) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  for (const s of records.sequences.values()) {
    const origin = records.origins.sequences.get(s.id)!;
    insSeq.run(s.id, origin);
    for (const m of s.members) {
      const isDefault = records.works.get(m.work)!.sequences.find((x) => x.sequence === s.id)!.default;
      insMember.run(s.id, m.work, m.ep_from, m.ep_to, m.absolute_start, isDefault ? 1 : 0, origin);
    }
  }

  const insGroup = db.prepare('INSERT INTO groups (id, origin) VALUES (?, ?)');
  const insGroupAlias = db.prepare('INSERT INTO group_aliases (group_id, alias, origin) VALUES (?, ?, ?)');
  const insOverride = db.prepare(
    'INSERT INTO group_overrides (group_id, work_id, numbering, offset, sequence_id, origin) VALUES (?, ?, ?, ?, ?, ?)',
  );
  for (const g of records.groups.values()) {
    const origin = records.origins.groups.get(g.id)!;
    insGroup.run(g.id, origin);
    for (const a of g.aliases) insGroupAlias.run(g.id, a, origin);
    for (const o of g.overrides) insOverride.run(g.id, o.work, o.numbering, o.offset, o.sequence, origin);
  }
}

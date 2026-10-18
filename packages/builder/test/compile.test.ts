import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { afterAll, describe, expect, it } from 'vitest';
import { compile, expectedCounts, isoWeekVersion } from '../src/compile.js';
import { validate } from '../src/validate.js';

const dataDir = fileURLToPath(new URL('../../../data/', import.meta.url));
const tmp = mkdtempSync(path.join(tmpdir(), 'courmap-compile-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('isoWeekVersion', () => {
  it.each([
    ['2026-10-17', '2026.42'],
    ['2026-01-01', '2026.01'],
    ['2027-01-01', '2026.53'],
    ['2024-12-30', '2025.01'],
  ])('%s -> %s', (date, version) => {
    expect(isoWeekVersion(new Date(`${date}T12:00:00Z`))).toBe(version);
  });
});

describe('compile data/', async () => {
  const v = await validate(dataDir);
  const out = path.join(tmp, 'courmap.sqlite');
  const report = compile(v.records!, v.checked, out, { builtAt: '2026-10-17T00:00:00.000Z', gitSha: 'test' });
  const db = new Database(out, { readonly: true });
  afterAll(() => db.close());

  it('row counts match the merged sources', () => {
    expect(report.counts).toEqual(expectedCounts(v.checked));
    expect(report.counts.works).toBe(v.checked.works.length);
  });

  it('passes PRAGMA integrity_check and foreign_key_check', () => {
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it('writes meta', () => {
    const meta = Object.fromEntries((db.prepare('SELECT key, value FROM meta').all() as { key: string; value: string }[]).map((r) => [r.key, r.value]));
    expect(meta).toEqual({ data_version: '2026.42', git_sha: 'test', built_at: '2026-10-17T00:00:00.000Z', schema_version: '2' });
  });

  it('gives every derived table an origin column, and specials no default', () => {
    const cols = (t: string) => db.pragma(`table_info(${t})`) as { name: string; notnull: number; dflt_value: unknown }[];
    for (const t of ['provider_refs', 'projections', 'aliases', 'sequences', 'sequence_members', 'groups', 'group_aliases', 'group_overrides']) {
      expect(cols(t).find((c) => c.name === 'origin'), `${t}.origin`).toMatchObject({ notnull: 1 });
    }
    expect(cols('works').find((c) => c.name === 'specials')).toMatchObject({ dflt_value: null });
    expect(db.prepare("SELECT specials FROM works WHERE id = 'sousou-no-frieren'").get()).toEqual({ specials: null });
  });

  it('reads one work through indexes, not table scans', () => {
    const plan = (sql: string) => (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all('x') as { detail: string }[]).map((r) => r.detail).join('; ');
    // Large tables: the planner must use the index. (Tiny ones may rightly prefer a scan after ANALYZE.)
    for (const sql of [
      'SELECT alias FROM aliases WHERE work_id = ? ORDER BY rowid',
      'SELECT * FROM projections WHERE work_id = ? ORDER BY provider, kind, ep_from',
      'SELECT * FROM provider_refs WHERE work_id = ?',
    ]) {
      expect(plan(sql), sql).toMatch(/USING (COVERING )?INDEX/);
    }
    const indexes = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as { name: string }[]).map((r) => r.name);
    expect(indexes).toEqual(expect.arrayContaining(['idx_proj_work', 'idx_alias_work', 'idx_members_work', 'idx_refs_work']));
  });

  it('stores open-ended ranges and seasons as written', () => {
    const row = db
      .prepare("SELECT ep_from, ep_to, season, target_from, target_to, origin FROM projections WHERE work_id = 'one-piece' AND provider = 'tvdb_show' AND season = 23")
      .get();
    expect(row).toEqual({ ep_from: 1156, ep_to: null, season: 23, target_from: 1, target_to: null, origin: 'manual' });
  });

  it('indexes normalized aliases for exact and trigram search', () => {
    const exact = db.prepare('SELECT DISTINCT work_id FROM aliases WHERE normalized = ?').all('frieren beyond journeys end');
    expect(exact).toContainEqual({ work_id: 'sousou-no-frieren' });
    const fuzzy = db.prepare('SELECT work_id FROM alias_trigrams WHERE alias_trigrams MATCH ? GROUP BY work_id').all('"shingeki no kyojin"');
    expect(fuzzy).toContainEqual({ work_id: 'shingeki-no-kyojin' });
  });
});

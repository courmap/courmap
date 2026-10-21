import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { afterAll, describe, expect, it } from 'vitest';
import { translate } from '@courmap/core';
import { compile } from '../src/compile.js';
import { MemoryDataset } from '../src/records.js';
import { validate } from '../src/validate.js';

// fixtures/derive: seven works on one TVDB show.
//   show-a  S1 E1-12    show-b  S1 E13-24    show-c  S2 E1-10    (one continuous run)
//   show-ova S0 E3 (special: not in season order)
//   show-g  S3 E1, upcoming with a placeholder count (never joins a sequence)
//   show-e  S4 E1-12    show-f  S5 E1-12     (a run, but show-e has a manual sequence)
const dir = fileURLToPath(new URL('./fixtures/derive/', import.meta.url));
const tmp = mkdtempSync(path.join(tmpdir(), 'courmap-derive-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('derived prequels and sequences (Xwolv decisions S3.6, S3.7)', async () => {
  const result = await validate(dir, { cwd: dir });
  const { derived } = result.checked;

  it('chains works sharing a TVDB show in season order, skipping specials', () => {
    expect(Object.fromEntries(derived.prequels)).toEqual({ 'show-b': 'show-a', 'show-c': 'show-b', 'show-g': 'show-c', 'show-e': 'show-g', 'show-f': 'show-e' });
  });

  it('turns a gapless run into one absolute sequence', () => {
    expect(derived.sequences).toEqual([
      {
        id: 'show-a-absolute',
        members: [
          { work: 'show-a', ep_from: 1, ep_to: 12, absolute_start: 1 },
          { work: 'show-b', ep_from: 1, ep_to: 12, absolute_start: 13 },
          { work: 'show-c', ep_from: 1, ep_to: 10, absolute_start: 25 },
        ],
      },
    ]);
  });

  it('lets a manual sequence win over a derived run', () => {
    expect(derived.skippedRuns).toBe(1); // show-e and show-f
  });

  it('answers the absolute target from a derived sequence', async () => {
    const ds = new MemoryDataset(result.records!, { data_version: 'test', git_sha: '', built_at: '', schema_version: '' });
    const r = await translate(ds, 'work:show-c', 3, ['absolute', 'tvdb_show']);
    expect(r.results).toEqual({ absolute: { sequence: 'show-a-absolute', episode: 27 }, tvdb_show: { id: '900100', season: 2, episode: 3 } });
  });

  it('compiles derived rows with origin: derived', () => {
    const out = path.join(tmp, 'derive.sqlite');
    compile(result.records!, result.checked, out, { builtAt: '2026-10-18T00:00:00.000Z', gitSha: 'test' });
    const db = new Database(out, { readonly: true });
    try {
      expect(db.prepare("SELECT prequel_id, prequel_origin FROM works WHERE id = 'show-c'").get()).toEqual({ prequel_id: 'show-b', prequel_origin: 'derived' });
      expect(db.prepare("SELECT prequel_id, prequel_origin FROM works WHERE id = 'show-a'").get()).toEqual({ prequel_id: null, prequel_origin: null });
      expect(db.prepare('SELECT id, origin FROM sequences ORDER BY id').all()).toEqual([
        { id: 'show-a-absolute', origin: 'derived' },
        { id: 'show-e-fansub', origin: 'manual' },
      ]);
    } finally {
      db.close();
    }
  });
});

// fixtures/relations: five works on one TVDB show plus seeds/relations.jsonl from the bots.
describe('AniList relations (Xwolv decision S4.1): manual over AniList over derived', async () => {
  const result = await validate(fileURLToPath(new URL('./fixtures/relations/', import.meta.url)), { cwd: fileURLToPath(new URL('./fixtures/relations/', import.meta.url)) });
  const prequelOf = (id: string) => result.records!.works.get(id)!.prequel;
  const originOf = (id: string) => result.records!.origins.works.get(id)!.prequel;

  it('validates, warning about a relation to a work that is not in the data', () => {
    expect(result.ok).toBe(true);
    expect(result.diagnostics.map((d) => [d.severity, d.code, d.line, d.message])).toEqual([
      ['warning', 'relation', 1, 'work "rel-gone" is not a known work; the relation is ignored'],
    ]);
  });

  it('keeps a manual prequel over a relation', () => {
    expect([prequelOf('rel-b'), originOf('rel-b')]).toEqual(['rel-a', 'manual']);
  });

  it('lets a relation replace the prequel TVDB order would derive', () => {
    expect([prequelOf('rel-c'), originOf('rel-c')]).toEqual(['rel-a', 'bot']);
    expect([prequelOf('rel-ova'), originOf('rel-ova')]).toEqual(['rel-a', 'bot']);
  });

  it('derives prequels only for works neither source covers', () => {
    expect([prequelOf('rel-d'), originOf('rel-d')]).toEqual(['rel-c', 'derived']);
  });

  it('applies airing lines over seeds, and manual keys over airing lines', () => {
    const seed = result.records!.works.get('rel-seed')!;
    expect([seed.episodes, seed.status]).toEqual([13, 'finished']);
    const manual = result.records!.works.get('rel-seed-manual')!;
    expect([manual.episodes, manual.status]).toEqual([25, 'airing']);
  });
});

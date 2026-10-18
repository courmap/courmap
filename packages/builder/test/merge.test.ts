import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { afterAll, describe, expect, it } from 'vitest';
import { compile } from '../src/compile.js';
import { validate } from '../src/validate.js';

// fixtures/merge has one manual file overlaid on a seed line, and one seed-only work.
const dir = fileURLToPath(new URL('./fixtures/merge/', import.meta.url));
const tmp = mkdtempSync(path.join(tmpdir(), 'courmap-merge-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('manual files over seeds (Xwolv decision 1)', async () => {
  const result = await validate(dir, { cwd: dir });
  const overlaid = result.checked.works.find((w) => w.id === 'overlaid')!;

  it('validates, with bounds problems on seed-only works as warnings', () => {
    expect(result.ok).toBe(true);
    expect(result.diagnostics.map((d) => [d.severity, d.code, d.file, d.line])).toEqual([
      ['warning', 'out-of-bounds', 'seeds/works-000.jsonl', 2],
    ]);
  });

  it('keeps what the manual file does not set, and replaces what it does', () => {
    expect(overlaid.data).toEqual({
      id: 'overlaid',
      type: 'tv', // seed
      status: 'finished', // seed
      year: 2020, // seed
      episodes: 13, // manual wins
      notes: 'Test fixture. Overrides the seed\'s episode count, TVDB ID and TVDB block, and removes its IMDb ID.',
      titles: { romaji: 'Overlaid' },
      // imdb removed by null; tvdb_show replaced; the rest from the seed
      ids: { anidb: 900001, anilist: 900011, tvdb_show: 900199, tmdb_show: 900201 },
      projections: {
        tvdb_show: [{ season: 2, episodes: '1-13' }], // manual block replaces the seed block
        tmdb_show: [{ season: 1, episodes: '1-13' }], // seed block kept
      },
      aliases: ['Seed Alias', 'Manual Alias'], // union, seed first
    });
  });

  it('tracks the origin of every part', () => {
    expect(overlaid.origins.ids).toEqual({ anidb: 'offline-db', anilist: 'offline-db', tvdb_show: 'manual', tmdb_show: 'anime-lists' });
    expect(overlaid.origins.projections).toEqual({ tvdb_show: 'manual', tmdb_show: 'anime-lists' });
    expect(Object.fromEntries(overlaid.origins.aliases)).toEqual({ Overlaid: 'offline-db', 'Seed Alias': 'offline-db', 'Manual Alias': 'offline-db' });
  });

  it('points diagnostics at whichever file supplied the part', () => {
    expect(overlaid.loc.locate(['projections', 'tvdb_show', 0, 'episodes'])).toMatchObject({ file: 'works/overlaid.yaml', line: 8 });
    expect(overlaid.loc.locate(['projections', 'tmdb_show', 0])).toEqual({ file: 'seeds/works-000.jsonl', line: 1, column: 1 });
    expect(overlaid.loc.locate(['episodes'])).toMatchObject({ file: 'works/overlaid.yaml', line: 2 });
    expect(overlaid.loc.locate(['type'])).toMatchObject({ file: 'seeds/works-000.jsonl' });
  });

  it('compiles each row with its own origin', () => {
    const out = path.join(tmp, 'merge.sqlite');
    compile(result.records!, result.checked, out, { builtAt: '2026-10-17T00:00:00.000Z', gitSha: 'test' });
    const db = new Database(out, { readonly: true });
    try {
      const refs = db.prepare("SELECT provider, provider_id, origin FROM provider_refs WHERE work_id = 'overlaid' ORDER BY provider").all();
      expect(refs).toEqual([
        { provider: 'anidb', provider_id: '900001', origin: 'offline-db' },
        { provider: 'anilist', provider_id: '900011', origin: 'offline-db' },
        { provider: 'tmdb_show', provider_id: '900201', origin: 'anime-lists' },
        { provider: 'tvdb_show', provider_id: '900199', origin: 'manual' },
      ]);
      const proj = db.prepare("SELECT provider, season, origin FROM projections WHERE work_id = 'overlaid' ORDER BY provider").all();
      expect(proj).toEqual([
        { provider: 'tmdb_show', season: 1, origin: 'anime-lists' },
        { provider: 'tvdb_show', season: 2, origin: 'manual' },
      ]);
    } finally {
      db.close();
    }
  });
});

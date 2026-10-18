import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { lookup, translate } from '@courmap/core';
import { MemoryDataset } from '../src/records.js';
import { validate } from '../src/validate.js';

// Checks the real data in data/: it validates (round trips included), and a few
// hand-verified translations from the Anime-Lists mapping lists hold.
const dataDir = fileURLToPath(new URL('../../../data/', import.meta.url));

describe('data/', async () => {
  const result = await validate([{ dir: dataDir, origin: 'manual' }]);
  const ds = new MemoryDataset(result.records!, { data_version: 'test', git_sha: '', built_at: '', schema_version: '' });

  it('passes validate, including round trips', () => {
    expect(result.diagnostics).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('split cour: Spy x Family Part 2 continues TVDB and TMDB season 1, and the absolute sequence', async () => {
    const r = await translate(ds, 'anilist:142838', 5, ['tvdb_show', 'tmdb_show', 'absolute', 'anidb']);
    expect(r.status).toBe('ok');
    expect(r.results).toEqual({
      tvdb_show: { id: '405920', season: 1, episode: 17 },
      tmdb_show: { id: '120089', season: 1, episode: 17 },
      absolute: { sequence: 'spy-x-family-absolute', episode: 17 },
      anidb: { id: '17061', episode: 5 },
    });
  });

  it('reverse: TVDB S01E13 of Spy x Family is part 2 episode 1', async () => {
    const r = await translate(ds, 'tvdb_show:405920:s1', 13, ['anilist']);
    expect(r.work).toEqual({ id: 'spy-x-family-part-2', episode: 1, kind: 'regular' });
    expect(r.results.anilist).toEqual({ id: '142838', episode: 1 });
  });

  it('long-runner: One Piece 1100 lands in different seasons on TVDB and TMDB', async () => {
    const r = await translate(ds, 'anidb:69', 1100, ['tvdb_show', 'tmdb_show']);
    expect(r.results).toEqual({
      tvdb_show: { id: '81797', season: 22, episode: 15 },
      tmdb_show: { id: '37854', season: 22, episode: 12 },
    });
  });

  it('long-runner: open-ended TVDB season 23 keeps counting, TMDB is unmapped', async () => {
    const r = await translate(ds, 'mal:21', 1170, ['tvdb_show', 'tmdb_show']);
    expect(r.status).toBe('unmapped');
    expect(r.results).toEqual({ tvdb_show: { id: '81797', season: 23, episode: 15 } });
    expect(r.unmapped).toEqual(['tmdb_show']);
  });

  it('specials: Attack on Titan S7 is TVDB S00E08', async () => {
    const r = await translate(ds, 'anidb:9541', 'S7', ['tvdb_show', 'anilist', 'anidb']);
    expect(r.results).toEqual({ tvdb_show: { id: '267440', season: 0, episode: 8 }, anidb: { id: '9541', episode: 7, kind: 'special' } });
    expect(r.unmapped).toEqual(['anilist']);
  });

  it('divergent providers: Apothecary Diaries S2E1 is TVDB S02E01 but TMDB S01E25', async () => {
    const r = await translate(ds, 'kitsu:48649', 1, ['tvdb_show', 'tmdb_show']);
    expect(r.results).toEqual({
      tvdb_show: { id: '431162', season: 2, episode: 1 },
      tmdb_show: { id: '220542', season: 1, episode: 25 },
    });
  });

  it('lookup on a shared TVDB season is ambiguous', async () => {
    await expect(lookup(ds, 'tvdb_show:405920:s1')).rejects.toMatchObject({
      code: 'ambiguous',
      candidates: ['spy-x-family', 'spy-x-family-part-2'],
    });
  });
});

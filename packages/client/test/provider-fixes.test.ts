import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { MemoryDataset, validate } from '@courmap/builder';
import { createClient, type CourmapClient } from '../src/index.js';

// Fixes made after checking the data against AniList and TMDB (2026-10-21), for the issues the bots opened.

const root = fileURLToPath(new URL('../../../', import.meta.url));

describe('data checked against the providers', () => {
  let client: CourmapClient;
  beforeAll(async () => {
    const v = await validate(`${root}data`);
    if (!v.ok || !v.records) throw new Error('data does not validate');
    client = createClient(new MemoryDataset(v.records, { data_version: 'test', git_sha: '', built_at: '', schema_version: '' }));
  }, 120_000);

  const t = async (work: string, ep: number) => (await client.translate(`work:${work}`, ep, ['tvdb_show', 'tmdb_show'])).results;

  it('New Panty & Stocking: the 13 broadcast episodes are the 30 TMDB segments, split as TVDB splits them', async () => {
    expect((await t('new-panty-stocking-with-garterbelt', 2)).tmdb_show).toMatchObject({ season: 1, episode: 2, episode_to: 3 });
    expect((await t('new-panty-stocking-with-garterbelt', 6)).tmdb_show).toMatchObject({ season: 1, episode: 13 });
    expect((await t('new-panty-stocking-with-garterbelt', 13)).tmdb_show).toMatchObject({ season: 1, episode: 29, episode_to: 30 });
  });

  it('LuluttoLilly part 2 continues TMDB season 1 after the 12 episodes of part 1', async () => {
    expect((await t('mahou-no-shimai-lulutto-lilly-part-2', 1)).tmdb_show).toMatchObject({ id: '286361', season: 1, episode: 13 });
  });

  it('Sekiro: No Defeat is a series of 8 episodes on both providers, not a one-episode movie', async () => {
    const w = await client.lookup('work:sekiro-no-defeat');
    expect(w).toMatchObject({ type: 'tv', status: 'upcoming', episodes: 8 });
    const r = await t('sekiro-no-defeat', 8);
    expect(r.tvdb_show).toMatchObject({ season: 1, episode: 8 });
    expect(r.tmdb_show).toMatchObject({ season: 1, episode: 8 });
  });
});

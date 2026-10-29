import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { MemoryDataset, validate } from '@courmap/builder';
import { createClient, type CourmapClient } from '../src/index.js';

// Issue #172: Anime-Lists sent AniDB episode 1 of some cours to season 0 and shifted the rest, so the last regular
// episode landed one short. Checked against the TheTVDB and TMDB season pages on 2026-10-29.

const root = fileURLToPath(new URL('../../../', import.meta.url));

describe('seeded TVDB ranges that were shifted by one', () => {
  let client: CourmapClient;
  beforeAll(async () => {
    const v = await validate(`${root}data`);
    if (!v.ok || !v.records) throw new Error('data does not validate');
    client = createClient(new MemoryDataset(v.records, { data_version: 'test', git_sha: '', built_at: '', schema_version: '' }));
  }, 120_000);

  const t = async (work: string, ep: number | string) => (await client.translate(`work:${work}`, ep, ['tvdb_show', 'tmdb_show'])).results;

  it('Fate/stay night UBW cour 1: episode 1 is TVDB S01E01 and episode 12 is S01E12', async () => {
    expect((await t('fate-stay-night-unlimited-blade-works', 1)).tvdb_show).toMatchObject({ id: '278626', season: 1, episode: 1 });
    expect((await t('fate-stay-night-unlimited-blade-works', 12)).tvdb_show).toMatchObject({ id: '278626', season: 1, episode: 12 });
    expect((await t('fate-stay-night-unlimited-blade-works', 12)).tmdb_show).toMatchObject({ id: '61415', season: 1, episode: 12 });
  });

  it('Fate/stay night UBW cour 2: episode 13 is TMDB S02E13 and TVDB S01E25', async () => {
    const r = await t('fate-stay-night-unlimited-blade-works-2nd-season', 13);
    expect(r.tmdb_show).toMatchObject({ id: '61415', season: 2, episode: 13 });
    expect(r.tvdb_show).toMatchObject({ id: '278626', season: 1, episode: 25 });
  });

  it('Fate/stay night UBW prologue is S00E01 on both, and Sunny Day is TMDB S00E02', async () => {
    const p = await t('fate-stay-night-unlimited-blade-works-prologue', 1);
    expect(p.tvdb_show).toMatchObject({ season: 0, episode: 1 });
    expect(p.tmdb_show).toMatchObject({ season: 0, episode: 1 });
    expect((await t('fate-stay-night-unlimited-blade-works-2nd-season-sunny-day', 1)).tmdb_show).toMatchObject({ season: 0, episode: 2 });
  });

  it('a fansub "Unlimited Blade Works - 12" release resolves to TVDB S01E12', async () => {
    const r = await client.resolve('[Group] Fate stay night - Unlimited Blade Works - 12 [1080p]');
    expect(r.status).toBe('ok');
    expect(r.match).toMatchObject({ work: 'fate-stay-night-unlimited-blade-works', episode: 12 });
    expect((await t(r.match!.work, r.match!.episode!)).tvdb_show).toMatchObject({ season: 1, episode: 12 });
  });

  it('Tales of Zestiria the X: cour 1 is S01E01-12 and the second cour continues at S01E13', async () => {
    expect((await t('tales-of-zestiria-the-cross', 1)).tvdb_show).toMatchObject({ id: '311014', season: 1, episode: 1 });
    expect((await t('tales-of-zestiria-the-cross', 12)).tvdb_show).toMatchObject({ season: 1, episode: 12 });
    expect((await t('tales-of-zestiria-the-cross-2nd-season', 1)).tvdb_show).toMatchObject({ season: 1, episode: 13 });
  });

  it('Dies Irae: the 11 TV episodes are S01E01-11', async () => {
    expect((await t('dies-irae', 1)).tvdb_show).toMatchObject({ id: '321690', season: 1, episode: 1 });
    expect((await t('dies-irae', 11)).tvdb_show).toMatchObject({ season: 1, episode: 11 });
  });

  it('High School DxD Hero: the 12 episodes are season 4 E01-12', async () => {
    expect((await t('high-school-dxd-hero', 1)).tvdb_show).toMatchObject({ id: '254653', season: 4, episode: 1 });
    expect((await t('high-school-dxd-hero', 12)).tvdb_show).toMatchObject({ season: 4, episode: 12 });
  });
});

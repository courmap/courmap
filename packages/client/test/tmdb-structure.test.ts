import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { MemoryDataset, validate } from '@courmap/builder';
import { createClient, type CourmapClient } from '../src/index.js';

// The TMDB projection checker found cours that TMDB keeps inside season 1 (the cours run on) while
// Anime-Lists maps them to a TMDB season 2 that does not exist. The overrides in data/works/ put them
// where TMDB has them; TVDB, which does have a season 2, is untouched.

const root = fileURLToPath(new URL('../../../', import.meta.url));

describe('cours that TMDB keeps in season 1', () => {
  let client: CourmapClient;
  beforeAll(async () => {
    const v = await validate(`${root}data`);
    if (!v.ok || !v.records) throw new Error('data does not validate');
    client = createClient(new MemoryDataset(v.records, { data_version: 'test', git_sha: '', built_at: '', schema_version: '' }));
  }, 120_000);

  // work, its episode 1 and 5 on TMDB season 1: the first cour's length + n
  const cases: [string, number][] = [
    ['jigokuraku-2nd-season', 13],
    ['sono-bisque-doll-wa-koi-wo-suru-season-2', 12],
    ['ore-dake-level-up-na-ken-season-2-arise-from-the-shadow', 12],
    ['watashi-no-shiawase-na-kekkon-2nd-season', 12],
    ['bye-bye-earth-2nd-season', 10],
    ['sentai-daishikkaku-2nd-season', 12],
    ['unnamed-memory-act-2', 12],
    ['kekkon-yubiwa-monogatari-ii', 12],
  ];

  it.each(cases)('%s continues TMDB season 1 after %i episodes, and keeps its TVDB season 2', async (work, before) => {
    for (const ep of [1, 5]) {
      const r = (await client.translate(`work:${work}`, ep, ['tvdb_show', 'tmdb_show'])).results;
      expect(r.tmdb_show).toMatchObject({ season: 1, episode: before + ep });
      expect(r.tvdb_show).toMatchObject({ season: 2, episode: ep });
    }
  });

  it('gives the 2016 Bonobono no TMDB mapping while the show Anime-Lists points at is the 1995 series', async () => {
    const r = await client.translate('work:bonobono-tv-2016', 600, ['tvdb_show', 'tmdb_show']);
    expect(r.results.tvdb_show).toMatchObject({ season: 2, episode: 600 });
    expect(r.results.tmdb_show).toBeUndefined();
  });
});

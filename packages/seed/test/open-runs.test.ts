import { describe, expect, it } from 'vitest';
import { parseAnimeLists } from '../src/anime-lists.js';
import type { Conflict } from '../src/conflicts.js';
import { buildEpisodeMap, emitBlock } from '../src/projections.js';
import { runSeed, type Pins } from '../src/seed.js';

// A show that is still airing has no final episode count: cedya77 records 1 (or nothing) until
// AniList knows it, and the count that is known keeps growing. Anime-Lists' default mapping covers
// every episode of the entry, so the seed must not close it at a count that is only a lower bound.

const pins: Pins = {
  offline_db: { repo: 'fixture/offline-db', tag: 'fixture', asset: 'offline-db.jsonl', sha256: 'fixture' },
  anime_lists: { repo: 'fixture/anime-lists', commit: '0'.repeat(40), path: 'anime-list.xml', sha256: 'fixture' },
};

const entry = (anidb: number, title: string, type: string, status: string, episodes: number, year = 2026) =>
  JSON.stringify({ sources: [`https://anidb.net/anime/${anidb}`, `https://anilist.co/anime/${anidb + 100}`], title, type, episodes, status, animeSeason: { year }, synonyms: [] });
const anime = (anidb: number, tvdb: number, season: number, offset = 0, extra = '') =>
  `<anime anidbid="${anidb}" tvdbid="${tvdb}" defaulttvdbseason="${season}" episodeoffset="${offset || ''}" tmdbtv="" tmdbseason="" tmdboffset="" tmdbid="" imdbid=""><name>never read</name>${extra}</anime>`;

const OFFLINE = [
  '{"$schema":"fixture","license":{"name":"ODbL-1.0 test fixture"},"repository":"fixture","lastUpdate":"2026-10-01"}',
  entry(910001, 'Ongoing Placeholder', 'TV', 'ONGOING', 1), // the placeholder 1
  entry(910002, 'Upcoming Placeholder', 'TV', 'UPCOMING', 1),
  entry(910003, 'Airing With A Count', 'TV', 'ONGOING', 22), // a real count that lags
  entry(910004, 'Cour One', 'TV', 'ONGOING', 1),
  entry(910005, 'Cour Two', 'TV', 'ONGOING', 1),
  entry(910006, 'Finished Show', 'TV', 'FINISHED', 12),
  entry(910007, 'Upcoming With A Count', 'TV', 'UPCOMING', 12),
  entry(910008, 'Ongoing Movie', 'MOVIE', 'ONGOING', 1),
  entry(910009, 'Ongoing With Sub-Mapping', 'TV', 'ONGOING', 1),
].join('\n');

const ANIME_LISTS = `<?xml version="1.0" encoding="utf-8"?><anime-list>
${anime(910001, 5101, 1)}
${anime(910002, 5102, 1)}
${anime(910003, 5103, 1)}
${anime(910004, 5104, 2)}
${anime(910005, 5104, 2, 12)}
${anime(910006, 5106, 1)}
${anime(910007, 5107, 1)}
${anime(910008, 5108, 1)}
${anime(910009, 5109, 1, 0, '<mapping-list><mapping anidbseason="1" tvdbseason="2" start="1" end="3" offset="5"/></mapping-list>')}
</anime-list>`;

async function seed() {
  const run = await runSeed({ offlineDbJsonl: OFFLINE, animeListsXml: ANIME_LISTS, pins, manual: { files: [] }, registry: [] });
  const works = [...run.files]
    .filter(([n]) => n.startsWith('works-'))
    .flatMap(([, t]) => t.split('\n').filter(Boolean).map((l) => JSON.parse(l) as { id: string; status: string; episodes: number | null; projections?: { tvdb_show?: unknown } }));
  return new Map(works.map((w) => [w.id, w]));
}

describe('a show whose episode count is not final', async () => {
  const works = await seed();

  it('reads the placeholder count of 1 on an ongoing or upcoming TV show as unknown', () => {
    expect(works.get('ongoing-placeholder')).toMatchObject({ status: 'airing', episodes: null });
    expect(works.get('upcoming-placeholder')).toMatchObject({ status: 'upcoming', episodes: null });
  });

  it('leaves the TVDB mapping open-ended instead of closing it at the placeholder', () => {
    expect(works.get('ongoing-placeholder')!.projections!.tvdb_show).toEqual([{ season: 1, episodes: '1-' }]);
    expect(works.get('upcoming-placeholder')!.projections!.tvdb_show).toEqual([{ season: 1, episodes: '1-' }]);
  });

  it('also opens the mapping of an airing show whose count is real but lags the broadcast', () => {
    expect(works.get('airing-with-a-count')).toMatchObject({ status: 'airing', episodes: 22 });
    expect(works.get('airing-with-a-count')!.projections!.tvdb_show).toEqual([{ season: 1, episodes: '1-' }]);
  });

  it('keeps a finished show, an upcoming show with a count, and a movie as they were', () => {
    expect(works.get('finished-show')!.projections!.tvdb_show).toEqual([{ season: 1, episodes: '1-12' }]);
    expect(works.get('upcoming-with-a-count')).toMatchObject({ episodes: 12 });
    expect(works.get('upcoming-with-a-count')!.projections!.tvdb_show).toEqual([{ season: 1, episodes: '1-12' }]);
    expect(works.get('ongoing-movie')).toMatchObject({ episodes: 1 });
    expect(works.get('ongoing-movie')!.projections!.tvdb_show).toEqual([{ season: 1, episodes: 1 }]);
  });

  it('never opens a range that a later cour of the same show and season would collide with', () => {
    // Both cours sit in TVDB season 2; an open first cour would run into the second (episodes 13 on).
    // ...so it runs up to where the second cour begins (offset 12), not to the placeholder count of 1.
    expect(works.get('cour-one')!.projections!.tvdb_show).toEqual([{ season: 2, episodes: '1-12' }]);
    // The last cour of the season (the largest offset) has nothing after it, so its range may stay open.
    expect(works.get('cour-two')!.projections!.tvdb_show).toEqual([{ season: 2, episodes: '1-', start: 13 }]);
  });

  it('keeps the old row where the count is unknown but the range cannot stay open', () => {
    expect(works.get('cour-one')).toMatchObject({ episodes: null });
  });

  it('does not touch a show whose default mapping has explicit sub-mappings', () => {
    expect(works.get('ongoing-with-sub-mapping')!.projections!.tvdb_show).not.toContainEqual({ season: 1, episodes: '1-' });
  });
});

describe('buildEpisodeMap with openDefault', () => {
  function block(attrs: string, episodes: number, open: boolean) {
    const conflicts: Conflict[] = [];
    const xml = `<anime-list><anime anidbid="1" ${attrs}><name>x</name></anime></anime-list>`;
    const al = parseAnimeLists(xml, conflicts).get(1)!;
    const map = buildEpisodeMap(al, 'tvdb_show', episodes, conflicts, open);
    return map ? (emitBlock(map, 'tvdb_show', episodes, new Set(), 'anidb:1', conflicts)?.block ?? null) : null;
  }

  it('with no count at all, one open row', () => {
    expect(block('tvdbid="10" defaulttvdbseason="1" episodeoffset=""', 0, true)).toEqual([{ season: 1, episodes: '1-' }]);
  });

  it('with the placeholder count, the same open row', () => {
    expect(block('tvdbid="10" defaulttvdbseason="1" episodeoffset=""', 1, true)).toEqual([{ season: 1, episodes: '1-' }]);
  });

  it('keeps the offset of a second cour: it opens at its own first episode', () => {
    expect(block('tvdbid="10" defaulttvdbseason="1" episodeoffset="12"', 1, true)).toEqual([{ season: 1, episodes: '1-', start: 13 }]);
  });

  it('is closed as before when not asked to open', () => {
    expect(block('tvdbid="10" defaulttvdbseason="1" episodeoffset=""', 12, false)).toEqual([{ season: 1, episodes: '1-12' }]);
    expect(block('tvdbid="10" defaulttvdbseason="1" episodeoffset=""', 0, false)).toBeNull();
  });
});

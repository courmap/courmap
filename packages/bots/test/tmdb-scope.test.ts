import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadState } from '../src/state.js';
import { TmdbClient, checkProjectionsDetailed, checkScope } from '../src/tmdb.js';

// Issue #172: the weekly run only looked at manual, airing and recent works, so a seeded 2015 cour that maps to a TMDB
// season that does not exist (season 1 episodes 13-25, where TMDB has a season 2) was never compared with TMDB.

describe('the projection checker scope', async () => {
  const state = await loadState(fileURLToPath(new URL('./fixtures/tmdb-scope/', import.meta.url)));
  const tmdb = () => {
    const f = (async () => new Response(JSON.stringify({ seasons: [{ season_number: 1, episode_count: 12 }, { season_number: 2, episode_count: 13 }] }))) as unknown as typeof fetch;
    return new TmdbClient('key', { fetch: f, minIntervalMs: 0 });
  };

  it('includes old seeded works that nobody edited, and leaves out works with no TMDB mapping', () => {
    expect(checkScope(state.records).sort()).toEqual(['old-show', 'old-show-2nd-season']);
    expect(state.merged.get('old-show-2nd-season')!.isManual).toBe(false);
  });

  it('flags a finished 2015 cour mapped past the end of TMDB season 1', async () => {
    const r = await checkProjectionsDetailed(state.records, checkScope(state.records), tmdb(), { now: new Date('2026-10-29T00:00:00Z') });
    expect(r.findings.map((f) => [f.work, f.summary])).toEqual([['old-show-2nd-season', 'TMDB projection disagrees with TMDB: season 1 is mapped to episode 25, TMDB lists 12']]);
  });
});

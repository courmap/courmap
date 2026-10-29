import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadState } from '../src/state.js';
import { OLDER_TRACKER_TITLE, TmdbClient, checkProjectionsDetailed, checkScope, corpusWorks, isUrgent, issuesToClose, mappingText, olderTrackerBody } from '../src/tmdb.js';

// Every work with a TMDB projection is checked, so old seeded mismatches would swamp the issue list. Works that affect
// people now (airing, recent, manual, in the corpus) keep an issue each; the rest go in one pinned tracker issue.

describe('urgent mismatches get issues, older ones go to the tracker', async () => {
  const state = await loadState(fileURLToPath(new URL('./fixtures/tmdb-older/', import.meta.url)));
  const now = new Date('2026-10-29T00:00:00Z');
  const corpus = corpusWorks(['  - name: x', '    expect:', '      status: ok', '      work: old-corpus', '      episode: 1', '  - name: y', '    expect:', '      status: ambiguous', '      top: old-popular', '  - name: z', '    expect:', '      work: old-popular'].join('\n'));
  const tmdb = () => {
    const f = (async () => new Response(JSON.stringify({ seasons: [{ season_number: 1, episode_count: 12 }] }))) as unknown as typeof fetch;
    return new TmdbClient('key', { fetch: f, minIntervalMs: 0 });
  };
  const premieres = new Map([['old-airing', new Date('2020-01-01T00:00:00Z')]]);
  const run = () => checkProjectionsDetailed(state.records, checkScope(state.records), tmdb(), { now, premieres, urgent: isUrgent(state.records, (id) => state.merged.get(id)!.isManual, corpus, now) });

  it('counts corpus cases per work, by match and by top candidate', () => {
    expect([...corpus]).toEqual([['old-corpus', 1], ['old-popular', 2]]);
  });

  it('gives airing, recent (last three years), manual and corpus works an issue each', async () => {
    const r = await run();
    expect(r.findings.map((f) => f.work).sort()).toEqual(['old-airing', 'old-corpus', 'old-manual', 'old-popular', 'recent-show']);
  });

  it('puts every other mismatch in the older list, with what we map and what TMDB lists', async () => {
    const r = await run();
    expect(r.older.map((f) => f.work)).toEqual(['old-plain']);
  });

  it('a finished 2010 work nobody touched is older', async () => {
    const r = await checkProjectionsDetailed(state.records, checkScope(state.records), tmdb(), { now, premieres, urgent: isUrgent(state.records, () => false, new Map(), now) });
    expect(r.older.map((f) => f.work).sort()).toEqual(['old-corpus', 'old-manual', 'old-plain', 'old-popular']);
    expect(r.findings.map((f) => f.work).sort()).toEqual(['old-airing', 'recent-show']);
    expect(r.older[0]!.data).toMatchObject({ mapped: 'S1 E1-13', problems: ['season 1 is mapped to episode 13, TMDB lists 12'] });
  });

  it('without a predicate every mismatch is an issue, as before', async () => {
    const r = await checkProjectionsDetailed(state.records, checkScope(state.records), tmdb(), { now, premieres });
    expect(r.older).toEqual([]);
    expect(r.findings).toHaveLength(6);
  });

  it('the tracker table lists corpus-named works first, then works with more aliases', async () => {
    const r = await checkProjectionsDetailed(state.records, checkScope(state.records), tmdb(), { now, premieres, urgent: isUrgent(state.records, () => false, new Map(), now) });
    const body = olderTrackerBody(state.records, r.older, corpus, now);
    const order = [...body.matchAll(/^\| `([a-z-]+)` \|/gm)].map((m) => m[1]);
    expect(order).toEqual(['old-popular', 'old-corpus', 'old-manual', 'old-plain']);
    expect(body).toContain('| `old-plain` | S1 E1-13 | season 1 is mapped to episode 13, TMDB lists 12 | [8001](https://www.themoviedb.org/tv/8001) |');
    expect(body).not.toContain('recent-show');
    expect(olderTrackerBody(state.records, [], corpus, now)).toContain('No mismatches right now.');
  });

  it('keeps the tracker under the size limit', async () => {
    const r = await checkProjectionsDetailed(state.records, checkScope(state.records), tmdb(), { now, premieres, urgent: () => false });
    const body = olderTrackerBody(state.records, r.older, new Map(), now, 700);
    expect(body.length).toBeLessThan(1100);
    expect(body).toMatch(/\d+ more not listed/);
  });

  it('an open per-work issue for a work that is now older closes as moved to the tracker', async () => {
    const r = await checkProjectionsDetailed(state.records, checkScope(state.records), tmdb(), { now, premieres, urgent: isUrgent(state.records, () => false, new Map(), now) });
    const open = [{ number: 1, title: 'TMDB projection mismatch: old-plain' }, { number: 2, title: 'TMDB projection mismatch: recent-show' }];
    expect(issuesToClose(open, 'TMDB projection mismatch: ', r)).toEqual([{ number: 1, reason: 'older' }]);
    expect(OLDER_TRACKER_TITLE).toBe('TMDB mismatches in older works');
  });

  it('writes a mapping the way a person reads it', () => {
    expect(mappingText(state.records, 'old-plain')).toBe('S1 E1-13');
  });
});

import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AniListClient } from '../src/anilist.js';
import { loadState } from '../src/state.js';
import { POPULARITY_THRESHOLD, TmdbClient, checkProjectionsDetailed, checkScope, isUrgent, issuesToClose, olderTrackerBody, promotePopular, workPopularity } from '../src/tmdb.js';

// Older works were ranked only by corpus mentions, so a very popular show sat in the tracker like any forgotten OVA.
// AniList popularity ranks the tracker and promotes works above a threshold to an issue each.

describe('AniList popularity for older TMDB mismatches', async () => {
  const state = await loadState(fileURLToPath(new URL('./fixtures/tmdb-older/', import.meta.url)));
  const now = new Date('2026-10-29T00:00:00Z');
  const tmdb = () => new TmdbClient('key', { fetch: (async () => new Response(JSON.stringify({ seasons: [{ season_number: 1, episode_count: 12 }] }))) as unknown as typeof fetch, minIntervalMs: 0 });
  const older = async () => checkProjectionsDetailed(state.records, checkScope(state.records), tmdb(), { now, urgent: isUrgent(state.records, () => false, new Map(), now) });
  const popularity = new Map([['old-plain', 400_000], ['old-corpus', 60_000], ['old-manual', 900]]);

  it('asks AniList for popularity only, 50 IDs to a request, and skips works without an AniList ID', async () => {
    const sent: { ids: number[]; query: string }[] = [];
    const fetchFn = (async (_u: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { query: string; variables: { ids: number[] } };
      sent.push({ ids: body.variables.ids, query: body.query });
      return new Response(JSON.stringify({ data: { Page: { pageInfo: { hasNextPage: false }, media: body.variables.ids.map((id) => ({ id, popularity: id * 10 })) } } }));
    }) as unknown as typeof fetch;
    const client = new AniListClient({ fetch: fetchFn, minIntervalMs: 0 });
    const pop = await client.popularityByIds(Array.from({ length: 120 }, (_, i) => i + 1));
    expect(sent.map((s) => s.ids.length)).toEqual([50, 50, 20]);
    expect(sent[0]!.query).toContain('popularity');
    expect(sent[0]!.query).not.toMatch(/title|description/);
    expect(pop.get(7)).toBe(70);
    const byWork = await workPopularity(state.records, ['old-plain', 'no-such-work'], { popularityByIds: async (ids) => new Map(ids.map((i) => [i, 5])) });
    expect([...byWork.keys()].every((k) => state.records.works.get(k)?.ids.anilist !== undefined)).toBe(true);
  });

  it('a failed AniList request leaves the tracker sorted as before instead of failing the run', async () => {
    const lines: string[] = [];
    const out = await workPopularity(state.records, ['old-plain'], { popularityByIds: async () => { throw new Error('HTTP 500'); } }, (l) => lines.push(l));
    expect(out.size).toBe(0);
    expect(lines[0]).toContain('HTTP 500');
  });

  it('promotes older works at or above the threshold to findings, most popular first', async () => {
    const r = await older();
    const promoted = promotePopular(r, popularity, 50_000);
    expect(promoted.map((f) => f.work)).toEqual(['old-plain', 'old-corpus']);
    expect(r.findings.map((f) => f.work)).toEqual(['recent-show', 'old-plain', 'old-corpus']);
    expect(r.older.map((f) => f.work).sort()).toEqual(['old-manual', 'old-popular']);
  });

  it('a work with no known popularity stays in the tracker, and the default threshold applies', async () => {
    const r = await older();
    expect(promotePopular(r, new Map())).toEqual([]);
    expect(r.older).toHaveLength(4);
    expect(POPULARITY_THRESHOLD).toBe(50_000);
    const r2 = await older();
    promotePopular(r2, new Map([['old-plain', POPULARITY_THRESHOLD - 1], ['old-corpus', POPULARITY_THRESHOLD]]));
    expect(r2.findings.map((f) => f.work)).toEqual(['recent-show', 'old-corpus']);
  });

  it('a promoted work keeps (is not closed as moved to the tracker) its own open issue', async () => {
    const r = await older();
    promotePopular(r, popularity, 50_000);
    const open = [{ number: 1, title: 'TMDB projection mismatch: old-plain' }, { number: 2, title: 'TMDB projection mismatch: old-manual' }];
    expect(issuesToClose(open, 'TMDB projection mismatch: ', r)).toEqual([{ number: 2, reason: 'older' }]);
  });

  it('sorts the tracker by popularity and shows it', async () => {
    const r = await older();
    const body = olderTrackerBody(state.records, r.older, new Map(), now, undefined, popularity);
    const order = [...body.matchAll(/^\| `([a-z-]+)` \|/gm)].map((m) => m[1]);
    expect(order).toEqual(['old-plain', 'old-corpus', 'old-manual', 'old-popular']);
    expect(body).toContain('AniList popularity');
    expect(body).toMatch(/old-plain.*\| 400000 \|/);
    expect(olderTrackerBody(state.records, r.older, new Map(), now)).not.toContain('AniList popularity |');
  });
});

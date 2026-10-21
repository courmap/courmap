import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { evaluate, loadState, tmdbSplitJson } from '../src/state.js';
import { TmdbClient, checkProjectionsDetailed } from '../src/tmdb.js';

// The split-cour pattern (decided by Xwolv, 2026-10-20), on the eight shows found that day: TMDB has no season 2,
// but its season 1 holds both cours, so the checker proposes continuing season 1 instead of opening an issue.

// show, first cour, second cour: TMDB's season 1 lists both
const SHOWS: [string, number, number, number][] = [
  ['jigokuraku', 117465, 13, 12],
  ['bisque', 123249, 12, 12],
  ['solo', 127532, 12, 13],
  ['happy-marriage', 196944, 12, 13],
  ['bye-bye-earth', 214587, 10, 10],
  ['sentai', 215799, 12, 12],
  ['unnamed-memory', 216272, 12, 12],
  ['wedding-rings', 218493, 12, 13],
];

describe('proposing a split cour', async () => {
  const state = await loadState(fileURLToPath(new URL('./fixtures/tmdb-splits/', import.meta.url)));
  const tmdb = () => {
    const f = (async (url: string) => {
      const id = Number(/tv\/(\d+)/.exec(url)![1]);
      const show = SHOWS.find((s) => s[1] === id);
      const total = show ? show[2] + show[3] : 30; // the odd pair: 12 + 12 mapped, TMDB lists 30
      return new Response(JSON.stringify({ seasons: [{ season_number: 1, episode_count: total }] }));
    }) as unknown as typeof fetch;
    return new TmdbClient('key', { fetch: f, minIntervalMs: 0 });
  };
  const run = (noSplit?: Set<string>) => checkProjectionsDetailed(state.records, state.records.works.keys(), tmdb(), { now: new Date('2026-10-20T00:00:00Z'), ...(noSplit && { noSplit }) });

  it.each(SHOWS)('%s: the second cour continues TMDB season 1 after the first', async (name, show, first, second) => {
    const r = await run();
    const f = r.splits.find((x) => x.work === `${name}-2`)!;
    expect(f).toMatchObject({ tier: 'B', kind: 'tmdb-split' });
    expect(f.split).toEqual({ work: `${name}-2`, tmdb_show: [{ season: 1, episodes: `1-${second}`, start: first + 1 }], origin: 'bot', tmdb: String(show) });
    expect(r.findings.map((x) => x.work)).not.toContain(`${name}-2`);
  });

  it('proposes nothing when the counts do not add up, and the work stays an ordinary finding', async () => {
    const r = await run();
    expect(r.splits.map((f) => f.work)).not.toContain('odd-2');
    expect(r.findings.map((f) => f.work)).toContain('odd-2');
  });

  it('does not propose again for a work in noSplit (rejected, or already in the file)', async () => {
    const r = await run(new Set(['jigokuraku-2']));
    expect(r.splits.map((f) => f.work)).not.toContain('jigokuraku-2');
    expect(r.findings.map((f) => f.work)).toContain('jigokuraku-2');
  });

  it('a proposal is a valid bot line: applied to the data it moves the TMDB mapping, and the checker then finds nothing', async () => {
    const r = await run();
    const lines = r.splits.map((f) => f.split!);
    const ev = evaluate(state.loaded, state.relations, state.airing, lines);
    expect(ev.errors).toEqual([]);
    const after = await checkProjectionsDetailed(ev.records!, ev.records!.works.keys(), tmdb(), { now: new Date('2026-10-20T00:00:00Z') });
    expect(after.splits).toEqual([]);
    expect(after.findings.map((f) => f.work)).toEqual(['odd-1', 'odd-2']); // the odd pair: TMDB lists more than we map, and no season 2
    const row = ev.records!.works.get('jigokuraku-2')!.projections.tmdb_show![0]!;
    expect([row.season, row.ep_from, row.ep_to, row.target_from]).toEqual([1, 1, 12, 14]);
  });

  it('writes one file per work, keys in a fixed order', () => {
    const text = tmdbSplitJson({ work: 'b', tmdb_show: [{ season: 1, episodes: '1-12', start: 13 }], origin: 'bot', tmdb: '2' });
    expect(text).toBe('{"work":"b","tmdb_show":[{"season":1,"episodes":"1-12","start":13}],"origin":"bot","tmdb":"2"}\n');
  });
});

import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { evaluate, loadState, tmdbSplitJson } from '../src/state.js';
import { TmdbClient, checkProjectionsDetailed, issuesToClose } from '../src/tmdb.js';

// The fill pattern: TMDB lists one episode more than all our works map, and exactly one other work of the same TVDB
// show (no TMDB mapping, same episode count) fills the gap. Modelled on issue #90 (the Cloudy Beach special).

describe('proposing the work that fills a TMDB gap', async () => {
  const state = await loadState(fileURLToPath(new URL('./fixtures/tmdb-fill/', import.meta.url)));
  const tmdb = () => {
    const f = (async (url: string) => {
      const id = Number(/tv\/(\d+)/.exec(url)![1]);
      return new Response(JSON.stringify({ seasons: [{ season_number: 1, episode_count: id === 5001 ? 12 : 13 }] }));
    }) as unknown as typeof fetch;
    return new TmdbClient('key', { fetch: f, minIntervalMs: 0 });
  };
  const run = (noSplit?: Set<string>) => checkProjectionsDetailed(state.records, state.records.works.keys(), tmdb(), { now: new Date('2026-10-21T00:00:00Z'), ...(noSplit && { noSplit }) });

  it('maps the special after the last mapped episode, and gives it the show ID it lacks', async () => {
    const r = await run();
    const f = r.splits.find((x) => x.work === 'meshi-special')!;
    expect(f).toMatchObject({ tier: 'B', kind: 'tmdb-fill', data: { for_work: 'meshi' } });
    expect(f.split).toEqual({ work: 'meshi-special', tmdb_show: [{ season: 1, episodes: 1, start: 12 }], origin: 'bot', tmdb: '5001', tmdb_id: '5001' });
    expect(r.findings.map((x) => x.work)).not.toContain('meshi');
  });

  it('proposes nothing when two works could fill the gap, and the show stays an issue', async () => {
    const r = await run();
    expect(r.splits.map((f) => f.work)).not.toContain('twin-special-a');
    expect(r.findings.map((f) => f.work)).toContain('twin');
  });

  it('is a valid bot line: applied to the data it closes the gap', async () => {
    const r = await run();
    const ev = evaluate(state.loaded, state.relations, state.airing, r.splits.map((f) => f.split!));
    expect(ev.errors).toEqual([]);
    expect(ev.records!.works.get('meshi-special')!.ids.tmdb_show).toBe('5001');
    const after = await checkProjectionsDetailed(ev.records!, ev.records!.works.keys(), tmdb(), { now: new Date('2026-10-21T00:00:00Z') });
    expect(after.splits).toEqual([]);
    expect(after.findings.map((f) => f.work)).toEqual(['twin']);
  });

  it('does not propose again for a rejected or already proposed work', async () => {
    const r = await run(new Set(['meshi-special']));
    expect(r.splits).toEqual([]);
    expect(r.findings.map((f) => f.work)).toContain('meshi');
  });

  it('an open issue for the show closes as proposed', async () => {
    const r = await run();
    const open = [{ number: 90, title: 'TMDB projection mismatch: meshi' }];
    expect(issuesToClose(open, 'TMDB projection mismatch: ', r)).toEqual([{ number: 90, reason: 'proposed-fill' }]);
  });

  it('writes the show ID into the file', () => {
    expect(tmdbSplitJson({ work: 'w', tmdb_show: [{ season: 1, episodes: 1, start: 12 }], origin: 'bot', tmdb: '5', tmdb_id: '5' })).toBe('{"work":"w","tmdb_show":[{"season":1,"episodes":1,"start":12}],"origin":"bot","tmdb":"5","tmdb_id":"5"}\n');
  });
});

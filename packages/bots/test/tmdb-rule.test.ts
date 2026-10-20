import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TMDB_ISSUE_PREFIX } from '../src/report.js';
import { loadState } from '../src/state.js';
import { LAG_GRACE_DAYS, TmdbClient, checkProjectionsDetailed, issuesToClose, onlyTmdbLag } from '../src/tmdb.js';

// The noise rule (decided by Xwolv, 2026-10-20): while a show is still starting, TMDB being behind us is
// not worth an issue; TMDB having more than we map, or a different structure, always is.

const NOW = new Date('2026-10-20T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

describe('onlyTmdbLag', () => {
  const behind = [{ kind: 'behind' as const, text: 'season 2 is not on TMDB' }];
  it('forgives an airing or upcoming work for six weeks after its premiere, or while the date is unknown', () => {
    expect(LAG_GRACE_DAYS).toBe(42);
    expect(onlyTmdbLag('airing', behind, daysAgo(10), NOW)).toBe(true);
    expect(onlyTmdbLag('airing', behind, daysAgo(42), NOW)).toBe(true);
    expect(onlyTmdbLag('upcoming', behind, new Date('2027-01-01T00:00:00Z'), NOW)).toBe(true);
    expect(onlyTmdbLag('upcoming', behind, null, NOW)).toBe(true);
    expect(onlyTmdbLag('airing', behind, daysAgo(43), NOW)).toBe(false);
  });

  it('never forgives a finished work, and never when anything besides "behind" is wrong', () => {
    expect(onlyTmdbLag('finished', behind, daysAgo(1), NOW)).toBe(false);
    expect(onlyTmdbLag('airing', [...behind, { kind: 'more', text: 'TMDB has more' }], daysAgo(1), NOW)).toBe(false);
    expect(onlyTmdbLag('airing', [{ kind: 'structure', text: 'x' }], daysAgo(1), NOW)).toBe(false);
    expect(onlyTmdbLag('airing', [{ kind: 'no-show', text: 'x' }], daysAgo(1), NOW)).toBe(false);
    expect(onlyTmdbLag('airing', [], daysAgo(1), NOW)).toBe(false);
  });
});

describe('the projection checker with the noise rule', async () => {
  const state = await loadState(fileURLToPath(new URL('./fixtures/tmdb-rule/', import.meta.url)));
  const season = (n: number, c: number) => ({ season_number: n, episode_count: c });
  const shows: Record<string, unknown> = {
    '9000': { seasons: [season(1, 12)] },
    '9001': { seasons: [season(1, 12)] },
    '9002': { seasons: [season(1, 12), season(2, 6)] },
    '9003': { seasons: [season(1, 8)] },
    '9004': { seasons: [season(1, 24)] },
    '9005': { seasons: [season(1, 12), season(3, 12)] },
    '9006': { seasons: [season(1, 24)] },
    '9007': { seasons: [season(1, 5)] },
    '9008': { seasons: [season(0, 4)] },
    '9009': { seasons: [season(0, 5)] },
  };
  const fetchFn = (async (url: string) => {
    const id = /tv\/(\d+)/.exec(url)![1]!;
    return shows[id] ? new Response(JSON.stringify(shows[id])) : new Response('{}', { status: 404 });
  }) as unknown as typeof fetch;
  const run = (premieres: Record<string, Date | null>) =>
    checkProjectionsDetailed(state.records, state.records.works.keys(), new TmdbClient('key', { fetch: fetchFn, minIntervalMs: 0 }), { now: NOW, premieres: new Map(Object.entries(premieres)) });
  const premieres = { 'r-new-season-airing': daysAgo(14), 'r-new-season-old': daysAgo(90), 'r-short-upcoming': null, 'r-more-airing': daysAgo(7), 'r-structure': daysAgo(7), 'r-open': daysAgo(30) };

  it('holds back TMDB lag on a show that is still starting, and flags everything else', async () => {
    const r = await run(premieres);
    expect(r.lagging.map((f) => f.work)).toEqual(['r-new-season-airing', 'r-short-upcoming']);
    expect(r.findings.map((f) => [f.work, f.summary.replace('TMDB projection disagrees with TMDB: ', '')])).toEqual([
      ['r-new-season-old', 'season 2 is not on TMDB'],
      ['r-short-finished', 'season 1 is mapped to episode 12, TMDB lists 8'],
      ['r-more-airing', 'season 1 has 24 episodes on TMDB, but all our works map only up to 12'],
      ['r-structure', 'season 2 is not on TMDB (TMDB has seasons up to 3, so it splits the show differently)'],
      ['r-specials-more', 'season 0 (specials) has 5 episodes on TMDB, but all our works map only up to 2'],
    ]);
  });

  it('does not flag TMDB being behind on specials, but flags it listing more of them', async () => {
    const r = await run(premieres);
    const all = [...r.findings, ...r.lagging].map((f) => f.work);
    expect(all).not.toContain('r-specials-behind');
    expect(all).toContain('r-specials-more');
    expect([...r.checked]).toContain('r-specials-behind');
  });

  it('flags a lagging work once its season premiered more than six weeks ago', async () => {
    const r = await run({ ...premieres, 'r-new-season-airing': daysAgo(43) });
    expect(r.lagging.map((f) => f.work)).toEqual(['r-short-upcoming']);
    expect(r.findings.map((f) => f.work)).toContain('r-new-season-airing');
  });

  it('adds up cours that share a TMDB season, and does not mind an open range', async () => {
    const r = await run(premieres);
    const all = [...r.findings, ...r.lagging].map((f) => f.work);
    expect(all).not.toContain('r-cour-one');
    expect(all).not.toContain('r-cour-two');
    expect(all).not.toContain('r-open');
    expect([...r.checked]).toContain('r-cour-two');
  });

  it('does not clear or flag the works of a show TMDB could not be asked about', async () => {
    const failing = (async () => new Response('', { status: 500 })) as unknown as typeof fetch;
    const seen: string[] = [];
    const r = await checkProjectionsDetailed(state.records, state.records.works.keys(), new TmdbClient('key', { fetch: failing, minIntervalMs: 0 }), { now: NOW, onError: (show) => seen.push(show) });
    expect(r.checked.size).toBe(0);
    expect(r.findings).toEqual([]);
    expect(seen).toHaveLength(10);
  });
});

describe('closing the checker\'s own issues', () => {
  const prefix = `${TMDB_ISSUE_PREFIX}: `;
  const finding = (work: string) => ({ tier: 'C' as const, kind: 'projection-mismatch' as const, work, anilist: null, title: work, summary: '', data: {} });
  const result = { findings: [finding('still-wrong')], lagging: [finding('behind')], splits: [finding('split')], checked: new Set(['still-wrong', 'behind', 'fixed', 'split']) };
  const open = [
    { number: 1, title: `${prefix}still-wrong` },
    { number: 2, title: `${prefix}behind` },
    { number: 3, title: `${prefix}fixed` },
    { number: 4, title: `${prefix}not-asked-about` },
    { number: 5, title: 'Count conflict: fixed' },
    { number: 6, title: `${prefix}split` },
  ];

  it('closes an issue when TMDB lags or the work now agrees, and leaves the others alone', () => {
    expect(issuesToClose(open, prefix, result)).toEqual([
      { number: 2, reason: 'lag' },
      { number: 3, reason: 'resolved' },
      { number: 6, reason: 'proposed' },
    ]);
  });
});

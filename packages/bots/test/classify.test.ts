import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { AniListMedia } from '../src/anilist.js';
import { classify } from '../src/classify.js';
import { loadState } from '../src/state.js';

const dir = fileURLToPath(new URL('./fixtures/data/', import.meta.url));
const now = new Date('2026-10-19T00:00:00Z');

/** AniList media with only the fields the bots read. */
function media(id: number, over: Partial<AniListMedia> & { start?: string; prequel?: number[]; sequel?: number[] } = {}): AniListMedia {
  const [y, m, d] = (over.start ?? '2026-10-05').split('-').map(Number);
  const { start: _s, prequel: _p, sequel: _q, ...fields } = over;
  const edges = [...(over.prequel ?? []).map((n) => ({ relationType: 'PREQUEL', node: { id: n, type: 'ANIME' } })), ...(over.sequel ?? []).map((n) => ({ relationType: 'SEQUEL', node: { id: n, type: 'ANIME' } }))];
  return { id, idMal: null, format: 'TV', status: 'RELEASING', episodes: 12, season: 'FALL', seasonYear: 2026, startDate: { year: y!, month: m!, day: d! }, relations: { edges }, nextAiringEpisode: null, ...fields };
}

describe('classifier', async () => {
  const state = await loadState(dir);
  const fall = [
    media(101, { status: 'FINISHED', episodes: 12, prequel: [100] }), // alpha-2 finishes, counts agree
    media(102, { status: 'RELEASING', episodes: 12, prequel: [101] }), // alpha-3 starts airing
    media(200, { episodes: 13 }), // beta's total grows
    media(201, { episodes: 20 }), // beta-low's total drops while airing
    media(250, { status: 'FINISHED', episodes: 11 }), // gamma has a manual count
    media(301, { status: 'FINISHED', episodes: 12, prequel: [300] }), // delta-2 follows delta
    media(400, { status: 'FINISHED', episodes: 12, prequel: [302] }), // epsilon's AniList prequel is a movie
    media(500, { start: '2026-08-01' }), // not in the data, premiered 11 weeks ago
    media(501, { start: '2026-10-12' }), // not in the data, one week old
    media(600, { episodes: 12 }), // zeta: the new count runs past its TVDB projection
    media(700, { format: 'MUSIC' }), // music videos are ignored
  ];
  const c = classify({ state, seasons: [{ ref: { season: 'FALL', year: 2026 }, media: fall }], airing: [], now });
  const of = (work: string) => c.findings.filter((f) => f.work === work).map((f) => [f.tier, f.kind]);

  it('bumps an airing total in tier A', () => {
    expect(of('beta')).toEqual([['A', 'count-bump']]);
    expect(c.proposed.airing).toContainEqual({ work: 'beta', episodes: 13, status: 'airing', origin: 'bot', anilist: 200 });
  });

  it('sends a lower count and a manual file to tier C', () => {
    expect(of('beta-low')).toEqual([['C', 'count-conflict']]);
    expect(of('gamma')).toEqual([['C', 'manual-change']]);
  });

  it('proposes a same-type AniList prequel in tier B, never a movie before a series', () => {
    expect(of('delta-2')).toEqual([['B', 'sequel']]);
    expect(c.proposed.relations).toEqual([{ work: 'delta-2', prequel: 'delta', relation: 'PREQUEL', origin: 'bot', anilist: [301, 300] }]);
    expect(of('epsilon')).toEqual([]);
    expect(c.tracker.get('Fall 2026')!.find((r) => r.anilist === 400)!.note).toMatch(/is a movie, this is a tv: not chained/);
  });

  it('lifts updates that change an existing absolute sequence to tier B (decision S4.2)', () => {
    // alpha-3 airing may now end the alpha run, so the derived sequence gains a member.
    expect(of('alpha-3')).toEqual([['B', 'sequence-change']]);
    expect(c.diff.changed).toEqual(['alpha-absolute']);
    expect(c.diff.shifts).toEqual([]);
  });

  it('files a count past the seed projection as projection-short, not as an update', () => {
    expect(of('zeta')).toEqual([['C', 'projection-short']]);
    expect(c.proposed.airing.find((a) => a.work === 'zeta')).toBeUndefined();
  });

  it('asks for a mapping only four weeks after premiere, and skips music', () => {
    expect(c.findings.filter((f) => f.work === null).map((f) => [f.anilist, f.tier, f.kind])).toEqual([[500, 'C', 'missing-ids']]);
    const states = Object.fromEntries(c.tracker.get('Fall 2026')!.map((r) => [r.anilist, r.state]));
    expect(states).toMatchObject({ 500: 'conflict', 501: 'waiting for seed', 200: 'auto-update', 301: 'awaiting review', 400: 'mapped' });
    expect(states[700]).toBeUndefined();
  });

  it('never puts an AniList title in a finding or the tracker', () => {
    expect(c.findings.find((f) => f.anilist === 500)!.title).toBe('AniList 500');
    expect(c.tracker.get('Fall 2026')!.find((r) => r.anilist === 200)!.title).toBe('Beta');
  });
});

describe('an update that puts a projection out of bounds', async () => {
  const state = await loadState(dir);
  it('is a count conflict, never an update (Chitose-kun Part 2 and Dark Machine went 12 to 11 in the first live PR)', () => {
    const c = classify({ state, seasons: [{ ref: { season: 'FALL', year: 2026 }, media: [media(650, { episodes: 11 })] }], airing: [], now });
    expect(c.findings.map((f) => [f.work, f.tier, f.kind])).toEqual([['eta', 'C', 'count-conflict']]);
    expect(c.findings[0]!.summary).toMatch(/AniList says airing, 11 episodes, but projections.tvdb_show disagrees/);
    expect(c.proposed.airing).toEqual([]);
  });
});

describe('a finished flip with another count', async () => {
  const state = await loadState(dir);
  const run = (episodes: number) => classify({ state, seasons: [{ ref: { season: 'FALL', year: 2026 }, media: [media(200, { status: 'FINISHED', episodes })] }], airing: [], now });

  it('is a count conflict when the count shrinks', () => {
    const c = run(11);
    expect(c.findings.map((f) => [f.work, f.tier, f.kind])).toEqual([['beta', 'C', 'count-conflict']]);
    expect(c.proposed.airing).toEqual([]);
  });

  it('is an update when it grows (cedya77 lags behind airing works)', () => {
    expect(run(13).findings.map((f) => [f.work, f.tier, f.kind])).toEqual([['beta', 'A', 'finished']]);
  });
});

describe('data/rejected.yaml', async () => {
  const fall = [media(301, { status: 'FINISHED', episodes: 12, prequel: [300] }), media(200, { episodes: 13 })];
  const rejection = { decided_by: 'Xwolv', date: '2026-10-19', origin: 'manual' as const, link: 'https://github.com/courmap/courmap/pull/10' };

  it('never proposes a rejected prequel or airing update again, and says why in the tracker', async () => {
    const state = await loadState(dir);
    state.rejected = [
      { kind: 'relation', work: 'delta-2', prequel: 'delta', reason: 'the two air side by side', ...rejection },
      { kind: 'airing', work: 'beta', episodes: 13, reason: 'AniList miscounts this one', ...rejection },
    ];
    const c = classify({ state, seasons: [{ ref: { season: 'FALL', year: 2026 }, media: fall }], airing: [], now });
    expect(c.findings.filter((f) => f.work === 'delta-2' || f.work === 'beta')).toEqual([]);
    expect(c.proposed.relations).toEqual([]);
    expect(c.proposed.airing.find((a) => a.work === 'beta')).toBeUndefined();
    const notes = Object.fromEntries(c.tracker.get('Fall 2026')!.map((r) => [r.work, r.note]));
    expect(notes['delta-2']).toBe('prequel delta rejected in data/rejected.yaml: the two air side by side');
    expect(notes.beta).toBe('airing update rejected in data/rejected.yaml: AniList miscounts this one');
  });

  it('still proposes a different count than the rejected one', async () => {
    const state = await loadState(dir);
    state.rejected = [{ kind: 'airing', work: 'beta', episodes: 13, reason: 'AniList miscounts this one', ...rejection }];
    const c = classify({ state, seasons: [{ ref: { season: 'FALL', year: 2026 }, media: [media(200, { episodes: 14 })] }], airing: [], now });
    expect(c.findings.filter((f) => f.work === 'beta').map((f) => [f.tier, f.kind])).toEqual([['A', 'count-bump']]);
  });
});

import { describe, expect, it } from 'vitest';
import { assignSlugs, slugify, type ManualClaim, type SlugCandidate, type SlugEntry } from '../src/slugs.js';

type Ids = { anidb?: number; anilist?: number; mal?: number };
const keyOf = (ids: Ids) => (ids.anidb !== undefined ? `anidb:${ids.anidb}` : ids.anilist !== undefined ? `anilist:${ids.anilist}` : `mal:${ids.mal}`);
const c = (ids: Ids | number, title: string, year: number | undefined, type = 'tv'): SlugCandidate => {
  const i = typeof ids === 'number' ? { anidb: ids } : ids;
  return { key: keyOf(i), ...i, title, type, ...(year !== undefined && { year }) };
};
const assign = (cands: SlugCandidate[], registry: SlugEntry[] = [], manual: ManualClaim[] = [], reserved = new Set<string>()) =>
  Object.fromEntries(assignSlugs(cands, registry, manual, reserved).slugs);

describe('slugify', () => {
  it.each([
    ['Sousou no Frieren', 'sousou-no-frieren'],
    ['Spy x Family Part 2', 'spy-x-family-part-2'],
    ['Shingeki no Kyōjin', 'shingeki-no-kyojin'],
    ['Steins;Gate 0', 'steins-gate-0'],
    ['  K-On!!  ', 'k-on'],
    ['葬送のフリーレン', ''],
  ])('%s -> %s', (title, slug) => expect(slugify(title)).toBe(slug));

  it('keeps long bases at a word boundary', () => {
    const s = slugify('word '.repeat(40));
    expect(s.length).toBeLessThanOrEqual(80);
    expect(s.endsWith('-')).toBe(false);
  });
});

describe('assignSlugs (Xwolv decisions 2 and S3.9)', () => {
  it('appends -year, then -type, then -a<anidb> on collision, cumulatively', () => {
    expect(
      assign([c(1, 'Hunter x Hunter', 1999), c(2, 'Hunter x Hunter', 2011), c(3, 'Hunter x Hunter', 2011, 'ova'), c(4, 'Hunter x Hunter', 2011, 'ova')]),
    ).toEqual({
      'anidb:1': 'hunter-x-hunter',
      'anidb:2': 'hunter-x-hunter-2011',
      'anidb:3': 'hunter-x-hunter-2011-ova',
      'anidb:4': 'hunter-x-hunter-2011-ova-a4',
    });
  });

  it('skips the year step when the year is unknown', () => {
    expect(assign([c(1, 'Same', 2000), c(2, 'Same', undefined, 'movie')])).toEqual({ 'anidb:1': 'same', 'anidb:2': 'same-movie' });
  });

  it('gives the plain base to the lower AniDB ID regardless of input order', () => {
    expect(assign([c(20, 'Remake', 2020), c(10, 'Remake', 1990)])).toEqual({ 'anidb:10': 'remake', 'anidb:20': 'remake-2020' });
  });

  it('never renames a published slug, even when the title or a new collision would change it', () => {
    const registry = [{ anidb: 20, slug: 'remake' }];
    expect(assign([c(10, 'Remake', 1990), c(20, 'Renamed Title', 2020)], registry)).toEqual({ 'anidb:20': 'remake', 'anidb:10': 'remake-1990' });
  });

  it('keeps slugs of works that left the seeds reserved', () => {
    expect(assign([c(30, 'Gone', 2001)], [{ anidb: 99, slug: 'gone' }])).toEqual({ 'anidb:30': 'gone-2001' });
  });

  it('lets a manual file claim the slug for its anchor, ahead of any seed', () => {
    const manual = [{ id: 'sousou-no-frieren', anidb: 17617 }];
    expect(assign([c(5, 'Sousou no Frieren', 2023), c(17617, 'Sousou no Frieren', 2023)], [], manual, new Set(['sousou-no-frieren']))).toEqual({
      'anidb:17617': 'sousou-no-frieren',
      'anidb:5': 'sousou-no-frieren-2023',
    });
  });

  it('does not reuse manual-only slugs', () => {
    expect(assign([c(1, 'Hand Made', 2024)], [], [], new Set(['hand-made']))).toEqual({ 'anidb:1': 'hand-made-2024' });
  });

  it('falls back to the ID suffix for titles with no ASCII letters', () => {
    expect(assign([c(7, '葬送のフリーレン', 2023), c({ anilist: 8 }, 'フリーレン', 2023)])).toEqual({ 'anidb:7': 'a7', 'anilist:8': 'al8' });
  });

  it('slugs works without AniDB by the same rules, after the AniDB-anchored ones', () => {
    expect(
      assign([c({ anilist: 1 }, 'Shared', 2024), c({ mal: 1 }, 'Shared', 2024), c(500, 'Shared', 2024), c({ anilist: 2, mal: 9 }, 'Shared', 2024, 'ona')]),
    ).toEqual({
      'anidb:500': 'shared',
      'anilist:1': 'shared-2024',
      'anilist:2': 'shared-2024-ona',
      'mal:1': 'shared-2024-tv',
    });
  });

  it('keeps a slug when a work seeded from AniList later gains an AniDB ID, and learns the new ID', () => {
    const first = assignSlugs([c({ anilist: 42, mal: 43 }, 'Late Comer', 2026)], [], [], new Set());
    expect(first.registry).toEqual([{ anilist: 42, mal: 43, slug: 'late-comer' }]);
    const later = assignSlugs([c({ anidb: 19999, anilist: 42, mal: 43 }, 'Late Comer', 2026)], first.registry, [], new Set());
    expect(Object.fromEntries(later.slugs)).toEqual({ 'anidb:19999': 'late-comer' });
    expect(later.registry).toEqual([{ anidb: 19999, anilist: 42, mal: 43, slug: 'late-comer' }]);
  });
});

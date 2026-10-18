import { describe, expect, it } from 'vitest';
import { assignSlugs, slugify, type SlugCandidate } from '../src/slugs.js';

const c = (anidb: number, title: string, year: number | undefined, type = 'tv'): SlugCandidate => ({ anidb, title, type, ...(year !== undefined && { year }) });
const assign = (cands: SlugCandidate[], registry: { anidb: number; slug: string }[] = [], manual = new Map<number, string>(), reserved = new Set<string>()) =>
  Object.fromEntries(assignSlugs(cands, registry, manual, reserved));

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

describe('assignSlugs (Xwolv decision 2)', () => {
  it('appends -year, then -type, then -a<anidb> on collision, cumulatively', () => {
    expect(
      assign([c(1, 'Hunter x Hunter', 1999), c(2, 'Hunter x Hunter', 2011), c(3, 'Hunter x Hunter', 2011, 'ova'), c(4, 'Hunter x Hunter', 2011, 'ova')]),
    ).toEqual({
      1: 'hunter-x-hunter',
      2: 'hunter-x-hunter-2011',
      3: 'hunter-x-hunter-2011-ova',
      4: 'hunter-x-hunter-2011-ova-a4',
    });
  });

  it('skips the year step when the year is unknown', () => {
    expect(assign([c(1, 'Same', 2000), c(2, 'Same', undefined, 'movie')])).toEqual({ 1: 'same', 2: 'same-movie' });
  });

  it('gives the plain base to the lower AniDB ID regardless of input order', () => {
    expect(assign([c(20, 'Remake', 2020), c(10, 'Remake', 1990)])).toEqual({ 10: 'remake', 20: 'remake-2020' });
  });

  it('never renames a published slug, even when the title or a new collision would change it', () => {
    const registry = [{ anidb: 20, slug: 'remake' }];
    expect(assign([c(10, 'Remake', 1990), c(20, 'Renamed Title', 2020)], registry)).toEqual({ 20: 'remake', 10: 'remake-1990' });
  });

  it('keeps slugs of works that left the seeds reserved', () => {
    expect(assign([c(30, 'Gone', 2001)], [{ anidb: 99, slug: 'gone' }])).toEqual({ 99: 'gone', 30: 'gone-2001' });
  });

  it('lets a manual file claim the slug for its AniDB ID, ahead of any seed', () => {
    const manual = new Map([[17617, 'sousou-no-frieren']]);
    expect(assign([c(5, 'Sousou no Frieren', 2023), c(17617, 'Sousou no Frieren', 2023)], [], manual, new Set(['sousou-no-frieren']))).toEqual({
      17617: 'sousou-no-frieren',
      5: 'sousou-no-frieren-2023',
    });
  });

  it('does not reuse manual-only slugs', () => {
    expect(assign([c(1, 'Hand Made', 2024)], [], new Map(), new Set(['hand-made']))).toEqual({ 1: 'hand-made-2024' });
  });

  it('falls back to a<anidb> for titles with no ASCII letters', () => {
    expect(assign([c(7, '葬送のフリーレン', 2023), c(8, 'フリーレン', 2023)])).toEqual({ 7: 'a7', 8: 'a8' });
  });
});

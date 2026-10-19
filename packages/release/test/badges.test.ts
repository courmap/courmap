import { describe, expect, it } from 'vitest';
import { makeBadges } from '../src/badges.js';

describe('README badges', () => {
  const tracker = { title: 'Season tracker: Fall 2026', body: 'Every show...\n\n6 conflict, 20 awaiting review, 22 auto-update, 2 waiting for seed, 10 upcoming, 51 mapped.\n' };

  it('reads the release, the corpus and the current Season tracker', () => {
    const b = makeBadges({ meta: { data_version: '2026.43' }, corpus: { verified: 35, passed: 35, pass_rate: 1 }, trackers: [tracker], season: 'Fall 2026' });
    expect(b.data).toEqual({ schemaVersion: 1, label: 'data', message: '2026.43', color: 'e04e39' });
    expect(b.coverage!.message).toBe('66% of 111 shows');
    expect(b.corpus!.message).toBe('35/35 (100.0%)');
  });

  it('says "no release yet" instead of breaking before the first release', () => {
    const b = makeBadges({ meta: null, corpus: null, trackers: null, season: 'Winter 2027' });
    expect([b.data!.message, b.coverage!.message, b.corpus!.message]).toEqual(['no release yet', 'no tracker yet', 'no release yet']);
    expect(Object.values(b).every((x) => x.color === 'lightgrey')).toBe(true);
  });
});

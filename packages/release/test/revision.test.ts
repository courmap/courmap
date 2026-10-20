import { describe, expect, it } from 'vitest';
import { latestOfWeek, nextVersion, revisionOf } from '../src/revision.js';

describe('revision releases', () => {
  it('reads the revision of a tag within its week', () => {
    expect(revisionOf('data-2026.43', '2026.43')).toBe(0);
    expect(revisionOf('data-2026.43.2', '2026.43')).toBe(2);
    expect(revisionOf('data-2026.44', '2026.43')).toBeNull();
    expect(revisionOf('data-2026.430', '2026.43')).toBeNull();
    expect(revisionOf('client-v0.1.0', '2026.43')).toBeNull();
  });

  it('finds the newest release of the week, not the newest tag overall', () => {
    const tags = ['data-2026.42.5', 'data-2026.43', 'data-2026.43.1', 'data-2026.43.10', 'data-2026.43.2'];
    expect(latestOfWeek(tags, '2026.43')).toEqual({ tag: 'data-2026.43.10', revision: 10 });
    expect(latestOfWeek(tags, '2026.44')).toBeNull();
  });

  it('publishes the bare week first, a revision when the data changed, and nothing new when it did not', () => {
    expect(nextVersion('2026.44', ['data-2026.43.1'], false)).toEqual({ version: '2026.44', changed: true });
    expect(nextVersion('2026.43', ['data-2026.43'], false)).toEqual({ version: '2026.43.1', changed: true });
    expect(nextVersion('2026.43', ['data-2026.43', 'data-2026.43.1'], false)).toEqual({ version: '2026.43.2', changed: true });
    expect(nextVersion('2026.43', ['data-2026.43', 'data-2026.43.1'], true)).toEqual({ version: '2026.43.1', changed: false });
  });
});

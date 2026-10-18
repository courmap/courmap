import { describe, expect, it } from 'vitest';
import type { WorkRecord } from '@courmap/core';
import { Reporter, makeLocator } from '../src/diagnostics.js';
import { MemoryDataset, type Records } from '../src/records.js';
import { checkRoundTrips } from '../src/roundtrip.js';
import type { CheckedFiles } from '../src/checks.js';

// validate's per-file checks make inconsistent data hard to build from YAML, so this
// exercises the round-trip check directly on records that bypass them.
function setup(works: WorkRecord[]) {
  const records: Records = {
    works: new Map(works.map((w) => [w.id, w])),
    sequences: new Map(),
    groups: new Map(),
    origins: { works: new Map(), sequences: new Map(), groups: new Map() },
  };
  const ds = new MemoryDataset(records, { data_version: 'test', git_sha: '', built_at: '', schema_version: '' });
  const files: CheckedFiles = {
    works: works.map((w) => ({
      id: w.id,
      data: { id: w.id, type: w.type, episodes: w.episodes },
      loc: makeLocator(`works/${w.id}.yaml`, null, null),
      isManual: true,
      manual: null,
      seed: null,
      origins: { ids: {}, projections: {}, aliases: new Map() },
    })),
    sequences: [],
    groups: [],
    derived: { prequels: new Map(), sequences: [], skippedRuns: 0 },
  };
  return { ds, files };
}

const base = (over: Partial<WorkRecord>): WorkRecord => ({
  id: 'w',
  type: 'tv',
  status: 'finished',
  year: null,
  episodes: 12,
  specials: null,
  titles: { romaji: null, english: null, native: null },
  ids: { anidb: '1', tvdb_show: '100' },
  projections: { tvdb_show: [{ kind: 'regular', ep_from: 1, ep_to: 12, season: 1, target_from: 1, target_to: null }] },
  prequel: null,
  sequences: [],
  aliases: [],
  ...over,
});

describe('round-trip check', () => {
  it('passes consistent data', async () => {
    const { ds, files } = setup([base({})]);
    const r = new Reporter();
    await checkRoundTrips(ds, files, r);
    expect(r.diagnostics).toEqual([]);
  });

  it('reports two works landing on the same provider episodes', async () => {
    const { ds, files } = setup([base({ id: 'a' }), base({ id: 'b', ids: { anidb: '2', tvdb_show: '100' } })]);
    const r = new Reporter();
    await checkRoundTrips(ds, files, r);
    expect(r.diagnostics.length).toBeGreaterThan(0);
    expect(r.diagnostics[0]!.code).toBe('round-trip');
    expect(r.diagnostics[0]!.message).toMatch(/ambiguous/);
  });
});

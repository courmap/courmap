import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MemoryDataset } from '@courmap/builder';
import { resolve } from '@courmap/core';
import { parseRelease } from '@courmap/parser';
import { evaluate, loadState } from '../src/state.js';

// Real data with the relations the bots propose applied, as if their PRs had merged.
const data = fileURLToPath(new URL('../../../data/', import.meta.url));

describe('AniList relations on the real data (decisions S5.1, S5.2)', async () => {
  const state = await loadState(data);
  const relations = [...state.relations, { work: 'doraemon-2005', prequel: 'doraemon-1979', relation: 'PREQUEL' as const, origin: 'bot' as const, anilist: [8687, 2471] as [number, number] }];
  const { records, errors } = evaluate(state.loaded, relations, state.airing);
  const ds = new MemoryDataset(records!, { data_version: 'test', git_sha: '', built_at: '', schema_version: '' });

  it('chains Doraemon (2005) after Doraemon (1979) without a sequence', () => {
    expect(errors).toEqual([]);
    const w = records!.works.get('doraemon-2005')!;
    expect([w.prequel, w.prequel_origin, w.sequences]).toEqual(['doraemon-1979', 'bot', []]);
  });

  it('resolves Doraemon (2005) episode 1 to its own episode 1', async () => {
    const r = await resolve(ds, parseRelease('[Group] Doraemon (2005) - 01 [1080p]'));
    expect([r.status, r.match?.work, r.match?.episode]).toEqual(['ok', 'doraemon-2005', 1]);
  });
});

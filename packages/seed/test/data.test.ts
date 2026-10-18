import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validate } from '@courmap/builder';
import { manualChanges } from '../src/files.js';

// The step 5 check on the committed data: after the last seed run, every part a hand-written
// file in data/works/ sets is exactly what the merged dataset carries.
const dataDir = fileURLToPath(new URL('../../../data/', import.meta.url));

describe('committed seed output', async () => {
  const result = await validate(dataDir);

  it('changes no manual mapping', () => {
    expect(result.ok).toBe(true);
    expect(manualChanges(result.checked)).toEqual([]);
  });

  it('covers every manual work that has an AniDB ID', () => {
    for (const w of result.checked.works.filter((x) => x.manual?.data.ids?.anidb != null)) {
      expect(w.seed, `${w.id} should have a seed line`).not.toBeNull();
    }
  });
});

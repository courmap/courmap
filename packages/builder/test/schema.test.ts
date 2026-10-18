import { describe, expect, it } from 'vitest';
import { loadSchema } from '../src/schema.js';

// Schemas are standalone files (no cross-file $ref, so any JSON Schema tool can read one in
// isolation). Shared definitions are therefore duplicated; this keeps the copies identical.
describe('schema definitions', () => {
  const defs = (kind: 'work' | 'sequence' | 'group') => (loadSchema(kind).$defs ?? {}) as Record<string, unknown>;

  it.each(['slug', 'sources'])('%s is identical in every schema', (name) => {
    expect(defs('sequence')[name]).toEqual(defs('work')[name]);
    expect(defs('group')[name]).toEqual(defs('work')[name]);
  });

  it('episodeRange is identical in work and sequence', () => {
    expect(defs('sequence').episodeRange).toEqual(defs('work').episodeRange);
  });
});

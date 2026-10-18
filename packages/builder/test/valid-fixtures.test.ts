import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validate } from '../src/validate.js';

// Each directory under fixtures/valid/ must pass validate with no diagnostics at all.
const root = fileURLToPath(new URL('./fixtures/valid/', import.meta.url));

describe('builder validate accepts valid fixtures', () => {
  it.each(readdirSync(root).sort())('%s', async (name) => {
    const dir = path.join(root, name);
    const result = await validate([{ dir, origin: 'manual' }], dir);
    expect(result.diagnostics).toEqual([]);
    expect(result.ok).toBe(true);
  });
});

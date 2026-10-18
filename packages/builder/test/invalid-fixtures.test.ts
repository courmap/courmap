import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { validate } from '../src/validate.js';

// Each directory under fixtures/invalid/ is a small data/ tree with deliberately broken
// files, plus expect.yaml listing exactly the diagnostics validate must report.
const root = fileURLToPath(new URL('./fixtures/invalid/', import.meta.url));
const cases = readdirSync(root).sort();

interface Expected {
  code: string;
  file: string;
  line?: number;
  message: string;
}

describe('builder validate rejects broken fixtures', () => {
  it('has fixtures', () => expect(cases.length).toBeGreaterThan(20));

  it.each(cases)('%s', async (name) => {
    const dir = path.join(root, name);
    const { errors, warnings = [] } = parse(readFileSync(path.join(dir, 'expect.yaml'), 'utf8')) as { errors: Expected[]; warnings?: Expected[] };
    const result = await validate(dir, { cwd: dir });

    expect(result.ok).toBe(errors.length === 0);
    const pick = (severity: string) =>
      result.diagnostics.filter((d) => d.severity === severity).map((d) => ({ code: d.code, file: d.file, line: d.line, message: d.message }));
    expect(pick('error')).toEqual(errors);
    expect(pick('warning')).toEqual(warnings);
    for (const d of result.diagnostics) {
      expect(d.message.length, 'messages should explain the problem').toBeGreaterThan(15);
      expect(d.line, 'every diagnostic should point at a line').toBeTypeOf('number');
    }
  });
});

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { parseRelease } from '../src/index.js';

const { cases } = parse(readFileSync(new URL('./fixtures.yaml', import.meta.url), 'utf8')) as {
  cases: { name: string; expect: Record<string, unknown> }[];
};

describe('parseRelease', () => {
  it('has fixtures', () => expect(cases.length).toBeGreaterThan(30));

  it.each(cases.map((c) => [c.name, c.expect] as const))('%s', (name, expected) => {
    const parsed = parseRelease(name) as unknown as Record<string, unknown>;
    const picked = Object.fromEntries(Object.keys(expected).map((k) => [k, parsed[k]]));
    expect(picked).toEqual(expected);
  });

  it('never throws on junk', () => {
    for (const junk of ['', '   ', '[', ']]][[', '----', '[] () {}', '.mkv', '\u0000\u0001', 'a'.repeat(2000)]) {
      expect(() => parseRelease(junk)).not.toThrow();
    }
  });
});

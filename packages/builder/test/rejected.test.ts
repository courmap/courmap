import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { Reporter } from '../src/diagnostics.js';
import { loadRejected, rejectsAiring, rejectsRelation } from '../src/rejected.js';

const tmp = mkdtempSync(path.join(tmpdir(), 'courmap-rejected-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
let n = 0;
const load = async (yaml: string | null, works = new Set(['a', 'b', 'c'])) => {
  const dir = path.join(tmp, String(n++));
  mkdirSync(dir, { recursive: true });
  if (yaml !== null) writeFileSync(path.join(dir, 'rejected.yaml'), yaml);
  const reporter = new Reporter();
  const list = await loadRejected(dir, reporter, { cwd: tmp, works });
  return { list, diagnostics: reporter.diagnostics.map((d) => `${d.code} ${d.line} ${d.message}`) };
};
const entry = (extra: string) => `rejected:\n  - kind: relation\n    work: b\n    prequel: a\n    reason: side by side\n    decided_by: Xwolv\n    date: 2026-10-19\n    origin: manual\n${extra}`;

describe('data/rejected.yaml', () => {
  it('is optional', async () => {
    expect(await load(null)).toEqual({ list: [], diagnostics: [] });
  });

  it('loads valid entries and matches proposals against them', async () => {
    const { list, diagnostics } = await load(
      entry('    link: https://github.com/courmap/courmap/pull/10\n  - kind: airing\n    work: c\n    episodes: 1\n    reason: placeholder count\n    decided_by: Xwolv\n    date: 2026-10-19\n    origin: manual\n'),
    );
    expect(diagnostics).toEqual([]);
    expect(rejectsRelation(list, 'b', 'a')?.reason).toBe('side by side');
    expect(rejectsRelation(list, 'b', 'c')).toBeUndefined();
    expect(rejectsAiring(list, 'c', { episodes: 1, status: 'airing' })?.reason).toBe('placeholder count');
    expect(rejectsAiring(list, 'c', { episodes: 12, status: 'airing' })).toBeUndefined();
  });

  it('reports unknown works, missing fields and a non-manual origin, and skips only the bad entries', async () => {
    const { list, diagnostics } = await load(
      `${entry('')}  - kind: relation\n    work: zz\n    prequel: a\n    reason: x\n    decided_by: Xwolv\n    date: 2026-10-19\n    origin: manual\n  - kind: relation\n    work: b\n    prequel: c\n    decided_by: Xwolv\n    date: 2026-10-19\n    origin: bot\n`,
    );
    expect(diagnostics).toEqual(['schema 16 missing required field "reason"', 'schema 21 "bot" is not allowed; expected "manual"', 'unknown-work 10 "zz" is not a work in the data']);
    expect(list.map((r) => r.work)).toEqual(['b', 'zz']);
  });
});

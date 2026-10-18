import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { MemoryDataset, compile, validate } from '@courmap/builder';
import { CourmapError, createClient, createOfflineClient, type CourmapClient } from '../src/index.js';

// Runs tests/conformance/cases against every client mode built so far. Results must be
// identical across modes, so each mode runs the same cases with the same expectations.
const conformance = fileURLToPath(new URL('../../../tests/conformance/', import.meta.url));

interface Case {
  name: string;
  op: 'lookup' | 'translate';
  ref: string;
  episode?: number | string;
  targets?: string[];
  expect?: unknown;
  expect_id?: string;
  error?: { code: string; field?: string; candidates?: string[] };
}

const cases: { file: string; c: Case }[] = readdirSync(path.join(conformance, 'cases'))
  .filter((f) => f.endsWith('.yaml'))
  .sort()
  .flatMap((file) => (parse(readFileSync(path.join(conformance, 'cases', file), 'utf8')) as { cases: Case[] }).cases.map((c) => ({ file, c })));

const tmp = mkdtempSync(path.join(tmpdir(), 'courmap-conformance-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

async function buildModes(): Promise<Record<string, CourmapClient>> {
  const v = await validate([{ dir: path.join(conformance, 'data'), origin: 'manual' }]);
  if (!v.ok || !v.records) throw new Error(`conformance data does not validate:\n${JSON.stringify(v.diagnostics, null, 2)}`);
  const meta = { dataVersion: 'conformance', builtAt: '2026-01-01T00:00:00.000Z', gitSha: 'conformance' };
  const dump = path.join(tmp, 'conformance.sqlite');
  compile(v.records, v.checked, dump, meta);
  return {
    offline: createOfflineClient(dump),
    // Not a published mode: the builder's in-memory dataset, kept here as a reference implementation.
    memory: createClient(
      new MemoryDataset(v.records, { data_version: 'conformance', git_sha: 'conformance', built_at: meta.builtAt, schema_version: '1' }),
    ),
  };
}

const run = (client: CourmapClient, c: Case) =>
  c.op === 'lookup' ? client.lookup(c.ref) : client.translate(c.ref, c.episode!, c.targets ?? []);

describe('conformance', async () => {
  const modes = await buildModes();
  afterAll(() => Object.values(modes).forEach((m) => m.close()));

  it('has cases', () => expect(cases.length).toBeGreaterThan(40));

  for (const [mode, client] of Object.entries(modes)) {
    describe(mode, () => {
      it.each(cases.map(({ file, c }) => [`${file}: ${c.name}`, c] as const))('%s', async (_label, c) => {
        if (c.error) {
          const err = await run(client, c).then(
            (r) => ({ unexpectedResult: r }),
            (e: unknown) => e,
          );
          expect(err).toBeInstanceOf(CourmapError);
          const e = err as CourmapError;
          expect(e.code).toBe(c.error.code);
          if (c.error.field !== undefined) expect(e.field).toBe(c.error.field);
          if (c.error.candidates !== undefined) expect(e.candidates).toEqual(c.error.candidates);
          return;
        }
        const result = await run(client, c);
        if (c.expect_id !== undefined) expect((result as { id: string }).id).toBe(c.expect_id);
        else expect(result).toEqual(c.expect);
      });
    });
  }
});

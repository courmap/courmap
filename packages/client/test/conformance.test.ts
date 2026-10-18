import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { MemoryDataset, compile, generateShards, validate } from '@courmap/builder';
import { CourmapError, createClient, createOfflineClient, createRemoteClient, type CourmapClient } from '../src/index.js';
import { serveStatic, type StaticServer } from './static-server.js';

// Runs tests/conformance/cases against every client mode: offline (SQLite dump), remote (static
// shards generated from that dump, served over HTTP from a local server) and the builder's
// in-memory dataset. Results must be identical, so every mode gets the same expectations.
const conformance = fileURLToPath(new URL('../../../tests/conformance/', import.meta.url));

interface Case {
  name: string;
  op: 'lookup' | 'translate' | 'resolve';
  ref: string;
  release?: string;
  expect_resolve?: {
    status: string;
    work?: string;
    episode?: number | null;
    episode_to?: number;
    confidence?: number;
    version?: number;
    batch_length?: number;
    top?: string[];
  };
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

let server: StaticServer | null = null;
afterAll(() => server?.close());

async function buildModes(): Promise<Record<string, CourmapClient>> {
  const v = await validate(path.join(conformance, 'data'));
  if (!v.ok || !v.records) throw new Error(`conformance data does not validate:\n${JSON.stringify(v.diagnostics, null, 2)}`);
  const meta = { dataVersion: 'conformance', builtAt: '2026-01-01T00:00:00.000Z', gitSha: 'conformance' };
  const dump = path.join(tmp, 'conformance.sqlite');
  compile(v.records, v.checked, dump, meta);
  const shards = path.join(tmp, 'shards', 'v1');
  await generateShards(dump, shards);
  server = await serveStatic(shards);
  return {
    offline: createOfflineClient(dump),
    remote: createRemoteClient(server.url),
    // Not a published mode: the builder's in-memory dataset, kept here as a reference implementation.
    memory: createClient(
      new MemoryDataset(v.records, { data_version: 'conformance', git_sha: 'conformance', built_at: meta.builtAt, schema_version: '3' }),
    ),
  };
}

const run = (client: CourmapClient, c: Case) =>
  c.op === 'lookup' ? client.lookup(c.ref) : c.op === 'resolve' ? client.resolve(c.release!) : client.translate(c.ref, c.episode!, c.targets ?? []);

describe('conformance', async () => {
  const modes = await buildModes();
  afterAll(() => Object.values(modes).forEach((m) => m.close()));

  it('has cases', () => expect(cases.length).toBeGreaterThan(50));

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
        if (c.expect_resolve) {
          const r = result as Awaited<ReturnType<CourmapClient['resolve']>>;
          const x = c.expect_resolve;
          expect(r.status).toBe(x.status);
          if (x.work !== undefined) expect(r.match?.work).toBe(x.work);
          if (x.episode !== undefined) expect(r.match?.episode).toBe(x.episode);
          if (x.episode_to !== undefined) expect(r.match?.episode_to).toBe(x.episode_to);
          if (x.confidence !== undefined) expect(r.match?.confidence).toBe(x.confidence);
          if (x.version !== undefined) expect(r.parsed.version).toBe(x.version);
          if (x.batch_length !== undefined) expect(r.match?.batch).toHaveLength(x.batch_length);
          if (x.top !== undefined) expect(r.candidates.slice(0, x.top.length).map((k) => k.work).sort()).toEqual([...x.top].sort());
          if (r.status !== 'ok') expect(r.match).toBeNull();
          return;
        }
        if (c.expect_id !== undefined) expect((result as { id: string }).id).toBe(c.expect_id);
        else expect(result).toEqual(c.expect);
      });
    });
  }
});

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { compile, generateShards, validate } from '@courmap/builder';
import { createRemoteClient } from '../src/index.js';
import { serveStatic } from './static-server.js';

// Remote-mode behaviour the conformance suite cannot see: caching by data_version, the
// on-disk cache, meta.json refresh and HTTP failures.
const data = fileURLToPath(new URL('../../../tests/conformance/data/', import.meta.url));
const tmp = mkdtempSync(path.join(tmpdir(), 'courmap-remote-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('remote client', async () => {
  const v = await validate(data);
  const dump = path.join(tmp, 'fixture.sqlite');
  compile(v.records!, v.checked, dump, { dataVersion: '2026.01', builtAt: '2026-01-01T00:00:00.000Z', gitSha: 'test' });
  const root = path.join(tmp, 'shards');
  await generateShards(dump, root);
  const server = await serveStatic(root);
  afterAll(() => server.close());
  beforeEach(() => {
    server.requests.length = 0;
    server.failPrefix = null;
  });

  it('writes the spec layout, meta.json included', () => {
    const meta = JSON.parse(readFileSync(path.join(root, 'meta.json'), 'utf8')) as Record<string, unknown>;
    expect(meta).toMatchObject({ data_version: '2026.01', schema_version: '3', counts: { works: 8, sequences: 2, groups: 1 } });
    expect(JSON.parse(readFileSync(path.join(root, 'refs', 'tvdb_show', '5.json'), 'utf8'))).toMatchObject({ '5002': ['split-show', 'split-show-part-2'] });
    expect(JSON.parse(readFileSync(path.join(root, 'refs', 'imdb', '0.json'), 'utf8'))).toEqual({ tt0000001: ['simple-show'], tt0000007: ['a-movie'] });
  });

  it('fetches each file once and reuses it', async () => {
    const client = createRemoteClient(server.url);
    await client.translate('anilist:2003', 5, ['tvdb_show']);
    await client.translate('anilist:2003', 6, ['tvdb_show']);
    await client.lookup('anilist:2003');
    expect(server.requests.sort()).toEqual(['meta.json', 'refs/anilist/2.json', 'works/split-show-part-2.json']);
  });

  it('serves a second client from the disk cache with no shard requests', async () => {
    const cacheDir = path.join(tmp, 'cache-a');
    await createRemoteClient(server.url, { cacheDir }).lookup('anidb:1001');
    server.requests.length = 0;
    server.failPrefix = 'works/'; // the network would fail now
    const work = await createRemoteClient(server.url, { cacheDir }).lookup('anidb:1001');
    expect(work.id).toBe('simple-show');
    expect(server.requests).toEqual(['meta.json']);
  });

  it('keeps meta.json for metaMaxAgeMs, then starts a fresh cache when data_version changes', async () => {
    let now = 0;
    const client = createRemoteClient(server.url, { metaMaxAgeMs: 1000, now: () => now });
    expect((await client.meta()).data_version).toBe('2026.01');
    await client.lookup('anidb:1001');
    now = 500;
    await client.lookup('anidb:1001');
    expect(server.requests.filter((r) => r === 'meta.json')).toHaveLength(1);

    const metaFile = path.join(root, 'meta.json');
    const original = readFileSync(metaFile, 'utf8');
    writeFileSync(metaFile, original.replace('"2026.01"', '"2026.02"'));
    try {
      now = 2000;
      server.requests.length = 0;
      const work = await client.lookup('anidb:1001');
      expect(work.data_version).toBe('2026.02');
      expect(server.requests.sort()).toEqual(['meta.json', 'refs/anidb/1.json', 'works/simple-show.json']);
    } finally {
      writeFileSync(metaFile, original);
    }
  });

  it('reports unknown refs as not_found and HTTP failures as errors', async () => {
    const client = createRemoteClient(server.url);
    await expect(client.lookup('anilist:9999')).rejects.toMatchObject({ code: 'not_found' });
    server.failPrefix = 'works/';
    await expect(createRemoteClient(server.url).lookup('anidb:1004')).rejects.toThrow(/HTTP 500/);
  });

  it('refuses to replace a directory that does not look like a shard tree', async () => {
    writeFileSync(path.join(tmp, 'keep.txt'), 'x');
    await expect(generateShards(dump, tmp)).rejects.toThrow(/refusing/);
    expect(readFileSync(path.join(tmp, 'keep.txt'), 'utf8')).toBe('x');
  });
});

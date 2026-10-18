import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { CreateBucketCommand, HeadObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { afterAll, describe, expect, it } from 'vitest';
import { compile, generateShards, validate } from '@courmap/builder';
import { buildAssets, s3Client, uploadShards, type S3Target } from '../src/index.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const tmp = mkdtempSync(path.join(tmpdir(), 'courmap-release-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

async function fixtureDump(): Promise<{ dump: string; shards: string }> {
  const v = await validate(path.join(root, 'tests/conformance/data'));
  const dump = path.join(tmp, 'fixture.sqlite');
  compile(v.records!, v.checked, dump, { dataVersion: '2026.01', builtAt: '2026-01-01T00:00:00.000Z', gitSha: 'test' });
  const shards = path.join(tmp, 'shards', 'v1');
  await generateShards(dump, shards);
  return { dump, shards };
}

describe('release assets', async () => {
  const { dump, shards } = await fixtureDump();

  it('builds dumps, license, attribution and checksums deterministically', async () => {
    const a = await buildAssets(dump, path.join(tmp, 'a'), root);
    const b = await buildAssets(dump, path.join(tmp, 'b'), root);
    expect(a.files).toEqual(['courmap-2026.01.sqlite.gz', 'courmap-2026.01.json.gz', 'LICENSE', 'ATTRIBUTION.md', 'SHA256SUMS']);
    for (const f of a.files) expect(readFileSync(path.join(tmp, 'b', f)), f).toEqual(readFileSync(path.join(tmp, 'a', f)));
    expect(b.sha256).toEqual(a.sha256);
    expect(readFileSync(path.join(tmp, 'a', 'LICENSE'), 'utf8')).toBe(readFileSync(path.join(root, 'DATA_LICENSE'), 'utf8'));
    const sums = readFileSync(path.join(tmp, 'a', 'SHA256SUMS'), 'utf8').trim().split('\n');
    expect(sums).toHaveLength(4);
    for (const line of sums) expect(line).toMatch(/^[0-9a-f]{64} {2}\S+$/);
  });

  it('ships the same data as JSON', async () => {
    await buildAssets(dump, path.join(tmp, 'c'), root);
    const json = JSON.parse(gunzipSync(readFileSync(path.join(tmp, 'c', 'courmap-2026.01.json.gz'))).toString('utf8'));
    expect(json.meta).toMatchObject({ data_version: '2026.01', schema_version: '3' });
    expect(json.works).toHaveLength(8);
    expect(json.sequences.map((s: { id: string }) => s.id)).toEqual(['part-two-only', 'split-show-absolute']);
    expect(json.groups.map((g: { id: string }) => g.id)).toEqual(['fixturesubs']);
  });

  it('plans an upload with meta.json last, without credentials', async () => {
    const r = await uploadShards(shards, null, { prefix: 'v1/' });
    expect(r.dryRun).toBe(true);
    expect(r.order.at(-1)).toBe('v1/meta.json');
    expect(r.uploaded).toBeGreaterThan(20);
  });
});

// End to end against a real S3-compatible server. CI starts one (adobe/s3mock) and sets
// S3_TEST_ENDPOINT; locally, point it at any S3-compatible server to run this.
const endpoint = process.env.S3_TEST_ENDPOINT;
describe.skipIf(!endpoint)('shard upload to S3-compatible storage', async () => {
  if (!endpoint) return; // the body still runs when skipped; do no setup
  const { shards } = await fixtureDump();
  const target: S3Target = { endpoint: endpoint!, bucket: `courmap-test-${Date.now()}`, accessKeyId: 'test', secretAccessKey: 'test', region: 'us-east-1' };
  const client = s3Client(target);
  await client.send(new CreateBucketCommand({ Bucket: target.bucket }));
  const keys = async () => ((await client.send(new ListObjectsV2Command({ Bucket: target.bucket, Prefix: 'v1/' }))).Contents ?? []).map((o) => o.Key!).sort();

  it('uploads every file, meta.json last, with the caching contract', async () => {
    const r = await uploadShards(shards, target, { prefix: 'v1/' });
    expect(r.dryRun).toBe(false);
    expect(r.order.at(-1)).toBe('v1/meta.json');
    expect((await keys()).length).toBe(r.uploaded);
    const meta = await client.send(new HeadObjectCommand({ Bucket: target.bucket, Key: 'v1/meta.json' }));
    expect(meta.CacheControl).toBe('public, max-age=300');
    expect(meta.ContentType).toBe('application/json');
    const work = await client.send(new HeadObjectCommand({ Bucket: target.bucket, Key: 'v1/works/simple-show.json' }));
    expect(work.CacheControl).toBe('public, max-age=3600, stale-while-revalidate=86400');
    const aliases = await client.send(new HeadObjectCommand({ Bucket: target.bucket, Key: 'v1/aliases.json.zst' }));
    expect(aliases.ContentType).toBe('application/zstd');
  });

  it('skips unchanged files, and prunes stale ones only after meta.json', async () => {
    const again = await uploadShards(shards, target, { prefix: 'v1/' });
    expect(again.uploaded).toBe(0);
    expect(again.unchanged).toBeGreaterThan(20);

    writeFileSync(path.join(shards, 'works', 'simple-show.json'), readFileSync(path.join(shards, 'works', 'simple-show.json'), 'utf8').replace('"year":2020', '"year":2021'));
    unlinkSync(path.join(shards, 'works', 'a-movie.json'));
    const changed = await uploadShards(shards, target, { prefix: 'v1/', prune: true });
    expect(changed.uploaded).toBe(1);
    expect(changed.deleted).toBe(1);
    expect(await keys()).not.toContain('v1/works/a-movie.json');
  });
});

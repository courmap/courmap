import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import { CreateBucketCommand, HeadObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { afterAll, describe, expect, it } from 'vitest';
import { compile, generateShards, validate } from '@courmap/builder';
import { buildAssets, fillMetaDumps, s3Client, verifyRelease, uploadShards, type S3Target } from '../src/index.js';

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
    expect(a.files).toEqual(['courmap-2026.01.sqlite.gz', 'courmap-2026.01.json.gz', 'LICENSE', 'DATA_LICENSE', 'ATTRIBUTION.md', 'SHA256SUMS']);
    for (const f of a.files) expect(readFileSync(path.join(tmp, 'b', f)), f).toEqual(readFileSync(path.join(tmp, 'a', f)));
    expect(b.sha256).toEqual(a.sha256);
    expect(readFileSync(path.join(tmp, 'a', 'LICENSE'), 'utf8')).toBe(readFileSync(path.join(root, 'LICENSE'), 'utf8'));
    expect(readFileSync(path.join(tmp, 'a', 'DATA_LICENSE'), 'utf8')).toBe(readFileSync(path.join(root, 'DATA_LICENSE'), 'utf8'));
    const sums = readFileSync(path.join(tmp, 'a', 'SHA256SUMS'), 'utf8').trim().split('\n');
    expect(sums).toHaveLength(5);
    for (const line of sums) expect(line).toMatch(/^[0-9a-f]{64} {2}\S+$/);
  });

  it('ships the same data as JSON', async () => {
    await buildAssets(dump, path.join(tmp, 'c'), root);
    const json = JSON.parse(gunzipSync(readFileSync(path.join(tmp, 'c', 'courmap-2026.01.json.gz'))).toString('utf8'));
    expect(json.meta).toMatchObject({ data_version: '2026.01', schema_version: '4' });
    expect(json.works).toHaveLength(17);
    expect(json.sequences.map((s: { id: string }) => s.id)).toEqual(['continuous-show-absolute', 'part-two-only', 'split-show-absolute']);
    expect(json.groups.map((g: { id: string }) => g.id)).toEqual(['fixturesubs']);
  });

  it('points meta.json at the release for its data version', async () => {
    const assets = path.join(tmp, 'm');
    await buildAssets(dump, assets, root);
    const dumps = await fillMetaDumps(shards, assets, 'courmap/courmap');
    const sums = readFileSync(path.join(assets, 'SHA256SUMS'), 'utf8');
    expect(dumps.tag).toBe('data-2026.01');
    expect(dumps.sqlite.url).toBe('https://github.com/courmap/courmap/releases/download/data-2026.01/courmap-2026.01.sqlite.gz');
    expect(sums).toContain(`${dumps.sqlite.sha256}  courmap-2026.01.sqlite.gz`);
    expect(sums).toContain(`${dumps.json.sha256}  courmap-2026.01.json.gz`);
    expect(JSON.parse(readFileSync(path.join(shards, 'meta.json'), 'utf8')).dumps).toEqual(dumps);
    // meta.json is a release asset too, covered by SHA256SUMS (decision S6.2).
    expect(readFileSync(path.join(assets, 'meta.json'), 'utf8')).toBe(readFileSync(path.join(shards, 'meta.json'), 'utf8'));
    expect(readFileSync(path.join(assets, 'SHA256SUMS'), 'utf8')).toMatch(/^[0-9a-f]{64} {2}meta\.json$/m);
  });

  it('verifies a complete release, and catches a tampered one', async () => {
    const assets = path.join(tmp, 'v');
    await buildAssets(dump, assets, root);
    await fillMetaDumps(shards, assets, 'courmap/courmap');
    const ok = await verifyRelease(assets, root, 'courmap/courmap');
    expect(ok.problems).toEqual([]);
    expect(ok.files).toEqual(['ATTRIBUTION.md', 'DATA_LICENSE', 'LICENSE', 'SHA256SUMS', 'courmap-2026.01.json.gz', 'courmap-2026.01.sqlite.gz', 'meta.json']);
    writeFileSync(path.join(assets, 'courmap-2026.01.json.gz'), gzipSync(Buffer.from('{"meta":{"data_version":"2026.01"},"works":[]}')));
    const bad = await verifyRelease(assets, root, 'courmap/courmap');
    expect(bad.problems).toEqual([
      'SHA256SUMS: wrong checksum for courmap-2026.01.json.gz',
      'meta.json dumps.json.sha256 does not match courmap-2026.01.json.gz',
      'the JSON dump has no works',
    ]);
  });

  it('refuses assets from another data version', async () => {
    const other = path.join(tmp, 'other');
    mkdirSync(other, { recursive: true });
    writeFileSync(path.join(other, 'SHA256SUMS'), `${'0'.repeat(64)}  courmap-1999.01.sqlite.gz
`);
    await expect(fillMetaDumps(shards, other, 'courmap/courmap')).rejects.toThrow(/has no courmap-2026.01.sqlite.gz/);
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
    const aliases = await client.send(new HeadObjectCommand({ Bucket: target.bucket, Key: 'v1/aliases/si.json' }));
    expect(aliases.ContentType).toBe('application/json');
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

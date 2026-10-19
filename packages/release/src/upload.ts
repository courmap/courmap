import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { DeleteObjectsCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

/** S3-compatible target. For Cloudflare R2: endpoint https://<account>.r2.cloudflarestorage.com, region auto. */
export interface S3Target {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
}

export interface UploadOptions {
  /** Object key prefix, e.g. "v1/". */
  prefix: string;
  /** Plan only: no writes or deletes. Without a target, every file counts as new. */
  dryRun?: boolean;
  /** Delete objects under the prefix that are not in this release, after meta.json is written. */
  prune?: boolean;
  concurrency?: number;
  log?: (line: string) => void;
}

export interface UploadReport {
  uploaded: number;
  unchanged: number;
  deleted: number;
  /** Keys in the order they were written; meta.json is always last. */
  order: string[];
  dryRun: boolean;
}

// The caching contract (docs/SPEC.md, "Caching contract").
const META_CACHE = 'public, max-age=300';
const SHARD_CACHE = 'public, max-age=3600, stale-while-revalidate=86400';

const contentType = (key: string) => (key.endsWith('.json') ? 'application/json' : 'application/octet-stream');

export function s3Client(t: S3Target): S3Client {
  return new S3Client({
    endpoint: t.endpoint,
    region: t.region ?? 'auto',
    credentials: { accessKeyId: t.accessKeyId, secretAccessKey: t.secretAccessKey },
    // R2 (and local test servers) are addressed by path, and R2 does not accept the SDK's
    // default extra checksums, so only send checksums S3 requires.
    forcePathStyle: true,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

async function listFiles(dir: string, rel = ''): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await listFiles(dir, r)));
    else if (e.isFile()) out.push(r);
  }
  return out.sort();
}

async function remoteEtags(client: S3Client, bucket: string, prefix: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  let token: string | undefined;
  do {
    const page = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
    for (const o of page.Contents ?? []) if (o.Key && o.ETag) out.set(o.Key, o.ETag.replace(/"/g, ''));
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return out;
}

/**
 * Publishes a shard tree (the /v1/ directory written by `builder shards`) to an S3-compatible
 * bucket. Files whose MD5 already matches the remote ETag are skipped. Every other file is
 * written first, meta.json last, so a client polling meta.json never sees a version whose
 * files are not all in place. Pruning, when asked, happens only after meta.json.
 */
export async function uploadShards(dir: string, target: S3Target | null, opts: UploadOptions): Promise<UploadReport> {
  const log = opts.log ?? (() => {});
  const files = await listFiles(dir);
  if (!files.includes('meta.json')) throw new Error(`${dir} has no meta.json; is it a shard tree?`);
  const prefix = opts.prefix.endsWith('/') || opts.prefix === '' ? opts.prefix : `${opts.prefix}/`;
  const client = target ? s3Client(target) : null;
  const remote = client ? await remoteEtags(client, target!.bucket, prefix) : new Map<string, string>();
  const dryRun = opts.dryRun === true || client === null;
  const report: UploadReport = { uploaded: 0, unchanged: 0, deleted: 0, order: [], dryRun };

  const put = async (rel: string) => {
    const key = prefix + rel;
    const body = await readFile(path.join(dir, rel));
    const md5 = createHash('md5').update(body).digest('hex');
    if (remote.get(key) === md5) {
      report.unchanged++;
      return;
    }
    report.uploaded++;
    report.order.push(key);
    if (dryRun) return;
    await client!.send(
      new PutObjectCommand({
        Bucket: target!.bucket,
        Key: key,
        Body: body,
        ContentType: contentType(key),
        CacheControl: rel === 'meta.json' ? META_CACHE : SHARD_CACHE,
      }),
    );
  };

  const rest = files.filter((f) => f !== 'meta.json');
  const limit = opts.concurrency ?? 32;
  for (let i = 0; i < rest.length; i += limit) await Promise.all(rest.slice(i, i + limit).map(put));
  // meta.json last: it is what makes the new version visible.
  await put('meta.json');
  if (!report.order.includes(`${prefix}meta.json`)) report.order.push(`${prefix}meta.json (unchanged)`);

  if (opts.prune && client) {
    const keep = new Set(files.map((f) => prefix + f));
    const stale = [...remote.keys()].filter((k) => !keep.has(k)).sort();
    report.deleted = stale.length;
    for (let i = 0; i < stale.length && !dryRun; i += 1000) {
      await client.send(new DeleteObjectsCommand({ Bucket: target!.bucket, Delete: { Objects: stale.slice(i, i + 1000).map((Key) => ({ Key })) } }));
    }
  }
  log(`${dryRun ? 'Dry run: would upload' : 'Uploaded'} ${report.uploaded} file(s), ${report.unchanged} unchanged, ${report.deleted} stale ${dryRun ? 'to delete' : 'deleted'}; meta.json last.`);
  return report;
}

/** Reads the S3 target from S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY (and S3_REGION). Null when incomplete. */
export function targetFromEnv(env: NodeJS.ProcessEnv = process.env): S3Target | null {
  const { S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_REGION } = env;
  if (!S3_ENDPOINT || !S3_BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) return null;
  return { endpoint: S3_ENDPOINT, bucket: S3_BUCKET, accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY, ...(S3_REGION && { region: S3_REGION }) };
}

import { refShard, type Dataset, type Meta, type Provider, type SequenceRecord, type WorkRecord } from '@courmap/core';
import { createClient, type CourmapClient } from './client.js';

export interface RemoteOptions {
  /** Defaults to the global fetch. */
  fetch?: typeof fetch;
  /** On-disk cache directory. Files are stored under <cacheDir>/<data_version>/, so a new data version starts a fresh cache. */
  cacheDir?: string;
  /** How long meta.json is trusted before it is fetched again. Default: one hour (the caching contract). */
  metaMaxAgeMs?: number;
  /** Clock, for tests. */
  now?: () => number;
}

const SAFE = /^[A-Za-z0-9._-]+$/;
const HOUR = 60 * 60 * 1000;

/**
 * A Dataset over the static shards (docs/SPEC.md, "Hosting"): fetches files on demand from
 * baseUrl (the /v1/ root) and caches them by data_version. Missing files (404) mean the
 * record does not exist; any other HTTP failure is an error.
 */
export class RemoteDataset implements Dataset {
  private readonly base: string;
  private readonly fetchFn: typeof fetch;
  private readonly maxAge: number;
  private readonly now: () => number;
  private metaValue: { meta: Meta; at: number } | null = null;
  private metaRequest: Promise<Meta> | null = null;
  private files = new Map<string, Promise<unknown>>();
  private filesVersion: string | null = null;

  constructor(
    baseUrl: string,
    private readonly opts: RemoteOptions = {},
  ) {
    this.base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    this.fetchFn = opts.fetch ?? fetch;
    this.maxAge = opts.metaMaxAgeMs ?? HOUR;
    this.now = opts.now ?? Date.now;
  }

  async meta(): Promise<Meta> {
    if (this.metaValue && this.now() - this.metaValue.at < this.maxAge) return this.metaValue.meta;
    this.metaRequest ??= this.fetchMeta().finally(() => (this.metaRequest = null));
    return this.metaRequest;
  }

  async getWork(id: string): Promise<WorkRecord | undefined> {
    return SAFE.test(id) ? this.file<WorkRecord>(`works/${id}.json`) : undefined;
  }

  async findWorkIds(provider: Provider, providerId: string): Promise<string[]> {
    if (!SAFE.test(providerId)) return [];
    const shard = await this.file<Record<string, string[]>>(`refs/${provider}/${refShard(provider, providerId)}.json`);
    return shard?.[providerId] ?? [];
  }

  async getSequence(id: string): Promise<SequenceRecord | undefined> {
    return SAFE.test(id) ? this.file<SequenceRecord>(`sequences/${id}.json`) : undefined;
  }

  private async fetchMeta(): Promise<Meta> {
    const res = await this.fetchFn(`${this.base}meta.json`);
    if (!res.ok) throw new Error(`GET ${this.base}meta.json: HTTP ${res.status}`);
    const m = (await res.json()) as Meta;
    if (!SAFE.test(m.data_version)) throw new Error(`meta.json has an unusable data_version "${m.data_version}"`);
    const meta: Meta = { data_version: m.data_version, git_sha: m.git_sha, built_at: m.built_at, schema_version: m.schema_version };
    this.metaValue = { meta, at: this.now() };
    return meta;
  }

  /** One shard file for the current data_version: memory, then disk, then network. */
  private async file<T>(rel: string): Promise<T | undefined> {
    const { data_version } = await this.meta();
    if (this.filesVersion !== data_version) {
      this.files = new Map();
      this.filesVersion = data_version;
    }
    let p = this.files.get(rel);
    if (!p) {
      p = this.load(data_version, rel);
      this.files.set(rel, p);
      p.catch(() => this.files.delete(rel)); // retry failures next time
    }
    return (await p) as T | undefined;
  }

  private async load(version: string, rel: string): Promise<unknown> {
    const disk = this.opts.cacheDir ? await diskCache(this.opts.cacheDir, version, rel) : null;
    const cached = await disk?.read();
    if (cached) return cached.value;
    const res = await this.fetchFn(this.base + rel);
    if (res.status === 404) {
      await disk?.write(null);
      return undefined;
    }
    if (!res.ok) throw new Error(`GET ${this.base}${rel}: HTTP ${res.status}`);
    const body = await res.text();
    const value = JSON.parse(body) as unknown;
    await disk?.write(body);
    return value;
  }
}

/** File-backed cache entry. fs is imported lazily so bundles without a disk cache (the Worker) never load it. */
async function diskCache(dir: string, version: string, rel: string) {
  const [{ mkdir, readFile, writeFile }, path] = await Promise.all([import('node:fs/promises'), import('node:path')]);
  const file = path.join(dir, version, ...rel.split('/'));
  return {
    // A cached 404 is stored as the literal "null". A miss is null; a hit wraps the value.
    read: async (): Promise<{ value: unknown } | null> => {
      try {
        const text = await readFile(file, 'utf8');
        return { value: text === 'null' ? undefined : (JSON.parse(text) as unknown) };
      } catch {
        return null;
      }
    },
    write: async (body: string | null) => {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, body ?? 'null');
    },
  };
}

/** A client over the static shards at baseUrl (the /v1/ root). */
export function createRemoteClient(baseUrl: string, opts: RemoteOptions = {}): CourmapClient {
  return createClient(new RemoteDataset(baseUrl, opts));
}

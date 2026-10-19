import { COURMAP_URLS, refShard, type AliasIndex, type Dataset, type GroupRecord, type Meta, type Provider, type SequenceRecord, type WorkRecord } from '@courmap/core';
import { decompress } from 'fzstd';
import { createClient, type CourmapClient } from './client.js';

/**
 * A persistent cache for shard files, keyed by data_version and path. The Node entry point
 * provides one on disk (`cacheDir`); in a browser or Worker the in-memory cache is enough.
 */
export interface ShardStore {
  /** The cached body: a JSON string, null for a cached 404, undefined for a miss. */
  read(version: string, rel: string): Promise<string | null | undefined>;
  write(version: string, rel: string, body: string | null): Promise<void>;
}

export interface RemoteOptions {
  /** Defaults to the global fetch. */
  fetch?: typeof fetch;
  /** Persistent cache beyond memory. */
  store?: ShardStore;
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
 * record does not exist; any other HTTP failure is an error. It uses only fetch and plain
 * JavaScript (zstd included), so it runs unchanged in Node, browsers and Workers (decision S4.7).
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
    baseUrl: string = COURMAP_URLS.data,
    private readonly opts: RemoteOptions = {},
  ) {
    this.base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    // Called unbound, browsers reject window.fetch ("Illegal invocation"), so wrap it.
    this.fetchFn = opts.fetch ?? ((input, init) => fetch(input, init));
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

  /** aliases.json.zst: one download per data_version, decompressed in memory. */
  async aliasIndex(): Promise<AliasIndex> {
    return (await this.file<AliasIndex>('aliases.json.zst', 'zstd'))!;
  }

  async groups(): Promise<GroupRecord[]> {
    return (await this.file<GroupRecord[]>('groups.json')) ?? [];
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

  /** One shard file for the current data_version: memory, then the store, then network. */
  private async file<T>(rel: string, encoding: 'json' | 'zstd' = 'json'): Promise<T | undefined> {
    const { data_version } = await this.meta();
    if (this.filesVersion !== data_version) {
      this.files = new Map();
      this.filesVersion = data_version;
    }
    let p = this.files.get(rel);
    if (!p) {
      p = this.load(data_version, rel, encoding);
      this.files.set(rel, p);
      p.catch(() => this.files.delete(rel)); // retry failures next time
    }
    return (await p) as T | undefined;
  }

  private async load(version: string, rel: string, encoding: 'json' | 'zstd'): Promise<unknown> {
    const store = this.opts.store;
    const cached = await store?.read(version, rel);
    if (cached !== undefined) return cached === null ? undefined : (JSON.parse(cached) as unknown);
    const res = await this.fetchFn(this.base + rel);
    if (res.status === 404) {
      await store?.write(version, rel, null);
      return undefined;
    }
    if (!res.ok) throw new Error(`GET ${this.base}${rel}: HTTP ${res.status}`);
    const body = encoding === 'zstd' ? new TextDecoder().decode(decompress(new Uint8Array(await res.arrayBuffer()))) : await res.text();
    const value = JSON.parse(body) as unknown;
    await store?.write(version, rel, body);
    return value;
  }
}

/** A client over the static shards at baseUrl (the /v1/ root; default https://data.courmap.com/v1/). */
export function createRemoteClient(baseUrl: string = COURMAP_URLS.data, opts: RemoteOptions = {}): CourmapClient {
  return createClient(new RemoteDataset(baseUrl, opts));
}

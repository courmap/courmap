import type { AliasIndex } from './aliases.js';

/**
 * The alias index split for on-demand loading (Xwolv decision S6.1). Every mode reads aliases
 * through these shards, so resolve and search see exactly the same candidates offline, in
 * memory and over the network:
 *
 *   aliases/<prefix>.json     every normalized alias whose first two characters are <prefix>,
 *                             with its works: [[alias, [work, ...]], ...], sorted by alias
 *   aliases/grams/<n>.json    the trigram set for fuzzy matching, in GRAM_BUCKETS files:
 *                             { trigram: [prefix, ...] } for every informative Latin trigram
 */

/** [normalized alias, work ids]. */
export type AliasEntry = [string, string[]];

/** Trigram set files. */
export const GRAM_BUCKETS = 256;
/** A trigram in more aliases than this ("  a", "ion") carries no signal and is left out of the set. */
export const COMMON_GRAM = 5000;
/** A trigram found under more prefixes than this cannot narrow the search either. */
export const GRAM_MAX_PREFIXES = 50;
/**
 * Only Latin trigrams (a-z, 0-9, space) go in the set: fuzzy matching is for misspelled
 * romanized titles, and non-Latin titles are matched exactly or within their own prefix shard.
 * This keeps the set at well under a megabyte instead of 14 MB.
 */
const LATIN_GRAM = /^[a-z0-9 ]+$/;

/**
 * The file-safe shard key for a normalized alias: its first two code points, a-z and 0-9 as
 * they are, anything else as "_" plus six hex digits ("葬送" is "_00846c_009001"). Not "-": file
 * names starting with a hyphen read as options to command-line tools.
 */
export function aliasShardKey(normalized: string): string {
  return [...normalized]
    .slice(0, 2)
    .map((c) => (/[a-z0-9]/.test(c) ? c : `_${c.codePointAt(0)!.toString(16).padStart(6, '0')}`))
    .join('');
}

/** Trigrams of a normalized string, padded so word starts and ends count. Code points, not UTF-16 units. */
export function trigrams(s: string): Set<string> {
  const cp = [...`  ${s} `];
  const out = new Set<string>();
  for (let i = 0; i + 3 <= cp.length; i++) out.add(cp.slice(i, i + 3).join(''));
  return out;
}

/** Which trigram set file holds a trigram: FNV-1a over its UTF-8 bytes. */
export function gramBucket(gram: string): number {
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(gram)) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % GRAM_BUCKETS;
}

export interface AliasShardSet {
  data_version: string;
  /** Prefix key to its aliases. */
  shards: Map<string, AliasEntry[]>;
  /** Bucket number to { trigram: sorted prefix keys }. */
  grams: Map<number, Record<string, string[]>>;
}

/** Splits a full alias index into prefix shards and the trigram set. Deterministic: same index, same files. */
export function shardAliasIndex(index: AliasIndex): AliasShardSet {
  const shards = new Map<string, AliasEntry[]>();
  const gramAliases = new Map<string, number>();
  const gramPrefixes = new Map<string, Set<string>>();
  for (const entry of index.aliases) {
    const key = aliasShardKey(entry[0]);
    let list = shards.get(key);
    if (!list) shards.set(key, (list = []));
    list.push(entry);
    for (const g of trigrams(entry[0])) {
      gramAliases.set(g, (gramAliases.get(g) ?? 0) + 1);
      let p = gramPrefixes.get(g);
      if (!p) gramPrefixes.set(g, (p = new Set()));
      p.add(key);
    }
  }
  const grams = new Map<number, Record<string, string[]>>();
  for (const [g, prefixes] of [...gramPrefixes].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
    if (gramAliases.get(g)! > COMMON_GRAM || prefixes.size > GRAM_MAX_PREFIXES || !LATIN_GRAM.test(g)) continue;
    const bucket = gramBucket(g);
    let b = grams.get(bucket);
    if (!b) grams.set(bucket, (b = {}));
    b[g] = [...prefixes].sort();
  }
  return { data_version: index.data_version, shards, grams };
}

/**
 * Serves shards from a full index built on first use: the offline and in-memory Datasets use
 * this, the shard generator writes what it returns, and the remote client reads those files.
 */
export class LocalAliasShards {
  private set: AliasShardSet | null = null;

  constructor(private readonly build: () => AliasIndex) {}

  private get(): AliasShardSet {
    return (this.set ??= shardAliasIndex(this.build()));
  }

  shard(key: string): AliasEntry[] {
    return this.get().shards.get(key) ?? [];
  }

  grams(bucket: number): Record<string, string[]> {
    return this.get().grams.get(bucket) ?? {};
  }

  all(): AliasShardSet {
    return this.get();
  }
}

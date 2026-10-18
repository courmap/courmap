import { codePointLength } from './normalize.js';

/** Normalized aliases shorter than this (in code points) are too generic to match on (decision S3.4). */
export const MIN_ALIAS_LENGTH = 3;

/**
 * Every alias, deduplicated by normalized form, with all the works that use it (Xwolv decision
 * S3.4). Sorted by normalized text, works sorted by id, so every mode builds identical bytes.
 * This is the content of /v1/aliases.json.zst.
 */
export interface AliasIndex {
  data_version: string;
  /** [normalized alias, work ids]. */
  aliases: [string, string[]][];
}

/** Builds the index from (normalized alias, work id) pairs: dedupe, drop short forms, sort. */
export function buildAliasIndex(dataVersion: string, pairs: Iterable<readonly [string, string]>): AliasIndex {
  const byAlias = new Map<string, Set<string>>();
  for (const [normalized, work] of pairs) {
    if (codePointLength(normalized) < MIN_ALIAS_LENGTH) continue;
    let works = byAlias.get(normalized);
    if (!works) byAlias.set(normalized, (works = new Set()));
    works.add(work);
  }
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return {
    data_version: dataVersion,
    aliases: [...byAlias].sort((a, b) => cmp(a[0], b[0])).map(([n, ws]) => [n, [...ws].sort(cmp)]),
  };
}

import { codePointLength } from './normalize.js';

/** Normalized aliases shorter than this (in code points) are too generic to match on (decision S3.4). */
export const MIN_ALIAS_LENGTH = 3;
/** An alias shared by more works than this is flagged for review (decision S4.3). */
export const ALIAS_REVIEW_OVER = 5;
/** An alias shared by more works than this stays in the data but leaves the resolver index (decision S4.3). */
export const ALIAS_EXCLUDE_OVER = 50;

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

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** (normalized alias, work id) pairs grouped by alias, short forms dropped, sorted. */
function groupPairs(pairs: Iterable<readonly [string, string]>): [string, string[]][] {
  const byAlias = new Map<string, Set<string>>();
  for (const [normalized, work] of pairs) {
    if (codePointLength(normalized) < MIN_ALIAS_LENGTH) continue;
    let works = byAlias.get(normalized);
    if (!works) byAlias.set(normalized, (works = new Set()));
    works.add(work);
  }
  return [...byAlias].sort((a, b) => cmp(a[0], b[0])).map(([n, ws]) => [n, [...ws].sort(cmp)]);
}

/**
 * Builds the index from (normalized alias, work id) pairs: dedupe, drop short forms and forms
 * shared by more than ALIAS_EXCLUDE_OVER works, sort.
 */
export function buildAliasIndex(dataVersion: string, pairs: Iterable<readonly [string, string]>): AliasIndex {
  return { data_version: dataVersion, aliases: groupPairs(pairs).filter(([, ws]) => ws.length <= ALIAS_EXCLUDE_OVER) };
}

/** How many works share each alias, in the bands of decision S4.3. */
export interface AliasBands {
  /** Used by one work. */
  unique: number;
  /** Shared by 2 to ALIAS_REVIEW_OVER works: normal (franchise names, sequels). */
  shared: number;
  /** Shared by more than ALIAS_REVIEW_OVER and at most ALIAS_EXCLUDE_OVER works: flagged for review. */
  review: [string, string[]][];
  /** Shared by more than ALIAS_EXCLUDE_OVER works: kept in the data, left out of the resolver index. */
  excluded: [string, string[]][];
}

/** Sorts every alias the index would consider (short forms dropped) into its band. */
export function aliasBands(pairs: Iterable<readonly [string, string]>): AliasBands {
  const bands: AliasBands = { unique: 0, shared: 0, review: [], excluded: [] };
  for (const entry of groupPairs(pairs)) {
    const n = entry[1].length;
    if (n === 1) bands.unique++;
    else if (n <= ALIAS_REVIEW_OVER) bands.shared++;
    else if (n <= ALIAS_EXCLUDE_OVER) bands.review.push(entry);
    else bands.excluded.push(entry);
  }
  return bands;
}

import { compareKeys } from './conflicts.js';
import { ANCHORS, entryKey, type Anchor, type EntryKey } from './offline-db.js';

/**
 * One row of data/seeds/slugs.jsonl: a published slug and every anchor ID it is known by.
 * Rows are never removed. A work found by any of its anchors keeps its slug, so a work first
 * seeded from AniList keeps it when cedya77 later adds its AniDB ID.
 */
export interface SlugEntry {
  slug: string;
  anidb?: number;
  anilist?: number;
  mal?: number;
}

export interface SlugCandidate {
  key: EntryKey;
  anidb?: number;
  anilist?: number;
  mal?: number;
  /** Romaji title (cedya77's main title). */
  title: string;
  year?: number;
  type: string;
}

/** A hand-written work, which claims the slug for its anchors before any seed. */
export interface ManualClaim {
  id: string;
  anidb?: number;
  anilist?: number;
  mal?: number;
}

const MAX_BASE = 80;

/** Lowercase ASCII kebab-case: diacritics folded, anything outside a-z0-9 collapsed to one hyphen. */
export function slugify(title: string): string {
  const s = title
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (s.length <= MAX_BASE) return s;
  return s.slice(0, MAX_BASE).replace(/-[^-]*$/, '') || s.slice(0, MAX_BASE);
}

/** The ID suffix of the last collision step: -a<anidb>, else -al<anilist>, else -m<mal>. */
const idSuffix = (c: SlugCandidate) => (c.anidb !== undefined ? `a${c.anidb}` : c.anilist !== undefined ? `al${c.anilist}` : `m${c.mal}`);

const anchorsOf = (x: Partial<Record<Anchor, number>>) => ANCHORS.filter((a) => x[a] !== undefined).map((a) => `${a}:${x[a]}`);

export interface SlugAssignment {
  /** Entry key to slug. */
  slugs: Map<EntryKey, string>;
  /** The registry to write back: old rows (with any newly learned anchors) plus new ones, in key order. */
  registry: SlugEntry[];
}

/**
 * Assigns slugs per Xwolv decisions 2 and S3.9. Registry rows are kept forever and matched by
 * any anchor; manual files claim slugs for their anchors next; new works get the romaji base,
 * then `-<year>`, then `-<type>`, then the ID suffix, each step added to the previous, until
 * free. New works are processed in key order (AniDB IDs ascending, then AniList, then MAL),
 * so the older work keeps the plain base. A title with no ASCII letters or digits gets its ID
 * suffix as the base.
 */
export function assignSlugs(
  candidates: readonly SlugCandidate[],
  registry: readonly SlugEntry[],
  manual: readonly ManualClaim[],
  reservedIds: ReadonlySet<string>,
): SlugAssignment {
  const rows = registry.map((r) => ({ ...r }));
  const byAnchor = new Map<string, SlugEntry>();
  for (const r of rows) for (const a of anchorsOf(r)) byAnchor.set(a, r);
  const manualByAnchor = new Map<string, string>();
  for (const m of manual) for (const a of anchorsOf(m)) manualByAnchor.set(a, m.id);

  const taken = new Set<string>([...reservedIds, ...rows.map((r) => r.slug)]);
  const used = new Set<SlugEntry>();
  const slugs = new Map<EntryKey, string>();
  const sorted = [...candidates].sort((a, b) => compareKeys(a.key, b.key));

  // 1. Published slugs, found by any anchor. Learn anchors the row did not have yet.
  for (const c of sorted) {
    const row = anchorsOf(c).map((a) => byAnchor.get(a)).find((r) => r !== undefined && !used.has(r));
    if (!row) continue;
    used.add(row);
    slugs.set(c.key, row.slug);
    for (const a of ANCHORS) if (row[a] === undefined && c[a] !== undefined) row[a] = c[a];
  }
  // 2. Manual files claim the slug for their anchors.
  for (const c of sorted) {
    if (slugs.has(c.key)) continue;
    const claimed = anchorsOf(c).map((a) => manualByAnchor.get(a)).find((id) => id !== undefined);
    if (claimed === undefined) continue;
    slugs.set(c.key, claimed);
    taken.add(claimed);
    rows.push({ slug: claimed, ...pick(c) });
  }
  // 3. New works: base, -year, -type, -<id>, cumulatively.
  for (const c of sorted) {
    if (slugs.has(c.key)) continue;
    const base = slugify(c.title) || idSuffix(c);
    const steps = [base];
    let s = base;
    if (c.year !== undefined) steps.push((s = `${s}-${c.year}`));
    steps.push((s = `${s}-${c.type}`));
    steps.push(`${s}-${idSuffix(c)}`);
    const slug = steps.find((x) => !taken.has(x));
    if (slug === undefined) throw new Error(`no free slug for ${c.key} (tried ${steps.join(', ')})`);
    slugs.set(c.key, slug);
    taken.add(slug);
    rows.push({ slug, ...pick(c) });
  }
  rows.sort((a, b) => compareKeys(entryKey(a) ?? '', entryKey(b) ?? '') || (a.slug < b.slug ? -1 : 1));
  return { slugs, registry: rows };
}

const pick = (c: Partial<Record<Anchor, number>>): Partial<Record<Anchor, number>> => {
  const out: Partial<Record<Anchor, number>> = {};
  for (const a of ANCHORS) if (c[a] !== undefined) out[a] = c[a];
  return out;
};

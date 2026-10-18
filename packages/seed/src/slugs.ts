/** One row of data/seeds/slugs.jsonl: an AniDB ID and the slug it was published under. Never removed. */
export interface SlugEntry {
  anidb: number;
  slug: string;
}

export interface SlugCandidate {
  anidb: number;
  /** Romaji title (cedya77's main title). */
  title: string;
  year?: number;
  type: string;
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

/**
 * Assigns slugs per Xwolv decision 2. Existing assignments (the registry) are kept forever;
 * manual files claim the slug for their AniDB ID next; new works get the romaji base, then
 * `-<year>`, then `-<type>`, then `-a<anidb>`, each step added to the previous, until free.
 * New works are processed by ascending AniDB ID, so the older work keeps the plain base.
 * A title with no ASCII letters or digits gets the base `a<anidb>`.
 */
export function assignSlugs(
  candidates: readonly SlugCandidate[],
  registry: readonly SlugEntry[],
  manual: ReadonlyMap<number, string>,
  reservedIds: ReadonlySet<string>,
): Map<number, string> {
  const out = new Map<number, string>();
  const taken = new Set<string>(reservedIds);
  for (const r of registry) {
    out.set(r.anidb, r.slug);
    taken.add(r.slug);
  }
  for (const c of [...candidates].sort((a, b) => a.anidb - b.anidb)) {
    if (out.has(c.anidb)) continue;
    const claimed = manual.get(c.anidb);
    if (claimed !== undefined) {
      out.set(c.anidb, claimed);
      taken.add(claimed);
    }
  }
  for (const c of [...candidates].sort((a, b) => a.anidb - b.anidb)) {
    if (out.has(c.anidb)) continue;
    const base = slugify(c.title) || `a${c.anidb}`;
    const steps = [base];
    let s = base;
    if (c.year !== undefined) steps.push((s = `${s}-${c.year}`));
    steps.push((s = `${s}-${c.type}`));
    steps.push(`${s}-a${c.anidb}`);
    const slug = steps.find((x) => !taken.has(x));
    if (slug === undefined) throw new Error(`no free slug for AniDB ${c.anidb} (tried ${steps.join(', ')})`);
    out.set(c.anidb, slug);
    taken.add(slug);
  }
  return out;
}

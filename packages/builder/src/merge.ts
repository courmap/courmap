import { PROJECTION_PROVIDERS, PROVIDERS, type ProjectionProvider, type Provider, type WorkFile } from '@courmap/core';
import type { Locator, PathSegment } from './diagnostics.js';
import type { Origin, SeedSource, SourceFile } from './load.js';

/** Per-part origins in a seed line. Anything not listed comes from `default`. */
export interface SeedOrigin {
  default: Origin;
  ids?: Partial<Record<Provider, Origin>>;
  projections?: Partial<Record<ProjectionProvider, Origin>>;
}

/** One line of data/seeds/works-NNN.jsonl. */
export type SeedWork = WorkFile & { origin: SeedOrigin };

type TitleKey = 'romaji' | 'english' | 'native';
const TITLE_KEYS: readonly TitleKey[] = ['romaji', 'english', 'native'];

/** Where each compiled row of a work comes from. */
export interface WorkOrigins {
  ids: Partial<Record<Provider, Origin>>;
  projections: Partial<Record<ProjectionProvider, Origin>>;
  /** By alias text, titles included. */
  aliases: Map<string, Origin>;
}

/**
 * A work after merging its manual file (if any) over its seed line (if any). Checks,
 * records and the compiler all work on this, and diagnostics find their way back to
 * whichever file supplied the part they are about.
 */
export interface MergedWork {
  id: string;
  /** Merged data with null removals applied. type or episodes may still be missing (reported). */
  data: WorkFile;
  loc: Locator;
  /** Has a hand-written file: bounds problems are errors, not warnings. */
  isManual: boolean;
  manual: { src: SourceFile; data: WorkFile } | null;
  seed: { src: SeedSource; data: SeedWork } | null;
  origins: WorkOrigins;
}

const has = (o: object | undefined | null, k: string) => o != null && Object.prototype.hasOwnProperty.call(o, k);

/**
 * Merges per Xwolv decision 1: a manual file's ids.<provider> key or projections.<provider>
 * block replaces only that part of the seed, and every other key it sets wins at its own
 * granularity; aliases are added to the seed's; null removes a seed value.
 */
export function mergeWork(manual: { src: SourceFile; data: WorkFile } | null, seed: { src: SeedSource; data: SeedWork } | null): MergedWork {
  const m = manual?.data;
  const s = seed?.data;
  const id = (m ?? s)!.id;
  const seedDefault: Origin = s?.origin.default ?? 'manual';

  const data: WorkFile = { id } as WorkFile;
  // Top-level scalar fields: manual wins when it sets the key.
  for (const key of ['type', 'status', 'year', 'episodes', 'specials', 'prequel', 'notes', 'sources'] as const) {
    const v = has(m, key) ? m![key] : s?.[key];
    if (v !== undefined) (data as unknown as Record<string, unknown>)[key] = v;
  }

  const titles: NonNullable<WorkFile['titles']> = {};
  const titleOrigin: Partial<Record<TitleKey, Origin>> = {};
  for (const k of TITLE_KEYS) {
    if (has(m?.titles, k)) {
      titles[k] = m!.titles![k]!;
      titleOrigin[k] = 'manual';
    } else if (s?.titles?.[k] !== undefined) {
      titles[k] = s.titles[k];
      titleOrigin[k] = seedDefault;
    }
  }
  if (Object.keys(titles).length > 0) data.titles = titles;

  const ids: NonNullable<WorkFile['ids']> = {};
  const idOrigin: WorkOrigins['ids'] = {};
  for (const p of PROVIDERS) {
    const fromManual = has(m?.ids, p);
    const v = fromManual ? m!.ids![p] : s?.ids?.[p];
    if (v === undefined || v === null) continue; // null in a manual file removes the seed's ID
    (ids as Record<string, unknown>)[p] = v;
    idOrigin[p] = fromManual ? 'manual' : (s!.origin.ids?.[p] ?? seedDefault);
  }
  if (Object.keys(ids).length > 0) data.ids = ids;

  const projections: NonNullable<WorkFile['projections']> = {};
  const projOrigin: WorkOrigins['projections'] = {};
  for (const p of PROJECTION_PROVIDERS) {
    const fromManual = has(m?.projections, p);
    const v = fromManual ? m!.projections![p] : s?.projections?.[p];
    if (v === undefined || v === null) continue;
    projections[p] = v;
    projOrigin[p] = fromManual ? 'manual' : (s!.origin.projections?.[p] ?? seedDefault);
  }
  if (Object.keys(projections).length > 0) data.projections = projections;

  const seedAliases = s?.aliases ?? [];
  const manualAliases = (m?.aliases ?? []).filter((a) => !seedAliases.includes(a));
  const aliases = [...seedAliases, ...manualAliases];
  if (aliases.length > 0) data.aliases = aliases;

  const aliasOrigin = new Map<string, Origin>();
  for (const k of TITLE_KEYS) if (titles[k] !== undefined && !aliasOrigin.has(titles[k]!)) aliasOrigin.set(titles[k]!, titleOrigin[k]!);
  for (const a of seedAliases) if (!aliasOrigin.has(a)) aliasOrigin.set(a, seedDefault);
  for (const a of manualAliases) if (!aliasOrigin.has(a)) aliasOrigin.set(a, 'manual');

  /** Which source supplied the part at `path`. */
  const owner = (path: readonly PathSegment[]): 'manual' | 'seed' => {
    if (!manual) return 'seed';
    if (!seed) return 'manual';
    const [head, sub] = path;
    if (head === undefined) return 'manual';
    if (head === 'aliases' && typeof sub === 'number') return sub < seedAliases.length ? 'seed' : 'manual';
    if ((head === 'ids' || head === 'projections' || head === 'titles') && typeof sub === 'string') {
      return has((m as unknown as Record<string, unknown>)[head] as object, sub) ? 'manual' : 'seed';
    }
    return has(m, String(head)) ? 'manual' : 'seed';
  };
  const loc: Locator = {
    locate(path, opts) {
      if (owner(path) === 'seed') return seed!.src.loc.locate(path, opts);
      // Merged alias indexes differ from the manual file's own.
      if (path[0] === 'aliases' && typeof path[1] === 'number') {
        const i = m!.aliases!.indexOf(aliases[path[1]]!);
        return manual!.src.loc.locate(['aliases', i, ...path.slice(2)], opts);
      }
      return manual!.src.loc.locate(path, opts);
    },
  };

  return {
    id,
    data,
    loc,
    isManual: manual !== null,
    manual,
    seed,
    origins: { ids: idOrigin, projections: projOrigin, aliases: aliasOrigin },
  };
}

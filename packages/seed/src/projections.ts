import type { ProjectionBlock, ProjectionEntry, ProjectionProvider } from '@courmap/core';
import type { ALEntry, ALSeason } from './anime-lists.js';
import type { Conflict } from './conflicts.js';

type Kind = 'regular' | 'special';

/** Where one canonical episode lands: a season (null = absolute order) and provider episodes (empty = no equivalent). */
export interface Landing {
  season: number | null;
  eps: number[];
}

/**
 * Every canonical episode's landing for one provider, built from Anime-Lists in rising
 * precedence: the default season and offset, then range mappings, then explicit lists.
 */
export interface EpisodeMap {
  regular: Map<number, Landing>;
  special: Map<number, Landing>;
  /** A range mapping with no end: the last regular row stays open-ended. */
  open: { from: number; season: number | null; offset: number } | null;
}

const toSeason = (s: ALSeason): number | null => (s === 'absolute' ? null : s);

/**
 * Builds the episode map for one provider, or null when Anime-Lists has no ID or nothing to map for it.
 *
 * `openDefault` is for a show that is still airing with no real episode count (cedya77 records 1,
 * or nothing, until the count is known): Anime-Lists' default mapping applies to every episode of
 * the entry, so it is left open-ended instead of being closed at the placeholder. It applies only
 * when that default is the whole mapping (no explicit sub-mappings to disagree with it).
 */
export function buildEpisodeMap(al: ALEntry, provider: ProjectionProvider, episodes: number, conflicts: Conflict[], openDefault = false): EpisodeMap | null {
  const isTvdb = provider === 'tvdb_show';
  if ((isTvdb ? al.tvdb : al.tmdbTv) === null) return null;
  const defaultSeason = isTvdb ? al.tvdbSeason : al.tmdbSeason;
  const defaultOffset = isTvdb ? al.tvdbOffset : al.tmdbOffset;
  const map: EpisodeMap = { regular: new Map(), special: new Map(), open: null };
  const land = (kind: Kind, e: number, season: number | null, t: number) => map[kind].set(e, { season, eps: t >= 1 ? [t] : [] });

  // Season 0 with no offset means "a special of this show, episode not given": an ID, not a mapping.
  // Any other default season with no offset is the plain case, offset 0.
  const unknownSpecial = defaultSeason === 0 && defaultOffset === null;
  if (defaultSeason !== null && !unknownSpecial) {
    for (let e = 1; e <= episodes; e++) land('regular', e, toSeason(defaultSeason), e + (defaultOffset ?? 0));
  }

  const relevant = al.mappings.filter((m) => (isTvdb ? m.tvdbSeason : m.tmdbSeason) !== null);
  if (openDefault && defaultSeason !== null && !unknownSpecial && !relevant.some((m) => m.anidbSeason !== 0)) {
    map.open = { from: 1, season: toSeason(defaultSeason), offset: defaultOffset ?? 0 };
  }
  for (const m of relevant.filter((x) => x.list === null)) {
    const s = toSeason((isTvdb ? m.tvdbSeason : m.tmdbSeason)!);
    const kind: Kind = m.anidbSeason === 0 ? 'special' : 'regular';
    const from = m.start ?? 1;
    if (m.end === null && m.start !== null) {
      if (kind === 'special') {
        conflicts.push({ key: `anidb:${al.anidb}`, part: `projections.${provider}`, reason: 'anime-lists-open-specials', detail: `open-ended specials range from S${from} skipped (specials count unknown)` });
        continue;
      }
      map.open = { from, season: s, offset: m.offset };
    }
    // A range with neither start nor end applies to every episode.
    const to = m.end ?? (kind === 'regular' ? episodes : from - 1);
    for (let e = from; e <= to; e++) land(kind, e, s, e + m.offset);
  }
  for (const m of relevant.filter((x) => x.list !== null)) {
    const s = toSeason((isTvdb ? m.tvdbSeason : m.tmdbSeason)!);
    const kind: Kind = m.anidbSeason === 0 ? 'special' : 'regular';
    for (const item of m.list!) map[kind].set(item.from, { season: s, eps: item.to });
  }
  return map.regular.size === 0 && map.special.size === 0 && map.open === null ? null : map;
}

/** One emitted row and the canonical episodes it covers, so a repair can drop exactly those. */
export interface EmittedRow {
  kind: Kind;
  episodes: number[];
  open: boolean;
}

export interface EmittedBlock {
  block: ProjectionBlock;
  rows: EmittedRow[];
}

const prefix = (kind: Kind) => (kind === 'special' ? 'S' : '');
const range = (kind: Kind, from: number, to: number | null): number | string => {
  const p = prefix(kind);
  if (to === from) return kind === 'regular' ? from : `${p}${from}`;
  return to === null ? `${p}${from}-` : `${p}${from}-${p}${to}`;
};

/**
 * Compresses an episode map into projection rows: runs of consecutive episodes with
 * consecutive targets become one range, one episode spanning several provider episodes
 * becomes a `target` split, and consecutive episodes sharing one provider episode become a
 * merge. Holes get `gap: true`; coverage that stops early is written as `coverage: partial`.
 * `excluded` holds `regular:5`, `special:2` or `open` keys a repair has removed.
 */
export function emitBlock(
  map: EpisodeMap,
  provider: ProjectionProvider,
  episodes: number,
  excluded: ReadonlySet<string>,
  key: string,
  conflicts: Conflict[],
): EmittedBlock | null {
  const rows: (ProjectionEntry & { __kind: Kind; __eps: number[]; __open: boolean })[] = [];

  for (const kind of ['regular', 'special'] as const) {
    const keys = [...map[kind].keys()]
      .filter((e) => !excluded.has(`${kind}:${e}`) && map[kind].get(e)!.eps.length > 0)
      .sort((a, b) => a - b);
    let next = 1;
    for (let i = 0; i < keys.length; ) {
      const e = keys[i]!;
      const l = map[kind].get(e)!;
      const seasonKey = l.season === null ? {} : { season: l.season };
      const gap = kind === 'regular' && e > next ? { gap: true as const } : {};
      if (l.eps.length > 1) {
        const consecutive = l.eps.every((t, k) => k === 0 || t === l.eps[k - 1]! + 1);
        if (!consecutive) {
          conflicts.push({ key, part: `projections.${provider}.${kind}:${e}`, reason: 'anime-lists-split-not-consecutive', detail: `episode ${e} maps to ${l.eps.join('+')}` });
          i++;
          continue;
        }
        rows.push({ ...seasonKey, episodes: range(kind, e, e), target: `${l.eps[0]}-${l.eps[l.eps.length - 1]}`, ...gap, __kind: kind, __eps: [e], __open: false });
        next = e + 1;
        i++;
        continue;
      }
      const t = l.eps[0]!;
      // Extend a run while keys stay consecutive, single-target and in the same season.
      const same = (k: number) => {
        const x = map[kind].get(k)!;
        return x.eps.length === 1 && x.season === l.season;
      };
      let j = i;
      const nextKey = keys[i + 1];
      const merging = nextKey === e + 1 && same(nextKey) && map[kind].get(nextKey)!.eps[0] === t;
      while (keys[j + 1] === keys[j]! + 1 && same(keys[j + 1]!)) {
        const nt = map[kind].get(keys[j + 1]!)!.eps[0]!;
        const pt = map[kind].get(keys[j]!)!.eps[0]!;
        if (merging ? nt !== t : nt !== pt + 1) break;
        j++;
      }
      const last = keys[j]!;
      const covered = keys.slice(i, j + 1);
      if (merging) {
        rows.push({ ...seasonKey, episodes: range(kind, e, last), target: t, ...gap, __kind: kind, __eps: covered, __open: false });
      } else {
        const start = t === e ? {} : { start: t };
        rows.push({ ...seasonKey, episodes: range(kind, e, last), ...start, ...gap, __kind: kind, __eps: covered, __open: false });
      }
      next = last + 1;
      i = j + 1;
    }
  }

  // An open-ended Anime-Lists range keeps the last regular row open.
  if (map.open && !excluded.has('open')) {
    const o = map.open;
    const regular = rows.filter((r) => r.__kind === 'regular');
    const last = regular[regular.length - 1];
    const lastFrom = last ? last.__eps[0]! : null;
    const fits =
      last &&
      last.target === undefined &&
      (last.season ?? null) === o.season &&
      (last.start ?? lastFrom!) - lastFrom! === o.offset &&
      last.__eps[last.__eps.length - 1]! >= o.from - 1;
    if (fits) {
      last.episodes = `${lastFrom}-`;
      last.__open = true;
    } else {
      const lastTo = last ? last.__eps[last.__eps.length - 1]! : 0;
      const seasonKey = o.season === null ? {} : { season: o.season };
      const start = o.from + o.offset === o.from ? {} : { start: o.from + o.offset };
      const gap = o.from > lastTo + 1 ? { gap: true as const } : {};
      const at = rows.findIndex((r) => r.__kind === 'special');
      const row = { ...seasonKey, episodes: `${o.from}-`, ...start, ...gap, __kind: 'regular' as const, __eps: [], __open: true };
      if (at === -1) rows.push(row);
      else rows.splice(at, 0, row);
    }
  }

  if (rows.length === 0) return null;
  const emitted: EmittedRow[] = rows.map((r) => ({ kind: r.__kind, episodes: r.__eps, open: r.__open }));
  const ranges: ProjectionEntry[] = rows.map(({ __kind: _k, __eps: _e, __open: _o, ...r }) => r);

  const regular = rows.filter((r) => r.__kind === 'regular');
  const lastRegular = regular[regular.length - 1];
  const reach = lastRegular ? (lastRegular.__open ? Infinity : lastRegular.__eps[lastRegular.__eps.length - 1]!) : null;
  if (reach !== null && reach < episodes) {
    const name = provider === 'tvdb_show' ? 'TVDB' : 'TMDB';
    return {
      block: { coverage: 'partial', notes: `Anime-Lists maps ${name} only through episode ${reach} of ${episodes}.`, ranges: ranges as [ProjectionEntry, ...ProjectionEntry[]] },
      rows: emitted,
    };
  }
  return { block: ranges as [ProjectionEntry, ...ProjectionEntry[]], rows: emitted };
}

import { createHash } from 'node:crypto';
import {
  PROJECTION_PROVIDERS,
  PROVIDERS,
  type ProjectionBlock,
  type ProjectionProvider,
  type Provider,
} from '@courmap/core';
import {
  MemoryDataset,
  Reporter,
  checkFiles,
  checkRoundTrips,
  makeLineLocator,
  toRecords,
  type CheckedFiles,
  type Diagnostic,
  type LoadedData,
  type MergedWork,
  type SeedSource,
  type SeedWork,
} from '@courmap/builder';
import { parseAnimeLists, type ALEntry, type ALSeason } from './anime-lists.js';
import { sortConflicts, type Conflict } from './conflicts.js';
import { ANCHORS, parseOfflineDb, type OfflineEntry } from './offline-db.js';
import { buildEpisodeMap, emitBlock, type EmittedRow, type EpisodeMap } from './projections.js';
import { assignSlugs, type ManualClaim, type SlugEntry } from './slugs.js';

export const SHARD_COUNT = 16;
/** Repair rounds before giving up; each round only removes data, so this is a safety net. */
const MAX_ROUNDS = 25;

export type { SlugEntry };

export interface Pins {
  offline_db: { repo: string; tag: string; asset: string; sha256: string };
  anime_lists: { repo: string; commit: string; path: string; sha256: string };
}

export interface SeedInputs {
  /** Decompressed anime-offline-database.jsonl. */
  offlineDbJsonl: string;
  animeListsXml: string;
  pins: Pins;
  /** The data directory's hand-written files (works/, sequences/, groups/); its seeds are ignored. */
  manual: Pick<LoadedData, 'files'>;
  /** The previous data/seeds/slugs.jsonl. */
  registry: SlugEntry[];
}

export interface SeedSummary {
  works: number;
  provider_refs: Partial<Record<Provider, number>>;
  projection_rows: Partial<Record<ProjectionProvider, number>>;
  projection_blocks: Partial<Record<ProjectionProvider, number>>;
  partial_blocks: Partial<Record<ProjectionProvider, number>>;
  warnings: Record<string, number>;
  info: Record<string, number>;
  conflicts: Record<string, number>;
  /** cedya77 entries with none of anidb, anilist, mal (not seeded). */
  offline_db_entries_without_anchor: number;
  /** Works seeded from an AniList or MAL anchor because cedya77 has no AniDB source (decision S3.9). */
  seeded_without_anidb: number;
  /** Of those, how many have a projection (only possible through a manual file). */
  seeded_without_anidb_with_projections: number;
  anime_lists_entries_without_offline_db: number;
  repair_rounds: number;
}

export interface SeedOutput {
  /** File name in data/seeds/ to exact contents. */
  files: Map<string, string>;
  summary: SeedSummary;
  /** Errors left after repair: always in manual files (seed data is repaired or dropped). */
  remainingErrors: Diagnostic[];
}

interface Draft {
  entry: OfflineEntry;
  slug: string;
  al: ALEntry | undefined;
  ids: Partial<Record<Provider, number | string>>;
  idOrigin: Partial<Record<Provider, 'offline-db' | 'anime-lists'>>;
  maps: Partial<Record<ProjectionProvider, EpisodeMap>>;
  excluded: Record<ProjectionProvider, Set<string>>;
  droppedBlocks: Set<ProjectionProvider>;
  /** Rows of the last render, for mapping diagnostics back to episodes. */
  rows: Partial<Record<ProjectionProvider, EmittedRow[]>>;
  dropped: boolean;
}

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

/** FNV-1a 32-bit: a work's shard depends only on its slug, so adding a work rewrites one shard. */
export function shardOf(slug: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < slug.length; i++) {
    h ^= slug.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % SHARD_COUNT;
}

const shardName = (n: number) => `works-${String(n).padStart(3, '0')}.jsonl`;

/**
 * Joins the two seeds on AniDB ID, assigns slugs, renders seed lines, then validates them
 * together with the manual files and drops whatever seed part fails, until the data is
 * clean. Pure: the same inputs always give byte-identical files.
 */
export async function runSeed(inputs: SeedInputs): Promise<SeedOutput> {
  const conflicts: Conflict[] = [];
  const offline = parseOfflineDb(inputs.offlineDbJsonl, conflicts);
  const lists = parseAnimeLists(inputs.animeListsXml, conflicts);

  // Manual works claim slugs for their anchor IDs; every manual id is reserved.
  const manualWorks = inputs.manual.files.filter((f) => f.kind === 'work');
  const claims: ManualClaim[] = [];
  const reserved = new Set<string>();
  for (const f of manualWorks) {
    const d = f.data as { id?: unknown; ids?: Record<string, unknown> } | null;
    if (typeof d?.id !== 'string') continue;
    reserved.add(d.id);
    const claim: ManualClaim = { id: d.id };
    for (const a of ANCHORS) if (typeof d.ids?.[a] === 'number') claim[a] = d.ids[a] as number;
    claims.push(claim);
  }
  const { slugs, registry } = assignSlugs(
    [...offline.entries.values()].map((e) => ({
      key: e.key,
      ...(e.anidb !== undefined && { anidb: e.anidb }),
      ...(e.anilist !== undefined && { anilist: e.anilist }),
      ...(e.mal !== undefined && { mal: e.mal }),
      title: e.title,
      type: e.type,
      ...(e.year !== undefined && { year: e.year }),
    })),
    inputs.registry,
    claims,
    reserved,
  );

  // How many Anime-Lists entries map into each provider show and season, by default or explicitly, and where
  // the default-mapped ones start (their episode offset): the last cour of a season may stay open-ended.
  const seasonUsers = new Map<string, { n: number; explicit: boolean; offsets: number[] }>();
  for (const al of lists.values()) {
    for (const p of PROJECTION_PROVIDERS) {
      const own = p === 'tvdb_show' ? al.tvdbSeason : al.tmdbSeason;
      const explicit = al.mappings.map((m) => (p === 'tvdb_show' ? m.tvdbSeason : m.tmdbSeason));
      for (const s of new Set<ALSeason | null>([own, ...explicit])) {
        if (s === null) continue;
        const u = seasonUsers.get(seasonKey(al, p, s)) ?? { n: 0, explicit: false, offsets: [] };
        u.n++;
        if (s === own) u.offsets.push((p === 'tvdb_show' ? al.tvdbOffset : al.tmdbOffset) ?? 0);
        if (explicit.includes(s)) u.explicit = true;
        seasonUsers.set(seasonKey(al, p, s), u);
      }
    }
  }
  // An open range would run into a later cour of the same show and season, so it needs the season to itself,
  // or to be the last cour there (the largest offset, with no explicit sub-mapping into the season).
  const mayStayOpen = (al: ALEntry, p: ProjectionProvider): boolean => {
    const season = p === 'tvdb_show' ? al.tvdbSeason : al.tmdbSeason;
    const u = seasonUsers.get(seasonKey(al, p, season));
    if (!u) return false;
    if (u.n === 1) return true;
    const mine = (p === 'tvdb_show' ? al.tvdbOffset : al.tmdbOffset) ?? 0;
    return !u.explicit && u.offsets.length === u.n && u.offsets.filter((o) => o >= mine).length === 1;
  };

  // The room an airing cour has before the next cour of the same show and season begins: Anime-Lists'
  // offsets say how long it will be, even while its count still lags (Kusuriya 3rd Season: offset 48,
  // part 2 at 72, so 24 episodes against the 12 aired so far). 0 when nothing follows or it cannot be told.
  const roomBeforeNextCour = (al: ALEntry, p: ProjectionProvider): number => {
    const season = p === 'tvdb_show' ? al.tvdbSeason : al.tmdbSeason;
    const u = seasonUsers.get(seasonKey(al, p, season));
    if (!u || u.n === 1 || u.explicit || u.offsets.length !== u.n) return 0;
    const mine = (p === 'tvdb_show' ? al.tvdbOffset : al.tmdbOffset) ?? 0;
    const next = Math.min(...u.offsets.filter((o) => o > mine));
    return Number.isFinite(next) ? next - mine : 0;
  };

  const drafts = new Map<string, Draft>();
  for (const entry of offline.entries.values()) {
    // Anime-Lists is keyed by AniDB, so works anchored elsewhere get IDs but no projections.
    const al = entry.anidb !== undefined ? lists.get(entry.anidb) : undefined;
    const draft: Draft = {
      entry,
      slug: slugs.get(entry.key)!,
      al,
      ids: {},
      idOrigin: {},
      maps: {},
      excluded: { tvdb_show: new Set(), tmdb_show: new Set() },
      droppedBlocks: new Set(),
      rows: {},
      dropped: false,
    };
    const setId = (p: Provider, v: number | string | null | undefined, origin: 'offline-db' | 'anime-lists') => {
      if (v === null || v === undefined) return;
      draft.ids[p] = v;
      draft.idOrigin[p] = origin;
    };
    setId('anidb', entry.anidb, 'offline-db');
    setId('anilist', entry.anilist, 'offline-db');
    setId('mal', entry.mal, 'offline-db');
    setId('kitsu', entry.kitsu, 'offline-db');
    if (al) {
      setId('tvdb_show', al.tvdb, 'anime-lists');
      setId('tmdb_show', al.tmdbTv, 'anime-lists');
      setId('tmdb_movie', al.tmdbMovie, 'anime-lists');
      setId('imdb', al.imdb, 'anime-lists');
      for (const p of PROJECTION_PROVIDERS) {
        const open = hasPlaceholderCount(entry) && mayStayOpen(al, p);
        // Where the range cannot stay open (a later cour shares the season), it runs up to that cour's first
        // episode, or keeps the count (the placeholder of one episode when there is none).
        const count = entry.episodes ?? (hasPlaceholderCount(entry) ? 1 : 0);
        const map = buildEpisodeMap(al, p, hasPlaceholderCount(entry) && !open ? Math.max(count, roomBeforeNextCour(al, p)) : count, conflicts, open);
        if (map) draft.maps[p] = map;
      }
    }
    drafts.set(draft.slug, draft);
  }
  const listsWithoutOffline = [...lists.keys()].filter((anidb) => !offline.entries.has(`anidb:${anidb}`)).length;

  // Validate and repair until clean.
  let rounds = 0;
  let checked: CheckedFiles;
  let reporter: Reporter;
  for (;;) {
    rounds++;
    reporter = new Reporter();
    // Emission problems are logged on the first render only; later rounds re-render the same maps.
    const seeds = renderSeeds(drafts, rounds === 1 ? conflicts : null);
    // Bot files (relations.jsonl, airing.jsonl) only override seed values or warn, so repair ignores them.
    checked = checkFiles({ files: inputs.manual.files, seeds, relations: [], airing: [] }, reporter);
    if (reporter.errorCount === 0) await roundTrips(checked, reporter);
    const errors = reporter.diagnostics.filter((d) => d.severity === 'error');
    if (errors.length === 0 || rounds >= MAX_ROUNDS) break;
    const repaired = repair(errors, drafts, checked, conflicts);
    if (repaired === 0) break;
  }
  const remainingErrors = reporter.diagnostics.filter((d) => d.severity === 'error');

  // Output files.
  const live = [...drafts.values()].filter((d) => !d.dropped).sort((a, b) => (a.slug < b.slug ? -1 : 1));
  const shards: string[][] = Array.from({ length: SHARD_COUNT }, () => []);
  for (const d of live) shards[shardOf(d.slug)]!.push(JSON.stringify(render(d, null)));
  const files = new Map<string, string>();
  shards.forEach((lines, i) => files.set(shardName(i), lines.length ? `${lines.join('\n')}\n` : ''));

  // Fixed field order per row, so the file is byte-stable.
  const slugLines = registry.map((r) => JSON.stringify({ ...(r.anidb !== undefined && { anidb: r.anidb }), ...(r.anilist !== undefined && { anilist: r.anilist }), ...(r.mal !== undefined && { mal: r.mal }), slug: r.slug }));
  files.set('slugs.jsonl', `${slugLines.join('\n')}\n`);

  const bySlug = new Map([...drafts.values()].map((d) => [d.entry.key, d.slug]));
  const conflictLines = sortConflicts(conflicts).map((c) => JSON.stringify({ key: c.key, slug: c.slug ?? bySlug.get(c.key) ?? null, part: c.part, reason: c.reason, detail: c.detail }));
  files.set('conflicts.jsonl', conflictLines.length ? `${conflictLines.join('\n')}\n` : '');

  const summary = summarize(checked, reporter, conflicts, offline.withoutAnchor, listsWithoutOffline, rounds);
  const noAnidb = live.filter((d) => d.entry.anidb === undefined);
  const withProjections = new Set(checked.works.filter((w) => w.data.projections && Object.keys(w.data.projections).length > 0).map((w) => w.id));
  summary.seeded_without_anidb = noAnidb.length;
  summary.seeded_without_anidb_with_projections = noAnidb.filter((d) => withProjections.has(d.slug)).length;
  const manifest = {
    format: 1,
    pins: { ...inputs.pins, offline_db: { ...inputs.pins.offline_db, last_update: offline.lastUpdate } },
    shards: [...files.keys()]
      .filter((n) => n.startsWith('works-'))
      .sort()
      .map((name) => ({ name, works: files.get(name)!.split('\n').filter(Boolean).length, sha256: sha256(files.get(name)!) })),
    summary,
  };
  files.set('manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
  return { files, summary, remainingErrors };
}

/** Renders every live draft to an in-memory seed source, recording each block's rows. */
function renderSeeds(drafts: Map<string, Draft>, conflicts: Conflict[] | null): SeedSource[] {
  const seeds: SeedSource[] = [];
  let line = 0;
  for (const d of drafts.values()) {
    if (d.dropped) continue;
    line++;
    seeds.push({ file: 'data/seeds', line, data: render(d, conflicts), loc: makeLineLocator('data/seeds', line) });
  }
  return seeds;
}

/** One provider show and season, the unit a closed or open range can collide in. */
const seasonKey = (al: ALEntry, p: ProjectionProvider, season: ALSeason | null): string => `${p}:${p === 'tvdb_show' ? al.tvdb : al.tmdbTv}:${season}`;

/**
 * A TV show whose count is not final: airing (the count lags the broadcast and AniList revises it),
 * or about to air with no count yet (cedya77's placeholder 1 is read as unknown, see offline-db.ts).
 * Whatever is derived from a count must stay open: Anime-Lists' default mapping covers every episode
 * of the entry, and the bots close the range when the show finishes.
 */
const hasPlaceholderCount = (e: { status?: string; type: string; episodes: number | null }): boolean =>
  e.type === 'tv' && (e.status === 'airing' || (e.status === 'upcoming' && e.episodes === null));

/** One seed line. Key order is fixed so output is byte-stable. Pass conflicts to log emission problems (first render only matters). */
function render(d: Draft, conflicts: Conflict[] | null): SeedWork {
  const e = d.entry;
  const ids: Record<string, number | string> = {};
  const idOrigin: Record<string, string> = {};
  for (const p of PROVIDERS) {
    if (d.ids[p] === undefined) continue;
    ids[p] = d.ids[p]!;
    if (d.idOrigin[p] !== 'offline-db') idOrigin[p] = d.idOrigin[p]!;
  }
  const projections: Partial<Record<ProjectionProvider, ProjectionBlock>> = {};
  const projOrigin: Record<string, string> = {};
  for (const p of PROJECTION_PROVIDERS) {
    const map = d.maps[p];
    if (!map || d.droppedBlocks.has(p) || d.ids[p] === undefined) continue;
    const emitted = emitBlock(map, p, e.episodes ?? 0, d.excluded[p], e.key, conflicts ?? []);
    d.rows[p] = emitted?.rows ?? [];
    if (!emitted) continue;
    projections[p] = emitted.block;
    projOrigin[p] = 'anime-lists';
  }
  const origin: SeedWork['origin'] = { default: 'offline-db' };
  if (Object.keys(idOrigin).length > 0) origin.ids = idOrigin as SeedWork['origin']['ids'];
  if (Object.keys(projOrigin).length > 0) origin.projections = projOrigin as SeedWork['origin']['projections'];
  return {
    id: d.slug,
    type: e.type,
    ...(e.status !== undefined && { status: e.status }),
    ...(e.year !== undefined && { year: e.year }),
    episodes: e.episodes,
    titles: { romaji: e.title },
    ids,
    ...(Object.keys(projections).length > 0 && { projections }),
    ...(e.synonyms.length > 0 && { aliases: e.synonyms }),
    origin,
  } as SeedWork;
}

const isSeedPart = (w: MergedWork | undefined, path: readonly (string | number)[]): boolean => {
  if (!w || !w.seed) return false;
  const [head, p] = path;
  if (head === 'projections' && typeof p === 'string') return w.origins.projections[p as ProjectionProvider] !== 'manual';
  if (head === 'ids' && typeof p === 'string') return w.origins.ids[p as Provider] !== 'manual';
  return !w.isManual;
};

const rowIndex = (path: readonly (string | number)[]): number | null => {
  const i = path[2] === 'ranges' ? path[3] : path[2];
  return typeof i === 'number' ? i : null;
};

/** Drops the seed part each error is about. Returns how many parts were dropped. */
function repair(errors: Diagnostic[], drafts: Map<string, Draft>, checked: CheckedFiles, conflicts: Conflict[]): number {
  const works = new Map(checked.works.map((w) => [w.id, w]));
  let dropped = 0;
  const log = (d: Draft, part: string, diag: Diagnostic) => {
    conflicts.push({ key: d.entry.key, slug: d.slug, part, reason: `validate-${diag.code}`, detail: diag.message });
    dropped++;
  };
  const dropRow = (d: Draft, p: ProjectionProvider, idx: number | null, diag: Diagnostic) => {
    const row = idx === null ? undefined : d.rows[p]?.[idx];
    if (!row) {
      if (d.droppedBlocks.has(p)) return;
      d.droppedBlocks.add(p);
      log(d, `projections.${p}`, diag);
      return;
    }
    const keys = [...row.episodes.map((e) => `${row.kind}:${e}`), ...(row.open ? ['open'] : [])];
    if (keys.every((k) => d.excluded[p].has(k))) return; // already dropped this round
    for (const k of keys) d.excluded[p].add(k);
    const span = row.episodes.length ? `${row.kind}:${row.episodes[0]}-${row.episodes[row.episodes.length - 1]}${row.open ? '+' : ''}` : 'open';
    log(d, `projections.${p}.${span}`, diag);
  };

  for (const diag of errors) {
    if (!diag.work) continue;
    const sides = [{ work: diag.work, path: diag.path }, ...(diag.related ? [diag.related] : [])];
    const seedSides = sides.filter((s) => isSeedPart(works.get(s.work), s.path) && drafts.has(s.work));
    if (seedSides.length === 0) continue; // a manual file is at fault: leave it for a human

    const [head, part] = diag.path;
    if (head === 'projections' && typeof part === 'string') {
      const p = part as ProjectionProvider;
      let targets = seedSides;
      // Two seed rows claiming the same provider episodes: if one is a special and the other a
      // regular episode of its own work (an OVA that is also listed as a special), keep the regular one.
      if (diag.code === 'target-overlap' && seedSides.length === 2) {
        const kinds = seedSides.map((s) => drafts.get(s.work)!.rows[p]?.[rowIndex(s.path) ?? -1]?.kind);
        if (kinds[0] === 'special' && kinds[1] === 'regular') targets = [seedSides[0]!];
        else if (kinds[0] === 'regular' && kinds[1] === 'special') targets = [seedSides[1]!];
      }
      for (const s of targets) {
        const d = drafts.get(s.work)!;
        const idx = diag.code === 'target-overlap' ? rowIndex(s.path) : null;
        dropRow(d, p, idx, diag);
      }
    } else if (head === 'ids' && typeof part === 'string') {
      for (const s of seedSides) {
        const d = drafts.get(s.work)!;
        if (d.ids[part as Provider] === undefined) continue;
        delete d.ids[part as Provider];
        log(d, `ids.${part}`, diag);
      }
    } else {
      for (const s of seedSides) {
        const d = drafts.get(s.work)!;
        if (d.dropped) continue;
        d.dropped = true;
        log(d, 'work', diag);
      }
    }
  }
  return dropped;
}

/** Coverage of the merged dataset (seeds plus manual files), as validation sees it. */
function summarize(
  checked: CheckedFiles,
  reporter: Reporter,
  conflicts: Conflict[],
  withoutAnchor: number,
  listsWithoutOffline: number,
  rounds: number,
): SeedSummary {
  const inc = <K extends string>(o: Partial<Record<K, number>>, k: K, n = 1) => (o[k] = (o[k] ?? 0) + n);
  const s: SeedSummary = {
    works: checked.works.length,
    provider_refs: {},
    projection_rows: {},
    projection_blocks: {},
    partial_blocks: {},
    warnings: {},
    info: {},
    conflicts: {},
    offline_db_entries_without_anchor: withoutAnchor,
    seeded_without_anidb: 0,
    seeded_without_anidb_with_projections: 0,
    anime_lists_entries_without_offline_db: listsWithoutOffline,
    repair_rounds: rounds,
  };
  for (const w of checked.works) {
    for (const p of PROVIDERS) if (w.data.ids?.[p] != null) inc(s.provider_refs, p);
    for (const p of PROJECTION_PROVIDERS) {
      const b = w.data.projections?.[p];
      if (!b) continue;
      inc(s.projection_blocks, p);
      const ranges = Array.isArray(b) ? b : b.ranges;
      inc(s.projection_rows, p, ranges.length);
      if (!Array.isArray(b) && b.coverage === 'partial') inc(s.partial_blocks, p);
    }
  }
  for (const d of reporter.diagnostics) {
    if (d.severity === 'warning') s.warnings[d.code] = (s.warnings[d.code] ?? 0) + 1;
    if (d.severity === 'info') s.info[d.code] = (s.info[d.code] ?? 0) + 1;
  }
  s.info = Object.fromEntries(Object.entries(s.info).sort());
  for (const c of conflicts) s.conflicts[c.reason] = (s.conflicts[c.reason] ?? 0) + 1;
  s.warnings = Object.fromEntries(Object.entries(s.warnings).sort());
  s.conflicts = Object.fromEntries(Object.entries(s.conflicts).sort());
  return s;
}

/** Round-trip verification used by the seed run: the builder's own check over in-memory records. */
export async function roundTrips(checked: CheckedFiles, reporter: Reporter): Promise<void> {
  const records = toRecords(checked);
  const ds = new MemoryDataset(records, { data_version: 'seed', git_sha: '', built_at: '', schema_version: '' });
  await checkRoundTrips(ds, checked, reporter);
}

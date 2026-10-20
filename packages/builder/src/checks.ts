import {
  PROJECTION_PROVIDERS,
  UNIQUE_ID_PROVIDERS,
  formatSpan,
  parseEpisodeRange,
  parseTargetRange,
  rangesOverlap,
  type EpisodeKind,
  type EpisodeSpan,
  type GroupFile,
  type ProjectionEntry,
  type ProjectionProvider,
  type SequenceFile,
  type WorkFile,
} from '@courmap/core';
import type { Reporter, Severity } from './diagnostics.js';
import { SEED_ORIGINS, type LoadedData, type SeedSource, type SourceFile } from './load.js';
import { mergeWork, type MergedWork, type SeedWork } from './merge.js';
import { schemaIssues } from './schema.js';
import { readBlock, type Block } from './blocks.js';
import { deriveFromTvdb, type Derived } from './derive.js';

export interface Typed<T> {
  src: SourceFile;
  data: T;
}

export interface CheckedFiles {
  /** Every work after merging manual files over seeds, in id order. */
  works: MergedWork[];
  sequences: Typed<SequenceFile>[];
  groups: Typed<GroupFile>[];
  /** Prequels and absolute sequences derived from TVDB order (decisions S3.6, S3.7). */
  derived: Derived;
}

type Code = Parameters<Reporter['report']>[1];
type At = (path: (string | number)[], code: Code, msg: string, severity?: Severity) => void;

/** A projection entry after parsing, with everything a check or the compiler needs. */
export interface ParsedEntry {
  index: number;
  kind: EpisodeKind;
  span: EpisodeSpan;
  season: number | null;
  targetFrom: number;
  targetTo: number | null;
  gap: boolean;
}

/** Last provider episode an entry lands on (Infinity when open-ended). */
export const landingEnd = (p: ParsedEntry) =>
  p.targetTo ?? (p.span.to === null ? Infinity : p.targetFrom + (p.span.to - p.span.from));

/**
 * Parses one projection entry, reporting problems. Returns null when the entry is unusable.
 * The compiler calls this too (with a throwaway reporter), so parsing rules live in one place.
 */
export function parseEntry(entry: ProjectionEntry, index: number, report: (code: Code, field: string | null, msg: string) => void): ParsedEntry | null {
  const r = parseEpisodeRange(entry.episodes);
  if (!r.ok) {
    report('invalid-range', 'episodes', r.error);
    return null;
  }
  const span = r.value;
  if (entry.kind !== undefined && entry.kind !== span.kind) {
    const fix = formatSpan({ ...span, kind: entry.kind });
    report('kind-mismatch', 'kind', `kind is ${entry.kind} but episodes "${entry.episodes}" are ${span.kind}; write episodes as "${fix}"`);
    return null;
  }
  if (entry.start !== undefined && entry.target !== undefined) {
    report('start-target-conflict', 'target', 'use either start (a plain offset) or target (an N-to-M split), not both');
    return null;
  }
  let targetFrom = entry.start ?? span.from;
  let targetTo: number | null = null;
  if (entry.target !== undefined) {
    const t = parseTargetRange(entry.target);
    if (!t.ok) {
      report('invalid-target', 'target', t.error);
      return null;
    }
    const n = span.to === null ? Infinity : span.to - span.from + 1;
    const m = t.value.to - t.value.from + 1;
    if (span.to === null) {
      report('invalid-target', 'target', 'an open-ended range cannot use target');
      return null;
    }
    if (n === 1 && m === 1) {
      report('invalid-target', 'target', 'target is only for N-to-M splits; for a 1-to-1 offset use start');
      return null;
    }
    if (n > 1 && m > 1) {
      report('invalid-target', 'target', `${n} canonical episodes onto ${m} provider episodes is not a split; target needs one side to be a single episode`);
      return null;
    }
    targetFrom = t.value.from;
    targetTo = t.value.to;
  }
  return { index, kind: span.kind, span, season: entry.season ?? null, targetFrom, targetTo, gap: entry.gap === true };
}

/** Runs schema checks on every source, merges manual files over seeds, then runs semantic checks. */
export function checkFiles(loaded: LoadedData, reporter: Reporter): CheckedFiles {
  const sequences: Typed<SequenceFile>[] = [];
  const groups: Typed<GroupFile>[] = [];
  const manualWorks = new Map<string, { src: SourceFile; data: WorkFile }>();
  const seedWorks = new Map<string, { src: SeedSource; data: SeedWork }>();

  // Every id seen, even in sources that fail the schema, so references to them add no noise.
  const knownIds: Record<SourceFile['kind'], Set<string>> = { work: new Set(), sequence: new Set(), group: new Set() };
  const firstFileForId = new Map<string, SourceFile>();

  for (const src of loaded.files) {
    const id = (src.data as { id?: unknown } | null)?.id;
    if (typeof id === 'string') {
      const key = `${src.kind}:${id}`;
      const prev = firstFileForId.get(key);
      if (prev) reporter.report(src.loc, 'duplicate-id', ['id'], `${src.kind} id "${id}" is already used by ${prev.file}`);
      else firstFileForId.set(key, src);
      knownIds[src.kind].add(id);
      if (id !== src.name) {
        reporter.report(src.loc, 'filename-mismatch', ['id'], `"${id}" must match the file name "${src.name}"`);
      }
    }
    const issues = schemaIssues(src.kind, src.data);
    for (const issue of issues) reporter.report(src.loc, 'schema', issue.path, issue.message, { key: issue.key });
    if (issues.length > 0) continue;
    if (src.kind === 'work') manualWorks.set(id as string, { src, data: src.data as WorkFile });
    else if (src.kind === 'sequence') sequences.push({ src, data: src.data as SequenceFile });
    else groups.push({ src, data: src.data as GroupFile });
  }

  for (const src of loaded.seeds) {
    const raw = src.data as Record<string, unknown> | null;
    if (typeof raw?.id === 'string') {
      knownIds.work.add(raw.id);
      const prev = seedWorks.get(raw.id);
      if (prev) {
        reporter.report(src.loc, 'duplicate-id', ['id'], `seed work id "${raw.id}" is already used at ${prev.src.file}:${prev.src.line}`);
        continue;
      }
    }
    const { origin, ...work } = raw ?? {};
    const issues = schemaIssues('work', work);
    for (const issue of issues) reporter.report(src.loc, 'schema', issue.path, issue.message);
    const originProblem = checkSeedOrigin(origin);
    if (originProblem) reporter.report(src.loc, 'seed-origin', ['origin'], originProblem);
    if (issues.length > 0 || originProblem) continue;
    seedWorks.set(raw!.id as string, { src, data: raw as unknown as SeedWork });
  }

  // A manual file and a seed are the same work only by slug. A matching anchor ID (AniDB,
  // AniList or MAL) under a different slug means the manual file must adopt the published slug.
  const seedByAnchor = new Map<string, string>();
  for (const [id, sw] of seedWorks) for (const a of ANCHOR_PROVIDERS) if (sw.data.ids?.[a] != null) seedByAnchor.set(`${a}:${sw.data.ids[a]}`, id);
  for (const [id, mw] of manualWorks) {
    for (const a of ANCHOR_PROVIDERS) {
      const v = mw.data.ids?.[a];
      const seedId = v != null ? seedByAnchor.get(`${a}:${v}`) : undefined;
      if (seedId === undefined || seedId === id) continue;
      reporter.report(
        mw.src.loc,
        'slug-conflict',
        ['id'],
        `this work has ${a} ${v}, which data/seeds/ publishes as "${seedId}"; rename the file to ${seedId}.yaml and set id: ${seedId} (published slugs never change)`,
        { work: id },
      );
      break;
    }
  }

  const ids = [...new Set([...manualWorks.keys(), ...seedWorks.keys()])].sort();
  const merged = ids.map((id) => mergeWork(manualWorks.get(id) ?? null, seedWorks.get(id) ?? null));
  const works = new Map(merged.map((w) => [w.id, w]));
  applyRelations(loaded.relations, works, reporter);
  applyAiring(loaded.airing, works, reporter);
  applyTmdbSplits(loaded.tmdbSplits, works, reporter);
  for (const w of merged) checkWork(w, knownIds.work, reporter);
  checkProviderIds(merged, reporter);
  checkSharedTargets(merged, reporter);
  checkSequences(sequences, works, knownIds.work, reporter);
  const derived = deriveFromTvdb(merged, sequences);
  checkGroups(groups, works, sequences, derived, knownIds.work, reporter);
  return { works: merged, sequences, groups, derived };
}

/** A line of data/seeds/relations.jsonl: an AniList PREQUEL or SEQUEL edge, as written by the bots. */
export interface RelationLine {
  work: string;
  prequel: string;
  /** The AniList relation type the edge came from, seen from `work` (SEQUEL edges are stored reversed). */
  relation: 'PREQUEL' | 'SEQUEL';
  origin: 'bot';
  /** AniList IDs of work and prequel, for tracing. */
  anilist?: [number, number];
}

function relationProblem(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return 'a relation line must be an object';
  const r = raw as Record<string, unknown>;
  for (const k of ['work', 'prequel'] as const) if (typeof r[k] !== 'string' || r[k] === '') return `${k} must be a work id`;
  if (r.relation !== 'PREQUEL' && r.relation !== 'SEQUEL') return 'relation must be PREQUEL or SEQUEL (other AniList relations never build prequel chains)';
  if (r.origin !== 'bot') return 'origin must be bot';
  const extra = Object.keys(r).filter((k) => !['work', 'prequel', 'relation', 'origin', 'anilist'].includes(k));
  if (extra.length > 0) return `unknown field "${extra[0]}"`;
  return null;
}

/**
 * Applies AniList relations from the bots (Xwolv decision S4.1). Precedence is manual, then
 * AniList, then derived: a relation sets a work's prequel only when no manual file or seed gave
 * it one, and derived prequels later fill only works that still have none. A relation naming a
 * work that is not in the data (a seed that left) is a warning and is ignored, so a seed run
 * never fails because of it.
 */
function applyRelations(lines: readonly SeedSource[], works: Map<string, MergedWork>, reporter: Reporter): void {
  const seen = new Map<string, number>();
  for (const src of lines) {
    const problem = relationProblem(src.data);
    if (problem) {
      reporter.report(src.loc, 'relation', [], problem);
      continue;
    }
    const r = src.data as RelationLine;
    const warn = (msg: string) => reporter.report(src.loc, 'relation', [], msg, { work: r.work, severity: 'warning' });
    if (seen.has(r.work)) {
      warn(`work "${r.work}" already has a relation on line ${seen.get(r.work)}; this one is ignored`);
      continue;
    }
    seen.set(r.work, src.line);
    const w = works.get(r.work);
    if (!w) warn(`work "${r.work}" is not a known work; the relation is ignored`);
    else if (r.prequel === r.work) warn(`work "${r.work}" cannot be its own prequel; the relation is ignored`);
    else if (!works.has(r.prequel)) warn(`prequel "${r.prequel}" is not a known work; the relation is ignored`);
    else if (w.data.prequel === undefined) {
      w.data.prequel = r.prequel;
      w.origins.prequel = 'bot';
    }
  }
}

/** A line of data/seeds/tmdb-splits.jsonl: where TMDB keeps a cour, as proposed by the bots' TMDB checker. */
export interface TmdbSplitLine {
  work: string;
  /** The work's tmdb_show projection rows, replacing the seed's (a manual file wins). */
  tmdb_show: { season: number; episodes: string | number; start?: number }[];
  origin: 'bot';
  /** The TMDB show, for tracing. */
  tmdb?: string;
}

function tmdbSplitProblem(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return 'a tmdb split line must be an object';
  const r = raw as Record<string, unknown>;
  if (typeof r.work !== 'string' || r.work === '') return 'work must be a work id';
  if (!Array.isArray(r.tmdb_show) || r.tmdb_show.length === 0) return 'tmdb_show must be a non-empty list of projection rows';
  for (const row of r.tmdb_show as unknown[]) {
    const x = row as Record<string, unknown> | null;
    if (typeof x !== 'object' || x === null || !Number.isInteger(x.season) || (typeof x.episodes !== 'string' && !Number.isInteger(x.episodes))) return 'a tmdb_show row needs a season and episodes';
    if (x.start !== undefined && !Number.isInteger(x.start)) return 'start must be an integer';
    const extra = Object.keys(x).filter((k) => !['season', 'episodes', 'start'].includes(k));
    if (extra.length > 0) return `unknown row field "${extra[0]}"`;
  }
  if (r.origin !== 'bot') return 'origin must be bot';
  const extra = Object.keys(r).filter((k) => !['work', 'tmdb_show', 'origin', 'tmdb'].includes(k));
  if (extra.length > 0) return `unknown field "${extra[0]}"`;
  return null;
}

/**
 * Applies the TMDB checker's split-cour lines: the work's tmdb_show projection becomes the proposed
 * rows, unless a manual file sets that block itself (manual wins). A line for an unknown work is a
 * warning and is ignored.
 */
function applyTmdbSplits(lines: readonly SeedSource[], works: Map<string, MergedWork>, reporter: Reporter): void {
  const seen = new Map<string, number>();
  for (const src of lines) {
    const problem = tmdbSplitProblem(src.data);
    if (problem) {
      reporter.report(src.loc, 'tmdb-split', [], problem);
      continue;
    }
    const s = src.data as TmdbSplitLine;
    const warn = (msg: string) => reporter.report(src.loc, 'tmdb-split', [], msg, { work: s.work, severity: 'warning' });
    if (seen.has(s.work)) {
      warn(`work "${s.work}" already has a tmdb split on line ${seen.get(s.work)}; this one is ignored`);
      continue;
    }
    seen.set(s.work, src.line);
    const w = works.get(s.work);
    if (!w) {
      warn(`work "${s.work}" is not a known work; the line is ignored`);
      continue;
    }
    const manual = w.manual?.data as { projections?: Record<string, unknown> } | undefined;
    if (manual?.projections !== undefined && Object.prototype.hasOwnProperty.call(manual.projections, 'tmdb_show')) continue;
    w.data.projections = { ...(w.data.projections ?? {}), tmdb_show: s.tmdb_show as never };
    w.origins.projections.tmdb_show = 'bot';
  }
}

/** A line of data/seeds/airing.jsonl: an airing work's count and status from AniList, as written by the bots. */
export interface AiringLine {
  work: string;
  /** AniList's total episode count (null while it is unknown, as for long-runners). */
  episodes: number | null;
  status: 'airing' | 'finished';
  origin: 'bot';
  anilist?: number;
}

function airingProblem(raw: unknown): string | null {
  if (typeof raw !== 'object' || raw === null) return 'an airing line must be an object';
  const r = raw as Record<string, unknown>;
  if (typeof r.work !== 'string' || r.work === '') return 'work must be a work id';
  if (r.episodes !== null && !(Number.isInteger(r.episodes) && (r.episodes as number) >= 1)) return 'episodes must be a positive integer or null';
  if (r.status !== 'airing' && r.status !== 'finished') return 'status must be airing or finished';
  if (r.status === 'finished' && r.episodes === null) return 'a finished work needs its episode count';
  if (r.origin !== 'bot') return 'origin must be bot';
  const extra = Object.keys(r).filter((k) => !['work', 'episodes', 'status', 'origin', 'anilist'].includes(k));
  if (extra.length > 0) return `unknown field "${extra[0]}"`;
  return null;
}

/**
 * Applies the airing tracker's counts and status (tier A count bumps and finished flips). Same
 * precedence as relations: a manual file that sets `episodes` or `status` wins; otherwise the
 * bot's value replaces the seed's. A line for a work not in the data is a warning and is ignored.
 */
function applyAiring(lines: readonly SeedSource[], works: Map<string, MergedWork>, reporter: Reporter): void {
  const seen = new Map<string, number>();
  for (const src of lines) {
    const problem = airingProblem(src.data);
    if (problem) {
      reporter.report(src.loc, 'airing', [], problem);
      continue;
    }
    const a = src.data as AiringLine;
    const warn = (msg: string) => reporter.report(src.loc, 'airing', [], msg, { work: a.work, severity: 'warning' });
    if (seen.has(a.work)) {
      warn(`work "${a.work}" already has an airing line on line ${seen.get(a.work)}; this one is ignored`);
      continue;
    }
    seen.set(a.work, src.line);
    const w = works.get(a.work);
    if (!w) {
      warn(`work "${a.work}" is not a known work; the line is ignored`);
      continue;
    }
    const manual = w.manual?.data as Record<string, unknown> | undefined;
    const own = (k: string) => manual !== undefined && Object.prototype.hasOwnProperty.call(manual, k);
    if (!own('episodes')) w.data.episodes = a.episodes;
    if (!own('status')) w.data.status = a.status;
  }
}

function checkSeedOrigin(origin: unknown): string | null {
  const ok = (v: unknown) => typeof v === 'string' && (SEED_ORIGINS as readonly string[]).includes(v);
  if (typeof origin !== 'object' || origin === null) return 'seed works need an origin object';
  const o = origin as Record<string, unknown>;
  if (!ok(o.default)) return `origin.default must be one of ${SEED_ORIGINS.join(', ')}`;
  for (const part of ['ids', 'projections']) {
    if (o[part] === undefined) continue;
    if (typeof o[part] !== 'object' || o[part] === null) return `origin.${part} must be an object`;
    for (const [k, v] of Object.entries(o[part] as object)) if (!ok(v)) return `origin.${part}.${k} must be one of ${SEED_ORIGINS.join(', ')}`;
  }
  return null;
}

/** A work needs at least one of these (Xwolv decision S3.9). */
const ANCHOR_PROVIDERS = ['anidb', 'anilist', 'mal'] as const;

const isAiring = (w: WorkFile) => w.status === 'airing';

function checkWork(w: MergedWork, knownWorks: Set<string>, reporter: Reporter): void {
  const d = w.data;
  // Bounds problems are errors for works with a manual file and warnings for seed-only works
  // (Xwolv decision 3). Movies are matched by ID and AniDB numbers their parts, so for them a
  // range past the count is only informational (decision S3.8).
  const boundsSeverity: Severity = d.type === 'movie' ? 'info' : w.isManual ? 'error' : 'warning';
  const at: At = (path, code, msg, severity) => reporter.report(w.loc, code, path, msg, { work: w.id, ...(severity && { severity }) });

  for (const key of ['type', 'episodes'] as const) {
    if (!(key in d)) at([key], 'missing-field', `${key} is required (no seed provides it for "${w.id}")`);
  }
  if (!ANCHOR_PROVIDERS.some((a) => d.ids?.[a] != null)) {
    at(['ids'], 'missing-anchor-id', 'a work needs at least one of ids.anidb, ids.anilist or ids.mal');
  }
  if (d.episodes === null && d.status !== 'airing' && d.status !== 'upcoming') {
    at(['episodes'], 'unknown-episode-count', 'episodes may be null only when status is airing or upcoming');
  }
  if (d.prequel !== undefined) {
    if (d.prequel === d.id) at(['prequel'], 'unknown-work', 'a work cannot be its own prequel');
    else if (!knownWorks.has(d.prequel)) at(['prequel'], 'unknown-work', `prequel "${d.prequel}" is not a known work`);
  }

  for (const provider of PROJECTION_PROVIDERS) {
    const written = d.projections?.[provider];
    if (!written) continue;
    const block = readBlock(written, provider);
    const base = block.base;
    if (d.ids?.[provider] == null) {
      at(['projections', provider], 'missing-provider-id', `projections.${provider} needs ids.${provider} to be set`);
    }
    if (block.coverage === 'partial' && block.notes === null) {
      at(['projections', provider, 'coverage'], 'coverage-notes', 'coverage: partial needs notes saying why the mapping stops early');
    }
    const parsed: ParsedEntry[] = [];
    let unusable = false;
    block.ranges.forEach((entry, i) => {
      const p = parseEntry(entry, i, (code, field, msg) => at(field ? [...base, i, field] : [...base, i], code, msg));
      if (!p) {
        unusable = true;
        return;
      }
      parsed.push(p);
      checkBounds(d, p, [...base, i, 'episodes'], (path, code, msg) => at(path, code, msg, boundsSeverity));
    });
    // With an entry already rejected, coverage checks would only report its absence again.
    if (!unusable) checkOverlapsAndGaps(d, provider, parsed, block, at);
    checkLandingOverlaps(provider, parsed, base, at);
  }
}

function checkBounds(w: WorkFile, p: ParsedEntry, path: (string | number)[], at: At): void {
  const label = formatSpan(p.span);
  if (p.span.to === null) {
    if (!isAiring(w)) {
      at(path, 'open-ended-not-airing', `open-ended range "${label}" is allowed only when status is airing`);
      return;
    }
  }
  const limit = p.kind === 'regular' ? (w.episodes ?? null) : p.kind === 'special' ? (w.specials ?? null) : null;
  if (limit === null) return;
  const end = p.span.to ?? p.span.from;
  if (end > limit) {
    const what = p.kind === 'regular' ? `episodes: ${limit}` : `specials: ${limit}`;
    at(path, 'out-of-bounds', `range "${label}" goes past the work's ${what}`);
  }
}

function checkOverlapsAndGaps(w: WorkFile, provider: ProjectionProvider, parsed: ParsedEntry[], block: Block, at: At): void {
  const base = block.base;
  const byKind = new Map<EpisodeKind, ParsedEntry[]>();
  for (const p of parsed) byKind.set(p.kind, [...(byKind.get(p.kind) ?? []), p]);

  for (const [kind, list] of byKind) {
    const sorted = [...list].sort((a, b) => a.span.from - b.span.from);
    for (let i = 1; i < sorted.length; i++) {
      for (let j = 0; j < i; j++) {
        const a = sorted[j]!;
        const b = sorted[i]!;
        if (rangesOverlap(a.span, b.span)) {
          at([...base, b.index, 'episodes'], 'overlap', `"${formatSpan(b.span)}" overlaps "${formatSpan(a.span)}" in ${provider}[${a.index}]`);
        }
      }
    }
    if (kind !== 'regular') continue;

    // Regular episodes must be covered without holes unless a hole is marked with gap: true.
    let next = 1;
    for (const p of sorted) {
      if (p.span.from > next) {
        if (!p.gap) {
          at([...base, p.index, 'episodes'], 'gap', `${missing(kind, next, p.span.from - 1)} no ${provider} mapping; add gap: true to this entry if that is intended`);
        }
      } else if (p.gap) {
        at([...base, p.index, 'gap'], 'gap-marker-unused', 'gap: true is set but no episodes are missing before this entry');
      }
      next = p.span.to === null ? Infinity : Math.max(next, p.span.to + 1);
    }
    const episodes = w.episodes ?? null;
    const stopsEarly = episodes !== null && next !== Infinity && next <= episodes && sorted.length > 0;
    if (stopsEarly && block.coverage !== 'partial') {
      const last = sorted[sorted.length - 1]!;
      at(
        [...base, last.index, 'episodes'],
        'gap',
        `${missing(kind, next, episodes)} no ${provider} mapping; if the provider really stops there, write this block as { coverage: partial, notes, ranges }`,
      );
    }
    if (!stopsEarly && block.coverage === 'partial') {
      at(['projections', provider, 'coverage'], 'coverage-unused', 'coverage: partial is set but the ranges reach the last episode');
    }
  }
}

function checkLandingOverlaps(provider: ProjectionProvider, parsed: ParsedEntry[], base: (string | number)[], at: At): void {
  for (let i = 0; i < parsed.length; i++) {
    for (let j = 0; j < i; j++) {
      const a = parsed[j]!;
      const b = parsed[i]!;
      if (a.season !== b.season) continue;
      if (rangesOverlap({ from: a.targetFrom, to: landingEnd(a) }, { from: b.targetFrom, to: landingEnd(b) })) {
        at([...base, b.index], 'target-overlap', `lands on the same ${provider} ${seasonLabel(b.season)} episodes as ${provider}[${a.index}]`);
      }
    }
  }
}

const missing = (kind: EpisodeKind, from: number, to: number) =>
  from === to ? `episode ${formatSpan({ kind, from, to })} has` : `episodes ${formatSpan({ kind, from, to })} have`;

const seasonLabel = (s: number | null) => (s === null ? '(no season)' : `season ${s}`);

function checkProviderIds(works: MergedWork[], reporter: Reporter): void {
  const seen = new Map<string, MergedWork>();
  for (const w of works) {
    for (const provider of UNIQUE_ID_PROVIDERS) {
      const id = w.data.ids?.[provider as keyof NonNullable<WorkFile['ids']>];
      if (id == null) continue;
      const key = `${provider}:${id}`;
      const prev = seen.get(key);
      if (prev) {
        reporter.report(w.loc, 'duplicate-provider-id', ['ids', provider], `${key} is already used by work "${prev.id}"`, {
          work: w.id,
          related: { work: prev.id, path: ['ids', provider] },
        });
      } else seen.set(key, w);
    }
  }
}

/** Two works sharing a season-based show must not land on the same season and episodes. */
function checkSharedTargets(works: MergedWork[], reporter: Reporter): void {
  for (const provider of PROJECTION_PROVIDERS) {
    const byShow = new Map<string, { w: MergedWork; p: ParsedEntry; base: (string | number)[] }[]>();
    for (const w of works) {
      const id = w.data.ids?.[provider];
      const written = w.data.projections?.[provider];
      if (id == null || !written) continue;
      const { ranges, base } = readBlock(written, provider);
      const list = byShow.get(String(id)) ?? [];
      ranges.forEach((e, i) => {
        const p = parseEntry(e, i, () => {});
        if (p) list.push({ w, p, base });
      });
      byShow.set(String(id), list);
    }
    for (const [show, list] of byShow) {
      for (let i = 0; i < list.length; i++) {
        for (let j = 0; j < i; j++) {
          const a = list[j]!;
          const b = list[i]!;
          if (a.w === b.w || a.p.season !== b.p.season) continue;
          if (rangesOverlap({ from: a.p.targetFrom, to: landingEnd(a.p) }, { from: b.p.targetFrom, to: landingEnd(b.p) })) {
            reporter.report(
              b.w.loc,
              'target-overlap',
              [...b.base, b.p.index],
              `${provider}:${show} ${seasonLabel(b.p.season)} episodes are also claimed by work "${a.w.id}" (${provider}[${a.p.index}])`,
              { work: b.w.id, related: { work: a.w.id, path: [...a.base, a.p.index] } },
            );
          }
        }
      }
    }
  }
}

function checkSequences(seqs: Typed<SequenceFile>[], works: Map<string, MergedWork>, knownWorks: Set<string>, reporter: Reporter): void {
  // work -> sequence -> member positions, for the default-sequence rule
  const memberships = new Map<string, Map<string, { src: SourceFile; i: number; isDefault: boolean }[]>>();
  for (const { src, data: s } of seqs) {
    const spans: { i: number; work: string; span: EpisodeSpan; abs: { from: number; to: number | null } }[] = [];
    s.members.forEach((m, i) => {
      const at = (field: string, code: Code, msg: string) => reporter.report(src.loc, code, ['members', i, field], msg);
      if (!knownWorks.has(m.work)) {
        at('work', 'unknown-work', `work "${m.work}" is not a known work`);
        return;
      }
      const r = parseEpisodeRange(m.episodes);
      if (!r.ok) return at('episodes', 'invalid-range', r.error);
      if (r.value.kind !== 'regular') return at('episodes', 'invalid-range', 'absolute sequences cover regular episodes only');
      const work = works.get(m.work)?.data;
      if (work) {
        if (r.value.to === null && !isAiring(work)) {
          at('episodes', 'open-ended-not-airing', `open-ended range "${formatSpan(r.value)}" needs work "${m.work}" to have status airing`);
        } else if (work.episodes != null && (r.value.to ?? r.value.from) > work.episodes) {
          at('episodes', 'out-of-bounds', `range "${formatSpan(r.value)}" goes past work "${m.work}" episodes: ${work.episodes}`);
        }
      }
      const abs = { from: m.absolute_start, to: r.value.to === null ? null : m.absolute_start + (r.value.to - r.value.from) };
      spans.push({ i, work: m.work, span: r.value, abs });

      const bySeq = memberships.get(m.work) ?? new Map();
      bySeq.set(s.id, [...(bySeq.get(s.id) ?? []), { src, i, isDefault: m.default === true }]);
      memberships.set(m.work, bySeq);
    });

    const maxStart = Math.max(...spans.map((x) => x.abs.from));
    const misplaced = new Set<number>();
    for (const x of spans) {
      if (x.abs.to === null && x.abs.from !== maxStart) {
        misplaced.add(x.i);
        reporter.report(src.loc, 'open-ended-not-last', ['members', x.i, 'episodes'], 'only the member with the highest absolute_start may be open-ended');
      }
    }
    for (let i = 0; i < spans.length; i++) {
      for (let j = 0; j < i; j++) {
        const a = spans[j]!;
        const b = spans[i]!;
        if (!misplaced.has(a.i) && !misplaced.has(b.i) && rangesOverlap(a.abs, b.abs)) {
          reporter.report(src.loc, 'sequence-overlap', ['members', b.i, 'absolute_start'], `absolute episodes ${fmtAbs(b.abs)} overlap members[${a.i}] (${fmtAbs(a.abs)})`);
        }
        if (a.work === b.work && rangesOverlap(a.span, b.span)) {
          reporter.report(src.loc, 'sequence-overlap', ['members', b.i, 'episodes'], `episodes of "${b.work}" are already covered by members[${a.i}]`);
        }
      }
    }
  }
  checkDefaultSequences(memberships, reporter);
}

/** A work in several sequences needs exactly one of them marked default: true. */
function checkDefaultSequences(memberships: Map<string, Map<string, { src: SourceFile; i: number; isDefault: boolean }[]>>, reporter: Reporter): void {
  for (const [work, bySeq] of memberships) {
    if (bySeq.size < 2) continue;
    const defaults = [...bySeq].filter(([, ms]) => ms.some((m) => m.isDefault));
    const seqs = [...bySeq.keys()].sort();
    if (defaults.length === 1) continue;
    if (defaults.length === 0) {
      for (const [, ms] of bySeq) {
        const m = ms[0]!;
        reporter.report(m.src.loc, 'sequence-default', ['members', m.i, 'work'], `work "${work}" is in ${seqs.length} sequences (${seqs.join(', ')}); mark exactly one membership default: true`);
      }
    } else {
      for (const [, ms] of defaults) {
        const m = ms.find((x) => x.isDefault)!;
        reporter.report(m.src.loc, 'sequence-default', ['members', m.i, 'default'], `work "${work}" has ${defaults.length} default sequences (${defaults.map(([id]) => id).sort().join(', ')}); only one may be default`);
      }
    }
  }
}

const fmtAbs = (a: { from: number; to: number | null }) => (a.to === null ? `${a.from}-` : `${a.from}-${a.to}`);

function checkGroups(
  groups: Typed<GroupFile>[],
  works: Map<string, MergedWork>,
  seqs: Typed<SequenceFile>[],
  derived: Derived,
  knownWorks: Set<string>,
  reporter: Reporter,
): void {
  const seqMembers = new Map(seqs.map((s) => [s.data.id, new Set(s.data.members.map((m) => m.work))]));
  for (const s of derived.sequences) seqMembers.set(s.id, new Set(s.members.map((m) => m.work)));
  const aliasOwner = new Map<string, string>();
  for (const { src, data: g } of groups) {
    (g.aliases ?? []).forEach((alias, i) => {
      const key = alias.toLowerCase();
      const owner = aliasOwner.get(key);
      if (owner !== undefined && owner !== g.id) {
        reporter.report(src.loc, 'duplicate-alias', ['aliases', i], `alias "${alias}" is already used by group "${owner}"`);
      } else aliasOwner.set(key, g.id);
    });
    (g.overrides ?? []).forEach((o, i) => {
      const at = (field: string, code: Code, msg: string) => reporter.report(src.loc, code, ['overrides', i, field], msg);
      if (!knownWorks.has(o.work)) return at('work', 'unknown-work', `work "${o.work}" is not a known work`);
      if (o.numbering === 'offset' && o.offset === undefined) at('numbering', 'offset-mismatch', 'numbering: offset needs an offset value');
      if (o.numbering !== 'offset' && o.offset !== undefined) at('offset', 'offset-mismatch', `offset is only used with numbering: offset, not ${o.numbering}`);
      if (o.sequence !== undefined) {
        if (o.numbering !== 'absolute') at('sequence', 'override-sequence', `sequence is only used with numbering: absolute, not ${o.numbering}`);
        else if (!seqMembers.has(o.sequence)) at('sequence', 'override-sequence', `sequence "${o.sequence}" is not in data/sequences/`);
        else if (!seqMembers.get(o.sequence)!.has(o.work)) at('sequence', 'override-sequence', `work "${o.work}" is not a member of sequence "${o.sequence}"`);
      }
      const target = works.get(o.work);
      // An AniList prequel (origin bot) never implies numbering (decision S5.2), so it does not count.
      const numberingPrequel = target && target.data.prequel !== undefined && target.origins.prequel !== 'bot';
      if (o.numbering === 'continue_prequel' && target && !numberingPrequel && !derived.prequels.has(o.work)) {
        at('numbering', 'missing-prequel', `continue_prequel needs work "${o.work}" to have a prequel from a manual file, a seed or TVDB order (AniList relations do not count)`);
      }
    });
  }
}

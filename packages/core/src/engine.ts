import { CourmapError } from './errors.js';
import { countIsFloor } from './model.js';
import type { AliasEntry } from './alias-shards.js';
import type {
  EpisodeInput,
  GroupRecord,
  Meta,
  ProjectionRow,
  SequenceRecord,
  TargetResult,
  TranslateResult,
  Work,
  WorkRecord,
} from './model.js';
import {
  isCanonicalProvider,
  isIdOnlyProvider,
  isProjectionProvider,
  isTarget,
  type EpisodeKind,
  type Provider,
  type ProjectionProvider,
  type Target,
} from './providers.js';
import { formatSpan, parseEpisode } from './range.js';
import { parseRef, type Ref } from './ref.js';

/**
 * Read access to compiled data. The in-memory builder dataset, the SQLite offline client
 * and the remote shard client all implement this, and all share the engine below, which
 * is what keeps their results identical.
 */
export interface Dataset {
  meta(): Promise<Meta>;
  getWork(id: string): Promise<WorkRecord | undefined>;
  /** Work ids carrying this provider ID, sorted ascending. */
  findWorkIds(provider: Provider, providerId: string): Promise<string[]>;
  getSequence(id: string): Promise<SequenceRecord | undefined>;
  /** One prefix shard of the alias index ([] when there is none), as shardAliasIndex splits it. */
  aliasShard(prefix: string): Promise<AliasEntry[]>;
  /** One bucket of the trigram set for fuzzy matching ({} when empty). */
  aliasGrams(bucket: number): Promise<Record<string, string[]>>;
  /** Every release group, sorted by id. */
  groups(): Promise<GroupRecord[]>;
}

/** A position on the hub: one canonical episode, or a canonical range when several map to one provider episode. */
interface HubPoint {
  work: WorkRecord;
  kind: EpisodeKind;
  episode: number;
  episodeTo: number;
}

// ---------------------------------------------------------------------------
// Projection math

interface Landing {
  season: number | null;
  from: number;
  to: number;
}

const rowContains = (row: ProjectionRow, e: number) => e >= row.ep_from && (row.ep_to === null || e <= row.ep_to);

/** Last provider episode a row covers, or Infinity when open-ended. */
function rowTargetEnd(row: ProjectionRow): number {
  if (row.target_to !== null) return row.target_to;
  if (row.ep_to === null) return Infinity;
  return row.target_from + (row.ep_to - row.ep_from);
}

/** Canonical episode to provider episode(s). */
export function projectForward(rows: readonly ProjectionRow[], kind: EpisodeKind, e: number): Landing | null {
  const row = rows.find((r) => r.kind === kind && rowContains(r, e));
  if (!row) return null;
  if (row.target_to !== null) {
    const single = row.ep_to === row.ep_from;
    // one canonical -> several provider episodes, or several canonical -> one provider episode
    return single
      ? { season: row.season, from: row.target_from, to: row.target_to }
      : { season: row.season, from: row.target_from, to: row.target_from };
  }
  const t = row.target_from + (e - row.ep_from);
  return { season: row.season, from: t, to: t };
}

export interface ReverseHit {
  kind: EpisodeKind;
  from: number;
  to: number;
}

/** Provider episode back to canonical episode(s), one hit per matching row. */
export function projectReverse(rows: readonly ProjectionRow[], season: number | null, t: number): ReverseHit[] {
  const hits: ReverseHit[] = [];
  for (const row of rows) {
    if (row.season !== season || t < row.target_from || t > rowTargetEnd(row)) continue;
    if (row.target_to !== null) {
      const single = row.ep_to === row.ep_from;
      hits.push(single ? { kind: row.kind, from: row.ep_from, to: row.ep_from } : { kind: row.kind, from: row.ep_from, to: row.ep_to! });
    } else {
      const e = row.ep_from + (t - row.target_from);
      hits.push({ kind: row.kind, from: e, to: e });
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Input handling

function parseRefOrThrow(input: string): Ref {
  if (typeof input !== 'string') throw new CourmapError('invalid_input', 'ref must be a string', { field: 'ref' });
  const r = parseRef(input);
  if (!r.ok) throw new CourmapError('invalid_input', r.error, { field: 'ref' });
  return r.value;
}

function parseEpisodeOrThrow(input: EpisodeInput): { kind: EpisodeKind; episode: number } {
  if (typeof input !== 'number' && typeof input !== 'string') {
    throw new CourmapError('invalid_input', 'episode must be a number or a string such as "S1"', { field: 'episode' });
  }
  const r = parseEpisode(input);
  if (!r.ok) throw new CourmapError('invalid_input', r.error, { field: 'episode' });
  return r.value;
}

async function requireWork(ds: Dataset, id: string): Promise<WorkRecord> {
  const work = await ds.getWork(id);
  if (!work) throw new CourmapError('not_found', `work "${id}" does not exist`, { field: 'ref' });
  return work;
}

async function worksForProviderId(ds: Dataset, provider: Provider, id: string): Promise<WorkRecord[]> {
  const ids = await ds.findWorkIds(provider, id);
  if (ids.length === 0) throw new CourmapError('not_found', `no work has ${provider}:${id}`, { field: 'ref' });
  return Promise.all(ids.map((w) => requireWork(ds, w)));
}

function single(works: WorkRecord[], what: string): WorkRecord {
  if (works.length > 1) {
    throw new CourmapError('ambiguous', `${what} matches ${works.length} works`, {
      field: 'ref',
      candidates: works.map((w) => w.id),
    });
  }
  return works[0]!;
}

function checkBounds(work: WorkRecord, kind: EpisodeKind, e: number): void {
  // A movie's parts (AniDB numbers them) may exceed its episode count of 1 (decision S3.8).
  if (work.type === 'movie' && kind === 'regular') return;
  // An airing work with an open-ended mapping: the count lags the broadcast (see countIsFloor).
  if (kind === 'regular' && countIsFloor(work)) return;
  const limit = kind === 'regular' ? work.episodes : kind === 'special' ? work.specials : null;
  if (limit !== null && e > limit) {
    throw new CourmapError('invalid_input', `${work.id} has ${limit} ${kind} episodes; ${formatSpan({ kind, from: e, to: e })} is out of range`, {
      field: 'episode',
    });
  }
}

/** Resolves the input ref and episode to a point on the hub. */
async function toHub(ds: Dataset, ref: Ref, episode: EpisodeInput): Promise<HubPoint> {
  const ns = ref.namespace;

  if (ns === 'absolute') {
    const seq = await ds.getSequence(ref.id);
    if (!seq) throw new CourmapError('not_found', `sequence "${ref.id}" does not exist`, { field: 'ref' });
    const { kind, episode: a } = parseEpisodeOrThrow(episode);
    if (kind !== 'regular') throw new CourmapError('invalid_input', 'absolute numbering has regular episodes only', { field: 'episode' });
    for (const m of seq.members) {
      const end = m.ep_to === null ? Infinity : m.absolute_start + (m.ep_to - m.ep_from);
      if (a >= m.absolute_start && a <= end) {
        const e = m.ep_from + (a - m.absolute_start);
        return { work: await requireWork(ds, m.work), kind: 'regular', episode: e, episodeTo: e };
      }
    }
    throw new CourmapError('not_found', `absolute episode ${a} is not in sequence ${seq.id}`, { field: 'episode' });
  }

  if (ns === 'work' || isCanonicalProvider(ns) || isIdOnlyProvider(ns)) {
    const work = ns === 'work' ? await requireWork(ds, ref.id) : single(await worksForProviderId(ds, ns, ref.id), `${ns}:${ref.id}`);
    const { kind, episode: e } = parseEpisodeOrThrow(episode);
    if (kind !== 'regular' && ns !== 'work' && ns !== 'anidb') {
      throw new CourmapError('invalid_input', `${ns} does not number ${kind} episodes; use an anidb or work ref`, { field: 'episode' });
    }
    checkBounds(work, kind, e);
    return { work, kind, episode: e, episodeTo: e };
  }

  // Season-based provider: reverse the projection.
  const provider: ProjectionProvider = ns;
  const parsed = parseEpisodeOrThrow(episode);
  if (parsed.kind !== 'regular') {
    throw new CourmapError('invalid_input', `${provider} episodes are plain numbers; specials live in season 0 (${provider}:${ref.id}:s0)`, {
      field: 'episode',
    });
  }
  const t = parsed.episode;
  const works = await worksForProviderId(ds, provider, ref.id);
  if (ref.season === null && !works.some((w) => w.projections[provider]?.some((r) => r.season === null))) {
    throw new CourmapError('invalid_input', `${provider}:${ref.id} is numbered by season; add a scope such as ${provider}:${ref.id}:s1`, {
      field: 'ref',
    });
  }
  const hits: HubPoint[] = [];
  for (const work of works) {
    for (const h of projectReverse(work.projections[provider] ?? [], ref.season, t)) {
      hits.push({ work, kind: h.kind, episode: h.from, episodeTo: h.to });
    }
  }
  if (hits.length === 0) {
    const where = ref.season === null ? '' : ` season ${ref.season}`;
    throw new CourmapError('not_found', `no work maps ${provider}:${ref.id}${where} episode ${t}`, { field: 'episode' });
  }
  if (hits.length > 1) {
    throw new CourmapError('ambiguous', `${provider}:${ref.id} episode ${t} maps to ${hits.length} canonical episodes`, {
      field: 'episode',
      candidates: [...new Set(hits.map((h) => h.work.id))],
    });
  }
  return hits[0]!;
}

// ---------------------------------------------------------------------------
// Hub to target

function withRange<T extends { episode: number }>(base: T, to: number): T & { episode_to?: number } {
  return to !== base.episode ? { ...base, episode_to: to } : base;
}

function fromHub(hub: HubPoint, target: Target): TargetResult | null {
  const { work, kind, episode: e, episodeTo } = hub;

  if (target === 'absolute') {
    if (kind !== 'regular') return null;
    // Only the default sequence answers; another sequence covering e is not a silent fallback.
    const m = work.sequences.find((s) => s.default && e >= s.ep_from && (s.ep_to === null || e <= s.ep_to));
    if (!m) return null;
    return withRange({ sequence: m.sequence, episode: m.absolute_start + (e - m.ep_from) }, m.absolute_start + (episodeTo - m.ep_from));
  }

  const id = work.ids[target];
  if (id === undefined) return null;

  if (isIdOnlyProvider(target)) return { id };

  if (isCanonicalProvider(target)) {
    if (kind !== 'regular' && target !== 'anidb') return null;
    const base = withRange({ id, episode: e }, episodeTo);
    return kind === 'regular' ? base : { ...base, kind };
  }

  const rows = work.projections[target] ?? [];
  const start = projectForward(rows, kind, e);
  if (!start) return null;
  let to = start.to;
  if (episodeTo !== e) {
    const end = projectForward(rows, kind, episodeTo);
    if (end && end.season === start.season) to = Math.max(to, end.to);
  }
  const base = start.season === null ? { id, episode: start.from } : { id, season: start.season, episode: start.from };
  return withRange(base, to);
}

// ---------------------------------------------------------------------------
// Operations

export async function lookup(ds: Dataset, refInput: string): Promise<Work> {
  const ref = parseRefOrThrow(refInput);
  const { data_version } = await ds.meta();
  const ns = ref.namespace;
  if (ns === 'absolute') throw new CourmapError('invalid_input', 'absolute refs name a sequence, not a work', { field: 'ref' });

  let work: WorkRecord;
  if (ns === 'work') {
    work = await requireWork(ds, ref.id);
  } else {
    let works = await worksForProviderId(ds, ns, ref.id);
    if (isProjectionProvider(ns) && ref.season !== null) {
      works = works.filter((w) => w.projections[ns]?.some((r) => r.season === ref.season));
      if (works.length === 0) throw new CourmapError('not_found', `no work maps ${ns}:${ref.id} season ${ref.season}`, { field: 'ref' });
    }
    work = single(works, refInput);
  }
  return { data_version, ...work };
}

export async function translate(
  ds: Dataset,
  refInput: string,
  episode: EpisodeInput,
  targets: readonly string[],
): Promise<TranslateResult> {
  const ref = parseRefOrThrow(refInput);
  if (!Array.isArray(targets)) throw new CourmapError('invalid_input', 'targets must be a list', { field: 'targets' });
  const bad = targets.filter((t) => !isTarget(t));
  if (bad.length > 0) throw new CourmapError('invalid_input', `unknown target(s): ${bad.join(', ')}`, { field: 'targets' });
  const { data_version } = await ds.meta();

  const hub = await toHub(ds, ref, episode);
  const results: Partial<Record<Target, TargetResult>> = {};
  const unmapped: Target[] = [];
  for (const target of [...new Set(targets)] as Target[]) {
    const r = fromHub(hub, target);
    if (r) results[target] = r;
    else unmapped.push(target);
  }

  return {
    data_version,
    status: unmapped.length > 0 ? 'unmapped' : 'ok',
    input: { ref: refInput, episode },
    work: withRange({ id: hub.work.id, episode: hub.episode, kind: hub.kind }, hub.episodeTo),
    results,
    unmapped,
  };
}

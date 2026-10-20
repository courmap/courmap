import { MIN_ALIAS_LENGTH } from './aliases.js';
import { aliasShardKey, gramBucket, trigrams, type AliasEntry } from './alias-shards.js';
import { translate, type Dataset } from './engine.js';
import { CourmapError } from './errors.js';
import { hasOpenRun, type GroupRecord, type WorkRecord } from './model.js';
import { codePointLength, normalizeTitle } from './normalize.js';
import type { ParsedRelease, ResolveCandidate, ResolvedProjections, ResolveMatch, ResolveResult, WorkSummary } from './release.js';

/** A winner needs at least this confidence... */
export const OK_FLOOR = 0.85;
/** ...and this lead over the runner-up. Otherwise the answer is ambiguous. */
export const CLEAR_MARGIN = 0.1;
/** Trigram matches below this similarity are not candidates. */
export const FUZZY_FLOOR = 0.6;
const FUZZY_TOP = 10;
/** Prefix shards searched for trigram matches: the query's own plus the best by shared rare trigrams. */
const FUZZY_SHARDS = 6;
/**
 * Evidence when a tie-breaker disagrees: a season token that does not match, no season token on a
 * sequel (no token reads as the first season), a year two or more off, a number nothing places.
 */
export const MISMATCH = 0.05;
const MAX_BATCH = 500;

// ---------------------------------------------------------------------------
// Alias matching, over the prefix shards and the trigram set (decision S6.1)

/** Per shard: exact lookup and each alias's trigrams, built once per loaded shard. */
interface ShardIndex {
  exact: Map<string, string[]>;
  grams: Set<string>[];
}
const shardIndexes = new WeakMap<AliasEntry[], ShardIndex>();

function indexShard(shard: AliasEntry[]): ShardIndex {
  let ix = shardIndexes.get(shard);
  if (!ix) shardIndexes.set(shard, (ix = { exact: new Map(shard), grams: shard.map(([a]) => trigrams(a)) }));
  return ix;
}

async function exactWorks(ds: Dataset, normalized: string): Promise<string[] | undefined> {
  if (codePointLength(normalized) < MIN_ALIAS_LENGTH) return undefined;
  return indexShard(await ds.aliasShard(aliasShardKey(normalized))).exact.get(normalized);
}

interface AliasHit {
  alias: string;
  works: string[];
  /** 1 for an exact hit, else trigram (Dice) similarity. */
  similarity: number;
  /** Hit through a season-suffixed query ("title 2"). */
  viaSeason: boolean;
}

/**
 * Trigram (Dice) matches for q, best first. The trigram set names the prefix shards that share
 * q's informative trigrams; the query's own shard and the best few others are searched exactly.
 * Deterministic: ties go to the alias that sorts first.
 */
async function fuzzy(ds: Dataset, q: string): Promise<{ alias: string; works: string[]; similarity: number }[]> {
  const qg = trigrams(q);
  const buckets = new Map<number, Record<string, string[]>>();
  for (const b of [...new Set([...qg].map(gramBucket))].sort((x, y) => x - y)) buckets.set(b, await ds.aliasGrams(b));
  const score = new Map<string, number>();
  for (const g of qg) for (const p of buckets.get(gramBucket(g))![g] ?? []) score.set(p, (score.get(p) ?? 0) + 1);
  const own = aliasShardKey(q);
  const ranked = [...score].filter(([p]) => p !== own).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const prefixes = [own, ...ranked.slice(0, FUZZY_SHARDS - 1).map(([p]) => p)];
  const out: { alias: string; works: string[]; similarity: number }[] = [];
  for (const p of prefixes) {
    const shard = await ds.aliasShard(p);
    const ix = indexShard(shard);
    shard.forEach(([alias, works], i) => {
      const ag = ix.grams[i]!;
      let c = 0;
      for (const g of qg) if (ag.has(g)) c++;
      const similarity = (2 * c) / (qg.size + ag.size);
      if (similarity >= FUZZY_FLOOR) out.push({ alias, works, similarity });
    });
  }
  out.sort((a, b) => b.similarity - a.similarity || (a.alias < b.alias ? -1 : a.alias > b.alias ? 1 : 0));
  return out.slice(0, FUZZY_TOP);
}

const ordinalSuffix = (n: number) => (n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'));

/** Exact hits for the title and its season variants; trigram hits only when nothing matches exactly. */
async function aliasHits(ds: Dataset, parsed: ParsedRelease): Promise<AliasHit[]> {
  const title = parsed.title!;
  const bases = [normalizeTitle(title)];
  // A trailing special word ("Show Movie") may or may not be part of the alias.
  if (parsed.special) {
    const stripped = normalizeTitle(title.replace(/\s+(?:movie|film|ova|oav|oad|specials?|sp)$/i, ''));
    if (stripped && stripped !== bases[0]) bases.push(stripped);
  }
  const n = parsed.season ?? parsed.part;
  const hits: AliasHit[] = [];
  const seen = new Set<string>();
  const tryExact = async (q: string, viaSeason: boolean) => {
    if (seen.has(q)) return;
    const works = await exactWorks(ds, q);
    if (works) {
      seen.add(q);
      hits.push({ alias: q, works, similarity: 1, viaSeason });
    }
  };
  for (const b of bases) {
    // Season tokens also appear as "2nd" or "s2"; Part and Cour tokens only as the number.
    if (parsed.season !== null) for (const v of [`${b} ${n}`, `${b} ${n}${ordinalSuffix(n!)}`, `${b} s${n}`]) await tryExact(v, true);
    else if (parsed.part !== null) await tryExact(`${b} ${n}`, true);
    // The parser takes "(2005)" out of the title as a year; remakes carry it in their title ("Doraemon (2005)").
    if (parsed.year !== null) await tryExact(`${b} ${parsed.year}`, false);
    await tryExact(b, false);
  }
  if (hits.length > 0 || !bases[0]) return hits;
  for (const f of await fuzzy(ds, bases[0])) hits.push({ ...f, viaSeason: false });
  return hits;
}

// ---------------------------------------------------------------------------
// Interpreting the number

interface Placement {
  work: WorkRecord;
  episode: number | null;
  episodeTo: number | null;
  /** 1 = the number fits; lower = a weaker reading; 0.05 = it does not fit at all. */
  fit: number;
  /** Placed through the TVDB season in reverse, which already agrees with the season token. */
  viaTvdbSeason: boolean;
  reason: string;
}

interface Ctx {
  ds: Dataset;
  parsed: ParsedRelease;
  group: GroupRecord | null;
}

const inRange = (w: WorkRecord, e: number) => e >= 1 && (w.episodes === null || e <= w.episodes || hasOpenRun(w));

/** Steps 4.1 to 4.4 of the spec for one episode number. */
async function placeOne(ctx: Ctx, w: WorkRecord, e: number, season: number | null): Promise<Omit<Placement, 'episodeTo'>> {
  const { ds } = ctx;
  const override = ctx.group?.overrides.find((o) => o.work === w.id);
  if (override) {
    const tag = `group ${ctx.group!.id}`;
    // An AniList prequel (origin bot) orders the chain but never implies numbering (decision S5.2).
    if (override.numbering === 'continue_prequel' && w.prequel && w.prequel_origin !== 'bot') {
      const prequel = await ds.getWork(w.prequel);
      if (prequel?.episodes != null && inRange(w, e - prequel.episodes)) {
        return { work: w, episode: e - prequel.episodes, fit: 1, viaTvdbSeason: false, reason: `${tag} numbers ${w.id} after ${prequel.id}'s ${prequel.episodes} episodes` };
      }
    }
    if (override.numbering === 'offset' && override.offset !== null && inRange(w, e - override.offset)) {
      return { work: w, episode: e - override.offset, fit: 1, viaTvdbSeason: false, reason: `${tag} numbers ${w.id} with an offset of ${override.offset}` };
    }
    if (override.numbering === 'absolute') {
      const seqId = override.sequence ?? w.sequences.find((s) => s.default)?.sequence;
      const hub = seqId ? await viaAbsolute(ds, seqId, e) : null;
      if (hub) return { ...hub, fit: 1, viaTvdbSeason: false, reason: `${tag} numbers by ${seqId}: absolute ${e} is ${hub.work.id} ${hub.episode}` };
    }
  }
  // An explicit season token (S2, Season 2, S02E05) is read as a TVDB season first: it is the
  // most specific reading, and for long-runners the canonical number would be wrong. Part and
  // cour tokens are not TVDB seasons, so they skip this.
  const tvdb = w.ids.tvdb_show;
  if (season !== null && tvdb !== undefined) {
    try {
      const r = await translate(ds, `tvdb_show:${tvdb}:s${season}`, e, []);
      const work = (await ds.getWork(r.work.id))!;
      return { work, episode: r.work.episode, fit: 1, viaTvdbSeason: true, reason: `TVDB S${season}E${e} is ${work.id} ${r.work.episode}` };
    } catch (err) {
      if (!(err instanceof CourmapError)) throw err;
    }
  }
  if (inRange(w, e)) {
    // Past the recorded count only for an airing work with an open-ended mapping, whose count lags the broadcast.
    const lagging = w.episodes !== null && e > w.episodes;
    return { work: w, episode: e, fit: 1, viaTvdbSeason: false, reason: lagging ? `${e} is past ${w.id}'s ${w.episodes} recorded episodes, but it is airing and its mapping is open-ended` : `${e} is within ${w.id}'s ${w.episodes ?? 'open'} episodes` };
  }
  const member = w.sequences.find((s) => s.default);
  if (member && e >= member.absolute_start) {
    const hub = await viaAbsolute(ds, member.sequence, e);
    if (hub) {
      return { ...hub, fit: 1, viaTvdbSeason: false, reason: `${e} exceeds ${w.id}'s ${w.episodes} episodes; ${member.sequence} places absolute ${e} at ${hub.work.id} ${hub.episode}` };
    }
  }
  return { work: w, episode: e, fit: MISMATCH, viaTvdbSeason: false, reason: `${e} is past ${w.id}'s ${w.episodes} episodes and nothing places it` };
}

async function viaAbsolute(ds: Dataset, sequence: string, abs: number): Promise<{ work: WorkRecord; episode: number } | null> {
  try {
    const r = await translate(ds, `absolute:${sequence}`, abs, []);
    return { work: (await ds.getWork(r.work.id))!, episode: r.work.episode };
  } catch (err) {
    if (err instanceof CourmapError) return null;
    throw err;
  }
}

async function place(ctx: Ctx, w: WorkRecord): Promise<Placement> {
  const p = ctx.parsed;
  // Only a season token names a TVDB season; part and cour tokens do not.
  const season = p.season;
  // Movies are matched by title and year; their numbering is not interpreted (decision S3.8).
  if (w.type === 'movie') {
    // An episode number with no movie marker is weak evidence for a movie.
    if (p.episode !== null && p.special !== 'movie') {
      return { work: w, episode: null, episodeTo: null, fit: MISMATCH, viaTvdbSeason: false, reason: 'a movie, but the release has an episode number' };
    }
    return { work: w, episode: null, episodeTo: null, fit: 1, viaTvdbSeason: false, reason: 'a movie, matched by title' };
  }
  if (p.episode === null) {
    if (p.batch && w.episodes !== null) return { work: w, episode: 1, episodeTo: w.episodes, fit: 1, viaTvdbSeason: false, reason: `a batch of all ${w.episodes} episodes` };
    // A special, OVA or ONA of exactly one episode, named by title and year, is that episode.
    if (w.episodes === 1 && w.type !== 'tv' && p.year !== null) return { work: w, episode: 1, episodeTo: null, fit: 1, viaTvdbSeason: false, reason: 'a one-episode work, matched by title and year' };
    return { work: w, episode: null, episodeTo: null, fit: 0.3, viaTvdbSeason: false, reason: 'no episode number' };
  }
  const first = await placeOne(ctx, w, p.episode, season);
  if (p.episode_to === null) return { ...first, episodeTo: null };
  const last = await placeOne(ctx, w, p.episode_to, season);
  if (last.work.id !== first.work.id) {
    return { ...first, episodeTo: null, fit: Math.min(first.fit, 0.3), reason: `${first.reason}; the batch ends in another work (${last.work.id})` };
  }
  return { ...first, episodeTo: last.episode, fit: Math.min(first.fit, last.fit), reason: `${first.reason}; through ${last.episode}` };
}

// ---------------------------------------------------------------------------
// Scoring

/** The works before w in its prequel chain, nearest first. */
async function earlierInChain(ds: Dataset, w: WorkRecord): Promise<string[]> {
  const out: string[] = [];
  let cur: WorkRecord | undefined = w;
  while (cur?.prequel && !out.includes(cur.prequel) && cur.prequel !== w.id && out.length < 50) {
    out.push(cur.prequel);
    cur = await ds.getWork(cur.prequel);
  }
  return out;
}

async function chainPosition(ds: Dataset, w: WorkRecord): Promise<number> {
  let pos = 1;
  let cur: WorkRecord | undefined = w;
  const seen = new Set<string>();
  while (cur?.prequel && !seen.has(cur.id) && pos < 50) {
    seen.add(cur.id);
    cur = await ds.getWork(cur.prequel);
    pos++;
  }
  return pos;
}

const firstTvdbSeason = (w: WorkRecord) => w.projections.tvdb_show?.find((r) => r.kind === 'regular' && r.season !== null && r.season > 0)?.season ?? null;

/**
 * The season token as a tie-breaker. No token reads as the first season, so a sequel without
 * one is a mismatch. A season token matches the work's place in its prequel chain or its TVDB
 * season; a part (or cour) token matches the chain position only, since parts share a season.
 */
async function seasonFit(ds: Dataset, w: WorkRecord, hit: AliasHit, placement: Placement, parsed: ParsedRelease, fuzzyWorks: ReadonlySet<string>): Promise<{ fit: number; reason: string | null }> {
  const n = parsed.season ?? parsed.part;
  if (n === null) {
    // No token reads as the first season, but only against the works it could be confused with:
    // the penalty applies when the alias is shared with an earlier work of the chain (decision S5.1).
    // A trigram match counts as shared when an earlier work also matched the query by trigram.
    if (!w.prequel) return { fit: 1, reason: null };
    const shares = (id: string) => (hit.similarity === 1 ? hit.works.includes(id) : fuzzyWorks.has(id));
    const earlier = (await earlierInChain(ds, w)).filter(shares);
    return earlier.length > 0 ? { fit: MISMATCH, reason: `no season token, and the alias is shared with its prequel ${earlier[0]}` } : { fit: 1, reason: null };
  }
  const what = parsed.season !== null ? 'season' : 'part';
  if (hit.viaSeason) return { fit: 1, reason: `${what} ${n} is in the alias` };
  if (placement.viaTvdbSeason) return { fit: 1, reason: null };
  const pos = await chainPosition(ds, w);
  if (pos === n) return { fit: 1, reason: `${what} ${n} is its place in the prequel chain` };
  if (parsed.season !== null && firstTvdbSeason(w) === n) return { fit: 1, reason: `season ${n} matches its TVDB season` };
  return { fit: MISMATCH, reason: `${what} ${n} does not match (chain position ${pos})` };
}

function yearFit(w: WorkRecord, year: number | null): { fit: number; reason: string | null } {
  if (year === null) return { fit: 1, reason: null };
  if (w.year === null) return { fit: 0.8, reason: `year ${year} cannot be checked` };
  const d = Math.abs(w.year - year);
  if (d === 0) return { fit: 1, reason: `year ${year} matches` };
  if (d === 1) return { fit: 0.7, reason: `year ${year} is one off (${w.year})` };
  return { fit: MISMATCH, reason: `year ${year} does not match (${w.year})` };
}

/** Tie-breaker weight when the alias is only a synonym of the work, not one of its titles (decision S4.4). */
export const SYNONYM_WEIGHT = 0.4;
/** Tie-breaker weight by type (decision S4.4): tv and movie over ova and ona, over special and anything else. */
export const TYPE_WEIGHT: Readonly<Record<string, number>> = { tv: 1, movie: 1, ova: 0.4, ona: 0.4 };
const OTHER_TYPE_WEIGHT = 0.2;
// Neither tie-breaker decides alone (a 1 to 0.4 split leaves the leader at 0.71), both together
// do (1 to 0.16 gives 0.86): see OK_FLOOR.

/**
 * Title rank and type as tie-breakers among the works sharing one alias (decision S4.4). The
 * romaji title is the primary one; a hit on any of the work's titles beats a hit on a synonym.
 * Type preference is skipped when the release names a special kind (OVA, movie, special),
 * since the marker is then the better evidence.
 */
function preference(w: WorkRecord, hit: AliasHit, parsed: ParsedRelease): { weight: number; reason: string | null } {
  const isTitle = [w.titles.romaji, w.titles.english, w.titles.native].some((t) => t !== null && normalizeTitle(t) === hit.alias);
  const title = isTitle ? 1 : SYNONYM_WEIGHT;
  const type = parsed.special !== null ? 1 : (TYPE_WEIGHT[w.type] ?? OTHER_TYPE_WEIGHT);
  const reasons = [!isTitle && 'the alias is a synonym, not a title', type < 1 && `type ${w.type}`].filter(Boolean);
  return { weight: title * type, reason: reasons.length > 0 ? reasons.join(', ') : null };
}

const round = (x: number) => Math.round(x * 1000) / 1000;

async function projectionsFor(ds: Dataset, workId: string, episode: number): Promise<ResolvedProjections> {
  // An episode the engine rejects (past the work's recorded count) is an answer without projections, never a crash.
  const r = await translate(ds, `work:${workId}`, episode, ['tvdb_show', 'tmdb_show', 'absolute']).catch((err: unknown) => {
    if (err instanceof CourmapError && err.code === 'invalid_input') return null;
    throw err;
  });
  if (r === null) return {};
  const out: ResolvedProjections = {};
  for (const [k, v] of Object.entries(r.results)) {
    if (k === 'absolute') out.absolute = v as { sequence: string; episode: number };
    else out[k as 'tvdb_show' | 'tmdb_show'] = (({ id: _id, ...rest }) => rest)(v as { id: string; season?: number; episode: number });
  }
  return out;
}

function findGroup(groups: GroupRecord[], name: string | null): GroupRecord | null {
  if (!name) return null;
  const key = name.toLowerCase();
  return groups.find((g) => g.id === key || g.aliases.some((a) => a.toLowerCase() === key)) ?? null;
}

/**
 * Resolves a parsed release name to a work and episode (docs/SPEC.md, "Release name
 * resolution"): match aliases, place the number, score every candidate, and answer ok only
 * for a clear winner above the floor. Works the same over every Dataset.
 */
export async function resolve(ds: Dataset, parsed: ParsedRelease): Promise<ResolveResult> {
  const { data_version } = await ds.meta();
  const base: Omit<ResolveResult, 'status' | 'match' | 'candidates'> = { data_version, parsed };
  if (!parsed.title) return { ...base, status: 'unmatched', match: null, candidates: [] };

  const hits = await aliasHits(ds, parsed);
  const ctx: Ctx = { ds, parsed, group: findGroup(await ds.groups(), parsed.group) };
  const fuzzyWorks = new Set(hits.filter((h) => h.similarity < 1).flatMap((h) => h.works));

  // Score each (alias hit, work); a shared alias splits its weight by each sharer's evidence.
  const best = new Map<string, ResolveCandidate>();
  for (const hit of hits) {
    const scored: { evidence: number; pref: { weight: number; reason: string | null }; cand: Omit<ResolveCandidate, 'confidence'> }[] = [];
    for (const id of hit.works) {
      const w = await ds.getWork(id);
      if (!w) continue;
      const pref = preference(w, hit, parsed);
      const placement = await place(ctx, w);
      const season = await seasonFit(ds, w, hit, placement, parsed, fuzzyWorks);
      const year = yearFit(w, parsed.year);
      const titleReason = hit.similarity === 1 ? `title alias "${hit.alias}" exact` : `title alias "${hit.alias}" similar (${round(hit.similarity)})`;
      const shared = hit.works.length > 1 ? `, shared by ${hit.works.length} works` : '';
      scored.push({
        evidence: placement.fit * season.fit * year.fit,
        pref,
        cand: {
          work: placement.work.id,
          episode: placement.episode,
          ...(placement.episodeTo !== null && placement.episodeTo !== placement.episode && { episode_to: placement.episodeTo }),
          reason: [titleReason + shared, placement.reason, season.reason, year.reason].filter(Boolean).join('; '),
        },
      });
    }
    // Title rank and type only break ties or widen a lead: weights are relative to the sharer the
    // other evidence favors (the best preference among equals), so they never overturn it.
    if (scored.length > 1) {
      const lead = scored.reduce((a, b) => (b.evidence > a.evidence || (b.evidence === a.evidence && b.pref.weight > a.pref.weight) ? b : a));
      for (const x of scored) {
        const weight = Math.min(1, x.pref.weight / lead.pref.weight);
        if (weight < 1) {
          x.evidence *= weight;
          x.cand.reason += `; ${x.pref.reason} (preferring ${lead.cand.work})`;
        }
      }
    }
    const total = scored.reduce((s, x) => s + x.evidence, 0);
    for (const { evidence, cand } of scored) {
      const confidence = round(total === 0 ? 0 : hit.similarity * evidence * (evidence / total));
      const key = `${cand.work}#${cand.episode}#${cand.episode_to ?? ''}`;
      const prev = best.get(key);
      if (!prev || confidence > prev.confidence) best.set(key, { ...cand, confidence });
    }
  }

  const candidates = [...best.values()].sort((a, b) => b.confidence - a.confidence || (a.work < b.work ? -1 : a.work > b.work ? 1 : (a.episode ?? 0) - (b.episode ?? 0)));
  if (candidates.length === 0) return { ...base, status: 'unmatched', match: null, candidates: [] };
  const [top, second] = candidates;
  const clear = top!.confidence >= OK_FLOOR && (second === undefined || top!.confidence - second.confidence >= CLEAR_MARGIN);
  if (!clear) return { ...base, status: 'ambiguous', match: null, candidates: candidates.slice(0, FUZZY_TOP) };

  const work = (await ds.getWork(top!.work))!;
  const episode = top!.episode ?? (work.type === 'movie' ? 1 : null);
  const match: ResolveMatch = {
    ...top!,
    ids: { ...work.ids },
    projections: episode === null ? {} : await projectionsFor(ds, work.id, episode),
  };
  if (top!.episode !== null && top!.episode_to !== undefined) {
    match.batch = [];
    for (let e = top!.episode; e <= top!.episode_to && match.batch.length < MAX_BATCH; e++) {
      match.batch.push({ episode: e, projections: await projectionsFor(ds, work.id, e) });
    }
  }
  return { ...base, status: 'ok', match, candidates: candidates.slice(1, FUZZY_TOP) };
}

/** Title search over the alias index: exact hits first, then trigram matches. */
export async function search(ds: Dataset, query: string, limit = 10): Promise<WorkSummary[]> {
  const q = normalizeTitle(query);
  if (!q) return [];
  const scores = new Map<string, number>();
  for (const id of (await exactWorks(ds, q)) ?? []) scores.set(id, 1);
  for (const f of await fuzzy(ds, q)) for (const id of f.works) if (!scores.has(id) || scores.get(id)! < f.similarity) scores.set(id, round(f.similarity));
  const out: WorkSummary[] = [];
  for (const [id, score] of [...scores].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, limit)) {
    const w = (await ds.getWork(id))!;
    out.push({ id, type: w.type, year: w.year, titles: w.titles, score });
  }
  return out;
}

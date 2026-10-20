import type { Records } from '@courmap/builder';
import type { Finding } from './classify.js';

/**
 * The projection checker (docs/SPEC.md, "Detectors"): compares our TMDB TV projections with the
 * season episode counts TMDB reports. CI only: responses live in memory for one run and never
 * enter data/, the dumps or any committed file. Mismatches become tier C issues.
 */
export class TmdbClient {
  requests = 0;
  private last = -Infinity;
  private readonly fetchFn: typeof fetch;

  constructor(
    private readonly apiKey: string,
    private readonly opts: { fetch?: typeof fetch; minIntervalMs?: number; sleep?: (ms: number) => Promise<void> } = {},
  ) {
    this.fetchFn = opts.fetch ?? ((input, init) => fetch(input, init));
  }

  /** Episode count per season number, or null when TMDB has no such show. */
  async seasonCounts(showId: string): Promise<Map<number, number> | null> {
    const wait = this.last + (this.opts.minIntervalMs ?? 100) - Date.now();
    if (wait > 0) await (this.opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(wait);
    this.last = Date.now();
    this.requests++;
    // A v4 read access token is a JWT; a v3 key goes in the query string.
    const bearer = this.apiKey.startsWith('eyJ');
    const url = `https://api.themoviedb.org/3/tv/${encodeURIComponent(showId)}${bearer ? '' : `?api_key=${encodeURIComponent(this.apiKey)}`}`;
    const res = await this.fetchFn(url, { headers: { Accept: 'application/json', ...(bearer && { Authorization: `Bearer ${this.apiKey}` }) } });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`TMDB: HTTP ${res.status} for tv/${showId}`);
    const body = (await res.json()) as { seasons?: { season_number: number; episode_count: number }[] };
    return new Map((body.seasons ?? []).map((s) => [s.season_number, s.episode_count]));
  }
}

/** The last TMDB episode each season of a work's tmdb_show projection lands on (Infinity when open-ended). */
export function landings(records: Records, workId: string): Map<number, number> {
  const out = new Map<number, number>();
  for (const r of records.works.get(workId)?.projections.tmdb_show ?? []) {
    if (r.season === null) continue;
    const last = r.target_to ?? (r.ep_to === null ? Infinity : r.target_from + (r.ep_to - r.ep_from));
    out.set(r.season, Math.max(out.get(r.season) ?? 0, last));
  }
  return out;
}

/** How long after its premiere TMDB gets the benefit of the doubt for an airing or upcoming work (decided by Xwolv, 2026-10-20). */
export const LAG_GRACE_DAYS = 42;

/**
 * One way our projection disagrees with TMDB. "behind" means TMDB lists less than we map (the season
 * is missing, or has fewer episodes): usually TMDB has not caught up with a show that is still
 * starting. Everything else is a disagreement about structure and is always worth a person's look.
 */
export interface Problem {
  kind: 'behind' | 'no-show' | 'more' | 'structure';
  text: string;
}

/**
 * Whether the problems of a work are only TMDB lagging: all of them are "behind", the work is airing or
 * upcoming, and its season premiered less than six weeks ago (or it is not known when, or not yet).
 * A finished work is never given the doubt.
 */
export function onlyTmdbLag(status: string, problems: readonly Problem[], premiere: Date | null, now: Date): boolean {
  if (problems.length === 0 || !problems.every((p) => p.kind === 'behind')) return false;
  if (status !== 'airing' && status !== 'upcoming') return false;
  if (premiere === null) return true;
  return now.getTime() - premiere.getTime() <= LAG_GRACE_DAYS * 86_400_000;
}

export interface CheckOptions {
  now?: Date;
  /** When each work's season premiered (from AniList's start date), by work id; absent or null when unknown. */
  premieres?: ReadonlyMap<string, Date | null>;
  /** Called when TMDB cannot be asked about a show; the show's works are then neither flagged nor cleared. */
  onError?: (show: string, err: Error) => void;
}

export interface CheckResult {
  /** Mismatches worth an issue. */
  findings: Finding[];
  /** Works whose only mismatch is TMDB lagging behind an airing or upcoming show: no issue, rechecked every run. */
  lagging: Finding[];
  /** Every work TMDB was successfully asked about: an open issue for one of them that is in neither list is resolved. */
  checked: Set<string>;
}

/**
 * Checks the given works against TMDB. Our projection landing past the end of a TMDB season, or on a
 * season TMDB does not have, is "behind" (see onlyTmdbLag). TMDB listing more episodes in a season than
 * all our works map to it, TMDB lacking the whole show, or a missing season below one TMDB does have,
 * are always flagged. Open-ended ranges (airing long-runners) only need the season to exist.
 */
export async function checkProjectionsDetailed(records: Records, workIds: Iterable<string>, tmdb: TmdbClient, opts: CheckOptions = {}): Promise<CheckResult> {
  const now = opts.now ?? new Date();
  const byShow = new Map<string, string[]>();
  for (const id of workIds) {
    const show = records.works.get(id)?.ids.tmdb_show;
    if (show !== undefined && (records.works.get(id)!.projections.tmdb_show?.length ?? 0) > 0) byShow.set(show, [...(byShow.get(show) ?? []), id]);
  }
  // Everything we map into each TMDB show and season, from every work (not only the checked ones), so that
  // two cours sharing a season add up.
  const mapped = new Map<string, Map<number, number>>();
  for (const w of records.works.values()) {
    const show = w.ids.tmdb_show;
    if (show === undefined || !byShow.has(show)) continue;
    const seasons = mapped.get(show) ?? new Map<number, number>();
    for (const [season, last] of landings(records, w.id)) seasons.set(season, Math.max(seasons.get(season) ?? 0, last));
    mapped.set(show, seasons);
  }
  const result: CheckResult = { findings: [], lagging: [], checked: new Set() };
  for (const [show, works] of [...byShow].sort((a, b) => Number(a[0]) - Number(b[0]))) {
    let counts: Map<number, number> | null;
    try {
      counts = await tmdb.seasonCounts(show);
    } catch (err) {
      if (!opts.onError) throw err;
      opts.onError(show, err as Error);
      continue;
    }
    const highest = counts === null ? 0 : Math.max(0, ...counts.keys());
    for (const id of works.sort()) {
      const w = records.works.get(id)!;
      const problems: Problem[] = [];
      if (counts === null) problems.push({ kind: 'no-show', text: `TMDB has no TV show ${show}` });
      else {
        for (const [season, last] of [...landings(records, id)].sort((a, b) => a[0] - b[0])) {
          const n = counts.get(season);
          if (n === undefined) {
            // A season above every one TMDB has is a season TMDB has not added yet; one below is a different structure.
            problems.push({ kind: season > highest ? 'behind' : 'structure', text: `season ${season} is not on TMDB${season > highest ? '' : ` (TMDB has seasons up to ${highest}, so it splits the show differently)`}` });
          } else if (last !== Infinity && last > n) problems.push({ kind: 'behind', text: `season ${season} is mapped to episode ${last}, TMDB lists ${n}` });
          else if (season > 0 && n > (mapped.get(show)?.get(season) ?? 0)) problems.push({ kind: 'more', text: `season ${season} has ${n} episodes on TMDB, but all our works map only up to ${mapped.get(show)?.get(season) ?? 0}` });
        }
      }
      result.checked.add(id);
      if (problems.length === 0) continue;
      const finding: Finding = {
        tier: 'C',
        kind: 'projection-mismatch',
        work: id,
        anilist: w.ids.anilist !== undefined ? Number(w.ids.anilist) : null,
        title: w.titles.romaji ?? id,
        summary: `TMDB projection disagrees with TMDB: ${problems.map((p) => p.text).join('; ')}`,
        data: { tmdb_show: show, url: `https://www.themoviedb.org/tv/${show}` },
      };
      if (onlyTmdbLag(w.status, problems, opts.premieres?.get(id) ?? null, now)) result.lagging.push(finding);
      else result.findings.push(finding);
    }
  }
  return result;
}

/** The findings of checkProjectionsDetailed, for callers that only want the issues to open. */
export async function checkProjections(records: Records, workIds: Iterable<string>, tmdb: TmdbClient, opts: CheckOptions = {}): Promise<Finding[]> {
  return (await checkProjectionsDetailed(records, workIds, tmdb, opts)).findings;
}

/**
 * Which open "TMDB projection mismatch" issues a run resolved: those whose work TMDB was asked about and
 * that now has no finding. `reason` says whether the work is only lagging (still being watched) or agrees.
 */
export function issuesToClose(open: readonly { number: number; title: string }[], prefix: string, result: CheckResult): { number: number; reason: 'lag' | 'resolved' }[] {
  const flagged = new Set(result.findings.map((f) => f.work));
  const lagging = new Set(result.lagging.map((f) => f.work));
  const out: { number: number; reason: 'lag' | 'resolved' }[] = [];
  for (const issue of open) {
    if (!issue.title.startsWith(prefix)) continue;
    const work = issue.title.slice(prefix.length);
    if (flagged.has(work) || !result.checked.has(work)) continue;
    out.push({ number: issue.number, reason: lagging.has(work) ? 'lag' : 'resolved' });
  }
  return out;
}

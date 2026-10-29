import type { Records, TmdbSplitLine } from '@courmap/builder';
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

  /** One TMDB API call (paced), or null for a 404. */
  async get(path: string, params: Record<string, string> = {}): Promise<unknown | null> {
    const wait = this.last + (this.opts.minIntervalMs ?? 100) - Date.now();
    if (wait > 0) await (this.opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(wait);
    this.last = Date.now();
    this.requests++;
    // A v4 read access token is a JWT; a v3 key goes in the query string.
    const bearer = this.apiKey.startsWith('eyJ');
    const query = new URLSearchParams({ ...params, ...(bearer ? {} : { api_key: this.apiKey }) });
    const url = `https://api.themoviedb.org/3/${path}${query.size > 0 ? `?${query}` : ''}`;
    const res = await this.fetchFn(url, { headers: { Accept: 'application/json', ...(bearer && { Authorization: `Bearer ${this.apiKey}` }) } });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`TMDB: HTTP ${res.status} for ${path}`);
    return res.json();
  }

  /** Episode count per season number, or null when TMDB has no such show. */
  async seasonCounts(showId: string): Promise<Map<number, number> | null> {
    const body = (await this.get(`tv/${encodeURIComponent(showId)}`)) as { seasons?: { season_number: number; episode_count: number }[] } | null;
    if (body === null) return null;
    return new Map((body.seasons ?? []).map((s) => [s.season_number, s.episode_count]));
  }
}

/** What TMDB says about a show, for a person to read in a CI log (never stored). */
export interface ShowInfo {
  name: string;
  status: string;
  seasons: { number: number; name: string; episodes: number; airDate: string | null }[];
}

/** Reads one show's name, status and seasons, or null when TMDB has no such show. */
export async function showInfo(tmdb: TmdbClient, showId: string): Promise<ShowInfo | null> {
  const body = await tmdb.get(`tv/${encodeURIComponent(showId)}`);
  if (body === null) return null;
  const b = body as { name?: string; status?: string; seasons?: { season_number: number; name?: string; episode_count: number; air_date?: string | null }[] };
  return { name: b.name ?? '', status: b.status ?? '', seasons: (b.seasons ?? []).map((s) => ({ number: s.season_number, name: s.name ?? '', episodes: s.episode_count, airDate: s.air_date ?? null })) };
}

/** TV shows TMDB finds for a title, to see whether a sequel is a show of its own. */
export async function searchShows(tmdb: TmdbClient, query: string): Promise<{ id: number; name: string; firstAirDate: string | null }[]> {
  const body = (await tmdb.get('search/tv', { query })) as { results?: { id: number; name: string; first_air_date?: string | null }[] } | null;
  return (body?.results ?? []).slice(0, 5).map((r) => ({ id: r.id, name: r.name, firstAirDate: r.first_air_date ?? null }));
}

/**
 * Other works of the same show (same TMDB or TVDB show) that have no TMDB mapping: when TMDB lists more episodes
 * than we map, the missing ones are often one of these (a special or a film), and the fix goes in that work's file.
 * Listed in the issue so a contributor knows the exact file name.
 */
export function related(records: Records, workId: string): { related_without_tmdb_mapping?: string[] } {
  const me = records.works.get(workId);
  if (!me) return {};
  const out: string[] = [];
  for (const w of records.works.values()) {
    if (w.id === workId || (w.projections.tmdb_show?.length ?? 0) > 0) continue;
    const sameTvdb = me.ids.tvdb_show !== undefined && w.ids.tvdb_show === me.ids.tvdb_show;
    const sameTmdb = me.ids.tmdb_show !== undefined && w.ids.tmdb_show === me.ids.tmdb_show;
    if (sameTvdb || sameTmdb) out.push(w.id);
  }
  return out.length > 0 ? { related_without_tmdb_mapping: out.sort().slice(0, 6) } : {};
}

/**
 * The fill pattern: TMDB lists `gap` episodes in a season that none of our works map, and exactly one other work of the
 * same show (same TVDB or TMDB show) has no TMDB mapping and exactly `gap` episodes: a special or a film that TMDB
 * counts as an episode of the season. Returns that work's line (with the TMDB show ID when it has none), or null when
 * there is not exactly one such work. A hint a person confirms on TMDB, so it is only ever proposed as a PR.
 */
export function fillProposal(records: Records, workId: string, show: string, season: number, mapped: number, gap: number, skip: ReadonlySet<string>): TmdbSplitLine | null {
  if (season < 1 || gap < 1) return null;
  const me = records.works.get(workId);
  if (!me) return null;
  const fits = [...records.works.values()].filter((w) => {
    if (w.id === workId || skip.has(w.id) || (w.projections.tmdb_show?.length ?? 0) > 0 || w.episodes !== gap || w.status !== 'finished') return false;
    if (w.ids.tmdb_show !== undefined && w.ids.tmdb_show !== show) return false;
    return w.ids.tmdb_show === show || (me.ids.tvdb_show !== undefined && w.ids.tvdb_show === me.ids.tvdb_show);
  });
  if (fits.length !== 1) return null;
  const w = fits[0]!;
  return { work: w.id, tmdb_show: [{ season, episodes: gap === 1 ? 1 : `1-${gap}`, start: mapped + 1 }], origin: 'bot', tmdb: show, ...(w.ids.tmdb_show === undefined && { tmdb_id: show }) };
}

/** What a work's TMDB projection maps, for a person to read: "S1 E1-12; S2 E1-13". */
export function mappingText(records: Records, workId: string): string {
  return (records.works.get(workId)?.projections.tmdb_show ?? [])
    .filter((r) => r.season !== null)
    .map((r) => {
      const last = r.target_to ?? (r.ep_to === null ? null : r.target_from + (r.ep_to - r.ep_from));
      return `S${r.season} E${r.target_from}${last === null ? '-' : last === r.target_from ? '' : `-${last}`}`;
    })
    .join('; ');
}

/** The work ids the corpus (tests/releases.yaml) expects as a match or a top candidate, with how many cases name each. */
export function corpusWorks(yamlText: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of yamlText.matchAll(/^\s+(?:work|top): ([a-z0-9][a-z0-9-]*)\s*$/gm)) out.set(m[1]!, (out.get(m[1]!) ?? 0) + 1);
  return out;
}

/** How many calendar years back a work still counts as recent: the current year and the two before it. */
export const RECENT_YEARS = 3;

/**
 * Whether a TMDB mismatch on a work gets an issue of its own: the work is airing or upcoming, from the last three years,
 * has a manual file, or is in the corpus (which holds the names real proxies and indexers sent), since those affect
 * people now. Every other mismatch goes to the tracker issue.
 */
export function isUrgent(records: Records, isManual: (id: string) => boolean, corpus: ReadonlyMap<string, number>, now: Date): (workId: string) => boolean {
  return (id) => {
    const w = records.works.get(id);
    if (!w) return true;
    return w.status === 'airing' || w.status === 'upcoming' || (w.year !== null && w.year > now.getUTCFullYear() - RECENT_YEARS) || isManual(id) || corpus.has(id);
  };
}

/** Title of the pinned tracker issue for mismatches on works that are not urgent. */
export const OLDER_TRACKER_TITLE = 'TMDB mismatches in older works';

/**
 * The tracker issue body: a table of the older works whose TMDB projection disagrees with TMDB, with the ones people are
 * most likely to meet first. No download counts exist in the data, so the order is: works named by more corpus cases,
 * then works with more aliases (a rough measure of how widely a show is known), then the id.
 */
export function olderTrackerBody(records: Records, older: readonly Finding[], corpus: ReadonlyMap<string, number>, when: Date, maxBody = 60_000): string {
  const aliases = (id: string) => records.works.get(id)?.aliases.length ?? 0;
  const rows = [...older].sort((a, b) => (corpus.get(b.work!) ?? 0) - (corpus.get(a.work!) ?? 0) || aliases(b.work!) - aliases(a.work!) || a.work!.localeCompare(b.work!));
  const cell = (t: string) => t.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  const head = [
    `Works that are not airing, not from the last ${RECENT_YEARS} years, have no manual file and are not in the corpus, whose TMDB mapping disagrees with TMDB. They have no issue of their own. Rewritten by the projection checker on every weekly run; last run ${when.toISOString().slice(0, 16).replace('T', ' ')} UTC.`,
    '',
    rows.length === 0 ? 'No mismatches right now.' : `${rows.length} work(s), most likely to be met first at the top.`,
  ];
  if (rows.length > 0) head.push('', '| Work | What we map (TMDB) | What TMDB lists | TMDB show |', '| --- | --- | --- | --- |');
  const lines = [...head];
  let length = head.join('\n').length;
  let omitted = 0;
  for (const f of rows) {
    const data = f.data as { mapped?: string; problems?: string[]; tmdb_show?: string; url?: string };
    const l = `| \`${f.work}\` | ${cell(data.mapped ?? '')} | ${cell((data.problems ?? [f.summary]).join('; '))} | [${data.tmdb_show}](${data.url}) |`;
    if (length + l.length + 1 > maxBody) omitted++;
    else {
      lines.push(l);
      length += l.length + 1;
    }
  }
  if (omitted > 0) lines.push('', `${omitted} more not listed: GitHub limits issue length.`);
  if (rows.length > 0) lines.push('', '<sub>To fix one, add a short override in `data/works/<work>.yaml` (see `data/works/fate-stay-night-unlimited-blade-works-2nd-season.yaml`), checked against the TMDB season page. A work leaves this list once its mapping agrees with TMDB, and gets its own issue if it becomes airing, recent, manual or part of the corpus.</sub>');
  return lines.join('\n');
}

/**
 * The works the weekly projection checker asks TMDB about: every work with a TMDB show and a TMDB projection.
 * It used to skip seeded works older than last year (and every non-airing, non-manual one), so a wrong Anime-Lists
 * mapping on an old finished show was never compared with TMDB (issue #172: Fate/stay night UBW cour 2 mapped to
 * season 1 episodes 13-25 while TMDB has a season 2). One request per show covers all its works, so the full scope costs
 * about as much as the old one.
 */
export function checkScope(records: Records): string[] {
  return [...records.works.values()].filter((w) => w.ids.tmdb_show !== undefined && (w.projections.tmdb_show?.length ?? 0) > 0).map((w) => w.id);
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
  /** 'more' only: the season, and how many episodes TMDB lists beyond what all our works map. */
  season?: number;
  gap?: number;
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
  /** Works whose split-cour proposal must not be made (data/rejected.yaml, or a file already in data/seeds/tmdb-splits/). */
  noSplit?: ReadonlySet<string>;
  now?: Date;
  /** When each work's season premiered (from AniList's start date), by work id; absent or null when unknown. */
  premieres?: ReadonlyMap<string, Date | null>;
  /**
   * Whether a mismatch on this work gets an issue of its own. A mismatch on any other work goes to `older` instead (one
   * tracker issue). Absent means every work is urgent.
   */
  urgent?: (workId: string) => boolean;
  /** Called when TMDB cannot be asked about a show; the show's works are then neither flagged nor cleared. */
  onError?: (show: string, err: Error) => void;
}

export interface CheckResult {
  /** Mismatches worth an issue. */
  findings: Finding[];
  /** Mismatches on works that are not urgent (see `urgent`): listed in the tracker issue, not opened one by one. */
  older: Finding[];
  /** Works whose only mismatch is TMDB lagging behind an airing or upcoming show: no issue, rechecked every run. */
  lagging: Finding[];
  /** Cours TMDB keeps inside the previous season (tier B): a PR continues them there instead of an issue. */
  splits: Finding[];
  /** Every work TMDB was successfully asked about: an open issue for one of them that is in neither list is resolved. */
  checked: Set<string>;
}

/**
 * The split-cour pattern (decided by Xwolv, 2026-10-20): TMDB has no season N, but its season N-1 has exactly
 * as many episodes as all our works mapped there plus this one, so TMDB keeps the cour inside season N-1 and the
 * mapping should continue there. Returns the work's rows moved to season N-1 and shifted past what is mapped
 * there, or null when the work or TMDB does not fit the pattern.
 */
export function splitProposal(records: Records, workId: string, counts: ReadonlyMap<number, number>, mappedInShow: ReadonlyMap<number, number>): TmdbSplitLine['tmdb_show'] | null {
  const rows = (records.works.get(workId)?.projections.tmdb_show ?? []).filter((r) => r.season !== null);
  if (rows.length === 0 || rows.some((r) => r.kind !== 'regular' || r.ep_to === null || r.season !== rows[0]!.season)) return null;
  const season = rows[0]!.season!;
  if (season < 2 || counts.has(season)) return null;
  const total = counts.get(season - 1);
  const before = mappedInShow.get(season - 1);
  const mine = landings(records, workId).get(season);
  if (total === undefined || before === undefined || mine === undefined || before === Infinity || !Number.isFinite(mine)) return null;
  if (before + mine !== total) return null;
  return rows.map((r) => ({ season: season - 1, episodes: r.ep_from === r.ep_to ? r.ep_from : `${r.ep_from}-${r.ep_to}`, start: r.target_from + before }));
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
  const result: CheckResult = { findings: [], older: [], lagging: [], splits: [], checked: new Set() };
  const filled = new Set<string>();
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
          // Specials (season 0): TMDB's list is usually incomplete, so TMDB being behind is not a finding (decided
          // by Xwolv, 2026-10-20); TMDB listing more specials than we map still is.
          if (season === 0) {
            const ours = mapped.get(show)?.get(0) ?? 0;
            if (n !== undefined && n > ours) problems.push({ kind: 'more', season: 0, gap: n - ours, text: `season 0 (specials) has ${n} episodes on TMDB, but all our works map only up to ${ours}` });
            continue;
          }
          if (n === undefined) {
            // A season above every one TMDB has is a season TMDB has not added yet; one below is a different structure.
            problems.push({ kind: season > highest ? 'behind' : 'structure', text: `season ${season} is not on TMDB${season > highest ? '' : ` (TMDB has seasons up to ${highest}, so it splits the show differently)`}` });
          } else if (last !== Infinity && last > n) problems.push({ kind: 'behind', text: `season ${season} is mapped to episode ${last}, TMDB lists ${n}` });
          else if (n > (mapped.get(show)?.get(season) ?? 0)) problems.push({ kind: 'more', season, gap: n - (mapped.get(show)?.get(season) ?? 0), text: `season ${season} has ${n} episodes on TMDB, but all our works map only up to ${mapped.get(show)?.get(season) ?? 0}` });
        }
      }
      result.checked.add(id);
      if (problems.length === 0) continue;
      const split = counts !== null && !opts.noSplit?.has(id) && problems.every((p) => p.kind === 'behind') ? splitProposal(records, id, counts, mapped.get(show) ?? new Map()) : null;
      const gapProblem = problems.length === 1 && problems[0]!.kind === 'more' ? problems[0]! : null;
      const fill = split === null && gapProblem !== null && !opts.noSplit?.has(id) ? fillProposal(records, id, show, gapProblem.season!, mapped.get(show)?.get(gapProblem.season!) ?? 0, gapProblem.gap!, new Set([...(opts.noSplit ?? []), ...filled])) : null;
      if (fill !== null) {
        filled.add(fill.work);
        const target = records.works.get(fill.work)!;
        result.splits.push({
          tier: 'B',
          kind: 'tmdb-fill',
          work: fill.work,
          anilist: target.ids.anilist !== undefined ? Number(target.ids.anilist) : null,
          title: target.titles.romaji ?? fill.work,
          summary: `TMDB lists ${gapProblem!.gap} episode(s) we do not map in season ${gapProblem!.season}: this work fills the gap`,
          split: fill,
          data: { tmdb_show: show, url: `https://www.themoviedb.org/tv/${show}`, problems: problems.map((p) => p.text), for_work: id },
        });
        continue;
      }
      if (split !== null) {
        result.splits.push({
          tier: 'B',
          kind: 'tmdb-split',
          work: id,
          anilist: w.ids.anilist !== undefined ? Number(w.ids.anilist) : null,
          title: w.titles.romaji ?? id,
          summary: `TMDB keeps this cour in season ${split[0]!.season}: continue it there from episode ${split[0]!.start}`,
          split: { work: id, tmdb_show: split, origin: 'bot', tmdb: show },
          data: { tmdb_show: show, url: `https://www.themoviedb.org/tv/${show}`, problems: problems.map((p) => p.text) },
        });
        continue;
      }
      const finding: Finding = {
        tier: 'C',
        kind: 'projection-mismatch',
        work: id,
        anilist: w.ids.anilist !== undefined ? Number(w.ids.anilist) : null,
        title: w.titles.romaji ?? id,
        summary: `TMDB projection disagrees with TMDB: ${problems.map((p) => p.text).join('; ')}`,
        data: { tmdb_show: show, url: `https://www.themoviedb.org/tv/${show}`, mapped: mappingText(records, id), problems: problems.map((p) => p.text), ...related(records, id) },
      };
      if (onlyTmdbLag(w.status, problems, opts.premieres?.get(id) ?? null, now)) result.lagging.push(finding);
      else if (opts.urgent && !opts.urgent(id)) result.older.push(finding);
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
 * that now has no finding. `reason` says whether the work is only lagging (still being watched) or agrees,
 * and which kind of proposal takes it over when a PR proposes one.
 */
export function issuesToClose(open: readonly { number: number; title: string }[], prefix: string, result: CheckResult): { number: number; reason: 'lag' | 'resolved' | 'proposed' | 'proposed-fill' | 'older' }[] {
  const flagged = new Set(result.findings.map((f) => f.work));
  const lagging = new Set(result.lagging.map((f) => f.work));
  const proposed = new Map(result.splits.map((f) => [(f.data.for_work as string | undefined) ?? f.work, f.kind]));
  const older = new Set(result.older.map((f) => f.work));
  const out: { number: number; reason: 'lag' | 'resolved' | 'proposed' | 'proposed-fill' | 'older' }[] = [];
  for (const issue of open) {
    if (!issue.title.startsWith(prefix)) continue;
    const work = issue.title.slice(prefix.length);
    if (flagged.has(work) || !result.checked.has(work)) continue;
    out.push({ number: issue.number, reason: older.has(work) ? 'older' : proposed.has(work) ? (proposed.get(work) === 'tmdb-fill' ? 'proposed-fill' : 'proposed') : lagging.has(work) ? 'lag' : 'resolved' });
  }
  return out;
}

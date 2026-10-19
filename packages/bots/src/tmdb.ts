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

/**
 * Checks the given works: a projection that lands past the end of a TMDB season, or on a season
 * TMDB does not have, is a mismatch. Open-ended ranges (airing long-runners) only need the season.
 */
export async function checkProjections(records: Records, workIds: Iterable<string>, tmdb: TmdbClient): Promise<Finding[]> {
  const byShow = new Map<string, string[]>();
  for (const id of workIds) {
    const show = records.works.get(id)?.ids.tmdb_show;
    if (show !== undefined && (records.works.get(id)!.projections.tmdb_show?.length ?? 0) > 0) byShow.set(show, [...(byShow.get(show) ?? []), id]);
  }
  const findings: Finding[] = [];
  for (const [show, works] of [...byShow].sort((a, b) => Number(a[0]) - Number(b[0]))) {
    const counts = await tmdb.seasonCounts(show);
    for (const id of works.sort()) {
      const w = records.works.get(id)!;
      const problems: string[] = [];
      if (counts === null) problems.push(`TMDB has no TV show ${show}`);
      else {
        for (const [season, last] of [...landings(records, id)].sort((a, b) => a[0] - b[0])) {
          const n = counts.get(season);
          if (n === undefined) problems.push(`season ${season} is not on TMDB`);
          else if (last !== Infinity && last > n) problems.push(`season ${season} is mapped to episode ${last}, TMDB lists ${n}`);
        }
      }
      if (problems.length > 0) {
        findings.push({
          tier: 'C',
          kind: 'projection-mismatch',
          work: id,
          anilist: w.ids.anilist !== undefined ? Number(w.ids.anilist) : null,
          title: w.titles.romaji ?? id,
          summary: `TMDB projection disagrees with TMDB: ${problems.join('; ')}`,
          data: { tmdb_show: show, url: `https://www.themoviedb.org/tv/${show}` },
        });
      }
    }
  }
  return findings;
}

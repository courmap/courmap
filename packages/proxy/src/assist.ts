import type { CourmapClient, Work } from '@courmap/client';
import type { SonarrClient, SonarrEpisode, SonarrSeries } from './sonarr.js';

/**
 * Sonarr-assisted numbering (Xwolv decision S7.1). When a release resolves to a work but the data
 * has no TVDB projection for it, the proxy may derive one from the user's own Sonarr: the work is
 * matched to exactly one Sonarr series, and the episode numbered from Sonarr's episode list. It
 * never overrides a real projection and never writes to the data; each mapping is local to the
 * install and is offered back as a contribution on the status page.
 */

/** One run of canonical episodes landing on consecutive episodes of one TVDB season, in data/ notation. */
export interface ProjectionEntry {
  season: number;
  episodes: string;
  start?: number;
}

export interface AssistedMapping {
  work: string;
  series: { title: string; tvdbId: number; year: number | null };
  /** How the series was found: the work's own TVDB ID, or its titles and aliases. */
  matchedBy: 'tvdb-id' | 'title';
  /** first-season: the work starts the chain, so its numbers are the first season's. absolute: prequel counts plus the episode, through Sonarr's absolute numbers. */
  method: 'first-season' | 'absolute';
  /** The whole work as Sonarr lays it out, as far as Sonarr's episode list goes. */
  projection: ProjectionEntry[];
  /** The projection stops before the work's last episode (Sonarr does not list them all yet). */
  partial: boolean;
}

export type AssistResult =
  | { ok: true; series: SonarrSeries; episodes: { season: number; episode: number }[]; mapping: AssistedMapping }
  | { ok: false; reason: 'assist-no-match' | 'assist-ambiguous' | 'assist-no-numbering'; detail: string };

const MAX_CHAIN = 50;

/** A work's titles and aliases, for matching Sonarr series. */
const titlesOf = (work: Work): string[] => [work.titles.romaji, work.titles.english, work.titles.native, ...work.aliases].filter((t): t is string => !!t);

/** The works before `work` in its prequel chain, nearest first, or null when the chain loops. */
async function prequels(client: CourmapClient, work: Work): Promise<Work[] | null> {
  const out: Work[] = [];
  let cur = work;
  while (cur.prequel) {
    if (out.length >= MAX_CHAIN || out.some((w) => w.id === cur.prequel) || cur.prequel === work.id) return null;
    cur = await client.lookup(`work:${cur.prequel}`);
    out.push(cur);
  }
  return out;
}

/**
 * Numbers `canonical` episodes of `work` in `series`, or explains why it cannot. Exactly one
 * Sonarr series must match; the first work of a chain uses its own numbers in the series' first
 * season; any later work uses absolute numbering, only when every prequel's count is known and
 * Sonarr's episodes carry absolute numbers.
 */
export async function assistNumbering(client: CourmapClient, sonarr: SonarrClient, workId: string, canonical: number[]): Promise<AssistResult> {
  const fail = (reason: Extract<AssistResult, { ok: false }>['reason'], detail: string): AssistResult => ({ ok: false, reason, detail });
  const work = await client.lookup(`work:${workId}`);
  if (work.type === 'movie') return fail('assist-no-match', `${workId} is a movie; Sonarr has series only`);

  // The series: the work's own TVDB ID when Sonarr has it, else a unique title match.
  let series: SonarrSeries | undefined;
  let matchedBy: AssistedMapping['matchedBy'] = 'tvdb-id';
  if (work.ids.tvdb_show !== undefined) series = sonarr.seriesByTvdb(Number(work.ids.tvdb_show));
  if (!series) {
    matchedBy = 'title';
    const found = sonarr.matchSeries(titlesOf(work), work.year);
    if (found.length === 0) return fail('assist-no-match', `no Sonarr series matches the titles of ${workId}`);
    if (found.length > 1) return fail('assist-ambiguous', `${found.length} Sonarr series match ${workId}: ${found.map((s) => s.title).join(', ')}`);
    series = found[0]!;
  }

  const list = await sonarr.episodesOf(series);
  const regular = list.filter((e) => e.seasonNumber > 0);
  const chain = await prequels(client, work);
  if (chain === null) return fail('assist-no-numbering', `the prequel chain of ${workId} loops`);

  let number: (e: number) => SonarrEpisode | undefined;
  let method: AssistedMapping['method'];
  if (chain.length === 0) {
    method = 'first-season';
    const first = Math.min(...regular.map((e) => e.seasonNumber));
    if (!Number.isFinite(first)) return fail('assist-no-numbering', `${series.title} has no regular episodes in Sonarr`);
    // "No prequel" may only mean the data lacks the relation (a "Season 2" whose AniList prequel
    // is not merged yet). Use the first season only when it is clearly this work: the series has
    // one season, or it started the same year and its first season has this work's episode count.
    const seasonCount = new Set(regular.map((e) => e.seasonNumber)).size;
    const firstCount = regular.filter((e) => e.seasonNumber === first).length;
    const sameStart = series.year !== undefined && work.year !== null && series.year === work.year && (work.episodes === null || work.episodes === firstCount);
    if (seasonCount > 1 && !sameStart) {
      return fail('assist-no-numbering', `${series.title} has ${seasonCount} seasons and nothing shows ${workId} is the first (no prequel in the data, ${series.year ?? '?'} vs ${work.year ?? '?'}, ${firstCount} vs ${work.episodes ?? '?'} episodes)`);
    }
    number = (e) => regular.find((x) => x.seasonNumber === first && x.episodeNumber === e);
  } else {
    method = 'absolute';
    const unknown = chain.find((w) => w.episodes === null);
    if (unknown) return fail('assist-no-numbering', `prequel ${unknown.id} has no known episode count, so absolute numbers cannot be summed`);
    // A prequel still airing has a count that will grow, which would shift every number after it.
    const running = chain.find((w) => w.status === 'airing' || w.status === 'upcoming');
    if (running) return fail('assist-no-numbering', `prequel ${running.id} is still ${running.status}, so its episode count is not final`);
    if (!regular.some((e) => e.absoluteEpisodeNumber != null)) return fail('assist-no-numbering', `${series.title} has no absolute numbers in Sonarr`);
    // Summing prequel counts only fits a series that starts with the chain's first work. A sequel
    // Sonarr keeps as its own series (numbered from 1) would otherwise land on the wrong episode.
    const root = chain[chain.length - 1]!;
    const rootInSeries =
      root.ids.tvdb_show !== undefined ? Number(root.ids.tvdb_show) === series.tvdbId : sonarr.matchSeries(titlesOf(root), root.year).some((s) => s.tvdbId === series.tvdbId);
    if (!rootInSeries) return fail('assist-no-numbering', `${series.title} does not start with ${root.id}, the first work of ${workId}'s prequel chain, so its absolute numbers cannot be offset by the prequel counts`);
    const offset = chain.reduce((sum, w) => sum + w.episodes!, 0);
    number = (e) => regular.find((x) => x.absoluteEpisodeNumber === offset + e);
  }

  const episodes: { season: number; episode: number }[] = [];
  for (const e of canonical) {
    const hit = number(e);
    if (!hit) return fail('assist-no-numbering', `${series.title} has no episode for ${workId} ${e} (${method})`);
    episodes.push({ season: hit.seasonNumber, episode: hit.episodeNumber });
  }

  // The contribution: the whole work as Sonarr lays it out.
  const last = work.episodes ?? Math.max(...canonical);
  // Runs of canonical episodes that land on consecutive episodes of one season.
  const runs: { season: number; from: number; to: number; start: number }[] = [];
  let mapped = 0;
  for (let e = 1; e <= last; e++) {
    const hit = number(e);
    if (!hit) break;
    mapped = e;
    const run = runs[runs.length - 1];
    if (run && run.season === hit.seasonNumber && run.to === e - 1 && run.start + (run.to - run.from) === hit.episodeNumber - 1) run.to = e;
    else runs.push({ season: hit.seasonNumber, from: e, to: e, start: hit.episodeNumber });
  }
  const projection: ProjectionEntry[] = runs.map((r) => ({
    season: r.season,
    episodes: r.from === r.to ? String(r.from) : `${r.from}-${r.to}`,
    ...(r.start !== r.from && { start: r.start }),
  }));
  return {
    ok: true,
    series,
    episodes,
    mapping: { work: workId, series: { title: series.title, tvdbId: series.tvdbId, year: series.year ?? null }, matchedBy, method, projection, partial: work.episodes === null || mapped < work.episodes },
  };
}

/** The data/works/<id>.yaml override a contributor would open a PR with. */
export function mappingYaml(m: AssistedMapping): string {
  const entry = (p: ProjectionEntry) => `    - { season: ${p.season}, episodes: ${p.episodes}${p.start !== undefined ? `, start: ${p.start}` : ''} }`;
  return [
    `# data/works/${m.work}.yaml`,
    `id: ${m.work}`,
    'ids:',
    `  tvdb_show: ${m.series.tvdbId}`,
    'projections:',
    ...(m.partial
      ? ['  tvdb_show:', '    coverage: partial', '    notes: Sonarr did not list every episode yet', '    ranges:', ...m.projection.map((p) => `  ${entry(p)}`)]
      : ['  tvdb_show:', ...m.projection.map(entry)]),
    'sources:',
    `  - https://thetvdb.com/dereferrer/series/${m.series.tvdbId}`,
    `notes: Derived by the Courmap proxy from a local Sonarr (${m.method === 'first-season' ? 'first season' : 'absolute numbering'}, matched by ${m.matchedBy === 'tvdb-id' ? 'TVDB ID' : 'title'} to "${m.series.title}"). Verify on TVDB before merging.`,
  ].join('\n');
}

import type { CourmapClient, ParsedRelease, ResolveResult } from '@courmap/client';
import { assistNumbering, type AssistedMapping } from './assist.js';
import { cleanTitle, type SonarrClient, type SonarrEpisode, type SonarrSeries } from './sonarr.js';

export type RewriteOutcome =
  /** `numbers` is what was written into the title: S01E05, S01E05-E08 or S01. */
  | { kind: 'rewritten'; title: string; numbers: string; tvdbId: number; work: string; resolved: ResolveResult; assisted?: AssistedMapping }
  | { kind: 'pass'; reason: PassReason; detail: string; resolved: ResolveResult | null };

/** Why a release went through unchanged. `ambiguous` and `unmatched` are logged as unresolved. */
export type PassReason =
  | 'no-data' // no dump loaded yet
  | 'ambiguous'
  | 'unmatched'
  | 'no-episode' // a movie or a name with no episode number
  | 'no-tvdb' // the work has no TVDB mapping for this episode
  | 'not-in-sonarr' // the TVDB show is not a series in this Sonarr
  | 'spans-seasons' // a batch across TVDB seasons
  | 'scene-conflict' // Sonarr would read the number as another episode's scene number
  | 'assist-no-match' // no TVDB projection, and no Sonarr series matches the work's titles
  | 'assist-ambiguous' // no TVDB projection, and several Sonarr series match
  | 'assist-no-numbering'; // a series matched, but Sonarr's episodes cannot number this work safely

interface Ep {
  season: number;
  episode: number;
}

const EXTENSION = /\.(?:mkv|mp4|avi|m4v|ts|wmv|webm|torrent)$/i;
const pad = (n: number) => String(n).padStart(2, '0');

/**
 * The group, quality and other tags of the original name, as Sonarr should see them: every
 * bracketed tag except the leading group, years and batch or season markers, kept verbatim.
 * Scene-style names without brackets get their parsed tags instead.
 */
export function tagsOf(parsed: ParsedRelease): string {
  let name = parsed.input.trim().replace(/^.*[\\/]/, '').replace(EXTENSION, '');
  if (parsed.group) name = name.replace(/^\s*[[(][^\])]*[\])]\s*/, '');
  const brackets = [...name.matchAll(/[[(]([^\])]*)[\])]/g)]
    .filter(([, inner]) => {
      const t = inner!.trim();
      return t !== '' && !/^\d{4}$/.test(t) && !/^\d{1,4}\s*(?:-|~|to)\s*\d{1,4}$/i.test(t) && !/^(?:batch|complete|season\s?\d+|s\d+)$/i.test(t);
    })
    .map(([m]) => m);
  if (brackets.length > 0) return brackets.join(' ');
  return [parsed.resolution, parsed.source, parsed.video_codec, ...parsed.audio, ...parsed.flags.filter((f) => f !== 'batch')].filter(Boolean).join(' ');
}

/**
 * The group where Sonarr's ReleaseGroupParser finds it at the end of a title: "[Group]" for
 * letters and digits, "-Group" for one hyphenated part ("-Erai-raws"), which its bracket rule
 * rejects. Other groups ("Anime Time") stay in brackets; Sonarr knows some of them by name.
 */
export function groupSuffix(group: string): string {
  if (/^[A-Za-zÀ-ÖØ-öø-ÿ0-9]+$/.test(group)) return `[${group}]`;
  if (/^[A-Za-zÀ-ÖØ-öø-ÿ0-9]+-[A-Za-zÀ-ÖØ-öø-ÿ0-9]+$/.test(group)) return `-${group}`;
  return `[${group}]`;
}

/** Whether written numbers (S01E05, S01E05-E08, S01) include this TVDB season and episode. */
export function numbersCover(numbers: string, season: number, episode: number): boolean {
  const m = /^S(\d+)E(\d+)(?:-E(\d+))?/.exec(numbers);
  if (!m || Number(m[1]) !== season) return false;
  const first = Number(m[2]);
  const last = m[3] ? Number(m[3]) : first;
  return episode >= first && episode <= last;
}

/** The rewritten title: Sonarr's series title, SxxEyy (or Sxx for a pack), the original tags, the group last. */
export function formatTitle(seriesTitle: string, numbers: string, parsed: ParsedRelease): string {
  const version = parsed.version !== null && parsed.version > 1 && /E\d+$/.test(numbers) ? `v${parsed.version}` : '';
  return [seriesTitle, `${numbers}${version}`, tagsOf(parsed), parsed.group ? groupSuffix(parsed.group) : ''].filter(Boolean).join(' ');
}

/** Turns resolved release names into titles Sonarr parses as the right TVDB episode. */
export class Rewriter {
  constructor(
    private readonly data: { readonly client: CourmapClient | null },
    private readonly sonarr: SonarrClient,
  ) {}

  async rewrite(releaseName: string): Promise<RewriteOutcome> {
    const client = this.data.client;
    if (!client) return { kind: 'pass', reason: 'no-data', detail: 'no Courmap dump is loaded yet', resolved: null };
    const r = await client.resolve(releaseName);
    const pass = (reason: PassReason, detail: string): RewriteOutcome => ({ kind: 'pass', reason, detail, resolved: r });
    if (r.status !== 'ok' || !r.match) return pass(r.status === 'ambiguous' ? 'ambiguous' : 'unmatched', r.candidates[0] ? `best candidate ${r.candidates[0].work} at ${r.candidates[0].confidence}` : 'no candidate');
    const m = r.match;
    if (m.episode === null) return pass('no-episode', `${m.work} matched without an episode number`);
    // TVDB episodes this release covers: from the data's projection, or else assisted by Sonarr.
    const items = m.batch ?? [{ episode: m.episode, projections: m.projections }];
    const eps: Ep[] = [];
    let series: SonarrSeries | undefined;
    let assisted: AssistedMapping | undefined;
    if (m.ids.tvdb_show !== undefined && items.every((p) => p.projections.tvdb_show?.season !== undefined)) {
      series = this.sonarr.seriesByTvdb(Number(m.ids.tvdb_show));
      if (!series) return pass('not-in-sonarr', `TVDB ${m.ids.tvdb_show} (${m.work}) is not a series in Sonarr`);
      for (const p of items) {
        const t = p.projections.tvdb_show!;
        for (let e = t.episode; e <= (t.episode_to ?? t.episode); e++) eps.push({ season: t.season!, episode: e });
      }
    } else {
      // Decision S7.1: only for a work with no TVDB projection at all; a real one is never overridden.
      if ((await client.lookup(`work:${m.work}`)).projections.tvdb_show?.length) return pass('no-tvdb', `${m.work} episode ${m.episode} is outside its TVDB projection`);
      const a = await assistNumbering(client, this.sonarr, m.work, items.map((p) => p.episode));
      if (!a.ok) return pass(a.reason, a.detail);
      series = a.series;
      assisted = a.mapping;
      eps.push(...a.episodes);
    }
    if (seasonSpecificTitle(series)) return pass('scene-conflict', `Sonarr maps "${series.title}" to one season only`);
    const seasons = new Set(eps.map((e) => e.season));
    if (seasons.size > 1) return pass('spans-seasons', `${m.work} covers TVDB seasons ${[...seasons].join(', ')}`);
    const season = eps[0]!.season;
    const nums = [...new Set(eps.map((e) => e.episode))].sort((a, b) => a - b);
    if (nums.some((n, i) => i > 0 && n !== nums[i - 1]! + 1)) return pass('no-tvdb', `${m.work} lands on non-consecutive TVDB episodes`);
    if (nums[nums.length - 1]! > 999) return pass('no-tvdb', `TVDB episode ${nums[nums.length - 1]} is beyond what Sonarr parses in SxxEyy`);

    const episodes = series.useSceneNumbering || nums.length > 1 ? await this.sonarr.episodesOf(series) : [];
    // A batch that is exactly one TVDB season is a season pack.
    if (nums.length > 1) {
      const inSeason = episodes.filter((e) => e.seasonNumber === season).map((e) => e.episodeNumber).sort((a, b) => a - b);
      if (season > 0 && inSeason.length === nums.length && inSeason.every((n, i) => n === nums[i])) {
        const sceneSeason = series.useSceneNumbering ? uniform(episodes.filter((e) => e.seasonNumber === season).map((e) => e.sceneSeasonNumber ?? season)) : season;
        if (sceneSeason === null) return pass('scene-conflict', `TVDB season ${season} spans several scene seasons`);
        return this.ok(r, series, `S${pad(sceneSeason)}`, assisted);
      }
    }
    const first = toSonarr(series, episodes, { season, episode: nums[0]! });
    const last = toSonarr(series, episodes, { season, episode: nums[nums.length - 1]! });
    if (typeof first === 'string') return pass('scene-conflict', first);
    if (typeof last === 'string') return pass('scene-conflict', last);
    if (nums.length === 1) return this.ok(r, series, `S${pad(first.season)}E${pad(first.episode)}`, assisted);
    if (first.season !== last.season || last.episode - first.episode !== nums.length - 1) return pass('scene-conflict', 'the range is not consecutive in scene numbering');
    return this.ok(r, series, `S${pad(first.season)}E${pad(first.episode)}-E${pad(last.episode)}`, assisted);
  }

  private ok(r: ResolveResult, series: SonarrSeries, numbers: string, assisted?: AssistedMapping): RewriteOutcome {
    return { kind: 'rewritten', title: formatTitle(series.title, numbers, r.parsed), numbers, tvdbId: series.tvdbId, work: r.match!.work, resolved: r, ...(assisted && { assisted }) };
  }
}

const uniform = (xs: number[]) => (xs.length > 0 && xs.every((x) => x === xs[0]) ? xs[0]! : null);

/**
 * A scene mapping on the series' own title that names one season would make Sonarr shift the
 * season it reads (ParsingService.Map); such series are passed through.
 */
function seasonSpecificTitle(series: SonarrSeries): boolean {
  const own = cleanTitle(series.title);
  return (series.alternateTitles ?? []).some((a) => cleanTitle(a.title) === own && ((a.seasonNumber ?? -1) >= 0 || (a.sceneSeasonNumber ?? -1) >= 0));
}

/**
 * TVDB numbers as Sonarr will read them. For a series with scene numbering Sonarr reads SxxEyy
 * as scene numbers first, so the episode's scene numbers are written; an episode without them
 * keeps its TVDB numbers unless another episode carries those as its scene numbers.
 */
function toSonarr(series: SonarrSeries, episodes: SonarrEpisode[], ep: Ep): Ep | string {
  if (!series.useSceneNumbering) return ep;
  const own = episodes.find((e) => e.seasonNumber === ep.season && e.episodeNumber === ep.episode);
  if (own?.sceneSeasonNumber != null && own.sceneEpisodeNumber != null) return { season: own.sceneSeasonNumber, episode: own.sceneEpisodeNumber };
  const clash = episodes.find((e) => e.sceneSeasonNumber === ep.season && e.sceneEpisodeNumber === ep.episode && !(e.seasonNumber === ep.season && e.episodeNumber === ep.episode));
  if (clash) return `TVDB S${pad(ep.season)}E${pad(ep.episode)} is the scene number of S${pad(clash.seasonNumber)}E${pad(clash.episodeNumber)} in Sonarr`;
  return ep;
}

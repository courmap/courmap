import { CourmapError, type CourmapClient } from '@courmap/client';
import type { SonarrClient, SonarrSeries } from './sonarr.js';

export interface TranslatedSearch {
  /** Parameter sets to send upstream, in order; their results are merged. */
  queries: URLSearchParams[];
  /** What was asked and what is sent, for the status page. */
  note: string;
  /** The TVDB show, season and episode (null for a season search) the queries look for. */
  target: { tvdb: number; season: number; episode: number | null };
  /**
   * True when the queries are alternative names for the same episode (its own title and number, and
   * the franchise title with the absolute number), so one that finds the episode makes the rest
   * optional. False for a season search, where each query is a different work.
   */
  alternatives: boolean;
}

const pad = (n: number) => String(n).padStart(2, '0');
/** The default for how many upstream queries one Sonarr search may cause. */
export const DEFAULT_MAX_QUERIES = 3;

/**
 * Translates Sonarr's searches into what anime indexers understand (docs/SPEC.md, "Sonarr
 * proxy"). Sonarr asks by TVDB ID with a season and episode, by TVDB ID with an absolute number
 * (anime series), or by title. Anime indexers only search text, and releases are named by the
 * work's own title and its canonical or absolute (fansub) number. When the series is not in the
 * cached list, the list is reloaded first (at most once a minute) in case it was just added.
 * Returns null when there is nothing to translate (RSS, or a show Courmap or Sonarr does not
 * know): the request then goes upstream unchanged.
 */
export async function translateSearch(params: URLSearchParams, client: CourmapClient | null, sonarr: SonarrClient, opts: { maxQueries?: number } = {}): Promise<TranslatedSearch | null> {
  const t = params.get('t');
  if (!client || (t !== 'tvsearch' && t !== 'search')) return null;
  const q = params.get('q')?.trim() ?? '';
  const seasonParam = params.get('season');
  const epParam = params.get('ep');
  let tvdb = Number(params.get('tvdbid') ?? NaN);
  let series: SonarrSeries | undefined;
  let absolute: number | null = null;

  if (Number.isInteger(tvdb) && tvdb > 0) {
    series = sonarr.seriesByTvdb(tvdb);
    if (!series) {
      // Maybe the series was added to Sonarr since the list was loaded. Searches need it (absolute and
      // scene numbers, a season's episodes), so wait for a reload (rate-limited) before translating.
      await sonarr.reloadOnMiss(tvdb);
      series = sonarr.seriesByTvdb(tvdb);
    }
    if (/^\d{1,4}$/.test(q)) absolute = Number(q);
  } else if (q !== '') {
    // A title search: "Title" with season/ep (tvsearch) or "Title 05" (search, anime).
    const m = /^(.*\S)\s+(\d{1,4})$/.exec(q);
    const find = () => sonarr.seriesByTitle(q) ?? (m ? sonarr.seriesByTitle(m[1]!) : undefined);
    series = find();
    if (!series) {
      await sonarr.reloadOnMiss();
      series = find();
    }
    if (!series) return null;
    tvdb = series.tvdbId;
    if (m && sonarr.seriesByTitle(m[1]!) === series && seasonParam === null) absolute = Number(m[2]);
  } else return null;

  // The TVDB season and episode Sonarr means.
  let season = seasonParam !== null && /^\d+$/.test(seasonParam) ? Number(seasonParam) : null;
  let episode = epParam !== null && /^\d+$/.test(epParam) ? Number(epParam) : null;
  if (absolute !== null) {
    if (!series) return null;
    const eps = await sonarr.episodesOf(series);
    const hit = eps.find((e) => (series!.useSceneNumbering ? (e.sceneAbsoluteEpisodeNumber ?? e.absoluteEpisodeNumber) : e.absoluteEpisodeNumber) === absolute);
    if (!hit) return null;
    season = hit.seasonNumber;
    episode = hit.episodeNumber;
  } else if (season !== null && episode !== null && series?.useSceneNumbering) {
    // Sonarr searches scene-numbered series by scene numbers.
    const hit = (await sonarr.episodesOf(series)).find((e) => e.sceneSeasonNumber === season && e.sceneEpisodeNumber === episode);
    if (hit) {
      season = hit.seasonNumber;
      episode = hit.episodeNumber;
    }
  }
  if (season === null) return null;

  const base = (text: string) => {
    const p = new URLSearchParams();
    p.set('t', 'search');
    p.set('q', text);
    for (const k of ['cat', 'apikey', 'limit', 'offset', 'extended']) {
      const v = params.get(k);
      if (v !== null) p.set(k, v);
    }
    return p;
  };
  const titleOf = async (workId: string) => {
    const w = await client.lookup(`work:${workId}`);
    return w.titles.romaji ?? w.titles.english ?? w.id;
  };

  const texts: string[] = [];
  if (episode !== null) {
    let r;
    try {
      r = await client.translate(`tvdb_show:${tvdb}:s${season}`, episode, ['absolute']);
    } catch (err) {
      if (err instanceof CourmapError) return null;
      throw err;
    }
    const canonical = r.work.episode;
    texts.push(`${await titleOf(r.work.id)} ${pad(canonical)}`);
    const abs = r.results.absolute as { sequence: string; episode: number } | undefined;
    if (abs && abs.episode !== canonical) {
      // Fansubs keep numbering under the franchise title: the sequence's first work.
      const first = await client.translate(`absolute:${abs.sequence}`, 1, []);
      texts.push(`${await titleOf(first.work.id)} ${pad(abs.episode)}`);
    }
  } else {
    // A season search: every work that lands in this TVDB season, searched by title.
    const works = new Set<string>();
    const numbers = series ? (await sonarr.episodesOf(series)).filter((e) => e.seasonNumber === season).map((e) => e.episodeNumber) : [1];
    for (const n of numbers.slice(0, 200)) {
      try {
        works.add((await client.translate(`tvdb_show:${tvdb}:s${season}`, n, [])).work.id);
      } catch (err) {
        if (!(err instanceof CourmapError)) throw err;
      }
    }
    for (const w of works) texts.push(await titleOf(w));
  }
  const unique = [...new Set(texts)].slice(0, opts.maxQueries ?? DEFAULT_MAX_QUERIES);
  if (unique.length === 0) return null;
  const asked = `tvdb ${tvdb} S${pad(season)}${episode !== null ? `E${pad(episode)}` : ''}${absolute !== null ? ` (absolute ${absolute})` : ''}`;
  return { queries: unique.map(base), note: `${asked} searched as ${unique.map((u) => `"${u}"`).join(', ')}`, target: { tvdb, season, episode }, alternatives: episode !== null };
}

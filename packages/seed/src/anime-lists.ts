import { XMLParser } from 'fast-xml-parser';
import type { Conflict } from './conflicts.js';

/** A season reference in Anime-Lists: a number, or "a" for the provider's absolute order. */
export type ALSeason = number | 'absolute';

export interface ALMapping {
  /** 0 = AniDB specials, 1 = regular episodes. */
  anidbSeason: number;
  tvdbSeason: ALSeason | null;
  tmdbSeason: ALSeason | null;
  start: number | null;
  end: number | null;
  offset: number;
  /** Explicit per-episode list: AniDB episode -> provider episodes (empty = no equivalent). */
  list: { from: number; to: number[] }[] | null;
}

/** The parts of one Anime-Lists `<anime>` element Courmap uses. The `<name>` (an AniDB title) is never read. */
export interface ALEntry {
  anidb: number;
  tvdb: number | null;
  tvdbSeason: ALSeason | null;
  /** null when the attribute is empty: on season 0 that means "a special, episode not given". */
  tvdbOffset: number | null;
  tmdbTv: number | null;
  tmdbSeason: ALSeason | null;
  tmdbOffset: number | null;
  tmdbMovie: number | null;
  imdb: string | null;
  mappings: ALMapping[];
}

const int = (s: string | undefined): number | null => (s !== undefined && /^-?\d+$/.test(s.trim()) ? Number(s.trim()) : null);
const season = (s: string | undefined): ALSeason | null => (s === 'a' ? 'absolute' : int(s));

interface RawMapping {
  anidbseason?: string;
  tvdbseason?: string;
  tmdbseason?: string;
  start?: string;
  end?: string;
  offset?: string;
  '#text'?: string;
}
interface RawAnime {
  anidbid: string;
  tvdbid?: string;
  defaulttvdbseason?: string;
  episodeoffset?: string;
  tmdbtv?: string;
  tmdbseason?: string;
  tmdboffset?: string;
  tmdbid?: string;
  imdbid?: string;
  'mapping-list'?: { mapping?: RawMapping[] };
}

/** Parses ";1-13;2-14+15;3-0;" into per-episode targets. Returns null and logs on anything unexpected. */
function parseList(text: string, anidb: number, conflicts: Conflict[]): ALMapping['list'] {
  const out: { from: number; to: number[] }[] = [];
  for (const item of text.split(';').map((s) => s.trim()).filter(Boolean)) {
    const m = /^(\d+)-(\d+(?:\+\d+)*)$/.exec(item);
    if (!m) {
      conflicts.push({ anidb, part: 'projections', reason: 'anime-lists-bad-list-item', detail: `mapping list item "${item}" is not of the form a-b or a-b+c` });
      return null;
    }
    const to = m[2]!.split('+').map(Number).filter((n) => n !== 0);
    out.push({ from: Number(m[1]), to });
  }
  return out;
}

export function parseAnimeLists(xml: string, conflicts: Conflict[]): Map<number, ALEntry> {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    parseAttributeValue: false,
    parseTagValue: false,
    isArray: (name) => name === 'anime' || name === 'mapping',
  });
  const doc = parser.parse(xml) as { 'anime-list'?: { anime?: RawAnime[] } };
  const entries = new Map<number, ALEntry>();
  for (const a of doc['anime-list']?.anime ?? []) {
    const anidb = int(a.anidbid);
    if (anidb === null) continue;
    const imdbIds = (a.imdbid ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (imdbIds.length > 1) conflicts.push({ anidb, part: 'ids.imdb', reason: 'anime-lists-multiple-ids', detail: `Anime-Lists lists IMDb ${imdbIds.join(', ')}` });
    const tmdbMovieIds = (a.tmdbid ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (tmdbMovieIds.length > 1) conflicts.push({ anidb, part: 'ids.tmdb_movie', reason: 'anime-lists-multiple-ids', detail: `Anime-Lists lists TMDB movies ${tmdbMovieIds.join(', ')}` });

    const mappings: ALMapping[] = [];
    for (const m of a['mapping-list']?.mapping ?? []) {
      const anidbSeason = int(m.anidbseason);
      if (anidbSeason !== 0 && anidbSeason !== 1) {
        conflicts.push({ anidb, part: 'projections', reason: 'anime-lists-unsupported-mapping', detail: `mapping with anidbseason="${m.anidbseason}" is not supported` });
        continue;
      }
      const text = (m['#text'] ?? '').trim();
      const list = text ? parseList(text, anidb, conflicts) : null;
      if (text && list === null) continue;
      mappings.push({
        anidbSeason,
        tvdbSeason: season(m.tvdbseason),
        tmdbSeason: season(m.tmdbseason),
        start: int(m.start),
        end: int(m.end),
        offset: int(m.offset) ?? 0,
        list,
      });
    }
    entries.set(anidb, {
      anidb,
      tvdb: int(a.tvdbid),
      tvdbSeason: season(a.defaulttvdbseason),
      tvdbOffset: int(a.episodeoffset),
      tmdbTv: int(a.tmdbtv),
      tmdbSeason: season(a.tmdbseason),
      tmdbOffset: int(a.tmdboffset),
      tmdbMovie: tmdbMovieIds.length === 1 ? int(tmdbMovieIds[0]) : null,
      imdb: imdbIds.length === 1 && /^tt\d{7,}$/.test(imdbIds[0]!) ? imdbIds[0]! : null,
      mappings,
    });
  }
  return entries;
}

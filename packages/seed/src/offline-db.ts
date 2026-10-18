import type { WorkStatus, WorkType } from '@courmap/core';
import type { Conflict } from './conflicts.js';

/** One cedya77/anime-offline-database entry that carries an AniDB source. */
export interface OfflineEntry {
  anidb: number;
  anilist?: number;
  mal?: number;
  kitsu?: number;
  title: string;
  type: WorkType;
  /** Omitted when cedya77 says UNKNOWN (the work then defaults to finished). */
  status?: WorkStatus;
  year?: number;
  episodes: number;
  synonyms: string[];
}

const TYPES: Record<string, WorkType> = { TV: 'tv', MOVIE: 'movie', OVA: 'ova', ONA: 'ona', SPECIAL: 'special' };
const STATUSES: Record<string, WorkStatus> = { FINISHED: 'finished', ONGOING: 'airing', UPCOMING: 'upcoming' };

const SOURCES: Record<string, 'anidb' | 'anilist' | 'mal' | 'kitsu'> = {
  'anidb.net': 'anidb',
  'anilist.co': 'anilist',
  'myanimelist.net': 'mal',
  'kitsu.app': 'kitsu',
};

interface RawEntry {
  sources: string[];
  title: string;
  type: string;
  episodes: number;
  status: string;
  animeSeason?: { year?: number | null };
  synonyms?: string[];
}

export interface OfflineDb {
  /** The `lastUpdate` from the dataset header. */
  lastUpdate: string | null;
  entries: Map<number, OfflineEntry>;
  /** Entries without an AniDB source (not seeded). */
  withoutAnidb: number;
}

/**
 * Parses anime-offline-database.jsonl (one header line, then one entry per line). Only entries
 * with exactly one AniDB source become seed works; the AniDB ID is the join key and the canonical grain.
 */
export function parseOfflineDb(jsonl: string, conflicts: Conflict[]): OfflineDb {
  const lines = jsonl.split('\n').filter((l) => l.trim() !== '');
  const header = JSON.parse(lines[0] ?? '{}') as { lastUpdate?: string };
  const entries = new Map<number, OfflineEntry>();
  let withoutAnidb = 0;

  for (const line of lines.slice(1)) {
    const raw = JSON.parse(line) as RawEntry;
    const ids: Record<string, number[]> = { anidb: [], anilist: [], mal: [], kitsu: [] };
    for (const s of raw.sources) {
      const m = /^https?:\/\/([^/]+)\/anime\/(\d+)$/.exec(s);
      const provider = m && SOURCES[m[1]!];
      if (provider) ids[provider]!.push(Number(m[2]));
    }
    const anidbIds = [...new Set(ids.anidb)];
    if (anidbIds.length === 0) {
      withoutAnidb++;
      continue;
    }
    if (anidbIds.length > 1) {
      for (const anidb of anidbIds) {
        conflicts.push({ anidb, part: 'work', reason: 'offline-db-merged-anidb', detail: `one cedya77 entry ("${raw.title}") carries AniDB ${anidbIds.join(' and ')}` });
      }
      continue;
    }
    const anidb = anidbIds[0]!;
    if (entries.has(anidb)) {
      conflicts.push({ anidb, part: 'work', reason: 'offline-db-duplicate-anidb', detail: `AniDB ${anidb} appears in more than one cedya77 entry; the first is kept` });
      continue;
    }
    const type = TYPES[raw.type];
    if (!type) {
      conflicts.push({ anidb, part: 'work', reason: 'offline-db-unknown-type', detail: `cedya77 type is ${raw.type}` });
      continue;
    }
    if (!Number.isInteger(raw.episodes) || raw.episodes < 1) {
      conflicts.push({ anidb, part: 'work', reason: 'offline-db-no-episode-count', detail: `cedya77 episodes is ${raw.episodes}` });
      continue;
    }
    const entry: OfflineEntry = { anidb, title: raw.title, type, episodes: raw.episodes, synonyms: [] };
    for (const p of ['anilist', 'mal', 'kitsu'] as const) {
      const unique = [...new Set(ids[p])];
      if (unique.length === 1) entry[p] = unique[0]!;
      else if (unique.length > 1) conflicts.push({ anidb, part: `ids.${p}`, reason: 'offline-db-multiple-ids', detail: `cedya77 lists ${p} ${unique.join(', ')}` });
    }
    const status = STATUSES[raw.status];
    if (status) entry.status = status;
    else conflicts.push({ anidb, part: 'status', reason: 'offline-db-unknown-status', detail: `cedya77 status is ${raw.status}; left unset (defaults to finished)` });
    const year = raw.animeSeason?.year;
    if (typeof year === 'number' && year >= 1900 && year <= 2100) entry.year = year;
    entry.synonyms = [...new Set((raw.synonyms ?? []).filter((s) => s.trim() !== '' && s !== raw.title))];
    entries.set(anidb, entry);
  }
  return { lastUpdate: header.lastUpdate ?? null, entries, withoutAnidb };
}

import type { WorkStatus, WorkType } from '@courmap/core';
import type { Conflict } from './conflicts.js';

/** The IDs that can anchor a seed work, in priority order (Xwolv decision S3.9). */
export const ANCHORS = ['anidb', 'anilist', 'mal'] as const;
export type Anchor = (typeof ANCHORS)[number];

/** A seed work's identity: its highest-priority anchor, as `anidb:69`, `anilist:21` or `mal:21`. */
export type EntryKey = string;

/** One cedya77/anime-offline-database entry that carries at least one anchor ID. */
export interface OfflineEntry {
  key: EntryKey;
  anidb?: number;
  anilist?: number;
  mal?: number;
  kitsu?: number;
  title: string;
  type: WorkType;
  /** Omitted when cedya77 says UNKNOWN (the work then defaults to finished). */
  status?: WorkStatus;
  year?: number;
  /** null while unknown (cedya77 says 0 for an upcoming or airing work). */
  episodes: number | null;
  synonyms: string[];
}

export const entryKey = (e: Pick<OfflineEntry, Anchor>): EntryKey | null => {
  for (const a of ANCHORS) if (e[a] !== undefined) return `${a}:${e[a]}`;
  return null;
};

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
  /** By entry key; AniDB-anchored entries first. */
  entries: Map<EntryKey, OfflineEntry>;
  /** Entries seeded without an AniDB source (anchored by AniList or MAL). */
  withoutAnidb: number;
  /** Entries with none of anidb, anilist, mal (not seeded). */
  withoutAnchor: number;
}

/**
 * Parses anime-offline-database.jsonl (one header line, then one entry per line). An entry
 * becomes a seed work when it carries at least one anchor ID: AniDB, or failing that AniList
 * or MAL (Xwolv decision S3.9). AniDB-anchored entries are read first, so an entry without
 * AniDB whose AniList or MAL ID another entry already carries is skipped as a duplicate.
 */
export function parseOfflineDb(jsonl: string, conflicts: Conflict[]): OfflineDb {
  const lines = jsonl.split('\n').filter((l) => l.trim() !== '');
  const header = JSON.parse(lines[0] ?? '{}') as { lastUpdate?: string };

  const parsed: { raw: RawEntry; ids: Record<string, number[]> }[] = [];
  for (const line of lines.slice(1)) {
    const raw = JSON.parse(line) as RawEntry;
    const ids: Record<string, number[]> = { anidb: [], anilist: [], mal: [], kitsu: [] };
    for (const s of raw.sources) {
      const m = /^https?:\/\/([^/]+)\/anime\/(\d+)$/.exec(s);
      const provider = m && SOURCES[m[1]!];
      if (provider) ids[provider]!.push(Number(m[2]));
    }
    for (const p of Object.keys(ids)) ids[p] = [...new Set(ids[p])];
    parsed.push({ raw, ids });
  }
  // AniDB first: the canonical grain, and the only join key into Anime-Lists.
  parsed.sort((a, b) => Number(b.ids.anidb!.length > 0) - Number(a.ids.anidb!.length > 0));

  const entries = new Map<EntryKey, OfflineEntry>();
  const claimed = new Set<string>(); // anchor IDs already used, as `anilist:21`
  let withoutAnidb = 0;
  let withoutAnchor = 0;

  for (const { raw, ids } of parsed) {
    const keyOf = () => ANCHORS.map((a) => (ids[a]!.length === 1 ? `${a}:${ids[a]![0]}` : null)).find((k) => k !== null) ?? null;
    if (ids.anidb!.length > 1) {
      for (const anidb of ids.anidb!) {
        conflicts.push({ key: `anidb:${anidb}`, part: 'work', reason: 'offline-db-merged-anidb', detail: `one cedya77 entry ("${raw.title}") carries AniDB ${ids.anidb!.join(' and ')}` });
      }
      continue;
    }
    const key = keyOf();
    if (key === null) {
      // No usable anchor: none at all, or only ambiguous ones (several AniList or MAL IDs).
      withoutAnchor++;
      continue;
    }
    const taken = ANCHORS.filter((a) => ids[a]!.length === 1 && claimed.has(`${a}:${ids[a]![0]}`));
    if (taken.length > 0) {
      const which = taken.map((a) => `${a} ${ids[a]![0]}`).join(', ');
      conflicts.push({ key, part: 'work', reason: 'offline-db-duplicate-ids', detail: `"${raw.title}": ${which} already belongs to another cedya77 entry; the first is kept` });
      continue;
    }
    const type = TYPES[raw.type];
    if (!type) {
      conflicts.push({ key, part: 'work', reason: 'offline-db-unknown-type', detail: `cedya77 type is ${raw.type}` });
      continue;
    }
    const status = STATUSES[raw.status];
    let episodes: number | null = raw.episodes;
    if (!Number.isInteger(raw.episodes) || raw.episodes < 1) {
      if (status !== 'upcoming' && status !== 'airing') {
        conflicts.push({ key, part: 'work', reason: 'offline-db-no-episode-count', detail: `cedya77 episodes is ${raw.episodes} for a ${raw.status} work` });
        continue;
      }
      episodes = null;
    }
    const entry: OfflineEntry = { key, title: raw.title, type, episodes, synonyms: [] };
    for (const p of ['anidb', 'anilist', 'mal', 'kitsu'] as const) {
      const unique = ids[p]!;
      if (unique.length === 1) entry[p] = unique[0]!;
      else if (unique.length > 1 && p !== 'anidb') conflicts.push({ key, part: `ids.${p}`, reason: 'offline-db-multiple-ids', detail: `cedya77 lists ${p} ${unique.join(', ')}` });
    }
    for (const a of ANCHORS) if (entry[a] !== undefined) claimed.add(`${a}:${entry[a]}`);
    if (status) entry.status = status;
    else conflicts.push({ key, part: 'status', reason: 'offline-db-unknown-status', detail: `cedya77 status is ${raw.status}; left unset (defaults to finished)` });
    const year = raw.animeSeason?.year;
    if (typeof year === 'number' && year >= 1900 && year <= 2100) entry.year = year;
    entry.synonyms = [...new Set((raw.synonyms ?? []).filter((s) => s.trim() !== '' && s !== raw.title))];
    if (entry.anidb === undefined) withoutAnidb++;
    entries.set(key, entry);
  }
  return { lastUpdate: header.lastUpdate ?? null, entries, withoutAnidb, withoutAnchor };
}

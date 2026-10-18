/** What packages/parser extracts from a release name. Absent parts are null. */
export interface ParsedRelease {
  /** The release name as given. */
  input: string;
  group: string | null;
  title: string | null;
  /** From S2, Season 2, 2nd Season. */
  season: number | null;
  /** From Part 2, Cour 2, Part II. */
  part: number | null;
  episode: number | null;
  /** Last episode of a batch range (01-12). */
  episode_to: number | null;
  /** Release version: 05v2 gives 2. */
  version: number | null;
  /** Special markers: movie, ova, oad, special, recap. */
  special: 'movie' | 'ova' | 'oad' | 'special' | null;
  year: number | null;
  resolution: string | null;
  source: string | null;
  video_codec: string | null;
  audio: string[];
  /** Other tags in lowercase kebab-case: dual-audio, multi-sub, uncensored, batch, 10bit... */
  flags: string[];
  batch: boolean;
  checksum: string | null;
  extension: string | null;
}

/** Where a resolved episode lands in the season-based providers and the absolute sequence. */
export type ResolvedProjections = Partial<Record<'tvdb_show' | 'tmdb_show', { season?: number; episode: number; episode_to?: number }>> & {
  absolute?: { sequence: string; episode: number };
};

export interface ResolveCandidate {
  work: string;
  /** null for movies and for works the number could not be placed in. */
  episode: number | null;
  episode_to?: number;
  confidence: number;
  reason: string;
}

export interface ResolveMatch extends ResolveCandidate {
  ids: Record<string, string>;
  projections: ResolvedProjections;
  /** For batches: one entry per episode. */
  batch?: { episode: number; projections: ResolvedProjections }[];
}

export interface ResolveResult {
  data_version: string;
  /** ok: one clear winner above the floor. ambiguous: candidates but no clear winner. unmatched: no candidate at all. */
  status: 'ok' | 'ambiguous' | 'unmatched';
  parsed: ParsedRelease;
  match: ResolveMatch | null;
  candidates: ResolveCandidate[];
}

/** A search hit. */
export interface WorkSummary {
  id: string;
  type: string;
  year: number | null;
  titles: { romaji: string | null; english: string | null; native: string | null };
  score: number;
}

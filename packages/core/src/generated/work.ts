// Generated from schema/work.schema.json by `pnpm gen:types`. Do not edit by hand.

export type Text = string;
export type NumericId = number;
/**
 * One provider's projection: a list of ranges, or an object when coverage needs a note.
 */
export type ProjectionBlock = ProjectionList | ProjectionBlockObject;
/**
 * @minItems 1
 */
export type ProjectionList = [ProjectionEntry, ...ProjectionEntry[]];
/**
 * A single episode (12, "S3") or a range ("1-12", "S1-S2", "892-" for open-ended). Prefix S = special, C = credit, T = trailer, P = parody; no prefix = regular.
 */
export type EpisodeRange = number | string;
/**
 * Only for N-to-M splits: one canonical episode to several provider episodes, or several to one.
 */
export type TargetRange = number | string;
export type Sources = string[];

/**
 * One canonical work (usually one cour, film or OVA): data/works/<id>.yaml. When data/seeds/ has a work with the same id, this file overrides it key by key (see docs/SPEC.md, "Seeds and manual files"), and only the keys it sets are needed; otherwise type and episodes are required.
 */
export interface WorkFile {
  /**
   * Stable slug, equal to the file name. Never changes once published.
   */
  id: string;
  type?: 'tv' | 'movie' | 'ova' | 'ona' | 'special';
  /**
   * Omitted means finished. Open-ended ranges require airing.
   */
  status?: 'finished' | 'airing' | 'upcoming';
  year?: number;
  /**
   * Regular episode count. null only while airing or upcoming.
   */
  episodes?: number | null;
  /**
   * Special (S) episode count. Omitted means unknown, which skips the specials bounds check.
   */
  specials?: number;
  titles?: {
    romaji?: Text;
    english?: Text;
    native?: Text;
  };
  ids?: WorkIds;
  projections?: WorkProjections;
  aliases?: Text[];
  /**
   * id of the work this one directly follows.
   */
  prequel?: string;
  notes?: string;
  sources?: Sources;
}
/**
 * Provider IDs. In a file that overrides a seed, null removes the seed's ID.
 */
export interface WorkIds {
  anidb?: NumericId | null;
  anilist?: NumericId | null;
  mal?: NumericId | null;
  kitsu?: NumericId | null;
  tvdb_show?: NumericId | null;
  tmdb_show?: NumericId | null;
  tmdb_movie?: NumericId | null;
  imdb?: string | null;
}
/**
 * How season-based providers lay out this work's episodes. In a file that overrides a seed, a block replaces the seed's block for that provider, and null removes it.
 */
export interface WorkProjections {
  tvdb_show?: ProjectionBlock | null;
  tmdb_show?: ProjectionBlock | null;
}
export interface ProjectionEntry {
  episodes: EpisodeRange;
  /**
   * Defaults to the kind implied by the episodes prefix.
   */
  kind?: 'regular' | 'special' | 'credit' | 'trailer' | 'parody';
  /**
   * Provider season. Omit for providers or orderings without seasons (for example TVDB absolute order).
   */
  season?: number;
  /**
   * Provider episode number of the first episode in the range. Defaults to the first canonical number.
   */
  start?: number;
  target?: TargetRange;
  /**
   * Marks that the canonical episodes just before this range are intentionally unmapped.
   */
  gap?: boolean;
}
export interface ProjectionBlockObject {
  /**
   * partial: the ranges intentionally stop before the work's last episode. Requires notes.
   */
  coverage?: 'full' | 'partial';
  /**
   * Why coverage is partial (for example: the provider has not listed the later episodes).
   */
  notes?: string;
  ranges: ProjectionList;
}

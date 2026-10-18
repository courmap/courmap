// Generated from schema/work.schema.json by `pnpm gen:types`. Do not edit by hand.

export type Text = string;
export type NumericId = number;
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
 * One canonical work (usually one cour, film or OVA): data/works/<id>.yaml.
 */
export interface WorkFile {
  /**
   * Stable slug, equal to the file name. Never changes once published.
   */
  id: string;
  type: 'tv' | 'movie' | 'ova' | 'ona' | 'special';
  /**
   * Omitted means finished. Open-ended ranges require airing.
   */
  status?: 'finished' | 'airing' | 'upcoming';
  year?: number;
  /**
   * Regular episode count. null only while airing or upcoming.
   */
  episodes: number | null;
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
export interface WorkIds {
  anidb?: NumericId;
  anilist?: NumericId;
  mal?: NumericId;
  kitsu?: NumericId;
  tvdb_show?: NumericId;
  tmdb_show?: NumericId;
  tmdb_movie?: NumericId;
  imdb?: string;
}
/**
 * How season-based providers lay out this work's episodes.
 */
export interface WorkProjections {
  tvdb_show?: ProjectionList;
  tmdb_show?: ProjectionList;
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

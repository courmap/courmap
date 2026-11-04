// Generated from schema/rejected.schema.json by `pnpm gen:types`. Do not edit by hand.

export type Slug = string;
/**
 * Why the proposal was rejected, in a sentence.
 */
export type Reason = string;
/**
 * Who rejected it.
 */
export type DecidedBy = string;
/**
 * When it was rejected (YYYY-MM-DD).
 */
export type Date = string;
/**
 * The pull request or issue where it was rejected.
 */
export type Link = string;

/**
 * Bot proposals a maintainer rejected: data/rejected.yaml. The bots read it before proposing anything and never propose a matching change again. Hand-written only (origin: manual).
 */
export interface RejectedFile {
  rejected: ((RelationRejection | AiringRejection | TmdbSplitRejection | TmdbExtrasRejection) & {
    kind: 'relation' | 'airing' | 'tmdb-split' | 'tmdb-extras';
  })[];
}
/**
 * A prequel link the bots must not propose: `prequel` as the prequel of `work`.
 */
export interface RelationRejection {
  kind: 'relation';
  work: Slug;
  prequel: Slug;
  reason: Reason;
  decided_by: DecidedBy;
  date: Date;
  link?: Link;
  origin: 'manual';
}
/**
 * An airing or count update the bots must not propose for `work`. Without `episodes` and `status` it covers every airing update for the work; with them, only updates to exactly those values.
 */
export interface AiringRejection {
  kind: 'airing';
  work: Slug;
  episodes?: number | null;
  status?: 'airing' | 'finished';
  reason: Reason;
  decided_by: DecidedBy;
  date: Date;
  link?: Link;
  origin: 'manual';
}
/**
 * A split-cour proposal from the TMDB checker the bots must not make again for `work`: that its TMDB episodes continue the previous TMDB season.
 */
export interface TmdbSplitRejection {
  kind: 'tmdb-split';
  work: Slug;
  reason: Reason;
  decided_by: DecidedBy;
  date: Date;
  link?: Link;
  origin: 'manual';
}
/**
 * TMDB episodes of `work`'s TMDB show that no work of ours covers (a bonus, a 3D version, a recap TMDB lists as a special). The TMDB checker counts them as mapped, so it stops flagging the show for them. Say which TMDB season and episodes, and why no work owns them.
 */
export interface TmdbExtrasRejection {
  kind: 'tmdb-extras';
  work: Slug;
  /**
   * The TMDB season the episodes are in (0 for specials).
   */
  season: number;
  /**
   * The TMDB episode number, or a range such as 11-12.
   */
  episodes: string;
  reason: Reason;
  decided_by: DecidedBy;
  date: Date;
  link?: Link;
  origin: 'manual';
}

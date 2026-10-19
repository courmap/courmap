import type { EpisodeKind, Provider, ProjectionProvider, Target } from './providers.js';

/** One projection row: canonical episodes ep_from..ep_to of one kind land on provider episodes from target_from. */
export interface ProjectionRow {
  kind: EpisodeKind;
  ep_from: number;
  /** null = open-ended. */
  ep_to: number | null;
  /** null for orderings without seasons (TVDB absolute order). */
  season: number | null;
  target_from: number;
  /** Set only for N-to-M splits. */
  target_to: number | null;
}

export interface SequenceMembership {
  sequence: string;
  ep_from: number;
  ep_to: number | null;
  absolute_start: number;
  /** True for the work's default sequence: its only one, or the one marked default when it has several. */
  default: boolean;
}

export type WorkType = 'tv' | 'movie' | 'ova' | 'ona' | 'special';
export type WorkStatus = 'finished' | 'airing' | 'upcoming';

/**
 * A compiled work, as stored in a Dataset. This is also the shape of the future
 * `works/{id}.json` shard, so every Dataset implementation can return it directly.
 */
export interface WorkRecord {
  id: string;
  type: WorkType;
  status: WorkStatus;
  year: number | null;
  episodes: number | null;
  /** null = unknown. */
  specials: number | null;
  titles: { romaji: string | null; english: string | null; native: string | null };
  ids: Partial<Record<Provider, string>>;
  projections: Partial<Record<ProjectionProvider, ProjectionRow[]>>;
  prequel: string | null;
  /**
   * Where the prequel came from: manual, a seed origin, bot (an AniList relation) or derived (TVDB
   * order); null when there is none. A bot prequel orders the chain but never implies numbering.
   */
  prequel_origin: string | null;
  sequences: SequenceMembership[];
  aliases: string[];
}

export interface SequenceMemberRow {
  work: string;
  ep_from: number;
  ep_to: number | null;
  absolute_start: number;
}

export interface SequenceRecord {
  id: string;
  /** Ordered by absolute_start. */
  members: SequenceMemberRow[];
}

/** A release group: its aliases and numbering quirks. */
export interface GroupRecord {
  id: string;
  aliases: string[];
  overrides: { work: string; numbering: 'continue_prequel' | 'absolute' | 'offset'; offset: number | null; sequence: string | null }[];
}

export interface Meta {
  data_version: string;
  git_sha: string;
  built_at: string;
  schema_version: string;
}

/** lookup() result. */
export type Work = WorkRecord & { data_version: string };

export type EpisodeInput = number | string;

export interface CanonicalTargetResult {
  id: string;
  episode: number;
  episode_to?: number;
  /** Present only for non-regular episodes (AniDB specials and the like). */
  kind?: EpisodeKind;
}

export interface ProjectionTargetResult {
  id: string;
  /** Omitted for orderings without seasons. */
  season?: number;
  episode: number;
  /** Set when one canonical episode spans several provider episodes, or a hub range maps to a provider range. */
  episode_to?: number;
}

export interface IdTargetResult {
  id: string;
}

export interface AbsoluteTargetResult {
  sequence: string;
  episode: number;
  episode_to?: number;
}

export type TargetResult = CanonicalTargetResult | ProjectionTargetResult | IdTargetResult | AbsoluteTargetResult;

export interface TranslateResult {
  data_version: string;
  status: 'ok' | 'unmapped';
  input: { ref: string; episode: EpisodeInput };
  work: { id: string; episode: number; kind: EpisodeKind; episode_to?: number };
  results: Partial<Record<Target, TargetResult>>;
  unmapped: Target[];
}

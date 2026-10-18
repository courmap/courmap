/** Every provider a work can carry an ID for. */
export const PROVIDERS = ['anidb', 'anilist', 'mal', 'kitsu', 'tvdb_show', 'tmdb_show', 'tmdb_movie', 'imdb'] as const;
export type Provider = (typeof PROVIDERS)[number];

/** Providers whose numbering is the work's own canonical numbering (same granularity as the hub). */
export const CANONICAL_PROVIDERS = ['anidb', 'anilist', 'mal', 'kitsu'] as const;
export type CanonicalProvider = (typeof CANONICAL_PROVIDERS)[number];

/** Providers that lay episodes out in seasons, described by projections. */
export const PROJECTION_PROVIDERS = ['tvdb_show', 'tmdb_show'] as const;
export type ProjectionProvider = (typeof PROJECTION_PROVIDERS)[number];

/** Providers that identify a whole work but have no episode numbering of their own. */
export const ID_ONLY_PROVIDERS = ['tmdb_movie', 'imdb'] as const;
export type IdOnlyProvider = (typeof ID_ONLY_PROVIDERS)[number];

/**
 * Providers whose IDs must point at exactly one work. Season-based providers and IMDb
 * legitimately share one ID across several works (split cours, sequels).
 */
export const UNIQUE_ID_PROVIDERS: readonly Provider[] = ['anidb', 'anilist', 'mal', 'kitsu', 'tmdb_movie'];

/** Anything a translate call can target: a provider or the absolute numbering of the work's sequence. */
export const TARGETS = [...PROVIDERS, 'absolute'] as const;
export type Target = (typeof TARGETS)[number];

/** Ref prefixes that are not providers: the canonical hub itself and absolute sequences. */
export type RefNamespace = Provider | 'work' | 'absolute';

export const isProvider = (s: string): s is Provider => (PROVIDERS as readonly string[]).includes(s);
export const isCanonicalProvider = (s: string): s is CanonicalProvider =>
  (CANONICAL_PROVIDERS as readonly string[]).includes(s);
export const isProjectionProvider = (s: string): s is ProjectionProvider =>
  (PROJECTION_PROVIDERS as readonly string[]).includes(s);
export const isIdOnlyProvider = (s: string): s is IdOnlyProvider => (ID_ONLY_PROVIDERS as readonly string[]).includes(s);
export const isTarget = (s: string): s is Target => (TARGETS as readonly string[]).includes(s);

/** Episode kinds, in AniDB's sense. Regular episodes have no prefix; the others use S, C, T, P. */
export const EPISODE_KINDS = ['regular', 'special', 'credit', 'trailer', 'parody'] as const;
export type EpisodeKind = (typeof EPISODE_KINDS)[number];

export const KIND_PREFIX: Record<EpisodeKind, string> = {
  regular: '',
  special: 'S',
  credit: 'C',
  trailer: 'T',
  parody: 'P',
};

export const PREFIX_KIND: Record<string, EpisodeKind> = {
  '': 'regular',
  S: 'special',
  C: 'credit',
  T: 'trailer',
  P: 'parody',
};

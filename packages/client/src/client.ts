import { lookup, resolve, search, translate, type Dataset, type EpisodeInput, type Meta, type ResolveOptions, type ResolveResult, type TranslateResult, type Work, type WorkSummary } from '@courmap/core';
import { parseRelease } from '@courmap/parser';

/**
 * The client contract from docs/SPEC.md. Offline (SQLite), remote (static shards) and any other
 * Dataset give identical answers, because every operation runs the same core code over it.
 */
export interface CourmapClient {
  /** The work a ref points at. Rejects with CourmapError (not_found, invalid_input, ambiguous). */
  lookup(ref: string): Promise<Work>;
  /**
   * One episode in every requested numbering. `targets` are provider names or "absolute".
   * Targets the work cannot map are listed in `unmapped` and set status to "unmapped".
   */
  translate(ref: string, episode: EpisodeInput, targets: readonly string[]): Promise<TranslateResult>;
  /**
   * A release name to its work and episode, with confidence and competing candidates. status is
   * ok only for a clear winner; otherwise ambiguous (candidates listed) or unmatched.
   */
  resolve(releaseName: string, options?: ResolveOptions): Promise<ResolveResult>;
  /** Works whose titles or aliases match the query, best first. */
  search(query: string, limit?: number): Promise<WorkSummary[]>;
  meta(): Promise<Meta>;
  /** Releases resources (the SQLite handle in offline mode). */
  close(): void;
}

/** Builds a client over any Dataset. Every mode goes through here, so all modes answer alike. */
export function createClient(dataset: Dataset, close: () => void = () => {}): CourmapClient {
  return {
    lookup: (ref) => lookup(dataset, ref),
    translate: (ref, episode, targets) => translate(dataset, ref, episode, targets),
    resolve: (releaseName, options) => resolve(dataset, parseRelease(releaseName), options),
    search: (query, limit) => search(dataset, query, limit),
    meta: () => dataset.meta(),
    close,
  };
}

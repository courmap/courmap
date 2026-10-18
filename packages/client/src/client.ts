import { lookup, translate, type Dataset, type EpisodeInput, type Meta, type TranslateResult, type Work } from '@courmap/core';

/**
 * The client contract from docs/SPEC.md. resolve() and search() join it in build step 7,
 * once packages/parser exists; createRemoteClient() arrives in step 6 as another Dataset.
 */
export interface CourmapClient {
  /** The work a ref points at. Rejects with CourmapError (not_found, invalid_input, ambiguous). */
  lookup(ref: string): Promise<Work>;
  /**
   * One episode in every requested numbering. `targets` are provider names or "absolute".
   * Targets the work cannot map are listed in `unmapped` and set status to "unmapped".
   */
  translate(ref: string, episode: EpisodeInput, targets: readonly string[]): Promise<TranslateResult>;
  meta(): Promise<Meta>;
  /** Releases resources (the SQLite handle in offline mode). */
  close(): void;
}

/** Builds a client over any Dataset. Every mode goes through here, so all modes answer alike. */
export function createClient(dataset: Dataset, close: () => void = () => {}): CourmapClient {
  return {
    lookup: (ref) => lookup(dataset, ref),
    translate: (ref, episode, targets) => translate(dataset, ref, episode, targets),
    meta: () => dataset.meta(),
    close,
  };
}

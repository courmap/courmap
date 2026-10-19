// The browser and Worker entry point (`@courmap/client/remote`, and the `browser` condition of
// `@courmap/client`): remote mode only, with no Node-only imports anywhere below it
// (decision S4.7). test/browser-bundle.test.ts bundles this file for the browser to keep it so.
export { createClient, type CourmapClient } from './client.js';
export { createRemoteClient, RemoteDataset, type RemoteOptions, type ShardStore } from './remote.js';
export {
  COURMAP_URLS,
  CourmapError,
  type CourmapErrorJSON,
  type Dataset,
  type EpisodeInput,
  type ErrorCode,
  type Meta,
  type ParsedRelease,
  type ResolveCandidate,
  type ResolveMatch,
  type ResolveResult,
  type WorkSummary,
  type Target,
  type TargetResult,
  type TranslateResult,
  type Work,
} from '@courmap/core';
export { parseRelease } from '@courmap/parser';

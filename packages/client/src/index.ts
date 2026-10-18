export { createClient, type CourmapClient } from './client.js';
export { createOfflineClient, SqliteDataset, sqliteReader } from './offline.js';
export { createRemoteClient, RemoteDataset, type RemoteOptions } from './remote.js';
export {
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

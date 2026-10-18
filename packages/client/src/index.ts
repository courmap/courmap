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
  type Target,
  type TargetResult,
  type TranslateResult,
  type Work,
} from '@courmap/core';

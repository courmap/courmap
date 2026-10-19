import { COURMAP_URLS } from '@courmap/core';
import type { CourmapClient } from './client.js';
import { diskStore } from './disk-store.js';
import { createRemoteClient as createRemote, type RemoteOptions } from './remote.js';

// The Node entry point: everything the browser entry has, plus offline mode and a disk cache.
export * from './browser.js';
export { createOfflineClient, SqliteDataset, sqliteReader } from './offline.js';
export { diskStore } from './disk-store.js';

export interface NodeRemoteOptions extends RemoteOptions {
  /** On-disk cache directory. Files are stored under <cacheDir>/<data_version>/, so a new data version starts a fresh cache. */
  cacheDir?: string;
}

/** A client over the static shards at baseUrl (default https://data.courmap.com/v1/), optionally cached on disk. */
export function createRemoteClient(baseUrl: string = COURMAP_URLS.data, opts: NodeRemoteOptions = {}): CourmapClient {
  const { cacheDir, ...rest } = opts;
  return createRemote(baseUrl, cacheDir !== undefined && rest.store === undefined ? { ...rest, store: diskStore(cacheDir) } : rest);
}

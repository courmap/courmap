import { readFileSync } from 'node:fs';
import { COURMAP_URLS } from '@courmap/core';
import { parse } from 'yaml';
import { PROTOCOLS, type Protocol } from './feed.js';

/** One upstream Torznab or Newznab feed (usually a Prowlarr indexer), served by the proxy at /<name>/api. */
export interface IndexerConfig {
  /** Path segment: lowercase letters, digits and hyphens. */
  name: string;
  /** The upstream endpoint, e.g. http://prowlarr:9696/1/api. */
  url: string;
  /** Upstream API key. When unset, the apikey Sonarr sends is forwarded. */
  apikey?: string;
  /** torznab (torrents) or newznab (usenet). When unset, learned from the feed's first results. */
  type?: Protocol;
}

export interface ProxyConfig {
  port: number;
  /** Where downloaded dumps, current.json and the unresolved log live. */
  dataDir: string;
  /** meta.json of the static shards, which names the current dump. */
  metaUrl: string;
  /** A fixed local dump. When set, the proxy never downloads one. */
  dump: string | null;
  /** How often meta.json is checked. */
  refreshHours: number;
  sonarr: { url: string; apiKey: string; refreshMinutes: number } | null;
  indexers: IndexerConfig[];
  /** Upstream requests time out after this long. */
  timeoutMs: number;
}

const NAME = /^[a-z0-9][a-z0-9-]*$/;

interface FileConfig {
  port?: number;
  data_dir?: string;
  meta_url?: string;
  dump?: string;
  refresh_hours?: number;
  sonarr?: { url?: string; api_key?: string; refresh_minutes?: number };
  indexers?: { name: string; url: string; apikey?: string; type?: string }[];
  timeout_seconds?: number;
}

/**
 * Configuration from environment variables and an optional YAML file (COURMAP_CONFIG, default
 * /config/courmap-proxy.yaml). Environment variables win over the file. Indexers come from the
 * file's `indexers:` list and from INDEXER_<NAME>_URL (plus INDEXER_<NAME>_APIKEY and
 * INDEXER_<NAME>_TYPE, torznab or newznab) variables.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env, readFile: (p: string) => string | null = tryRead): ProxyConfig {
  const file = env.COURMAP_CONFIG ?? '/config/courmap-proxy.yaml';
  const text = readFile(file);
  const f: FileConfig = text ? ((parse(text) as FileConfig | null) ?? {}) : {};
  const num = (v: string | undefined, fallback: number) => (v !== undefined && v !== '' ? Number(v) : fallback);

  const indexers = new Map<string, IndexerConfig>();
  for (const i of f.indexers ?? []) indexers.set(i.name, { name: i.name, url: i.url, ...(i.apikey && { apikey: i.apikey }), ...(i.type && { type: i.type as Protocol }) });
  for (const [key, value] of Object.entries(env)) {
    const m = /^INDEXER_([A-Z0-9_]+)_URL$/.exec(key);
    if (!m || !value) continue;
    const name = m[1]!.toLowerCase().replace(/_/g, '-');
    const apikey = env[`INDEXER_${m[1]}_APIKEY`];
    const type = env[`INDEXER_${m[1]}_TYPE`];
    indexers.set(name, { name, url: value, ...(apikey && { apikey }), ...(type && { type: type as Protocol }) });
  }
  for (const i of indexers.values()) {
    if (!NAME.test(i.name)) throw new Error(`indexer name "${i.name}" must be lowercase letters, digits and hyphens`);
    if (!/^https?:\/\//.test(i.url)) throw new Error(`indexer "${i.name}": url must start with http:// or https://`);
    if (i.type !== undefined) {
      const type = String(i.type).trim().toLowerCase() as Protocol;
      if (!PROTOCOLS.includes(type)) throw new Error(`indexer "${i.name}": type must be ${PROTOCOLS.join(' or ')}, not "${i.type}"`);
      i.type = type;
    }
  }

  const sonarrUrl = env.SONARR_URL ?? f.sonarr?.url;
  const sonarrKey = env.SONARR_API_KEY ?? f.sonarr?.api_key;
  return {
    port: num(env.PORT, f.port ?? 9797),
    dataDir: env.DATA_DIR ?? f.data_dir ?? '/data',
    metaUrl: env.COURMAP_META_URL ?? f.meta_url ?? COURMAP_URLS.releaseMeta,
    dump: env.COURMAP_DUMP ?? f.dump ?? null,
    refreshHours: num(env.REFRESH_HOURS, f.refresh_hours ?? 24),
    sonarr: sonarrUrl && sonarrKey ? { url: sonarrUrl.replace(/\/+$/, ''), apiKey: sonarrKey, refreshMinutes: num(env.SONARR_REFRESH_MINUTES, f.sonarr?.refresh_minutes ?? 60) } : null,
    indexers: [...indexers.values()].sort((a, b) => (a.name < b.name ? -1 : 1)),
    timeoutMs: num(env.TIMEOUT_SECONDS, f.timeout_seconds ?? 60) * 1000,
  };
}

function tryRead(p: string): string | null {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

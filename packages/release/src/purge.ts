/** A Cloudflare zone and the token allowed to purge its cache (Cache Purge permission, nothing else). */
export interface PurgeTarget {
  zoneId: string;
  token: string;
  /** URL prefixes without the scheme, e.g. "data.courmap.com/v1/". */
  prefixes: string[];
}

const DEFAULT_PREFIX = 'data.courmap.com/v1/';

/**
 * Drops the edge copies of the shards after a sync. The cache rule on data.courmap.com keeps files for
 * the lifetime in their Cache-Control header (an hour), so without a purge a client could read the new
 * meta.json next to a shard from the previous release. Throws on any answer but success.
 */
export async function purgeCache(target: PurgeTarget, fetchFn: typeof fetch = (i, init) => fetch(i, init)): Promise<void> {
  const res = await fetchFn(`https://api.cloudflare.com/client/v4/zones/${target.zoneId}/purge_cache`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${target.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefixes: target.prefixes }),
  });
  const body = (await res.json().catch(() => null)) as { success?: boolean; errors?: { message?: string }[] } | null;
  if (!res.ok || body?.success !== true) {
    const why = body?.errors?.map((e) => e.message).filter(Boolean).join('; ') || `HTTP ${res.status}`;
    throw new Error(`Cloudflare cache purge failed: ${why}`);
  }
}

/** Reads CLOUDFLARE_ZONE_ID and CLOUDFLARE_PURGE_TOKEN (and CACHE_PURGE_PREFIX). Null when either is missing. */
export function purgeTargetFromEnv(env: NodeJS.ProcessEnv = process.env): PurgeTarget | null {
  const { CLOUDFLARE_ZONE_ID, CLOUDFLARE_PURGE_TOKEN, CACHE_PURGE_PREFIX } = env;
  if (!CLOUDFLARE_ZONE_ID || !CLOUDFLARE_PURGE_TOKEN) return null;
  return { zoneId: CLOUDFLARE_ZONE_ID, token: CLOUDFLARE_PURGE_TOKEN, prefixes: [CACHE_PURGE_PREFIX || DEFAULT_PREFIX] };
}

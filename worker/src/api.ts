import { COURMAP_URLS, CourmapError, createRemoteClient, type CourmapClient } from '@courmap/client/remote';

/**
 * The optional Worker (docs/SPEC.md, "Hosting"; decision S6.3): lookup, translate, resolve and
 * search over the static shards, for curl-and-go users. It runs the same remote client as the
 * browser, so its answers are the library's answers. If it is switched off, nothing else breaks.
 */

/** Cloudflare's rate limiting binding (wrangler.toml [[ratelimits]]). */
interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  /** The /v1/ shard root; defaults to https://data.courmap.com/v1/. */
  DATA_URL?: string;
  LIMITER?: RateLimiter;
}

export const MAX_TRANSLATE_BATCH = 100;
export const MAX_RESOLVE_BATCH = 25;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

const json = (status: number, body: unknown, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS, ...extra } });

/** CourmapError codes to HTTP statuses (docs/SPEC.md, "Ambiguity and failure"). */
const STATUS: Record<string, number> = { invalid_input: 400, not_found: 404, ambiguous: 409 };

function errorBody(err: unknown): { status: number; body: unknown } {
  if (err instanceof CourmapError) return { status: STATUS[err.code] ?? 400, body: err.toJSON() };
  return { status: 502, body: { code: 'upstream', message: `could not read the data: ${(err as Error).message}` } };
}

const invalid = (field: string, message: string) => json(400, { code: 'invalid_input', field, message });

// One client per isolate: it caches meta.json for an hour and every shard by data version.
let cached: { url: string; client: CourmapClient } | null = null;
function clientFor(env: Env): CourmapClient {
  const url = env.DATA_URL || COURMAP_URLS.data;
  if (cached?.url !== url) cached = { url, client: createRemoteClient(url) };
  return cached.client;
}

/** Runs one call; a CourmapError becomes its JSON error, per item in a batch. */
async function settle<T>(f: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; status: number; body: unknown }> {
  try {
    return { ok: true, value: await f() };
  } catch (err) {
    return { ok: false, ...errorBody(err) };
  }
}

async function readBatch(request: Request, key: string, max: number): Promise<unknown[] | Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalid('body', 'the body must be JSON');
  }
  const list = (body as Record<string, unknown> | null)?.[key];
  if (!Array.isArray(list)) return invalid(key, `the body must be { "${key}": [...] }`);
  if (list.length > max) return invalid(key, `at most ${max} per request, got ${list.length}`);
  return list;
}

export async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  // HEAD (curl -I, uptime checks): the GET answer without its body.
  if (request.method === 'HEAD') {
    const res = await handle(new Request(request.url, { method: 'GET', headers: request.headers }), env);
    return new Response(null, { status: res.status, headers: res.headers });
  }
  if (request.method !== 'GET' && request.method !== 'POST') return json(405, { code: 'invalid_input', message: 'GET, HEAD, POST or OPTIONS' });

  if (env.LIMITER) {
    const key = request.headers.get('CF-Connecting-IP') ?? 'unknown';
    if (!(await env.LIMITER.limit({ key })).success) return json(429, { code: 'rate_limited', message: 'too many requests; slow down, or use the library or the dumps' }, { 'Retry-After': '60' });
  }

  const client = clientFor(env);
  const q = url.searchParams;
  const route = url.pathname.replace(/\/+$/, '');
  const post = request.method === 'POST';
  const one = async (f: () => Promise<unknown>) => {
    const r = await settle(f);
    return r.ok ? json(200, r.value) : json(r.status, r.body);
  };

  switch (route) {
    case '':
    case '/v1':
      return json(200, {
        name: 'Courmap API',
        docs: COURMAP_URLS.docs,
        endpoints: ['/v1/meta', '/v1/lookup?ref=', '/v1/translate?from=&episode=&to=', '/v1/resolve?release=', '/v1/search?q='],
        batches: { translate: MAX_TRANSLATE_BATCH, resolve: MAX_RESOLVE_BATCH },
      });
    case '/v1/meta':
      return one(() => client.meta());
    case '/v1/lookup':
      if (!q.get('ref')) return invalid('ref', 'ref is required, e.g. ?ref=anilist:142838');
      return one(() => client.lookup(q.get('ref')!));
    case '/v1/translate': {
      if (post) {
        const list = await readBatch(request, 'items', MAX_TRANSLATE_BATCH);
        if (list instanceof Response) return list;
        const results = [];
        for (const item of list as { ref?: string; episode?: number | string; targets?: string[] }[]) {
          const r = await settle(() => client.translate(String(item?.ref ?? ''), item?.episode ?? '', Array.isArray(item?.targets) ? item.targets : []));
          results.push(r.ok ? r.value : { error: r.body });
        }
        return json(200, { results });
      }
      if (!q.get('from')) return invalid('ref', 'from is required, e.g. ?from=anilist:142838&episode=5&to=tvdb_show');
      const targets = (q.get('to') ?? '').split(',').filter(Boolean);
      // Query strings are text; "5" is the number 5, as in the spec's response shape. "S1" stays text.
      const episode = q.get('episode') ?? '';
      return one(() => client.translate(q.get('from')!, /^\d+$/.test(episode) ? Number(episode) : episode, targets));
    }
    case '/v1/resolve': {
      if (post) {
        const list = await readBatch(request, 'releases', MAX_RESOLVE_BATCH);
        if (list instanceof Response) return list;
        const results = [];
        for (const name of list) {
          const r = await settle(() => client.resolve(String(name)));
          results.push(r.ok ? r.value : { error: r.body });
        }
        return json(200, { results });
      }
      if (!q.get('release')) return invalid('release', 'release is required, e.g. ?release=[SubsPlease] Spy x Family - 17 (1080p)');
      return one(() => client.resolve(q.get('release')!));
    }
    case '/v1/search': {
      if (!q.get('q')) return invalid('q', 'q is required, e.g. ?q=frieren');
      const limit = Math.min(Math.max(Number(q.get('limit') ?? 10) || 10, 1), 50);
      return one(() => client.search(q.get('q')!, limit));
    }
    default:
      return json(404, { code: 'not_found', message: `no route ${url.pathname}; see /v1` });
  }
}


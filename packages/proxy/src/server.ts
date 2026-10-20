import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { IndexerConfig } from './config.js';
import type { DataManager } from './data.js';
import { Redactor } from './redact.js';
import { Rewriter, numbersCover, type RewriteOutcome } from './rewrite.js';
import { DEFAULT_MAX_QUERIES, translateSearch } from './search.js';
import type { SonarrClient } from './sonarr.js';
import type { Stats } from './stats.js';
import { statusHtml, statusJson } from './status.js';
import { classifyUpstream, detectProtocol, emptyFeed, ensureNamespace, errorXml, items, replaceItems, rewriteCaps, rewriteItem, type Protocol, type UpstreamVerdict } from './feed.js';
import type { TranslatedSearch } from './search.js';

export interface ProxyDeps {
  indexers: IndexerConfig[];
  data: DataManager;
  sonarr: SonarrClient;
  stats: Stats;
  version: string;
  timeoutMs: number;
  fetch?: typeof fetch;
  log?: (line: string) => void;
  /** Masks secrets in logs, error responses, the status page and exports; one is made from the indexer config when not given. */
  redactor?: Redactor;
  /** What one Sonarr search may cost an indexer (usenet indexers enforce daily API limits). */
  limits?: { maxQueries?: number; stopOnMatch?: boolean; cacheSeconds?: number };
  /** The clock, for tests. */
  now?: () => number;
}

interface Upstream {
  status: number;
  contentType: string;
  body: string;
  /** Whether the indexer answered usefully, and if not, why. */
  verdict: UpstreamVerdict;
  /** The indexer's Retry-After header, passed on to Sonarr with an error so it backs off as long as the indexer asks. */
  retryAfter?: string;
}

const CACHE_ENTRIES = 100;
/** The same kind of upstream failure is logged at most this often per indexer. */
const LOG_FAILURE_EVERY_MS = 60_000;

/**
 * The proxy's HTTP server. Each upstream feed is served at /<name>/api and behaves like the
 * indexer behind it, Torznab or Newznab, to Sonarr: caps advertise the TV search parameters the
 * proxy translates, searches are translated, and every result title is resolved and rewritten
 * (or passed through unchanged). / is the status page, /status.json its data, /health a
 * liveness check.
 */
export function createProxyServer(deps: ProxyDeps): Server {
  const rewriter = new Rewriter(deps.data, deps.sonarr);
  const byName = new Map(deps.indexers.map((i) => [i.name, i]));
  const fetchFn = deps.fetch ?? ((i, init) => fetch(i, init));
  const redactor = deps.redactor ?? new Redactor();
  for (const i of deps.indexers) {
    redactor.add(i.apikey);
    redactor.addFromUrl(i.url);
  }
  const rawLog = deps.log ?? (() => {});
  const log = (line: string) => rawLog(redactor.redact(line));
  const limits = { maxQueries: deps.limits?.maxQueries ?? DEFAULT_MAX_QUERIES, stopOnMatch: deps.limits?.stopOnMatch ?? true, cacheSeconds: deps.limits?.cacheSeconds ?? 60 };
  const now = deps.now ?? Date.now;
  const lastFailureLog = new Map<string, number>();

  /** One request to an indexer: counted per day, classified, and its failure (if any) kept for the status page. */
  const sendUpstream = async (ix: IndexerConfig, params: URLSearchParams, wanted: 'caps' | 'feed'): Promise<Upstream> => {
    const p = new URLSearchParams(params);
    if (ix.apikey) p.set('apikey', ix.apikey);
    const url = `${ix.url}${ix.url.includes('?') ? '&' : '?'}${p}`;
    let result: Upstream;
    try {
      const res = await fetchFn(url, { signal: AbortSignal.timeout(deps.timeoutMs), headers: { Accept: 'application/rss+xml, application/xml, text/xml' } });
      const body = await res.text();
      const retryAfter = res.headers.get('retry-after') ?? undefined;
      result = { status: res.status, contentType: res.headers.get('content-type') ?? 'application/xml', body, verdict: classifyUpstream(res.status, body, wanted), ...(retryAfter && { retryAfter }) };
    } catch (err) {
      const e = err as Error & { cause?: { code?: string } };
      const timedOut = e.name === 'TimeoutError' || e.name === 'AbortError';
      const detail = timedOut ? `no answer within ${Math.round(deps.timeoutMs / 1000)} s` : `${e.message}${e.cause?.code ? ` (${e.cause.code})` : ''}`;
      result = { status: 502, contentType: 'application/xml', body: errorXml(900, redactor.redact(`upstream ${ix.name}: ${detail}`)), verdict: { ok: false, kind: timedOut ? 'timeout' : 'network', detail } };
    }
    const failure = result.verdict.ok ? null : result.verdict;
    deps.stats.countUpstream(ix.name, failure, new Date(now()));
    if (failure) {
      const key = `${ix.name} ${failure.kind}`;
      if (now() - (lastFailureLog.get(key) ?? 0) >= LOG_FAILURE_EVERY_MS) {
        lastFailureLog.set(key, now());
        log(`${ix.name}: upstream ${failure.kind}: ${failure.detail}`);
      }
    }
    return result;
  };

  // Identical upstream queries share one request for a short time (Sonarr sends the same translated
  // search several times, once per way of asking), whether the first is still running or done.
  // Failures are shared while in flight and then forgotten, so the next request tries again.
  const cache = new Map<string, { at: number; value: Promise<Upstream> }>();
  const upstream = (ix: IndexerConfig, params: URLSearchParams, wanted: 'caps' | 'feed' = 'feed'): Promise<Upstream> => {
    if (limits.cacheSeconds <= 0) return sendUpstream(ix, params, wanted);
    const key = `${ix.name}?${[...params].filter(([k]) => k !== 'apikey').map(([k, v]) => `${k}=${v}`).sort().join('&')}`;
    const hit = cache.get(key);
    if (hit && now() - hit.at < limits.cacheSeconds * 1000) {
      deps.stats.countCacheHit(ix.name, new Date(now()));
      return hit.value;
    }
    const value = sendUpstream(ix, params, wanted);
    cache.set(key, { at: now(), value });
    void value.then((u) => {
      if (!u.verdict.ok && cache.get(key)?.value === value) cache.delete(key);
    });
    while (cache.size > CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
    return value;
  };

  /** Whether a rewritten result is the episode the search asked for. */
  const resolvesTo = (o: RewriteOutcome, t: TranslatedSearch['target']) => o.kind === 'rewritten' && o.tvdbId === t.tvdb && t.episode !== null && numbersCover(o.numbers, t.season, t.episode);

  /** What Sonarr's parser must read the tvdbid from: the configured type, else what the feed's results showed. */
  const protocolOf = (ix: IndexerConfig): Protocol => ix.type ?? deps.stats.of(ix.name).detected ?? 'torznab';

  /** Remembers what a response says about its protocol, and warns once when it contradicts the configured type. */
  const observe = (ix: IndexerConfig, body: string) => {
    const seen = detectProtocol(body);
    if (!seen) return;
    const stats = deps.stats.of(ix.name);
    if (ix.type && seen !== ix.type && stats.detected !== seen) log(`${ix.name}: configured as ${ix.type}, but its feed looks like ${seen}; check INDEXER_${ix.name.toUpperCase().replace(/-/g, '_')}_TYPE`);
    stats.detected = seen;
  };

  const feed = async (ix: IndexerConfig, params: URLSearchParams, res: ServerResponse) => {
    const stats = deps.stats.of(ix.name);
    stats.requests++;
    // The key Sonarr sends is forwarded upstream; it is a secret wherever it turns up in an error.
    redactor.add(params.get('apikey'));
    const t = params.get('t') ?? '';
    if (t === 'caps') {
      const up = await upstream(ix, params, 'caps');
      // Caps carry no protocol marker (nor does Sonarr read one), so they pass through with only the TV search rewritten.
      return send(res, up.status, up.contentType, up.verdict.ok ? rewriteCaps(up.body) : redactor.redact(up.body), up.retryAfter ? { 'Retry-After': up.retryAfter } : undefined);
    }
    const isSearch = params.has('q') || params.has('tvdbid') || params.has('season');
    if (isSearch) stats.searches++;
    const translated = isSearch ? await translateSearch(params, deps.data.client, deps.sonarr, { maxQueries: limits.maxQueries }) : null;
    if (translated) {
      stats.translated++;
      stats.lastSearch = translated.note;
      log(`${ix.name}: ${translated.note}`);
    }
    const queries = translated ? translated.queries : [params];
    const responses: Upstream[] = [];
    let firstOk: Upstream | null = null;
    let satisfied = false;
    const seen = new Set<string>();
    const out: string[] = [];

    /** Resolves and rewrites the results of one upstream answer; duplicates across answers are dropped. */
    const handle = async (r: Upstream) => {
      responses.push(r);
      if (!r.verdict.ok) return;
      firstOk ??= r;
      observe(ix, r.body);
      const protocol = protocolOf(ix);
      for (const item of items(r.body)) {
        if (seen.has(item.key)) continue;
        seen.add(item.key);
        const outcome = await rewriter.rewrite(item.title).catch((err: Error) => {
          log(`rewrite failed for "${item.title}": ${err.message}`);
          return null;
        });
        if (!outcome) {
          out.push(item.xml);
          continue;
        }
        deps.stats.record(ix.name, item.title, outcome);
        out.push(outcome.kind === 'rewritten' ? rewriteItem(item.xml, outcome.title, outcome.tvdbId, protocol) : item.xml);
        if (translated && resolvesTo(outcome, translated.target)) satisfied = true;
      }
    };

    // The first query alone. For an episode search its alternatives (the same episode under another
    // name or number) are only worth an API request when it found nothing for that episode; a season
    // search asks about different works, so all of its queries run. The rest go out together.
    await handle(await upstream(ix, queries[0]!));
    const rest = queries.slice(1);
    if (rest.length > 0) {
      if (translated?.alternatives && limits.stopOnMatch && satisfied) {
        stats.upstreamSkipped += rest.length;
      } else {
        for (const r of await Promise.all(rest.map((q) => upstream(ix, q)))) await handle(r);
      }
    }

    const ok = firstOk as Upstream | null;
    if (!ok) {
      // Newznab reports errors (a bad API key, a request limit) as HTTP 200 with an <error> document, which
      // Sonarr reads by its code: pass it on as it is, not as a gateway failure.
      const apiError = responses.find((r) => r.status === 200 && /<error[\s/>]/.test(r.body));
      if (apiError) return send(res, 200, apiError.contentType, redactor.redact(apiError.body));
      const first = responses[0]!;
      return send(res, first.status === 200 ? 502 : first.status, first.contentType, redactor.redact(first.body) || errorXml(900, `upstream ${ix.name} failed`), first.retryAfter ? { 'Retry-After': first.retryAfter } : undefined);
    }
    send(res, 200, 'application/rss+xml; charset=utf-8', ensureNamespace(replaceItems(ok.body, out), protocolOf(ix)));
  };

  return createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://proxy');
    const parts = url.pathname.split('/').filter(Boolean);
    void (async () => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'text/plain', 'method not allowed');
      if (parts.length === 0) return send(res, 200, 'text/html; charset=utf-8', redactor.redact(statusHtml(statusInput(deps))));
      if (parts[0] === 'status.json') return send(res, 200, 'application/json', redactor.redact(JSON.stringify(statusJson(statusInput(deps)), null, 2)));
      if (parts[0] === 'health') return send(res, 200, 'text/plain', 'ok');
      // For pnpm corpus:from-proxy: what this install could not resolve, and what Sonarr helped number.
      if (parts[0] === 'export.json') return send(res, 200, 'application/json', redactor.redact(JSON.stringify(exportJson(deps), null, 2)));
      if (parts[0] === 'export.txt') return send(res, 200, 'text/plain; charset=utf-8', redactor.redact(exportText(deps)));
      const ix = byName.get(parts[0]!);
      if (!ix) return send(res, 404, 'text/plain', `no indexer "${parts[0]}"; configured: ${[...byName.keys()].join(', ') || 'none'}`);
      // Sonarr calls <base>/api; accept the bare base too.
      if (parts.length > 2 || (parts[1] !== undefined && parts[1] !== 'api')) return send(res, 404, 'text/plain', 'not found');
      if (!url.searchParams.has('t')) return send(res, 200, 'application/rss+xml', emptyFeed(`Courmap proxy: ${ix.name}`, protocolOf(ix)));
      await feed(ix, url.searchParams, res);
    })().catch((err: Error) => {
      log(`request failed: ${err.stack ?? err.message}`);
      if (!res.headersSent) send(res, 500, 'application/xml', errorXml(900, redactor.redact(err.message)));
    });
  });
}

/** Unresolved and assisted release names with details; the input of pnpm corpus:from-proxy. */
export const exportJson = (deps: Pick<ProxyDeps, 'stats' | 'data'>) => ({
  courmap_proxy_export: 1,
  data_version: deps.data.status.dataVersion,
  unresolved: deps.stats.unresolvedList().map((e) => ({ name: e.name, status: e.status, count: e.count, detail: e.detail })),
  assisted: deps.stats.assistedList().map((a) => ({ work: a.mapping.work, count: a.count, examples: a.examples, mapping: a.mapping })),
});

/** One release name per line: unresolved names, then assisted examples. */
export const exportText = (deps: Pick<ProxyDeps, 'stats'>) =>
  [...deps.stats.unresolvedList().map((e) => e.name), ...deps.stats.assistedList().flatMap((a) => a.examples)].join('\n') + '\n';

const statusInput = (deps: ProxyDeps) => ({ version: deps.version, data: deps.data.status, sonarr: deps.sonarr.status, stats: deps.stats, indexers: deps.indexers.map((i) => ({ name: i.name, ...(i.type && { type: i.type }) })) });

function send(res: ServerResponse, status: number, contentType: string, body: string, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'Content-Type': contentType, 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

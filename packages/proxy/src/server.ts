import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { IndexerConfig } from './config.js';
import type { DataManager } from './data.js';
import { Redactor } from './redact.js';
import { Rewriter } from './rewrite.js';
import { translateSearch } from './search.js';
import type { SonarrClient } from './sonarr.js';
import type { Stats } from './stats.js';
import { statusHtml, statusJson } from './status.js';
import { detectProtocol, emptyFeed, ensureNamespace, errorXml, items, replaceItems, rewriteCaps, rewriteItem, type Protocol } from './feed.js';

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
}

interface Upstream {
  status: number;
  contentType: string;
  body: string;
}

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

  const upstream = async (ix: IndexerConfig, params: URLSearchParams): Promise<Upstream> => {
    const p = new URLSearchParams(params);
    if (ix.apikey) p.set('apikey', ix.apikey);
    const url = `${ix.url}${ix.url.includes('?') ? '&' : '?'}${p}`;
    try {
      const res = await fetchFn(url, { signal: AbortSignal.timeout(deps.timeoutMs), headers: { Accept: 'application/rss+xml, application/xml, text/xml' } });
      return { status: res.status, contentType: res.headers.get('content-type') ?? 'application/xml', body: await res.text() };
    } catch (err) {
      return { status: 502, contentType: 'application/xml', body: errorXml(900, redactor.redact(`upstream ${ix.name}: ${(err as Error).message}`)) };
    }
  };

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
      const up = await upstream(ix, params);
      if (up.status !== 200) stats.upstreamErrors++;
      // Caps carry no protocol marker (nor does Sonarr read one), so they pass through with only the TV search rewritten.
      return send(res, up.status, up.contentType, up.status === 200 ? rewriteCaps(up.body) : up.body);
    }
    const isSearch = params.has('q') || params.has('tvdbid') || params.has('season');
    if (isSearch) stats.searches++;
    const translated = isSearch ? await translateSearch(params, deps.data.client, deps.sonarr) : null;
    const responses = translated ? await Promise.all(translated.queries.map((q) => upstream(ix, q))) : [await upstream(ix, params)];
    if (translated) {
      stats.translated++;
      stats.lastSearch = translated.note;
      log(`${ix.name}: ${translated.note}`);
    }
    const ok = responses.filter((r) => r.status === 200 && /<rss\b/.test(r.body));
    stats.upstreamErrors += responses.length - ok.length;
    if (ok.length === 0) {
      // Newznab reports errors (a bad API key, a request limit) as HTTP 200 with an <error> document, which
      // Sonarr reads by its code: pass it on as it is, not as a gateway failure.
      const apiError = responses.find((r) => r.status === 200 && /<error[\s/>]/.test(r.body));
      if (apiError) return send(res, 200, apiError.contentType, redactor.redact(apiError.body));
      const first = responses[0]!;
      return send(res, first.status === 200 ? 502 : first.status, first.contentType, first.body || errorXml(900, `upstream ${ix.name} failed`));
    }
    for (const r of ok) observe(ix, r.body);
    const protocol = protocolOf(ix);
    // Merge results of several queries, dropping duplicates.
    const seen = new Set<string>();
    const merged = ok.flatMap((r) => items(r.body)).filter((i) => !seen.has(i.key) && seen.add(i.key));
    const out: string[] = [];
    for (const item of merged) {
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
    }
    send(res, 200, 'application/rss+xml; charset=utf-8', ensureNamespace(replaceItems(ok[0]!.body, out), protocol));
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

function send(res: ServerResponse, status: number, contentType: string, body: string): void {
  res.writeHead(status, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
  res.end(body);
}

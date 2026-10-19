import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { IndexerConfig } from './config.js';
import type { DataManager } from './data.js';
import { Rewriter } from './rewrite.js';
import { translateSearch } from './search.js';
import type { SonarrClient } from './sonarr.js';
import type { Stats } from './stats.js';
import { statusHtml, statusJson } from './status.js';
import { emptyFeed, ensureNamespace, errorXml, items, replaceItems, rewriteCaps, rewriteItem } from './torznab.js';

export interface ProxyDeps {
  indexers: IndexerConfig[];
  data: DataManager;
  sonarr: SonarrClient;
  stats: Stats;
  version: string;
  timeoutMs: number;
  fetch?: typeof fetch;
  log?: (line: string) => void;
}

interface Upstream {
  status: number;
  contentType: string;
  body: string;
}

/**
 * The proxy's HTTP server. Each upstream feed is served at /<name>/api and behaves like a
 * Torznab indexer to Sonarr: caps advertise the TV search parameters the proxy translates,
 * searches are translated, and every result title is resolved and rewritten (or passed through
 * unchanged). / is the status page, /status.json its data, /health a liveness check.
 */
export function createProxyServer(deps: ProxyDeps): Server {
  const rewriter = new Rewriter(deps.data, deps.sonarr);
  const byName = new Map(deps.indexers.map((i) => [i.name, i]));
  const fetchFn = deps.fetch ?? ((i, init) => fetch(i, init));
  const log = deps.log ?? (() => {});

  const upstream = async (ix: IndexerConfig, params: URLSearchParams): Promise<Upstream> => {
    const p = new URLSearchParams(params);
    if (ix.apikey) p.set('apikey', ix.apikey);
    const url = `${ix.url}${ix.url.includes('?') ? '&' : '?'}${p}`;
    try {
      const res = await fetchFn(url, { signal: AbortSignal.timeout(deps.timeoutMs), headers: { Accept: 'application/rss+xml, application/xml, text/xml' } });
      return { status: res.status, contentType: res.headers.get('content-type') ?? 'application/xml', body: await res.text() };
    } catch (err) {
      return { status: 502, contentType: 'application/xml', body: errorXml(900, `upstream ${ix.name}: ${(err as Error).message}`) };
    }
  };

  const feed = async (ix: IndexerConfig, params: URLSearchParams, res: ServerResponse) => {
    const stats = deps.stats.of(ix.name);
    stats.requests++;
    const t = params.get('t') ?? '';
    if (t === 'caps') {
      const up = await upstream(ix, params);
      if (up.status !== 200) stats.upstreamErrors++;
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
      const first = responses[0]!;
      return send(res, first.status === 200 ? 502 : first.status, first.contentType, first.body || errorXml(900, `upstream ${ix.name} failed`));
    }
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
      out.push(outcome.kind === 'rewritten' ? rewriteItem(item.xml, outcome.title, outcome.tvdbId) : item.xml);
    }
    send(res, 200, 'application/rss+xml; charset=utf-8', ensureNamespace(replaceItems(ok[0]!.body, out)));
  };

  return createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://proxy');
    const parts = url.pathname.split('/').filter(Boolean);
    void (async () => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'text/plain', 'method not allowed');
      if (parts.length === 0) return send(res, 200, 'text/html; charset=utf-8', statusHtml(statusInput(deps)));
      if (parts[0] === 'status.json') return send(res, 200, 'application/json', JSON.stringify(statusJson(statusInput(deps)), null, 2));
      if (parts[0] === 'health') return send(res, 200, 'text/plain', 'ok');
      const ix = byName.get(parts[0]!);
      if (!ix) return send(res, 404, 'text/plain', `no indexer "${parts[0]}"; configured: ${[...byName.keys()].join(', ') || 'none'}`);
      // Sonarr calls <base>/api; accept the bare base too.
      if (parts.length > 2 || (parts[1] !== undefined && parts[1] !== 'api')) return send(res, 404, 'text/plain', 'not found');
      if (!url.searchParams.has('t')) return send(res, 200, 'application/rss+xml', emptyFeed(`Courmap proxy: ${ix.name}`));
      await feed(ix, url.searchParams, res);
    })().catch((err: Error) => {
      log(`request failed: ${err.stack ?? err.message}`);
      if (!res.headersSent) send(res, 500, 'application/xml', errorXml(900, err.message));
    });
  });
}

const statusInput = (deps: ProxyDeps) => ({ version: deps.version, data: deps.data.status, sonarr: deps.sonarr.status, stats: deps.stats, indexers: deps.indexers.map((i) => i.name) });

function send(res: ServerResponse, status: number, contentType: string, body: string): void {
  res.writeHead(status, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
  res.end(body);
}

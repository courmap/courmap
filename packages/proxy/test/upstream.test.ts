import { mkdtempSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { DataManager } from '../src/data.js';
import { classifyUpstream } from '../src/feed.js';
import { createProxyServer, type ProxyDeps } from '../src/server.js';
import { SonarrClient } from '../src/sonarr.js';
import { Stats } from '../src/stats.js';
import { fakeProwlarr, fakeSonarr, fixtureDump, rss, serve, tmp, type FakeServer } from './helpers.js';

// What one Sonarr search costs an indexer, and how failures show up: usenet indexers enforce daily API limits.

const CAPS = '<caps><limits max="100" default="50"/><searching><search available="yes" supportedParams="q"/></searching></caps>';

describe('classifyUpstream', () => {
  const doc = (code: number, description: string) => `<?xml version="1.0"?><error code="${code}" description="${description}"/>`;

  it('tells an API limit from a bad key from any other indexer error, whatever the HTTP status', () => {
    expect(classifyUpstream(200, doc(500, 'Request limit reached'), 'feed')).toEqual({ ok: false, kind: 'api-limit', detail: 'error 500: Request limit reached' });
    expect(classifyUpstream(200, doc(500, 'Daily Hits Limit Reached'), 'feed')).toMatchObject({ kind: 'api-limit' });
    expect(classifyUpstream(200, doc(100, 'Incorrect user credentials'), 'feed')).toEqual({ ok: false, kind: 'auth', detail: 'error 100: Incorrect user credentials' });
    expect(classifyUpstream(200, doc(300, 'No such function'), 'feed')).toEqual({ ok: false, kind: 'indexer-error', detail: 'error 300: No such function' });
    expect(classifyUpstream(200, doc(910, 'API disabled &amp; closed'), 'caps')).toMatchObject({ kind: 'indexer-error', detail: 'error 910: API disabled & closed' });
    expect(classifyUpstream(429, '<html>slow down</html>', 'feed')).toEqual({ ok: false, kind: 'api-limit', detail: 'HTTP 429 (too many requests)' });
    expect(classifyUpstream(401, '', 'feed')).toMatchObject({ kind: 'auth', detail: 'HTTP 401' });
    expect(classifyUpstream(503, 'down', 'feed')).toEqual({ ok: false, kind: 'http', detail: 'HTTP 503' });
  });

  it('accepts a feed or caps document, and rejects a page that is neither', () => {
    expect(classifyUpstream(200, rss([]), 'feed')).toEqual({ ok: true });
    expect(classifyUpstream(200, CAPS, 'caps')).toEqual({ ok: true });
    expect(classifyUpstream(200, '<html>maintenance</html>', 'feed')).toMatchObject({ ok: false, kind: 'bad-response' });
    expect(classifyUpstream(200, rss([]), 'caps')).toMatchObject({ ok: false, kind: 'bad-response' });
  });
});

describe('the limits in the configuration', () => {
  const cfg = (env: Record<string, string>, yaml?: string) => loadConfig({ COURMAP_CONFIG: '/x.yaml', ...env }, () => yaml ?? null);

  it('defaults to three queries, early stop on, and a minute of cache', () => {
    expect(cfg({})).toMatchObject({ maxQueries: 3, stopOnMatch: true, cacheSeconds: 60 });
  });

  it('reads them from the environment or the YAML file, and keeps them in a sane range', () => {
    expect(cfg({ MAX_QUERIES_PER_SEARCH: '1', SEARCH_STOP_ON_MATCH: 'false', UPSTREAM_CACHE_SECONDS: '0' })).toMatchObject({ maxQueries: 1, stopOnMatch: false, cacheSeconds: 0 });
    expect(cfg({}, 'max_queries_per_search: 2\nsearch_stop_on_match: false\nupstream_cache_seconds: 300\n')).toMatchObject({ maxQueries: 2, stopOnMatch: false, cacheSeconds: 300 });
    expect(cfg({ MAX_QUERIES_PER_SEARCH: '0' }).maxQueries).toBe(1);
    expect(cfg({ MAX_QUERIES_PER_SEARCH: '99' }).maxQueries).toBe(10);
    expect(cfg({ SEARCH_STOP_ON_MATCH: 'no' }).stopOnMatch).toBe(false);
    expect(cfg({ SEARCH_STOP_ON_MATCH: '1' }).stopOnMatch).toBe(true);
  });
});

describe('what a Sonarr search costs an indexer', async () => {
  const dump = await fixtureDump('2026.05');
  const sonarrServer = await fakeSonarr();
  const data = new DataManager({ dataDir: path.join(tmp, 'up-d1'), metaUrl: 'unused', dump, refreshHours: 24 });
  await data.start();
  const sonarr = new SonarrClient({ url: sonarrServer.url, apiKey: 'sonarr-key', refreshMinutes: 60 });
  await sonarr.start();
  const closers: (() => Promise<void> | void)[] = [() => data.stop(), () => sonarrServer.close()];
  afterAll(async () => {
    for (const c of closers) await c();
  });

  // A Sonarr episode search for TVDB S01E17 of a split-cour show asks the indexer two ways: the work's
  // own title and number, and the franchise title with the absolute number.
  const EPISODE = 't=tvsearch&tvdbid=5002&season=1&ep=17&cat=5070';
  const FOUND = { 'split show part 2 05': ['[Other] Split Show Part 2 - 05 [720p]'], 'split show 17': ['[Other] Split Show - 17 [1080p] [ABCD1234].mkv'] };
  const FIRST_EMPTY = { 'split show part 2 05': [], 'split show 17': ['[Other] Split Show - 17 [1080p] [ABCD1234].mkv'] };

  async function setup(searches: Record<string, string[]>, limits: ProxyDeps['limits'], extra: Partial<ProxyDeps> = {}, upstream?: FakeServer) {
    const prowlarr = upstream ?? (await fakeProwlarr([], searches));
    const stats = new Stats(null);
    const logs: string[] = [];
    const server = createProxyServer({ indexers: [{ name: 'nyaa', url: `${prowlarr.url}/1/api` }], data, sonarr, stats, version: 'test', timeoutMs: 2000, log: (l) => logs.push(l), limits, ...extra });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    closers.push(
      () => void server.close(),
      () => (upstream ? undefined : prowlarr.close()),
    );
    const get = async (query: string, key = 'prowlarr-key') => {
      const res = await fetch(`${base}/nyaa/api?apikey=${key}&${query}`);
      return { status: res.status, body: await res.text() };
    };
    const asked = () => prowlarr.requests.map((u) => u.searchParams.get('q') ?? `(${u.searchParams.get('t')})`);
    return { prowlarr, stats, logs, base, get, asked };
  }

  describe('the cache', () => {
    it('answers identical queries from one upstream request, however Sonarr words the ask', async () => {
      const t = await setup(FOUND, { stopOnMatch: false, cacheSeconds: 60 });
      // Sonarr asks for one episode several ways; they translate to the same upstream queries.
      const bodies = [await t.get(EPISODE), await t.get('t=tvsearch&tvdbid=5002&q=17&cat=5070'), await t.get(`${EPISODE}&offset=0`)];
      expect(t.asked()).toEqual(['Split Show Part 2 05', 'Split Show 17', 'Split Show Part 2 05', 'Split Show 17']);
      expect(bodies[0]!.body).toBe(bodies[0]!.body);
      const again = await t.get(EPISODE);
      expect(again.body).toBe(bodies[0]!.body);
      // Two distinct queries went out for the first ask; the second ask (absolute number) repeated them, the third had another offset, the fourth repeated the first.
      expect(t.stats.of('nyaa')).toMatchObject({ upstreamRequests: 4, upstreamCacheHits: 4 });
    });

    it('shares one request between concurrent identical queries', async () => {
      const t = await setup(FOUND, { stopOnMatch: false, cacheSeconds: 60 });
      await Promise.all(Array.from({ length: 6 }, () => t.get(EPISODE)));
      expect(t.asked()).toEqual(['Split Show Part 2 05', 'Split Show 17']);
      expect(t.stats.of('nyaa').upstreamRequests).toBe(2);
      expect(t.stats.of('nyaa').upstreamCacheHits).toBe(10);
    });

    it('forgets an answer after its time, and never keeps a failure', async () => {
      let clock = Date.parse('2026-10-20T12:00:00Z');
      let failing = true;
      const upstream = await serve((url, res) => {
        res.writeHead(200, { 'Content-Type': 'application/xml' });
        if (failing) return void res.end('<error code="500" description="Request limit reached"/>');
        res.end(url.searchParams.get('t') === 'caps' ? CAPS : rss(['[Other] Split Show - 17 [1080p]']));
      });
      const t = await setup({}, { cacheSeconds: 30 }, { now: () => clock }, upstream);
      await t.get('t=search&q=Something%20Else');
      failing = false;
      const ok = await t.get('t=search&q=Something%20Else'); // the failure was not cached
      expect(ok.body).toContain('Split Show S01E17');
      await t.get('t=search&q=Something%20Else'); // cached
      expect(upstream.requests).toHaveLength(2);
      clock += 31_000;
      await t.get('t=search&q=Something%20Else'); // expired
      expect(upstream.requests).toHaveLength(3);
    });

    it('can be turned off', async () => {
      const t = await setup(FOUND, { stopOnMatch: false, cacheSeconds: 0 });
      await t.get(EPISODE);
      await t.get(EPISODE);
      expect(t.asked()).toHaveLength(4);
      expect(t.stats.of('nyaa').upstreamCacheHits).toBe(0);
    });
  });

  describe('stopping once an episode is found', () => {
    it('does not send the alternative query when the first one found the episode', async () => {
      const t = await setup(FOUND, { stopOnMatch: true, cacheSeconds: 0 });
      const r = await t.get(EPISODE);
      expect(t.asked()).toEqual(['Split Show Part 2 05']);
      expect(r.body).toContain('Split Show S01E17 [720p] [Other]');
      expect(t.stats.of('nyaa').upstreamSkipped).toBe(1);
    });

    it('sends it when the first query found nothing for that episode', async () => {
      const t = await setup(FIRST_EMPTY, { stopOnMatch: true, cacheSeconds: 0 });
      const r = await t.get(EPISODE);
      expect(t.asked()).toEqual(['Split Show Part 2 05', 'Split Show 17']);
      expect(r.body).toContain('Split Show S01E17 [1080p] [ABCD1234] [Other]');
      expect(t.stats.of('nyaa').upstreamSkipped).toBe(0);
    });

    it('sends it when the first query found only other episodes', async () => {
      const t = await setup({ 'split show part 2 05': ['[Other] Split Show Part 2 - 06 [720p]'], 'split show 17': ['[Other] Split Show - 17 [1080p]'] }, { stopOnMatch: true, cacheSeconds: 0 });
      await t.get(EPISODE);
      expect(t.asked()).toEqual(['Split Show Part 2 05', 'Split Show 17']);
    });

    it('can be turned off', async () => {
      const t = await setup(FOUND, { stopOnMatch: false, cacheSeconds: 0 });
      await t.get(EPISODE);
      expect(t.asked()).toEqual(['Split Show Part 2 05', 'Split Show 17']);
    });

    it('never applies to a season search, whose queries are different works', async () => {
      const t = await setup({ 'split show': ['[Other] Split Show - 01-12 [BD 1080p]'], 'split show part 2': ['[Other] Split Show Part 2 - 01-13 [BD 1080p]'] }, { stopOnMatch: true, cacheSeconds: 0 });
      await t.get('t=tvsearch&tvdbid=5002&season=1');
      expect(t.asked()).toEqual(['Split Show', 'Split Show Part 2']);
      expect(t.stats.of('nyaa').upstreamSkipped).toBe(0);
    });
  });

  describe('the cap on queries per search', () => {
    it('limits a season search to the configured number of queries', async () => {
      const t = await setup({ 'split show': ['[Other] Split Show - 01-12 [BD 1080p]'], 'split show part 2': ['[Other] Split Show Part 2 - 01-13 [BD 1080p]'] }, { maxQueries: 1, stopOnMatch: false, cacheSeconds: 0 });
      await t.get('t=tvsearch&tvdbid=5002&season=1');
      expect(t.asked()).toEqual(['Split Show']);
    });

    it('limits an episode search the same way', async () => {
      const t = await setup(FIRST_EMPTY, { maxQueries: 1, stopOnMatch: false, cacheSeconds: 0 });
      await t.get(EPISODE);
      expect(t.asked()).toEqual(['Split Show Part 2 05']);
    });
  });

  describe('failures and daily counts', () => {
    it('records why requests failed, in words, for each way an indexer can fail', async () => {
      let n = 0;
      const answers: [number, string][] = [
        [200, '<error code="500" description="Request limit reached"/>'],
        [429, '<html>Too many requests</html>'],
        [200, '<error code="100" description="Incorrect user credentials"/>'],
        [503, 'Service Unavailable'],
        [200, '<html>Down for maintenance</html>'],
      ];
      const upstream = await serve((_url, res) => {
        const [status, body] = answers[n++ % answers.length]!;
        res.writeHead(status, { 'Content-Type': 'text/plain' }).end(body);
      });
      const t = await setup({}, { cacheSeconds: 0 }, {}, upstream);
      for (let i = 0; i < answers.length; i++) await t.get(`t=search&q=Anything%20${i}`);
      const s = t.stats.of('nyaa');
      expect(s.upstreamFailures).toEqual({ 'api-limit': 2, auth: 1, http: 1, 'bad-response': 1 });
      expect(s.upstreamErrors).toBe(5);
      expect(s.lastUpstreamError).toMatchObject({ kind: 'bad-response', detail: 'HTTP 200 but not a feed document' });
      // A limit error document is handed to Sonarr as it is, with its 200, so Sonarr can back off by its code.
      n = 0;
      const limited = await t.get('t=search&q=Another');
      expect([limited.status, limited.body]).toEqual([200, '<error code="500" description="Request limit reached"/>']);
      // The status page says why, in the indexer's row and under it.
      const page = await (await fetch(t.base)).text();
      expect(page).toContain('api-limit 3');
      expect(page).toContain('auth 1');
      expect(page).toContain('last upstream problem');
      expect(page).toContain('Requests to your indexers, per day');
      const json = JSON.parse(await (await fetch(`${t.base}/status.json`)).text()) as { indexers: Record<string, { upstreamFailures: Record<string, number>; days: { requests: number; errors: number }[] }> };
      expect(json.indexers.nyaa!.upstreamFailures['api-limit']).toBe(3);
      expect(json.indexers.nyaa!.days[0]).toMatchObject({ requests: 6, errors: 6 });
    });

    it('tells a timeout from a refused connection', async () => {
      const calls: string[] = [];
      const fetchFn = ((input: string | URL | Request) => {
        calls.push(String(input));
        if (calls.length === 1) return Promise.reject(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }));
        return Promise.reject(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }));
      }) as typeof fetch;
      const t = await setup({}, { cacheSeconds: 0 }, { fetch: fetchFn });
      const a = await t.get('t=search&q=a');
      await t.get('t=search&q=b');
      expect(a.status).toBe(502);
      expect(t.stats.of('nyaa').upstreamFailures).toEqual({ timeout: 1, network: 1 });
      expect(t.stats.of('nyaa').lastUpstreamError?.detail).toBe('fetch failed (ECONNREFUSED)');
      expect(t.logs.filter((l) => l.includes('upstream timeout: no answer within 2 s'))).toHaveLength(1);
    });

    it('logs the same kind of failure at most once a minute', async () => {
      let clock = Date.parse('2026-10-20T12:00:00Z');
      const upstream = await serve((_u, res) => void res.writeHead(200).end('<error code="500" description="Request limit reached"/>'));
      const t = await setup({}, { cacheSeconds: 0 }, { now: () => clock }, upstream);
      for (let i = 0; i < 5; i++) await t.get(`t=search&q=x${i}`);
      expect(t.logs.filter((l) => l.includes('upstream api-limit'))).toHaveLength(1);
      clock += 61_000;
      await t.get('t=search&q=again');
      expect(t.logs.filter((l) => l.includes('upstream api-limit'))).toHaveLength(2);
    });

    it('counts requests per UTC day, keeps them across a restart, and drops the old ones', async () => {
      const dir = mkdtempSync(path.join(tmpdir(), 'courmap-days-'));
      const stats = new Stats(dir);
      const day = (d: string, h = 12) => new Date(`${d}T${String(h).padStart(2, '0')}:00:00Z`);
      for (let i = 0; i < 3; i++) stats.countUpstream('geek', null, day('2026-10-19'));
      stats.countUpstream('geek', { kind: 'api-limit', detail: 'x' }, day('2026-10-19', 23));
      stats.countCacheHit('geek', day('2026-10-20', 0));
      stats.countUpstream('geek', null, day('2026-10-20', 0));
      await stats.save();
      const reloaded = new Stats(dir);
      expect(reloaded.recentDays('geek', 3, day('2026-10-20'))).toEqual([
        { date: '2026-10-20', requests: 1, cacheHits: 1, errors: 0 },
        { date: '2026-10-19', requests: 4, cacheHits: 0, errors: 1 },
        { date: '2026-10-18', requests: 0, cacheHits: 0, errors: 0 },
      ]);
      for (let d = 1; d <= 20; d++) reloaded.countUpstream('geek', null, new Date(Date.UTC(2026, 10, d, 12)));
      expect(reloaded.recentDays('geek', 30, new Date(Date.UTC(2026, 10, 20, 12))).filter((x) => x.requests > 0)).toHaveLength(14);
    });
  });
});

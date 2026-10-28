import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { DataManager } from '../src/data.js';
import { items } from '../src/feed.js';
import { createProxyServer } from '../src/server.js';
import { MISS_REFRESH_INTERVAL_MS, SonarrClient } from '../src/sonarr.js';
import { Stats } from '../src/stats.js';
import { fakeProwlarr, fakeSonarr, fixtureDump, SONARR_SERIES, tmp } from './helpers.js';

const SIMPLE_SHOW = SONARR_SERIES.find((s) => s.tvdbId === 5001)!;
const withoutSimpleShow = () => SONARR_SERIES.filter((s) => s !== SIMPLE_SHOW);
const seriesRequests = (sonarr: { requests: URL[] }) => sonarr.requests.filter((r) => r.pathname === '/api/v3/series').length;
/** Long enough for a reload the code started in the background to have reached the fake Sonarr. */
const settle = () => new Promise((r) => setTimeout(r, 60));
const episodeRequests = (sonarr: { requests: URL[] }) => sonarr.requests.filter((r) => r.pathname === '/api/v3/episode').length;

describe('series list refresh on a miss', async () => {
  const live = withoutSimpleShow();
  const sonarrServer = await fakeSonarr(live);
  let clock = 1_000_000;
  const sonarr = new SonarrClient({ url: sonarrServer.url, apiKey: 'sonarr-key', refreshMinutes: 60, now: () => clock });
  await sonarr.start();
  afterAll(() => sonarrServer.close());

  it('does nothing for a series the list already has', async () => {
    clock += 2 * MISS_REFRESH_INTERVAL_MS;
    const before = seriesRequests(sonarrServer);
    sonarr.refreshOnMiss(5002);
    await settle();
    expect(seriesRequests(sonarrServer)).toBe(before);
  });

  it('picks up a series added to Sonarr after the list was loaded', async () => {
    clock += 2 * MISS_REFRESH_INTERVAL_MS;
    expect(sonarr.seriesByTvdb(5001)).toBeUndefined();
    live.push(SIMPLE_SHOW);
    sonarr.refreshOnMiss(5001);
    await vi.waitFor(() => expect(sonarr.seriesByTvdb(5001)?.title).toBe('Simple Show'));
    expect(sonarr.status.series).toBe(4);
    expect(sonarr.status.lastRefresh).toBe(new Date(clock).toISOString());
  });

  it('reloads at most once a minute, counted from the last reload', async () => {
    const before = seriesRequests(sonarrServer);
    clock += MISS_REFRESH_INTERVAL_MS - 1;
    sonarr.refreshOnMiss(9001); // a show that is not in Sonarr at all
    await settle();
    expect(seriesRequests(sonarrServer)).toBe(before); // rate-limited

    clock += 1;
    sonarr.refreshOnMiss(9001);
    sonarr.refreshOnMiss(9002); // while that reload runs, this one joins it
    await vi.waitFor(() => expect(seriesRequests(sonarrServer)).toBe(before + 1));
    await settle();
    expect(seriesRequests(sonarrServer)).toBe(before + 1);

    sonarr.refreshOnMiss(9003); // right after a reload: limited again
    await settle();
    expect(seriesRequests(sonarrServer)).toBe(before + 1);
  });

  it('keeps other series\' cached episode lists, and reloads everything on the schedule', async () => {
    const splitShow = sonarr.seriesByTvdb(5002)!;
    await sonarr.episodesOf(splitShow);
    const cached = episodeRequests(sonarrServer);

    clock += 2 * MISS_REFRESH_INTERVAL_MS;
    await sonarr.refresh(9003); // a reload that a miss started
    await sonarr.episodesOf(splitShow);
    expect(episodeRequests(sonarrServer)).toBe(cached); // still cached

    await sonarr.refresh(); // a scheduled reload clears every list
    await sonarr.episodesOf(splitShow);
    expect(episodeRequests(sonarrServer)).toBe(cached + 1);
  });

  it('does nothing when Sonarr is not configured', () => {
    const none = new SonarrClient(null);
    none.refreshOnMiss(5001);
    expect(none.status.lastRefresh).toBeNull();
  });
});

describe('a series added to Sonarr is rewritten after one miss', async () => {
  const dump = await fixtureDump('2026.01');
  const prowlarr = await fakeProwlarr(['[Other] Simple Show - 03-05 [1080p]'], {});
  const live = withoutSimpleShow();
  const sonarrServer = await fakeSonarr(live);
  const data = new DataManager({ dataDir: path.join(tmp, 'd-refresh'), metaUrl: 'unused', dump, refreshHours: 24 });
  await data.start();
  let clock = 5_000_000;
  const sonarr = new SonarrClient({ url: sonarrServer.url, apiKey: 'sonarr-key', refreshMinutes: 60, now: () => clock });
  await sonarr.start();
  const server = createProxyServer({ indexers: [{ name: 'nyaa', url: `${prowlarr.url}/1/api` }], data, sonarr, stats: new Stats(null), version: 'test', timeoutMs: 5000, limits: { cacheSeconds: 0, stopOnMatch: false } });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  afterAll(async () => {
    server.close();
    data.stop();
    await prowlarr.close();
    await sonarrServer.close();
  });
  const titles = async () => items(await (await fetch(`${base}/nyaa/api?apikey=prowlarr-key&t=tvsearch&cat=5070`)).text()).map((i) => i.title);

  it('passes the release through once, then rewrites it', async () => {
    clock += 2 * MISS_REFRESH_INTERVAL_MS; // a while after the proxy loaded the list
    live.push(SIMPLE_SHOW); // added to Sonarr since
    expect(await titles()).toEqual(['[Other] Simple Show - 03-05 [1080p]']);
    await vi.waitFor(() => expect(sonarr.seriesByTvdb(5001)).toBeDefined()); // the miss started a reload
    expect(await titles()).toEqual(['Simple Show S01E03-E05 [1080p] [Other]']);
  });
});

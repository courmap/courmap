import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { DataManager } from '../src/data.js';
import { Rewriter } from '../src/rewrite.js';
import { SonarrClient } from '../src/sonarr.js';
import { fakeSonarr, fixtureDump, serve, SONARR_SERIES, tmp } from './helpers.js';

describe('dump refresh', async () => {
  const v1 = gzipSync(readFileSync(await fixtureDump('2026.01')));
  const v2 = gzipSync(readFileSync(await fixtureDump('2026.02')));
  const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
  const state = { meta: { data_version: '2026.01', dumps: { tag: 'data-2026.01', sqlite: { url: '/dl/v1.gz', sha256: sha(v1) } } } as Record<string, unknown> };
  const server = await serve((url, res) => {
    if (url.pathname === '/v1/meta.json') return void res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(state.meta));
    const body = url.pathname === '/dl/v1.gz' ? v1 : url.pathname === '/dl/v2.gz' ? v2 : null;
    res.writeHead(body ? 200 : 404).end(body ?? '');
  });
  const abs = (meta: { dumps: { sqlite: { url: string } } }) => ((meta.dumps.sqlite.url = server.url + meta.dumps.sqlite.url.replace(server.url, '')), meta);
  abs(state.meta as never);
  const dir = path.join(tmp, 'refresh');
  const data = new DataManager({ dataDir: dir, metaUrl: `${server.url}/v1/meta.json`, dump: null, refreshHours: 24, log: () => {} });
  afterAll(async () => {
    data.stop();
    await server.close();
  });
  const downloads = () => server.requests.filter((u) => u.pathname.startsWith('/dl/')).length;

  it('downloads, verifies and opens the dump meta.json names', async () => {
    await data.start();
    expect(data.status).toMatchObject({ dataVersion: '2026.01', lastError: null });
    expect((await data.client!.meta()).data_version).toBe('2026.01');
    expect(JSON.parse(readFileSync(path.join(dir, 'current.json'), 'utf8'))).toEqual({ file: 'courmap-2026.01.sqlite', data_version: '2026.01' });
  });

  it('does not download again while data_version is unchanged', async () => {
    const before = downloads();
    await data.check();
    expect(downloads()).toBe(before);
  });

  it('keeps the working dump when the checksum does not match', async () => {
    state.meta = abs({ data_version: '2026.02', dumps: { tag: 'data-2026.02', sqlite: { url: '/dl/v2.gz', sha256: sha(v1) } } } as never);
    await data.check();
    expect(data.status.dataVersion).toBe('2026.01');
    expect(data.status.lastError).toMatch(/^checksum mismatch for v2\.gz/);
    expect((await data.client!.meta()).data_version).toBe('2026.01');
    expect(readdirSync(dir).sort()).toEqual(['courmap-2026.01.sqlite', 'current.json']);
  });

  it('swaps to a new version atomically and removes the old dump', async () => {
    const old = data.client!;
    state.meta = abs({ data_version: '2026.02', dumps: { tag: 'data-2026.02', sqlite: { url: '/dl/v2.gz', sha256: sha(v2) } } } as never);
    await data.check();
    expect(data.status).toMatchObject({ dataVersion: '2026.02', lastError: null });
    expect(data.client).not.toBe(old);
    expect((await data.client!.resolve('[Other] Split Show - 17')).data_version).toBe('2026.02');
    expect(readdirSync(dir).sort()).toEqual(['courmap-2026.02.sqlite', 'current.json']);
  });

  it('reopens the last dump after a restart, before any network', async () => {
    const again = new DataManager({ dataDir: dir, metaUrl: 'http://127.0.0.1:9/unreachable', dump: null, refreshHours: 24, log: () => {} });
    await again.start();
    expect(again.status.dataVersion).toBe('2026.02');
    expect(again.status.lastError).toMatch(/fetch failed|ECONNREFUSED/);
    again.stop();
  });

  it('reports meta.json without a dump (the release workflow in dry run)', async () => {
    const fresh = new DataManager({ dataDir: path.join(tmp, 'fresh'), metaUrl: `${server.url}/v1/meta.json`, dump: null, refreshHours: 24, log: () => {} });
    state.meta = { data_version: '2026.03', dumps: null };
    await fresh.start();
    expect(fresh.client).toBeNull();
    expect(fresh.status.lastError).toBe('meta.json for 2026.03 names no dump yet');
    expect(existsSync(path.join(tmp, 'fresh', 'current.json'))).toBe(false);
    fresh.stop();
  });
});

describe('scene numbering', async () => {
  // Simple Show as an XEM-mapped series: TVDB S01E03 is scene S02E01, and TVDB S01E05 has no
  // scene number while S01E05 is another episode's scene number.
  const scene = [
    {
      ...SONARR_SERIES[1]!,
      useSceneNumbering: true,
      episodes: Array.from({ length: 12 }, (_, i) => ({ seasonNumber: 1, episodeNumber: i + 1, ...(i + 1 === 3 && { sceneSeasonNumber: 2, sceneEpisodeNumber: 1 }), ...(i + 1 === 9 && { sceneSeasonNumber: 1, sceneEpisodeNumber: 5 }) })),
    },
  ];
  const sonarrServer = await fakeSonarr(scene);
  const sonarr = new SonarrClient({ url: sonarrServer.url, apiKey: 'sonarr-key', refreshMinutes: 60 });
  await sonarr.refresh();
  const data = new DataManager({ dataDir: path.join(tmp, 'scene'), metaUrl: 'unused', dump: await fixtureDump('2026.01'), refreshHours: 24 });
  await data.start();
  const rewriter = new Rewriter(data, sonarr);
  afterAll(async () => {
    data.stop();
    await sonarrServer.close();
  });

  it('writes the scene number Sonarr will read for a scene-numbered series', async () => {
    expect(await rewriter.rewrite('[Other] Simple Show - 03 [1080p]')).toMatchObject({ kind: 'rewritten', title: 'Simple Show S02E01 [1080p] [Other]' });
    expect(await rewriter.rewrite('[Other] Simple Show - 04 [1080p]')).toMatchObject({ kind: 'rewritten', title: 'Simple Show S01E04 [1080p] [Other]' });
  });

  it('passes through when the TVDB number is another episode scene number', async () => {
    expect(await rewriter.rewrite('[Other] Simple Show - 05 [1080p]')).toMatchObject({ kind: 'pass', reason: 'scene-conflict' });
  });
});

describe('config', () => {
  it('reads indexers and Sonarr from the environment over the YAML file', () => {
    const yaml = 'port: 8000\nsonarr:\n  url: http://file-sonarr:8989\n  api_key: k1\nindexers:\n  - { name: nyaa, url: "http://prowlarr:9696/1/api" }\n';
    const c = loadConfig({ COURMAP_CONFIG: '/x.yaml', SONARR_URL: 'http://sonarr:8989/', INDEXER_ANIME_TOSHO_URL: 'http://prowlarr:9696/2/api', INDEXER_ANIME_TOSHO_APIKEY: 'p2' }, () => yaml);
    expect(c.port).toBe(8000);
    expect(c.sonarr).toEqual({ url: 'http://sonarr:8989', apiKey: 'k1', refreshMinutes: 60 });
    expect(c.indexers).toEqual([
      { name: 'anime-tosho', url: 'http://prowlarr:9696/2/api', apikey: 'p2' },
      { name: 'nyaa', url: 'http://prowlarr:9696/1/api' },
    ]);
    expect(c.metaUrl).toBe('https://github.com/courmap/courmap/releases/latest/download/meta.json');
  });

  it('rejects an indexer URL without a scheme', () => {
    expect(() => loadConfig({ INDEXER_X_URL: 'prowlarr:9696' }, () => null)).toThrow(/must start with http/);
  });
});

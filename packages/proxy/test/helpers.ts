import { mkdtempSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile, validate } from '@courmap/builder';
import type { SonarrEpisode, SonarrSeries } from '../src/sonarr.js';

export const tmp = mkdtempSync(path.join(tmpdir(), 'courmap-proxy-'));
const fixture = fileURLToPath(new URL('../../../tests/conformance/data/', import.meta.url));

/** The conformance fixture compiled to a dump with the given data_version. */
export async function fixtureDump(dataVersion: string, file = path.join(tmp, `fixture-${dataVersion}.sqlite`)): Promise<string> {
  const v = await validate(fixture);
  compile(v.records!, v.checked, file, { dataVersion, builtAt: '2026-01-01T00:00:00.000Z', gitSha: 'test' });
  return file;
}

export interface FakeServer {
  url: string;
  requests: URL[];
  close(): Promise<void>;
}

export async function serve(handler: (url: URL, res: ServerResponse, req: IncomingMessage) => void | Promise<void>): Promise<FakeServer> {
  const requests: URL[] = [];
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://fake');
    requests.push(url);
    void Promise.resolve(handler(url, res, req)).catch((err: Error) => res.writeHead(500).end(err.message));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, requests, close: () => new Promise((r) => server.close(() => r())) };
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** The user's Sonarr: four of the fixture's TVDB shows, with episodes as Sonarr lists them. */
export const SONARR_SERIES: (SonarrSeries & { episodes: SonarrEpisode[] })[] = [
  { id: 1, title: 'Split Show', tvdbId: 5002, seriesType: 'anime', useSceneNumbering: false, episodes: range(1, 24).map((e) => ({ seasonNumber: 1, episodeNumber: e, absoluteEpisodeNumber: e })) },
  { id: 2, title: 'Simple Show', tvdbId: 5001, seriesType: 'standard', useSceneNumbering: false, episodes: range(1, 12).map((e) => ({ seasonNumber: 1, episodeNumber: e })) },
  {
    id: 3,
    title: 'Long Runner',
    tvdbId: 5005,
    seriesType: 'anime',
    useSceneNumbering: false,
    episodes: [...range(1, 50).map((e) => ({ seasonNumber: 1, episodeNumber: e, absoluteEpisodeNumber: e })), ...range(1, 100).map((e) => ({ seasonNumber: 2, episodeNumber: e, absoluteEpisodeNumber: 50 + e }))],
  },
  { id: 4, title: 'Specials Show', tvdbId: 5004, seriesType: 'standard', useSceneNumbering: false, episodes: [...range(1, 13).map((e) => ({ seasonNumber: 1, episodeNumber: e })), { seasonNumber: 0, episodeNumber: 5 }, { seasonNumber: 0, episodeNumber: 6 }] },
];

export function fakeSonarr(series = SONARR_SERIES, apiKey = 'sonarr-key'): Promise<FakeServer> {
  return serve((url, res, req) => {
    if (req.headers['x-api-key'] !== apiKey) return void res.writeHead(401).end();
    if (url.pathname === '/api/v3/series') return void res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(series.map(({ episodes: _e, ...s }) => s)));
    if (url.pathname === '/api/v3/episode') {
      const s = series.find((x) => x.id === Number(url.searchParams.get('seriesId')));
      return void res.writeHead(s ? 200 : 404, { 'Content-Type': 'application/json' }).end(JSON.stringify(s?.episodes ?? []));
    }
    res.writeHead(404).end();
  });
}

export function rssItem(title: string, i: number): string {
  const esc = title.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<item>
      <title>${esc}</title>
      <guid>https://indexer.example/t/${encodeURIComponent(title)}</guid>
      <link>https://indexer.example/dl/${i}.torrent</link>
      <enclosure url="https://indexer.example/dl/${i}.torrent" length="1000" type="application/x-bittorrent" />
      <torznab:attr name="seeders" value="${10 + i}" />
      <torznab:attr name="category" value="5070" />
    </item>`;
}

export const rss = (titles: string[], offset = 0) => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:torznab="http://torznab.com/schemas/2015/feed">
  <channel>
    <title>Fake Prowlarr</title>
    ${titles.map((t, i) => rssItem(t, offset + i)).join('\n    ')}
  </channel>
</rss>
`;

export const CAPS = `<?xml version="1.0" encoding="UTF-8"?>
<caps>
  <server title="Fake Prowlarr" />
  <searching>
    <search available="yes" supportedParams="q" />
    <tv-search available="yes" supportedParams="q" />
  </searching>
  <categories><category id="5070" name="TV/Anime" /></categories>
</caps>
`;

/** A fake Prowlarr anime indexer: RSS for no query, and text search results keyed by the query. */
export function fakeProwlarr(rssTitles: string[], searches: Record<string, string[]>): Promise<FakeServer> {
  return serve((url, res) => {
    if (url.searchParams.get('apikey') !== 'prowlarr-key') return void res.writeHead(401, { 'Content-Type': 'application/xml' }).end('<error code="100" description="Invalid API Key" />');
    const t = url.searchParams.get('t');
    if (t === 'caps') return void res.writeHead(200, { 'Content-Type': 'application/xml' }).end(CAPS);
    const q = url.searchParams.get('q');
    const titles = q === null || q === '' ? rssTitles : (searches[q.toLowerCase()] ?? []);
    res.writeHead(200, { 'Content-Type': 'application/rss+xml' }).end(rss(titles, q ? 100 : 0));
  });
}

/**
 * Sonarr's own parsing of a rewritten title, ported from its source (Parser.cs "Episodes with a
 * title" and "Season only releases", ReleaseGroupParser's bracketed-group-at-the-end rule;
 * develop 2b39049ee6). The repeated named group is renamed for JavaScript.
 */
export function sonarrParse(title: string): { title: string; season: number; episodes: number[]; fullSeason: boolean; group: string | null } | null {
  const episode = /^(?<title>.+?)(?:(?:[-_\W](?<![()[!]))+S?(?<season>(?<!\d+)(?:\d{1,2})(?!\d+))(?:[ex]|\W[ex]){1,2}(?<episode>\d{2,3}(?!\d+))(?:(?:-|[ex]|\W[ex]|_){1,2}(?<episode2>\d{2,3}(?!\d+)))*)(?:[-_. ]|$)/i.exec(title);
  const seasonOnly = /^(?<title>.+?)[-_. ]+?(?:S|Season|Saison|Series|Stagione)[-_. ]?(?<season>\d{1,2}(?![-_. ]?\d+))(?:[-_. ]|$)+/i.exec(title);
  const group = (/[-._ ]\[(?<g>[A-Za-zÀ-ÖØ-öø-ÿ0-9]+)\]$/.exec(title) ?? /-(?<g>[A-Za-zÀ-ÖØ-öø-ÿ0-9]+(?:-[A-Za-zÀ-ÖØ-öø-ÿ0-9]+)?)$/.exec(title))?.groups?.g ?? null;
  if (episode?.groups) {
    const g = episode.groups;
    const first = Number(g.episode);
    const last = g.episode2 ? Number(g.episode2) : first;
    return { title: g.title!.trim(), season: Number(g.season), episodes: Array.from({ length: last - first + 1 }, (_, i) => first + i), fullSeason: false, group };
  }
  if (seasonOnly?.groups) return { title: seasonOnly.groups.title!.trim(), season: Number(seasonOnly.groups.season), episodes: [], fullSeason: true, group };
  return null;
}

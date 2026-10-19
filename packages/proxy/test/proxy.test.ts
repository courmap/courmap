import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { DataManager } from '../src/data.js';
import { createProxyServer } from '../src/server.js';
import { SonarrClient } from '../src/sonarr.js';
import { Stats } from '../src/stats.js';
import { items } from '../src/torznab.js';
import { fakeProwlarr, fakeSonarr, fixtureDump, sonarrParse, tmp } from './helpers.js';

const RSS = [
  '[Other] Split Show - 17 [1080p] [ABCD1234].mkv', // absolute 17 is Part 2 episode 5, TVDB S01E17
  '[Other] Simple Show - 01-12 [BD 1080p] [Batch]', // the whole TVDB season: a season pack
  '[Other] Simple Show - 03-05 [1080p]', // a range inside the season
  '[Other] Long Runner - 45-55 [1080p]', // canonical 45-55 crosses TVDB seasons 1 and 2
  'Long Runner S02E70 1080p WEB H264-GRP', // canonical 120, TVDB S02E70
  '[Erai-raws] Specials Show - 12 [1080p]', // one canonical episode is TVDB 12 and 13
  '[Other] Unknown Thing - 03 [1080p]', // unmatched
  '[Other] Twin Title - 01 [1080p]', // ambiguous
  '[Other] Tie Show - 01 [1080p]', // resolved, but no TVDB ID
];
const SEARCHES = {
  'split show part 2 05': ['[Other] Split Show Part 2 - 05 [720p]'],
  'split show 17': ['[Other] Split Show - 17 [1080p] [ABCD1234].mkv', '[Other] Split Show - 05 [1080p]'],
  'split show': ['[Other] Split Show - 01-12 [BD 1080p] [Batch]'],
};

describe('Sonarr Torznab proxy', async () => {
  const dump = await fixtureDump('2026.01');
  const prowlarr = await fakeProwlarr(RSS, SEARCHES);
  const sonarrServer = await fakeSonarr();
  const data = new DataManager({ dataDir: path.join(tmp, 'd1'), metaUrl: 'unused', dump, refreshHours: 24 });
  await data.start();
  const sonarr = new SonarrClient({ url: sonarrServer.url, apiKey: 'sonarr-key', refreshMinutes: 60 });
  await sonarr.start();
  const stats = new Stats(null);
  const server = createProxyServer({ indexers: [{ name: 'nyaa', url: `${prowlarr.url}/1/api` }], data, sonarr, stats, version: 'test', timeoutMs: 5000 });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  afterAll(async () => {
    server.close();
    data.stop();
    await prowlarr.close();
    await sonarrServer.close();
  });
  beforeEach(() => void (prowlarr.requests.length = 0));

  /** What Sonarr gets back: each item's title and tvdbid attribute. */
  const get = async (query: string) => {
    const res = await fetch(`${base}/nyaa/api?apikey=prowlarr-key&${query}`);
    const body = await res.text();
    return {
      status: res.status,
      body,
      items: items(body).map((i) => ({ title: i.title, tvdbid: /name="tvdbid" value="(\d+)"/.exec(i.xml)?.[1] ?? null })),
    };
  };

  it('advertises the TV search parameters it translates', async () => {
    const r = await get('t=caps');
    expect(r.body).toContain('<tv-search available="yes" supportedParams="q,season,ep,tvdbid" />');
    expect(r.body).toContain('<category id="5070"');
  });

  it('rewrites RSS results it resolves and passes the rest through unchanged', async () => {
    const r = await get('t=tvsearch&cat=5070');
    expect(r.items).toEqual([
      { title: 'Split Show S01E17 [1080p] [ABCD1234] [Other]', tvdbid: '5002' },
      { title: 'Simple Show S01 [BD 1080p] [Other]', tvdbid: '5001' },
      { title: 'Simple Show S01E03-E05 [1080p] [Other]', tvdbid: '5001' },
      { title: '[Other] Long Runner - 45-55 [1080p]', tvdbid: null },
      { title: expect.stringMatching(/^Long Runner S02E70 1080p .*\[GRP\]$/), tvdbid: '5005' },
      { title: 'Specials Show S01E12-E13 [1080p] -Erai-raws', tvdbid: '5004' },
      { title: '[Other] Unknown Thing - 03 [1080p]', tvdbid: null },
      { title: '[Other] Twin Title - 01 [1080p]', tvdbid: null },
      { title: '[Other] Tie Show - 01 [1080p]', tvdbid: null },
    ]);
    // Everything else in each item reaches Sonarr unchanged.
    expect(r.body).toContain('<torznab:attr name="seeders" value="10" />');
    expect(r.body).toContain('<enclosure url="https://indexer.example/dl/0.torrent"');
  });

  it('writes titles Sonarr parses as the right episode, season pack and group', async () => {
    const titles = (await get('t=tvsearch')).items.filter((i) => i.tvdbid).map((i) => sonarrParse(i.title));
    expect(titles[0]).toEqual({ title: 'Split Show', season: 1, episodes: [17], fullSeason: false, group: 'Other' });
    expect(titles[1]).toEqual({ title: 'Simple Show', season: 1, episodes: [], fullSeason: true, group: 'Other' });
    expect(titles[2]).toMatchObject({ season: 1, episodes: [3, 4, 5] });
    expect(titles[3]).toMatchObject({ title: 'Long Runner', season: 2, episodes: [70], group: 'GRP' });
    expect(titles[4]).toMatchObject({ season: 1, episodes: [12, 13], group: 'Erai-raws' });
  });

  it('counts hit rates and logs unresolved names locally', async () => {
    const s = stats.of('nyaa');
    expect(s.rewritten).toBeGreaterThan(0);
    expect(s.passed).toMatchObject({ 'spans-seasons': expect.any(Number), unmatched: expect.any(Number), ambiguous: expect.any(Number), 'no-tvdb': expect.any(Number) });
    expect(stats.unresolvedList().map((e) => [e.name, e.status])).toEqual(
      expect.arrayContaining([
        ['[Other] Unknown Thing - 03 [1080p]', 'unmatched'],
        ['[Other] Twin Title - 01 [1080p]', 'ambiguous'],
      ]),
    );
    const page = await (await fetch(base)).text();
    expect(page).toContain('2026.01');
    expect(page).toContain('Copy as GitHub issue');
    expect(page).toContain('| `[Other] Unknown Thing - 03 [1080p]` |');
  });

  it('check: a Sonarr search for TVDB S01E17 of a split-cour show finds the absolute-numbered release, rewritten for Sonarr', async () => {
    const r = await get('t=tvsearch&tvdbid=5002&season=1&ep=17&cat=5070');
    // Upstream got the text searches anime indexers understand: Part 2's own number and the fansub absolute number.
    expect(prowlarr.requests.map((u) => [u.searchParams.get('t'), u.searchParams.get('q'), u.searchParams.get('cat')])).toEqual([
      ['search', 'Split Show Part 2 05', '5070'],
      ['search', 'Split Show 17', '5070'],
    ]);
    const grab = r.items.find((i) => i.title.includes('ABCD1234'))!;
    expect(grab).toEqual({ title: 'Split Show S01E17 [1080p] [ABCD1234] [Other]', tvdbid: '5002' });
    expect(sonarrParse(grab.title)).toEqual({ title: 'Split Show', season: 1, episodes: [17], fullSeason: false, group: 'Other' });
    // Part 2's own numbering lands on the same TVDB episode; the decoy is rewritten to the episode it really is.
    expect(r.items.map((i) => i.title)).toEqual(['Split Show S01E17 [720p] [Other]', 'Split Show S01E17 [1080p] [ABCD1234] [Other]', 'Split Show S01E05 [1080p] [Other]']);
  });

  it('translates an anime absolute search and a plain title search the same way', async () => {
    const byAbsolute = await get('t=tvsearch&tvdbid=5002&q=17');
    expect(prowlarr.requests.map((u) => u.searchParams.get('q'))).toEqual(['Split Show Part 2 05', 'Split Show 17']);
    prowlarr.requests.length = 0;
    const byTitle = await get('t=search&q=Split%20Show%2017');
    expect(prowlarr.requests.map((u) => u.searchParams.get('q'))).toEqual(['Split Show Part 2 05', 'Split Show 17']);
    expect(byTitle.items).toEqual(byAbsolute.items);
  });

  it('searches a season by the titles of the works in it', async () => {
    const r = await get('t=tvsearch&tvdbid=5002&season=1');
    expect(prowlarr.requests.map((u) => u.searchParams.get('q'))).toEqual(['Split Show', 'Split Show Part 2']);
    // Part 1's batch is only half of TVDB season 1, so it becomes a range, not a pack.
    expect(r.items).toEqual([{ title: 'Split Show S01E01-E12 [BD 1080p] [Other]', tvdbid: '5002' }]);
  });

  it('forwards searches it cannot translate unchanged', async () => {
    await get('t=search&q=Something%20Else');
    expect(prowlarr.requests.map((u) => u.search)).toEqual(['?apikey=prowlarr-key&t=search&q=Something+Else']);
  });

  it('passes upstream errors through', async () => {
    const res = await fetch(`${base}/nyaa/api?apikey=wrong&t=search&q=x`);
    expect(res.status).toBe(401);
    expect(await res.text()).toContain('Invalid API Key');
  });
});

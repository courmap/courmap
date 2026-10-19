import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { DataManager } from '../src/data.js';
import { NAMESPACE, detectProtocol, emptyFeed, ensureNamespace, items, rewriteCaps, rewriteItem } from '../src/feed.js';
import { createProxyServer } from '../src/server.js';
import { SonarrClient } from '../src/sonarr.js';
import { Stats } from '../src/stats.js';
import { statusHtml } from '../src/status.js';
import { CAPS, attrNamespace, fakeNewznab, fakeProwlarr, fakeSonarr, fixtureDump, newznabItem, newznabRss, NEWZNAB_CAPS, rss, sonarrCapsFailure, sonarrParse, tmp } from './helpers.js';

// Newznab (usenet) support, issue #30: the same resolving, rewriting and search translation as
// Torznab, with the protocol's own attribute namespace and everything else passed on untouched.

const RSS = [
  '[Other] Split Show - 17 [1080p] [ABCD1234].mkv',
  '[Other] Simple Show - 01-12 [BD 1080p] [Batch]',
  'Long Runner S02E70 1080p WEB H264-GRP',
  '[Other] Unknown Thing - 03 [1080p]', // unmatched
  '[Other] Twin Title - 01 [1080p]', // ambiguous
];
const SEARCHES = {
  'split show part 2 05': ['[Other] Split Show Part 2 - 05 [720p]'],
  'split show 17': ['[Other] Split Show - 17 [1080p] [ABCD1234].mkv', '[Other] Split Show - 05 [1080p]'],
};

/** What an item looks like once the proxy's own changes (title, tvdbid attribute) are taken out. */
const untouched = (itemXml: string) =>
  itemXml
    .replace(/<title\b[^>]*>[\s\S]*?<\/title>/, '')
    .replace(/\s*<(?:torznab|newznab):attr\s+name="tvdbid"\s+value="[^"]*"\s*\/>/g, '')
    .replace(/\s+/g, ' ')
    .trim();

describe('feed handling for both protocols', () => {
  const nzb = newznabItem('Show S01E01', 1);

  it('detects the protocol from a feed, items first, then the namespaces it declares', () => {
    expect(detectProtocol(newznabRss(['A']))).toBe('newznab');
    expect(detectProtocol(rss(['A']))).toBe('torznab');
    // Evidence in the item wins over a root that declares both namespaces.
    const both = (inner: string) => `<rss xmlns:torznab="${NAMESPACE.torznab}" xmlns:newznab="${NAMESPACE.newznab}"><channel>${inner}</channel></rss>`;
    expect(detectProtocol(both(nzb))).toBe('newznab');
    expect(detectProtocol(both('<item><title>x</title><enclosure url="u" type="application/x-bittorrent"/></item>'))).toBe('torznab');
    expect(detectProtocol(both('<item><title>x</title><link>magnet:?xt=urn:btih:abc</link></item>'))).toBe('torznab');
    // Empty feeds fall back to the declared namespace; with no evidence at all, there is no answer.
    expect(detectProtocol(emptyFeed('x', 'newznab'))).toBe('newznab');
    expect(detectProtocol(emptyFeed('x', 'torznab'))).toBe('torznab');
    expect(detectProtocol(both(''))).toBeNull();
    expect(detectProtocol('<rss><channel><item><title>x</title></item></channel></rss>')).toBeNull();
    // Caps carry no marker, which is why the protocol is learned from results.
    expect(detectProtocol(NEWZNAB_CAPS)).toBeNull();
    expect(detectProtocol(CAPS)).toBeNull();
  });

  it('writes the tvdbid attribute in the protocol namespace and replaces one of either prefix', () => {
    const withTorznab = nzb.replace('</item>', '  <torznab:attr name="tvdbid" value="1"/>\n    </item>');
    const withNewznab = nzb.replace('</item>', '  <newznab:attr name="tvdbid" value="2"/>\n    </item>');
    for (const [src, protocol] of [[nzb, 'newznab'], [withTorznab, 'newznab'], [withNewznab, 'newznab'], [withNewznab, 'torznab']] as const) {
      const out = rewriteItem(src, 'New Title', 4242, protocol);
      expect(out.match(/name="tvdbid"/g)).toHaveLength(1);
      expect(out).toContain(`<${protocol}:attr name="tvdbid" value="4242" />`);
      expect(out).toContain('<title>New Title</title>');
    }
    expect(rewriteItem(nzb, 'T', 1)).toContain('<torznab:attr name="tvdbid"'); // Torznab is the default
  });

  it('declares only the namespace a rewritten feed needs', () => {
    const plain = '<rss version="2.0"><channel></channel></rss>';
    expect(ensureNamespace(plain, 'newznab')).toContain(`xmlns:newznab="${NAMESPACE.newznab}"`);
    expect(ensureNamespace(plain)).toContain(`xmlns:torznab="${NAMESPACE.torznab}"`);
    const declared = newznabRss(['A']);
    expect(ensureNamespace(declared, 'newznab')).toBe(declared);
    expect(emptyFeed('x', 'newznab')).toContain(`xmlns:newznab="${NAMESPACE.newznab}"`);
  });

  it('rewrites caps for Sonarr the same way for both protocols, whatever the tv-search element looks like', () => {
    // Real Newznab caps: the TV search lacks nothing but its API key, yet Sonarr's test needs it to ask by ID.
    expect(sonarrCapsFailure(NEWZNAB_CAPS)).toBeNull();
    const caps = rewriteCaps(NEWZNAB_CAPS);
    expect(caps).toContain('<tv-search available="yes" supportedParams="q,season,ep,tvdbid" />');
    expect(caps).toContain('<limits max="100" default="50"/>');
    expect(caps).toContain('<subcat id="5070" name="Anime"/>');
    expect(caps).toContain('<movie-search available="yes" supportedParams="q,imdbid"/>');
    expect(caps.match(/<tv-search/g)).toHaveLength(1);
    expect(sonarrCapsFailure(caps)).toBeNull();
    // A TV search with a closing tag, or children, leaves no stray end tag behind.
    for (const variant of ['<tv-search available="yes" supportedParams="q"></tv-search>', '<tv-search available="yes" supportedParams="q">\n<note/>\n</tv-search>']) {
      const out = rewriteCaps(NEWZNAB_CAPS.replace(/<tv-search[^>]*\/>/, variant));
      expect(out).not.toContain('</tv-search>');
      expect(sonarrCapsFailure(out)).toBeNull();
    }
    // No TV search at all, or no text search: the proxy adds what Sonarr's test looks for.
    const bare = '<?xml version="1.0"?>\n<caps>\n  <limits max="100" default="100"/>\n  <searching>\n    <audio-search available="yes" supportedParams="q"/>\n  </searching>\n</caps>';
    expect(sonarrCapsFailure(bare)).toBe('search parameters not supported');
    expect(sonarrCapsFailure(rewriteCaps(bare))).toBeNull();
  });
});

describe('INDEXER_<NAME>_TYPE', () => {
  const cfg = (env: Record<string, string>, yaml?: string) => loadConfig({ COURMAP_CONFIG: '/x.yaml', ...env }, () => yaml ?? null).indexers;

  it('sets the protocol from the environment or the YAML file, and leaves it unset otherwise', () => {
    expect(cfg({ INDEXER_GEEK_URL: 'http://j/api', INDEXER_GEEK_TYPE: 'newznab', INDEXER_NYAA_URL: 'http://p/1/api' })).toEqual([
      { name: 'geek', url: 'http://j/api', type: 'newznab' },
      { name: 'nyaa', url: 'http://p/1/api' },
    ]);
    expect(cfg({}, 'indexers:\n  - { name: geek, url: "http://j/api", type: Newznab }\n  - { name: nyaa, url: "http://p/1/api", type: torznab }\n')).toEqual([
      { name: 'geek', url: 'http://j/api', type: 'newznab' },
      { name: 'nyaa', url: 'http://p/1/api', type: 'torznab' },
    ]);
    // An environment entry replaces the file entry of the same name, as before.
    expect(cfg({ INDEXER_GEEK_URL: 'http://env/api', INDEXER_GEEK_TYPE: 'torznab' }, 'indexers:\n  - { name: geek, url: "http://file/api", type: newznab }\n')).toEqual([{ name: 'geek', url: 'http://env/api', type: 'torznab' }]);
  });

  it('rejects any other value, naming the indexer and the choices', () => {
    expect(() => cfg({ INDEXER_GEEK_URL: 'http://j/api', INDEXER_GEEK_TYPE: 'usenet' })).toThrow('indexer "geek": type must be torznab or newznab, not "usenet"');
  });
});

describe('Sonarr Newznab proxy', async () => {
  const dump = await fixtureDump('2026.01');
  const usenet = await fakeNewznab(RSS, SEARCHES, { tvdbAttr: '\n      <newznab:attr name="tvdbid" value="999"/>' });
  const sonarrServer = await fakeSonarr();
  const data = new DataManager({ dataDir: path.join(tmp, 'nzb-d1'), metaUrl: 'unused', dump, refreshHours: 24 });
  await data.start();
  const sonarr = new SonarrClient({ url: sonarrServer.url, apiKey: 'sonarr-key', refreshMinutes: 60 });
  await sonarr.start();
  const stats = new Stats(null);
  const logs: string[] = [];
  const server = createProxyServer({
    indexers: [{ name: 'geek', url: `${usenet.url}/api`, type: 'newznab' }],
    data,
    sonarr,
    stats,
    version: 'test',
    timeoutMs: 5000,
    log: (l) => logs.push(l),
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  afterAll(async () => {
    server.close();
    data.stop();
    await usenet.close();
    await sonarrServer.close();
  });
  beforeEach(() => void (usenet.requests.length = 0));

  const get = async (query: string, indexer = 'geek', key = 'usenet-key') => {
    const res = await fetch(`${base}/${indexer}/api?apikey=${key}&${query}`);
    const body = await res.text();
    return { status: res.status, body, list: items(body), items: items(body).map((i) => ({ title: i.title, tvdbid: /name="tvdbid" value="(\d+)"/.exec(i.xml)?.[1] ?? null })) };
  };

  it('serves caps Sonarr accepts as a Newznab indexer, with the upstream caps otherwise intact', async () => {
    const r = await get('t=caps');
    expect(r.status).toBe(200);
    expect(sonarrCapsFailure(r.body)).toBeNull();
    expect(r.body).toContain('<tv-search available="yes" supportedParams="q,season,ep,tvdbid" />');
    expect(r.body).toContain('<server version="1.0" title="Fake Usenet"');
    expect(r.body).toContain('<limits max="100" default="50"/>');
    expect(r.body).toContain('<subcat id="5070" name="Anime"/>');
  });

  it('rewrites RSS results it resolves and passes the rest through unchanged', async () => {
    const r = await get('t=tvsearch&cat=5070&extended=1');
    expect(r.items).toEqual([
      { title: 'Split Show S01E17 [1080p] [ABCD1234] [Other]', tvdbid: '5002' },
      { title: 'Simple Show S01 [BD 1080p] [Other]', tvdbid: '5001' },
      { title: expect.stringMatching(/^Long Runner S02E70 1080p .*\[GRP\]$/), tvdbid: '5005' },
      // Not resolved: the title, and the upstream's own tvdbid attribute, reach Sonarr exactly as they were.
      { title: '[Other] Unknown Thing - 03 [1080p]', tvdbid: '999' },
      { title: '[Other] Twin Title - 01 [1080p]', tvdbid: '999' },
    ]);
    const parsed = r.items.slice(0, 3).map((i) => sonarrParse(i.title));
    expect(parsed[0]).toEqual({ title: 'Split Show', season: 1, episodes: [17], fullSeason: false, group: 'Other' });
    expect(parsed[1]).toMatchObject({ title: 'Simple Show', season: 1, fullSeason: true });
    expect(parsed[2]).toMatchObject({ title: 'Long Runner', season: 2, episodes: [70], group: 'GRP' });
  });

  it('writes the tvdbid where Sonarr reads it: newznab:attr, bound to the Newznab namespace', async () => {
    const r = await get('t=tvsearch');
    for (const i of r.list.slice(0, 3)) {
      expect(i.xml).not.toContain('torznab:attr');
      expect(attrNamespace(r.body, i.xml, 'tvdbid')).toBe(NAMESPACE.newznab);
      expect(i.xml.match(/name="tvdbid"/g)).toHaveLength(1); // the upstream's own was replaced
    }
    expect(r.body).not.toContain('xmlns:torznab');
  });

  it('never touches an enclosure, a download link or a protocol attribute', async () => {
    const r = await get('t=tvsearch');
    const upstream = items(newznabRss(RSS, 0, '\n      <newznab:attr name="tvdbid" value="999"/>'));
    expect(r.list).toHaveLength(upstream.length);
    r.list.forEach((item, i) => expect(untouched(item.xml)).toBe(untouched(upstream[i]!.xml)));
    // The download URL carries the indexer's own API key and still points at the indexer.
    expect(r.list[0]!.xml).toMatch(/<enclosure url="https:\/\/usenet\.example\/api\?t=get&amp;id=\d+&amp;apikey=usenet-key" length="734003200" type="application\/x-nzb"\/>/);
    expect(r.list[0]!.xml).toMatch(/<link>https:\/\/usenet\.example\/api\?t=get&amp;id=\d+&amp;apikey=usenet-key<\/link>/);
    for (const attr of ['<newznab:attr name="size" value="734003200"/>', '<newznab:attr name="grabs" value="3"/>', '<newznab:attr name="usenetdate" value="Mon, 19 Oct 2026 11:58:00 +0000"/>', '<newznab:attr name="category" value="5070"/>']) {
      expect(r.list[0]!.xml).toContain(attr);
    }
  });

  it('translates a Sonarr TV search by TVDB ID into the text searches indexers understand', async () => {
    const r = await get('t=tvsearch&tvdbid=5002&season=1&ep=17&cat=5070&extended=1');
    expect(usenet.requests.map((u) => [u.searchParams.get('t'), u.searchParams.get('q'), u.searchParams.get('cat'), u.searchParams.get('extended'), u.searchParams.get('apikey')])).toEqual([
      ['search', 'Split Show Part 2 05', '5070', '1', 'usenet-key'],
      ['search', 'Split Show 17', '5070', '1', 'usenet-key'],
    ]);
    expect(r.items.map((i) => i.title)).toEqual(['Split Show S01E17 [720p] [Other]', 'Split Show S01E17 [1080p] [ABCD1234] [Other]', 'Split Show S01E05 [1080p] [Other]']);
    expect(r.items.every((i) => i.tvdbid === '5002')).toBe(true);
    expect(r.list.every((i) => attrNamespace(r.body, i.xml, 'tvdbid') === NAMESPACE.newznab)).toBe(true);
  });

  it('forwards searches it cannot translate unchanged', async () => {
    await get('t=search&q=Something%20Else');
    expect(usenet.requests.map((u) => u.search)).toEqual(['?apikey=usenet-key&t=search&q=Something+Else']);
  });

  it('passes an indexer error document through as Sonarr expects it, with status 200', async () => {
    const r = await get('t=tvsearch', 'geek', 'wrong');
    expect(r.status).toBe(200);
    expect(r.body).toBe('<error code="100" description="Incorrect user credentials"/>');
    expect(stats.of('geek').upstreamErrors).toBeGreaterThan(0);
  });

  it('serves an empty feed in its own namespace when asked without a function', async () => {
    const res = await fetch(`${base}/geek/api`);
    const body = await res.text();
    expect(body).toContain(`xmlns:newznab="${NAMESPACE.newznab}"`);
    expect(body).not.toContain('torznab');
  });

  it('counts hits and logs unresolved names as it does for Torznab', () => {
    expect(stats.of('geek').rewritten).toBeGreaterThan(0);
    expect(stats.unresolvedList().map((e) => e.name)).toEqual(expect.arrayContaining(['[Other] Unknown Thing - 03 [1080p]', '[Other] Twin Title - 01 [1080p]']));
    expect(stats.of('geek').detected).toBe('newznab');
    expect(logs.filter((l) => l.includes('looks like'))).toEqual([]);
  });
});

describe('an indexer whose type is not set', async () => {
  const dump = await fixtureDump('2026.02');
  const usenet = await fakeNewznab(RSS, SEARCHES);
  const torrents = await fakeProwlarr(RSS, SEARCHES);
  const sonarrServer = await fakeSonarr();
  const data = new DataManager({ dataDir: path.join(tmp, 'nzb-d2'), metaUrl: 'unused', dump, refreshHours: 24 });
  await data.start();
  const sonarr = new SonarrClient({ url: sonarrServer.url, apiKey: 'sonarr-key', refreshMinutes: 60 });
  await sonarr.start();
  const stats = new Stats(null);
  const logs: string[] = [];
  // One indexer of each type on one proxy: geek is usenet with its type left to detection, nyaa is
  // torrents, and mislabeled is a usenet feed configured as torznab.
  const server = createProxyServer({
    indexers: [
      { name: 'geek', url: `${usenet.url}/api` },
      { name: 'nyaa', url: `${torrents.url}/1/api` },
      { name: 'mislabeled', url: `${usenet.url}/api`, type: 'torznab' },
    ],
    data,
    sonarr,
    stats,
    version: 'test',
    timeoutMs: 5000,
    log: (l) => logs.push(l),
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  afterAll(async () => {
    server.close();
    data.stop();
    await usenet.close();
    await torrents.close();
    await sonarrServer.close();
  });
  const get = async (indexer: string, key: string, query: string) => {
    const body = await (await fetch(`${base}/${indexer}/api?apikey=${key}&${query}`)).text();
    return { body, list: items(body) };
  };

  it('learns its protocol from the first results, after caps (which say nothing) have been served', async () => {
    expect(stats.of('geek').detected).toBeNull();
    const caps = await get('geek', 'usenet-key', 't=caps');
    expect(sonarrCapsFailure(caps.body)).toBeNull();
    expect(stats.of('geek').detected).toBeNull();
    // Before any results, the page says so.
    expect(statusHtml({ version: 't', data: data.status, sonarr: sonarr.status, stats, indexers: [{ name: 'geek' }] })).toContain('not known yet');
    const r = await get('geek', 'usenet-key', 't=tvsearch');
    expect(stats.of('geek').detected).toBe('newznab');
    expect(r.list[0]!.title).toBe('Split Show S01E17 [1080p] [ABCD1234] [Other]');
    expect(attrNamespace(r.body, r.list[0]!.xml, 'tvdbid')).toBe(NAMESPACE.newznab);
    expect(r.body).not.toContain('xmlns:torznab');
    expect(statusHtml({ version: 't', data: data.status, sonarr: sonarr.status, stats, indexers: [{ name: 'geek' }] })).toContain('newznab (detected)');
  });

  it('keeps a torrent indexer on the same proxy in the Torznab namespace', async () => {
    const r = await get('nyaa', 'prowlarr-key', 't=tvsearch');
    expect(stats.of('nyaa').detected).toBe('torznab');
    expect(r.list[0]!.title).toBe('Split Show S01E17 [1080p] [ABCD1234] [Other]');
    expect(attrNamespace(r.body, r.list[0]!.xml, 'tvdbid')).toBe(NAMESPACE.torznab);
    expect(r.body).not.toContain('newznab');
    // Its own attributes still reach Sonarr as they were.
    expect(r.list[0]!.xml).toContain('<torznab:attr name="seeders" value="10" />');
    expect(r.list[0]!.xml).toContain('type="application/x-bittorrent"');
    // The usenet indexer's feed is unaffected by the torrent one.
    expect(stats.of('geek').detected).toBe('newznab');
  });

  it('sticks with the configured type, warns once, and flags the page when the feed looks different', async () => {
    const r = await get('mislabeled', 'usenet-key', 't=tvsearch');
    expect(attrNamespace(r.body, r.list[0]!.xml, 'tvdbid')).toBe(NAMESPACE.torznab); // as configured
    await get('mislabeled', 'usenet-key', 't=tvsearch');
    expect(logs.filter((l) => l.startsWith('mislabeled: configured as torznab, but its feed looks like newznab'))).toHaveLength(1);
    const page = statusHtml({ version: 't', data: data.status, sonarr: sonarr.status, stats, indexers: [{ name: 'mislabeled', type: 'torznab' }] });
    expect(page).toContain('(feed looks like newznab)');
  });

  it('serves empty feeds in the namespace it has learned', async () => {
    const body = await (await fetch(`${base}/geek/api`)).text();
    expect(body).toContain(`xmlns:newznab="${NAMESPACE.newznab}"`);
    const unknown = await (await fetch(`${base}/nyaa/api`)).text();
    expect(unknown).toContain(`xmlns:torznab="${NAMESPACE.torznab}"`);
  });
});

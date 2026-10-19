/**
 * Minimal Torznab and Newznab (RSS) handling. The two share one format; Torznab adds torrent
 * attributes (seeders, peers, info hash, magnet URL) and Newznab the usenet ones (NZB enclosure,
 * size, grabs, usenet date). The proxy changes only each item's <title> and its tvdbid
 * attribute; everything else in the upstream response is passed on byte for byte, so whatever
 * the indexer adds (enclosures, download links, protocol attributes, categories) reaches Sonarr
 * unchanged.
 *
 * The protocol decides one thing: which attribute namespace Sonarr reads the tvdbid from.
 * Sonarr's Torznab parser only reads torznab:attr and its Newznab parser only newznab:attr
 * (docs/DECISIONS.md, "Newznab support").
 */

export type Protocol = 'torznab' | 'newznab';

export const PROTOCOLS: readonly Protocol[] = ['torznab', 'newznab'];

/** The attribute namespace of each protocol, as Sonarr's parsers expect it. */
export const NAMESPACE: Record<Protocol, string> = {
  torznab: 'http://torznab.com/schemas/2015/feed',
  newznab: 'http://www.newznab.com/DTD/2010/feeds/attributes/',
};

export const decodeXml = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

export const encodeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface FeedItem {
  title: string;
  /** guid, else link: identifies an item when results of several queries are merged. */
  key: string;
  xml: string;
}

const ITEM = /<item\b[^>]*>[\s\S]*?<\/item>/g;
const TITLE = /<title\b[^>]*>([\s\S]*?)<\/title>/;
/** An existing tvdbid attribute, whichever protocol's prefix it carries. */
const TVDB_ATTR = /\s*<(?:torznab|newznab):attr\s+name="tvdbid"\s+value="[^"]*"\s*\/>/g;

export function items(xml: string): FeedItem[] {
  return [...xml.matchAll(ITEM)].map((m) => {
    const x = m[0];
    const key = /<guid\b[^>]*>([\s\S]*?)<\/guid>/.exec(x)?.[1] ?? /<link\b[^>]*>([\s\S]*?)<\/link>/.exec(x)?.[1] ?? x;
    return { title: decodeXml(TITLE.exec(x)?.[1] ?? '').trim(), key: decodeXml(key).trim(), xml: x };
  });
}

/**
 * What a feed says about its own protocol, or null when it says nothing (an empty feed, or one
 * that declares neither). Evidence in the items comes first, since a feed may declare both
 * namespaces: an NZB enclosure or a newznab:attr means usenet, a torrent enclosure, a magnet link
 * or a torznab:attr means torrents. Then the namespaces the root declares.
 *
 * Caps responses carry no such marker (Sonarr's own caps parser reads none), so the protocol of
 * an indexer whose type is not set is learned from its first results.
 */
export function detectProtocol(xml: string): Protocol | null {
  const first = items(xml)[0]?.xml;
  if (first) {
    const nzb = /type="application\/x-nzb"|<newznab:attr\b/i.test(first);
    const torrent = /type="application\/x-bittorrent"|magnet:\?|<torznab:attr\b/i.test(first);
    if (nzb !== torrent) return nzb ? 'newznab' : 'torznab';
  }
  const root = /<rss\b[^>]*>/i.exec(xml)?.[0] ?? '';
  const declares = (p: Protocol) => root.includes(`xmlns:${p}=`);
  if (declares('newznab') !== declares('torznab')) return declares('newznab') ? 'newznab' : 'torznab';
  return null;
}

/** An item with a new title and tvdbid attribute (any existing tvdbid is replaced), in the protocol's namespace. */
export function rewriteItem(itemXml: string, title: string, tvdbId: number, protocol: Protocol = 'torznab'): string {
  const withTitle = itemXml.replace(TITLE, `<title>${encodeXml(title)}</title>`);
  return withTitle.replace(TVDB_ATTR, '').replace(/<\/item>$/, `  <${protocol}:attr name="tvdbid" value="${tvdbId}" />\n    </item>`);
}

/** Replaces the items of a feed, keeping the channel around them. A feed with no items gets them before </channel>. */
export function replaceItems(xml: string, newItems: string[]): string {
  // Items sit together in a channel, so the first one's offset is where the new block goes.
  const first = xml.search(ITEM);
  const stripped = xml.replace(ITEM, '');
  const at = first >= 0 ? first : stripped.lastIndexOf('</channel>');
  const insert = at >= 0 ? at : stripped.length;
  const block = newItems.map((i) => `${i.trim()}\n    `).join('');
  return `${stripped.slice(0, insert)}${block}${stripped.slice(insert)}`.replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, '\n');
}

/** Makes sure the feed declares the protocol's namespace, since rewritten items carry its attr. */
export function ensureNamespace(xml: string, protocol: Protocol = 'torznab'): string {
  if (new RegExp(`xmlns:${protocol}=`).test(xml)) return xml;
  return xml.replace(/<rss\b/, `<rss xmlns:${protocol}="${NAMESPACE[protocol]}"`);
}

/**
 * Upstream caps with the TV search parameters the proxy translates: Sonarr then sends tvdbid,
 * season and ep, which anime indexers cannot use but the proxy can. For both protocols, this is
 * what Sonarr's indexer test reads: text search ("q"), or a TV search with an ID or "q" plus
 * "season" and "ep".
 */
export function rewriteCaps(xml: string): string {
  const tv = '<tv-search available="yes" supportedParams="q,season,ep,tvdbid" />';
  let out = xml;
  // The element may be self-closing or have a closing tag; replace all of it either way.
  if (/<tv-search\b/.test(out)) out = out.replace(/<tv-search\b[^>]*?\/>|<tv-search\b[^>]*>[\s\S]*?<\/tv-search>/, tv);
  else out = out.replace(/<searching>/, `<searching>\n    ${tv}`);
  if (!/<search\b/.test(out)) out = out.replace(/<searching>/, '<searching>\n    <search available="yes" supportedParams="q" />');
  return out;
}

/** An empty feed, for errors Sonarr should see as "no results". */
export const emptyFeed = (title: string, protocol: Protocol = 'torznab') =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:${protocol}="${NAMESPACE[protocol]}">\n  <channel>\n    <title>${encodeXml(title)}</title>\n  </channel>\n</rss>\n`;

/** A Torznab or Newznab error document (the two share it). */
export const errorXml = (code: number, description: string) => `<?xml version="1.0" encoding="UTF-8"?>\n<error code="${code}" description="${encodeXml(description)}" />\n`;

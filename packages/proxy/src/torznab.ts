/**
 * Minimal Torznab (RSS) handling. The proxy changes only each item's <title> and its tvdbid
 * attribute; everything else in the upstream response is passed on byte for byte, so whatever
 * Prowlarr adds (enclosures, seeders, info hashes, categories) reaches Sonarr unchanged.
 */

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
const TVDB_ATTR = /\s*<torznab:attr\s+name="tvdbid"\s+value="[^"]*"\s*\/>/g;

export function items(xml: string): FeedItem[] {
  return [...xml.matchAll(ITEM)].map((m) => {
    const x = m[0];
    const key = /<guid\b[^>]*>([\s\S]*?)<\/guid>/.exec(x)?.[1] ?? /<link\b[^>]*>([\s\S]*?)<\/link>/.exec(x)?.[1] ?? x;
    return { title: decodeXml(TITLE.exec(x)?.[1] ?? '').trim(), key: decodeXml(key).trim(), xml: x };
  });
}

/** An item with a new title and tvdbid attribute (any existing tvdbid is replaced). */
export function rewriteItem(itemXml: string, title: string, tvdbId: number): string {
  const withTitle = itemXml.replace(TITLE, `<title>${encodeXml(title)}</title>`);
  return withTitle.replace(TVDB_ATTR, '').replace(/<\/item>$/, `  <torznab:attr name="tvdbid" value="${tvdbId}" />\n    </item>`);
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

/** Makes sure the feed declares the torznab namespace, since rewritten items carry torznab:attr. */
export function ensureNamespace(xml: string): string {
  if (/xmlns:torznab=/.test(xml)) return xml;
  return xml.replace(/<rss\b/, '<rss xmlns:torznab="http://torznab.com/schemas/2015/feed"');
}

/**
 * Upstream caps with the TV search parameters the proxy translates: Sonarr then sends tvdbid,
 * season and ep, which anime indexers cannot use but the proxy can.
 */
export function rewriteCaps(xml: string): string {
  let out = xml;
  if (/<tv-search\b/.test(out)) out = out.replace(/<tv-search\b[^>]*\/?>/, '<tv-search available="yes" supportedParams="q,season,ep,tvdbid" />');
  else out = out.replace(/<searching>/, '<searching>\n    <tv-search available="yes" supportedParams="q,season,ep,tvdbid" />');
  if (!/<search\b/.test(out)) out = out.replace(/<searching>/, '<searching>\n    <search available="yes" supportedParams="q" />');
  return out;
}

/** An empty Torznab feed, for errors Sonarr should see as "no results". */
export const emptyFeed = (title: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:torznab="http://torznab.com/schemas/2015/feed">\n  <channel>\n    <title>${encodeXml(title)}</title>\n  </channel>\n</rss>\n`;

/** A Torznab error document. */
export const errorXml = (code: number, description: string) => `<?xml version="1.0" encoding="UTF-8"?>\n<error code="${code}" description="${encodeXml(description)}" />\n`;

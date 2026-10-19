/**
 * Where Courmap is served (Xwolv decision S4.6). The domain is defined here and nowhere else;
 * every URL below derives from it.
 *
 * - courmap.com: the docs site (Cloudflare Pages)
 * - data.courmap.com: the static shards (R2 custom domain), /v1/ root
 * - api.courmap.com: the optional Worker
 */
export const COURMAP_DOMAIN = 'courmap.com';
/** The GitHub repository; data releases are tagged data-<data_version> there. */
export const COURMAP_REPO = 'courmap/courmap';

export const COURMAP_URLS = {
  // courmap.pages.dev until courmap.com is bought (docs/LAUNCH.md); then `https://${COURMAP_DOMAIN}/`.
  docs: 'https://courmap.pages.dev/',
  data: `https://data.${COURMAP_DOMAIN}/v1/`,
  api: `https://api.${COURMAP_DOMAIN}/v1/`,
  /** meta.json of the latest data release on GitHub (decision S6.2): needs no R2 or domain. */
  releaseMeta: `https://github.com/${COURMAP_REPO}/releases/latest/download/meta.json`,
} as const;

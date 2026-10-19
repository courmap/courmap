/**
 * Where Courmap is served (Xwolv decision S4.6). The domain is defined here and nowhere else;
 * every URL below derives from it.
 *
 * - courmap.com: the docs site (Cloudflare Pages)
 * - data.courmap.com: the static shards (R2 custom domain), /v1/ root
 * - api.courmap.com: the optional Worker
 */
export const COURMAP_DOMAIN = 'courmap.com';

export const COURMAP_URLS = {
  docs: `https://${COURMAP_DOMAIN}/`,
  data: `https://data.${COURMAP_DOMAIN}/v1/`,
  api: `https://api.${COURMAP_DOMAIN}/v1/`,
} as const;

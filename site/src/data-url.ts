import { COURMAP_URLS } from '@courmap/core';

/**
 * Where the try-it box reads the static shards: the one place this is configured (decision S6.4).
 * In `astro dev` the dev server serves locally built shards at /v1/ (see astro.config.mjs);
 * a built site uses PUBLIC_COURMAP_DATA_URL when set, else data.courmap.com.
 */
export const DATA_URL: string = import.meta.env.PUBLIC_COURMAP_DATA_URL || (import.meta.env.DEV ? '/v1/' : COURMAP_URLS.data);

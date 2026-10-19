// The Courmap docs site (decision S6.4): Astro Starlight on Cloudflare Pages.
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import preact from '@astrojs/preact';
import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
// Until data.courmap.com exists, the try-it box reads shards built locally into out/shards/v1
// (pnpm compile, then pnpm builder shards), which the dev server serves at /v1/.
const localShards = path.join(repoRoot, 'out/shards/v1');

/** Serves out/shards/v1 at /v1/ in `astro dev`, the way R2 will serve it. */
const localShardServer = {
  name: 'courmap-local-shards',
  configureServer(server) {
    server.middlewares.use('/v1/', (req, res, next) => {
      const rel = decodeURIComponent((req.url ?? '/').split('?')[0]).replace(/^\/+/, '');
      const file = path.resolve(localShards, rel);
      if (!file.startsWith(localShards + path.sep) || !existsSync(file) || !statSync(file).isFile()) {
        res.statusCode = 404;
        return res.end();
      }
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');
      createReadStream(file).pipe(res);
    });
  },
};

export default defineConfig({
  // courmap.pages.dev until courmap.com exists; the domain itself lives in packages/core/src/site.ts.
  site: process.env.SITE_URL ?? 'https://courmap.pages.dev',
  integrations: [
    starlight({
      title: 'Courmap',
      description: 'One anime episode, every numbering: AniDB, AniList, MAL, Kitsu, TVDB, TMDB, IMDb and absolute.',
      logo: { src: './src/assets/logo.svg', alt: 'Courmap' },
      favicon: '/favicon.svg',
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/courmap/courmap' }],
      editLink: { baseUrl: 'https://github.com/courmap/courmap/edit/main/site/' },
      customCss: ['./src/styles/brand.css'],
      sidebar: [
        { label: 'Try it', link: '/try/' },
        { label: 'Getting started', items: [{ autogenerate: { directory: 'getting-started' } }] },
        { label: 'Concepts', items: [{ autogenerate: { directory: 'concepts' } }] },
        { label: 'Sonarr guide', link: '/sonarr/' },
        {
          label: 'Reference',
          items: [
            { label: 'Library guide: remote and offline', link: '/reference/library/' },
            { label: 'Library API (generated)', collapsed: true, items: [{ autogenerate: { directory: 'reference/library/api' } }] },
            { label: 'Static files and dumps', link: '/reference/static-files/' },
            { label: 'Data format (generated)', link: '/reference/data-format/' },
          ],
        },
        { label: 'Contributing mappings', link: '/contributing/' },
        { label: 'How automation works', link: '/automation/' },
        { label: 'Coverage', link: '/coverage/' },
        { label: 'More', items: [{ label: 'FAQ', link: '/faq/' }, { label: 'Licensing and attribution', link: '/licensing/' }, { label: 'Changelog', link: '/changelog/' }] },
      ],
    }),
    preact(),
  ],
  vite: {
    // Workspace packages resolve to their TypeScript source, as everywhere else in the repo. Aliases
    // rather than export conditions: Astro's client build does not pass custom conditions through.
    resolve: {
      alias: [
        { find: /^@courmap\/client\/remote$/, replacement: path.join(repoRoot, 'packages/client/src/browser.ts') },
        { find: /^@courmap\/core$/, replacement: path.join(repoRoot, 'packages/core/src/index.ts') },
        { find: /^@courmap\/parser$/, replacement: path.join(repoRoot, 'packages/parser/src/index.ts') },
      ],
    },
    plugins: [localShardServer],
  },
});

// The Courmap docs site (decision S6.4): Astro Starlight on Cloudflare Pages.
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import preact from '@astrojs/preact';
import starlight from '@astrojs/starlight';
import starlightLinksValidator from 'starlight-links-validator';
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
  // Pages that moved keep working (the site is static, so these become redirect pages).
  redirects: {
    '/reference/library': '/guides/library/',
  },
  // The domain itself lives in packages/core/src/site.ts.
  site: process.env.SITE_URL ?? 'https://courmap.com',
  integrations: [
    starlight({
      title: 'Courmap',
      description: 'One anime episode, every numbering: AniDB, AniList, MAL, Kitsu, TVDB, TMDB, IMDb and absolute.',
      logo: { src: './src/assets/logo.svg', alt: 'Courmap logo' },
      favicon: '/favicon.svg',
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/courmap/courmap' }],
      editLink: { baseUrl: 'https://github.com/courmap/courmap/edit/main/site/' },
      customCss: ['./src/styles/brand.css'],
      components: { Footer: './src/components/Footer.astro', SocialIcons: './src/components/SocialIcons.astro' },
      head: [{ tag: 'script', attrs: { src: '/image-zoom.js', defer: true } }],
      plugins: [starlightLinksValidator()],
      sidebar: [
        { label: 'Try it', slug: 'try' },
        {
          label: 'Get started',
          items: [
            { label: 'What is Courmap?', slug: 'getting-started/what-is-courmap' },
            { label: 'Sonarr quickstart', slug: 'getting-started/sonarr' },
            { label: 'Library quickstart', slug: 'getting-started/library' },
            { label: 'Use the data', slug: 'getting-started/data' },
            { label: 'Fix a mapping', slug: 'getting-started/contributing' },
          ],
        },
        {
          label: 'Guides',
          items: [
            { label: 'Sonarr: full guide', slug: 'sonarr' },
            { label: 'Library: remote vs offline', slug: 'guides/library' },
            { label: 'Contributing mappings', slug: 'contributing' },
          ],
        },
        {
          label: 'Concepts',
          items: [
            { label: 'Glossary', slug: 'concepts/glossary' },
            { label: 'Works', slug: 'concepts/works' },
            { label: 'Projections', slug: 'concepts/projections' },
            { label: 'Absolute sequences', slug: 'concepts/absolute-sequences' },
            { label: 'Group overrides', slug: 'concepts/group-overrides' },
            { label: 'Resolving release names', slug: 'concepts/release-names' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'Library API', collapsed: true, items: [{ autogenerate: { directory: 'reference/library/api' } }] },
            { label: 'Static files and dumps', slug: 'reference/static-files' },
            { label: 'Data format', slug: 'reference/data-format' },
            { label: 'Coverage', slug: 'coverage' },
          ],
        },
        {
          label: 'Maintainers',
          collapsed: true,
          items: [
            { label: 'How automation works', slug: 'automation' },
            { label: 'Fixing open issues', slug: 'fixing-issues' },
            { label: 'Turning proxy reports into data', slug: 'proxy-reports' },
          ],
        },
        {
          label: 'More',
          items: [
            { label: 'FAQ', slug: 'faq' },
            { label: 'Licensing and attribution', slug: 'licensing' },
            { label: 'Changelog', slug: 'changelog' },
          ],
        },
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

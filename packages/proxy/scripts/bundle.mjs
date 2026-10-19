// Bundles the proxy into one ES module for the Docker image: workspace packages are inlined from
// their TypeScript source, better-sqlite3 (a native module) stays external.
// Usage: node packages/proxy/scripts/bundle.mjs [version]
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
await build({
  entryPoints: [`${root}src/main.ts`],
  outfile: `${root}docker/proxy.mjs`,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  conditions: ['@courmap/source'],
  external: ['better-sqlite3'],
  define: { COURMAP_PROXY_VERSION: JSON.stringify(process.argv[2] ?? 'dev') },
  // Some dependencies still call require(); give the ES module one.
  banner: { js: "import { createRequire as __courmapRequire } from 'node:module'; const require = __courmapRequire(import.meta.url);" },
  logLevel: 'warning',
});
console.log(`bundled ${root}docker/proxy.mjs`);

// Proves the packed npm tarballs work for a real user (decision S7.2): installs out/npm/*.tgz
// into a clean temporary project with npm, then
//   - Node: offline mode over a dump and remote mode over shards give the same answers;
//   - TypeScript: the published types type-check a consumer file (NodeNext);
//   - browser: @courmap/client/remote bundles for the browser platform with no Node-only module,
//     and the bundle answers the same in a context with only browser globals.
// Usage: node scripts/pack-npm.mjs && tsx --conditions=@courmap/source scripts/verify-npm.ts
//        tsx --conditions=@courmap/source scripts/verify-npm.ts --registry 0.1.0   (the published packages)
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { build } from 'esbuild';
import { compile, generateShards, validate } from '../packages/builder/src/index.js';
import { serveStatic } from '../packages/client/test/static-server.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const npmDir = path.join(root, 'out/npm');
const registryArg = process.argv.indexOf('--registry');
const registryVersion = registryArg >= 0 ? process.argv[registryArg + 1] : undefined;
if (registryArg >= 0 && !registryVersion) throw new Error('--registry needs a version, for example --registry 0.1.0');
const tarballs: Record<string, string> = registryVersion
  ? {}
  : Object.fromEntries(readdirSync(npmDir).filter((f) => f.endsWith('.tgz')).map((f) => [/courmap-(\w+)-/.exec(f)![1]!, path.join(npmDir, f)]));
if (!registryVersion) for (const p of ['core', 'parser', 'client']) if (!tarballs[p]) throw new Error(`out/npm has no ${p} tarball; run node scripts/pack-npm.mjs first`);

const work = mkdtempSync(path.join(tmpdir(), 'courmap-npm-'));
const run = (cmd: string, args: string[]) => execFileSync(cmd, args, { cwd: work, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
const fileSpec = (f: string) => `file:${f.split(path.sep).join('/')}`;
let server: Awaited<ReturnType<typeof serveStatic>> | null = null;
try {
  // A consumer project that knows nothing about the workspace. With tarballs, overrides make npm
  // take the dependencies from them instead of the registry; with --registry, npm fetches all three.
  writeFileSync(
    path.join(work, 'package.json'),
    JSON.stringify({
      name: 'courmap-npm-check',
      private: true,
      type: 'module',
      ...(registryVersion
        ? { dependencies: { '@courmap/client': registryVersion, '@courmap/parser': registryVersion } }
        : {
            dependencies: { '@courmap/client': fileSpec(tarballs.client!), '@courmap/parser': fileSpec(tarballs.parser!) },
            overrides: { '@courmap/core': fileSpec(tarballs.core!), '@courmap/parser': fileSpec(tarballs.parser!) },
          }),
    }),
  );
  run('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error', '--prefer-online']);
  if (registryVersion) {
    const tree = JSON.parse(run('npm', ['ls', '--all', '--json'])) as { dependencies: Record<string, { version: string; resolved?: string; dependencies?: Record<string, { version: string }> }> };
    const core = tree.dependencies['@courmap/client']!.dependencies?.['@courmap/core']?.version;
    const got = { client: tree.dependencies['@courmap/client']!.version, parser: tree.dependencies['@courmap/parser']!.version, core };
    if (Object.values(got).some((x) => x !== registryVersion)) throw new Error(`expected ${registryVersion} from the registry, got ${JSON.stringify(got)}`);
    console.log(`installed @courmap/client, parser and core ${registryVersion} from the npm registry into a clean project`);
  } else {
    console.log('installed the tarballs into a clean project');
  }

  // Data: the conformance fixture as a dump and as shards.
  const v = await validate(path.join(root, 'tests/conformance/data'));
  const dump = path.join(work, 'fixture.sqlite');
  compile(v.records!, v.checked, dump, { dataVersion: 'npm-check', builtAt: '2026-01-01T00:00:00.000Z', gitSha: 'test' });
  await generateShards(dump, path.join(work, 'shards'));
  server = await serveStatic(path.join(work, 'shards'));

  // Node, through the installed package only.
  writeFileSync(
    path.join(work, 'check.mjs'),
    `import { createOfflineClient, createRemoteClient } from '@courmap/client';
import { parseRelease } from '@courmap/parser';
const offline = createOfflineClient(process.argv[2]);
const remote = createRemoteClient(process.argv[3]);
const calls = [
  (c) => c.translate('anilist:2003', 5, ['tvdb_show', 'absolute']),
  (c) => c.resolve('[Other] Split Show - 13 [1080p]'),
  (c) => c.lookup('anidb:1001'),
  (c) => c.search('simple show'),
];
for (const f of calls) {
  const [a, b] = [JSON.stringify(await f(offline)), JSON.stringify(await f(remote))];
  if (a !== b) throw new Error('offline and remote differ: ' + a + ' vs ' + b);
}
const r = await offline.resolve('[Other] Split Show - 13 [1080p]');
if (r.match?.work !== 'split-show-part-2' || r.match.episode !== 1) throw new Error('wrong answer: ' + JSON.stringify(r.match));
if (parseRelease('[G] A - 05').episode !== 5) throw new Error('parser');
offline.close();
console.log('node: offline and remote agree; resolve, translate, lookup, search and the parser work');
`,
  );
  // Asynchronously: the shard server runs in this process and must keep answering.
  process.stdout.write((await promisify(execFile)(process.execPath, ['check.mjs', dump, server.url], { cwd: work, encoding: 'utf8' })).stdout);

  // TypeScript: the published .d.ts files, as a NodeNext consumer sees them.
  writeFileSync(
    path.join(work, 'check-types.ts'),
    `import { createOfflineClient, createRemoteClient, CourmapError, type TranslateResult } from '@courmap/client';
import { createRemoteClient as browserClient } from '@courmap/client/remote';
const c = createOfflineClient('x.sqlite');
const t: Promise<TranslateResult> = c.translate('anilist:1', 1, ['tvdb_show']);
void t; void createRemoteClient; void browserClient; void CourmapError;
`,
  );
  writeFileSync(path.join(work, 'tsconfig.json'), JSON.stringify({ compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext', target: 'ES2023', strict: true, noEmit: true, skipLibCheck: false, types: [] }, files: ['check-types.ts'] }));
  const tsc = path.join(root, 'node_modules/typescript/bin/tsc');
  execFileSync(process.execPath, [tsc, '-p', path.join(work, 'tsconfig.json')], { cwd: work, stdio: 'inherit' });
  console.log('types: a NodeNext consumer type-checks against the published declarations');

  // Browser: bundle the installed package for the browser platform and run it bare.
  writeFileSync(path.join(work, 'entry.mjs'), `export { createRemoteClient } from '@courmap/client/remote';\n`);
  const bundle = await build({ entryPoints: [path.join(work, 'entry.mjs')], absWorkingDir: work, bundle: true, platform: 'browser', format: 'iife', globalName: 'Courmap', write: false, metafile: true, logLevel: 'silent' });
  const nodeOnly = Object.keys(bundle.metafile.inputs).filter((f) => /node:|better-sqlite3|offline\.js|disk-store\.js/.test(f));
  if (nodeOnly.length > 0) throw new Error(`the browser bundle pulls in Node-only modules: ${nodeOnly.join(', ')}`);
  const context = vm.createContext({ fetch, TextDecoder, TextEncoder, URL, console, setTimeout, clearTimeout });
  vm.runInContext(`${bundle.outputFiles[0]!.text}\nglobalThis.Courmap = Courmap;`, context);
  const browser = (context.Courmap as { createRemoteClient(u: string): { resolve(n: string): Promise<{ match: { work: string; episode: number } | null }> } }).createRemoteClient(server.url);
  const b = await browser.resolve('[Other] Split Show - 13 [1080p]');
  if (b.match?.work !== 'split-show-part-2' || b.match.episode !== 1) throw new Error(`browser bundle answered ${JSON.stringify(b.match)}`);
  console.log(`browser: @courmap/client/remote bundles to ${Math.round(bundle.outputFiles[0]!.text.length / 1024)} KB with no Node-only module and resolves with only browser globals`);
  console.log(`\nnpm tarballs verified: ${Object.values(tarballs).map((f) => path.basename(f)).join(', ')}`);
} finally {
  await server?.close();
  rmSync(work, { recursive: true, force: true });
}

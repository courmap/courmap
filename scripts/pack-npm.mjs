// Builds and packs the npm packages (decision S7.2): @courmap/core, @courmap/parser and
// @courmap/client, in dependency order, into out/npm/*.tgz. pnpm pack turns workspace:*
// dependencies into the real versions. Each tarball gets the repository's LICENSE.
// Usage: node scripts/pack-npm.mjs [--expect <version>]
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACKAGES = ['core', 'parser', 'client'];
const root = fileURLToPath(new URL('../', import.meta.url));
const out = path.join(root, 'out/npm');
const expect = process.argv.includes('--expect') ? process.argv[process.argv.indexOf('--expect') + 1] : null;

const versions = PACKAGES.map((p) => JSON.parse(readFileSync(path.join(root, 'packages', p, 'package.json'), 'utf8')).version);
if (new Set(versions).size !== 1) throw new Error(`the packages disagree on their version: ${PACKAGES.map((p, i) => `${p} ${versions[i]}`).join(', ')}`);
if (expect && versions[0] !== expect) throw new Error(`the tag says ${expect}, the packages say ${versions[0]}`);

const pnpm = (args, cwd = root) => execFileSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
pnpm(['--filter', '@courmap/core', '--filter', '@courmap/parser', '--filter', '@courmap/client', 'run', 'build']);
for (const p of PACKAGES) {
  const dir = path.join(root, 'packages', p);
  copyFileSync(path.join(root, 'LICENSE'), path.join(dir, 'LICENSE'));
  try {
    pnpm(['pack', '--pack-destination', out], dir);
  } finally {
    rmSync(path.join(dir, 'LICENSE'), { force: true });
  }
}
console.log(`packed ${versions[0]}: ${readdirSync(out).join(', ')}`);

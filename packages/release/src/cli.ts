#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { buildAssets } from './assets.js';
import { fillMetaDumps } from './meta.js';
import { verifyRelease } from './verify.js';
import { targetFromEnv, uploadShards } from './upload.js';

const USAGE = `Usage: courmap-release <command> [options]

Commands:
  assets --dump <file> --out <dir>    Build the GitHub release assets and SHA256SUMS
  meta --dir <shards> --assets <dir> --repo <owner/name>
                                      Point meta.json's dumps at the GitHub release data-<version>
                                      and add meta.json to the release assets
  verify --dir <assets> --repo <owner/name>
                                      Check a release directory before publishing it
  upload --dir <shards> [--prefix v1/] [--dry-run] [--prune]
                                      Publish a shard tree to S3-compatible storage, meta.json last

Upload reads S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY and S3_REGION
(default auto). Without them it runs as a dry run.
`;

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      dump: { type: 'string' },
      out: { type: 'string' },
      dir: { type: 'string' },
      assets: { type: 'string' },
      repo: { type: 'string' },
      prefix: { type: 'string', default: 'v1/' },
      'dry-run': { type: 'boolean' },
      prune: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const command = positionals[0];
  if (values.help || !command) {
    process.stdout.write(USAGE);
    return command || values.help ? 0 : 1;
  }
  if (command === 'assets') {
    if (!values.dump || !values.out) return (console.error('assets needs --dump and --out'), 1);
    const root = fileURLToPath(new URL('../../../', import.meta.url));
    const a = await buildAssets(values.dump, values.out, root);
    for (const f of a.files) console.log(`${a.sha256[f] ?? '(checksums)'.padEnd(64)}  ${f}`);
    console.log(`Release assets for data-${a.dataVersion} in ${values.out}`);
    return 0;
  }
  if (command === 'meta') {
    if (!values.dir || !values.assets || !values.repo) return (console.error('meta needs --dir, --assets and --repo'), 1);
    const dumps = await fillMetaDumps(values.dir, values.assets, values.repo);
    console.log(`meta.json now points at ${dumps.tag}: ${dumps.sqlite.url}`);
    return 0;
  }
  if (command === 'verify') {
    if (!values.dir || !values.repo) return (console.error('verify needs --dir and --repo'), 1);
    const root = fileURLToPath(new URL('../../../', import.meta.url));
    const r = await verifyRelease(values.dir, root, values.repo);
    for (const p of r.problems) console.error(`problem: ${p}`);
    console.log(r.problems.length === 0 ? `Release data-${r.dataVersion} verified: ${r.files.join(', ')}` : `\n${r.problems.length} problem(s); do not publish`);
    return r.problems.length === 0 ? 0 : 1;
  }
  if (command === 'upload') {
    if (!values.dir) return (console.error('upload needs --dir'), 1);
    const target = targetFromEnv();
    if (!target) console.log('No S3 credentials in the environment: dry run.');
    await uploadShards(values.dir, target, { prefix: values.prefix!, dryRun: values['dry-run'] === true, prune: values.prune === true, log: console.log });
    return 0;
  }
  console.error(`Unknown command "${command}"\n`);
  process.stderr.write(USAGE);
  return 1;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err instanceof Error ? (err.stack ?? err.message) : err);
    process.exit(2);
  },
);

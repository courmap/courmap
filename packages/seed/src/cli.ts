#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { Reporter, formatDiagnostic, loadData, validate } from '@courmap/builder';
import { download, resolveLatest } from './fetch.js';
import { manualChanges, readPrevious, writeSeedDir } from './files.js';
import { renderReport } from './report.js';
import { runSeed, type SeedOutput } from './seed.js';

const USAGE = `Usage: courmap-seed [options]

Rebuilds data/seeds/ from cedya77/anime-offline-database and Anime-Lists.

Pins (pick one; default: reuse the pins in data/seeds/manifest.json):
  --latest                     Resolve the newest cedya77 release and Anime-Lists master commit
  --offline-db-tag <tag>       cedya77 release tag, e.g. 2026-42
  --anime-lists-commit <sha>   Anime-Lists commit (full SHA)

Options:
  --data <dir>                 Data directory (default: data)
  --cache <dir>                Download cache (default: .cache/seed)
  --verify                     Run twice and require byte-identical output
  --report <file>              Write a Markdown summary of what changed (for the seed PR)
  -h, --help                   Show this help
`;

async function main(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      latest: { type: 'boolean' },
      'offline-db-tag': { type: 'string' },
      'anime-lists-commit': { type: 'string' },
      data: { type: 'string', default: 'data' },
      cache: { type: 'string', default: '.cache/seed' },
      verify: { type: 'boolean' },
      report: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  const dataDir = values.data!;
  const seedDir = path.join(dataDir, 'seeds');
  const previous = await readPrevious(seedDir);
  const previousManifest = await readFile(path.join(seedDir, 'manifest.json'), 'utf8').catch(() => null);

  let tag = values['offline-db-tag'] ?? previous.pins?.offline_db.tag;
  let commit = values['anime-lists-commit'] ?? previous.pins?.anime_lists.commit;
  if (values.latest) ({ tag, commit } = await resolveLatest());
  if (!tag || !commit) {
    console.error('No pins: pass --latest, or --offline-db-tag and --anime-lists-commit.');
    return 1;
  }
  console.log(`Pins: cedya77 ${tag}, Anime-Lists ${commit}`);
  const inputs = await download(tag, commit, values.cache!, previous.pins ?? undefined);

  const reporter = new Reporter();
  const { files } = await loadData(dataDir, reporter);
  if (reporter.errorCount > 0) {
    for (const d of reporter.diagnostics) console.error(formatDiagnostic(d));
    console.error('Fix the hand-written files first.');
    return 1;
  }
  const run = () => runSeed({ ...inputs, manual: { files }, registry: previous.registry });

  const out = await run();
  if (values.verify) {
    const again = await run();
    const differ = [...new Set([...out.files.keys(), ...again.files.keys()])].filter((n) => out.files.get(n) !== again.files.get(n));
    if (differ.length > 0) {
      console.error(`Not reproducible: ${differ.join(', ')} differ between two runs with the same pins.`);
      return 1;
    }
    console.log('Verified: two runs with the same pins produced byte-identical output.');
  }
  report(out);
  if (out.remainingErrors.length > 0) {
    for (const d of out.remainingErrors) console.error(formatDiagnostic(d));
    console.error(`\n${out.remainingErrors.length} error(s) remain in hand-written files; data/seeds/ was not written.`);
    return 1;
  }
  await writeSeedDir(seedDir, out.files);
  if (values.report) await writeFile(values.report, renderReport(previousManifest, out.files.get('manifest.json')!));

  // The step 5 check, against what is now on disk.
  const result = await validate(dataDir);
  const changed = manualChanges(result.checked);
  if (!result.ok || changed.length > 0) {
    for (const d of result.diagnostics.filter((x) => x.severity === 'error')) console.error(formatDiagnostic(d));
    for (const c of changed) console.error(`manual mapping changed by the merge: ${c}`);
    return 1;
  }
  console.log(`Wrote ${seedDir}/; validate passes and no manual mapping changed.`);
  return 0;
}

function report(out: SeedOutput): void {
  const s = out.summary;
  console.log(`Works: ${s.works} (repair rounds: ${s.repair_rounds})`);
  console.log(`Provider refs: ${JSON.stringify(s.provider_refs)}`);
  console.log(`Projection rows: ${JSON.stringify(s.projection_rows)}; blocks: ${JSON.stringify(s.projection_blocks)}; partial: ${JSON.stringify(s.partial_blocks)}`);
  console.log(`Warnings: ${JSON.stringify(s.warnings)}; info: ${JSON.stringify(s.info)}`);
  console.log(`Conflicts: ${JSON.stringify(s.conflicts)}`);
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err instanceof Error ? (err.stack ?? err.message) : err);
    process.exit(2);
  },
);

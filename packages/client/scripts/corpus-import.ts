// Appends release names from a plain text file to tests/releases.yaml as unverified cases.
// Usage: pnpm corpus:import <names.txt> [--source <label>]
//
// Input: one release name (or file name, or full path) per line, UTF-8. Blank lines and lines
// starting with # are skipped; names already in the corpus are skipped.
//
// Each new case records what the resolver answers today as its expectation, marked
// verified: false, so it is excluded from the pass rate. A person then checks each one, fixes
// the expectation if it is wrong, and sets verified: true.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { importCases, readNames } from './corpus-lib.js';

export { expectationOf, readNames } from './corpus-lib.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { source: { type: 'string', default: 'imported' } } });
  const file = positionals[0];
  if (!file) {
    console.error('Usage: pnpm corpus:import <names.txt> [--source <label>]');
    return 1;
  }
  const names = readNames(readFileSync(file, 'utf8'));
  const r = await importCases(
    names.map((name) => ({ name, source: values.source! })),
    { corpusFile: `${root}tests/releases.yaml`, dataDir: `${root}data` },
  );
  console.log(`Added ${r.added} unverified case(s) (${JSON.stringify(r.byStatus)}); skipped ${r.skipped} already present or repeated.`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.error(err);
      process.exit(2);
    },
  );
}

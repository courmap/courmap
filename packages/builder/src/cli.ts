#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { formatDiagnostic } from './diagnostics.js';
import { validate } from './validate.js';
import type { DataSource } from './load.js';

const USAGE = `Usage: courmap-builder <command> [options]

Commands:
  validate               Check data files (schema, overlaps, gaps, bounds, references, round trips)

Options:
  --data <dir>           Data directory with works/, sequences/, groups/ (default: data)
  -h, --help             Show this help
`;

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      data: { type: 'string', default: 'data' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const command = positionals[0];
  if (values.help || !command) {
    process.stdout.write(USAGE);
    return command || values.help ? 0 : 1;
  }
  const sources: DataSource[] = [{ dir: values.data!, origin: 'manual' }];

  if (command === 'validate') {
    const result = await validate(sources);
    for (const d of result.diagnostics) console.error(formatDiagnostic(d));
    if (!result.ok) {
      console.error(`\n${result.diagnostics.length} problem(s) in ${values.data}/ (${result.fileCount} files checked)`);
      return 1;
    }
    console.log(`OK: ${result.fileCount} files in ${values.data}/ passed all checks, including round trips`);
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

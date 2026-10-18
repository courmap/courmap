#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { formatDiagnostic } from './diagnostics.js';
import { validate } from './validate.js';
import { compile } from './compile.js';
import type { DataSource } from './load.js';

const USAGE = `Usage: courmap-builder <command> [options]

Commands:
  validate               Check data files (schema, overlaps, gaps, bounds, references, round trips)
  compile --out <file>   Validate, then compile to SQLite and verify the result

Options:
  --data <dir>           Data directory with works/, sequences/, groups/ (default: data)
  --out <file>           SQLite output path (compile)
  --data-version <v>     Override data_version (default: ISO year.week, e.g. 2026.42)
  --built-at <iso>       Override built_at (default: now)
  -h, --help             Show this help
`;

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      data: { type: 'string', default: 'data' },
      out: { type: 'string' },
      'data-version': { type: 'string' },
      'built-at': { type: 'string' },
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

  if (command === 'compile') {
    if (!values.out) {
      console.error('compile needs --out <file>');
      return 1;
    }
    const result = await validate(sources);
    if (!result.ok || !result.records) {
      for (const d of result.diagnostics) console.error(formatDiagnostic(d));
      console.error(`\nNot compiling: ${result.diagnostics.length} problem(s) in ${values.data}/`);
      return 1;
    }
    const report = compile(result.records, result.checked, values.out, {
      ...(values['data-version'] !== undefined && { dataVersion: values['data-version'] }),
      ...(values['built-at'] !== undefined && { builtAt: values['built-at'] }),
    });
    for (const [table, n] of Object.entries(report.counts)) console.log(`${table.padEnd(18)} ${n}`);
    console.log(`\nWrote ${values.out} (data_version ${report.meta.data_version}); row counts match the YAML; integrity_check ok`);
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

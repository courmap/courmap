#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { formatDiagnostic, type Diagnostic } from './diagnostics.js';
import { validate, type ValidateResult } from './validate.js';
import { compile } from './compile.js';
import { generateShards } from './shards.js';

const USAGE = `Usage: courmap-builder <command> [options]

Commands:
  validate               Check data files (schema, merge, overlaps, gaps, bounds, references, round trips)
  compile --out <file>   Validate, then compile to SQLite and verify the result
  shards --from <file> --out <dir>
                         Write the static JSON shards (the /v1/ tree) from a compiled dump

Options:
  --data <dir>           Data directory with works/, sequences/, groups/, seeds/ (default: data)
  --warnings             List every warning and info note, not just counts by code
  --out <path>           SQLite output (compile) or shard directory (shards)
  --from <file>          Compiled dump to read (shards)
  --data-version <v>     Override data_version (default: ISO year.week, e.g. 2026.42)
  --built-at <iso>       Override built_at (default: now)
  -h, --help             Show this help
`;

const errors = (r: ValidateResult) => r.diagnostics.filter((d) => d.severity === 'error');
const warningsOf = (r: ValidateResult) => r.diagnostics.filter((d) => d.severity === 'warning');
const infoOf = (r: ValidateResult) => r.diagnostics.filter((d) => d.severity === 'info');
const warningNote = (r: ValidateResult) => {
  const n = warningsOf(r).length;
  return n === 0 ? '' : ` (${n} warning(s); --warnings lists them)`;
};

/** Errors are always listed. Warnings (seed-only works) can number in the thousands, so they are counted by code unless asked for. */
function printDiagnostics(r: ValidateResult, listWarnings: boolean): void {
  for (const d of errors(r)) console.error(formatDiagnostic(d));
  const warnings = warningsOf(r);
  if (listWarnings) {
    for (const d of [...warnings, ...infoOf(r)]) console.error(formatDiagnostic(d));
    return;
  }
  const byCode = new Map<Diagnostic['code'], number>();
  for (const d of warnings) byCode.set(d.code, (byCode.get(d.code) ?? 0) + 1);
  for (const [code, n] of [...byCode].sort()) console.error(`warning ${code}: ${n}`);
  const info = new Map<Diagnostic['code'], number>();
  for (const d of infoOf(r)) info.set(d.code, (info.get(d.code) ?? 0) + 1);
  for (const [code, n] of [...info].sort()) console.error(`info ${code}: ${n}`);
}

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      data: { type: 'string', default: 'data' },
      out: { type: 'string' },
      from: { type: 'string' },
      'data-version': { type: 'string' },
      'built-at': { type: 'string' },
      warnings: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const command = positionals[0];
  if (values.help || !command) {
    process.stdout.write(USAGE);
    return command || values.help ? 0 : 1;
  }
  const dataDir = values.data!;

  if (command === 'validate') {
    const result = await validate(dataDir);
    printDiagnostics(result, values.warnings === true);
    const scope = `${result.fileCount} files and ${result.seedCount} seed works in ${dataDir}/`;
    if (!result.ok) {
      console.error(`\n${errors(result).length} error(s) in ${scope}`);
      return 1;
    }
    console.log(`OK: ${scope} passed all checks, including round trips${warningNote(result)}`);
    return 0;
  }

  if (command === 'compile') {
    if (!values.out) {
      console.error('compile needs --out <file>');
      return 1;
    }
    const result = await validate(dataDir);
    if (!result.ok || !result.records) {
      printDiagnostics(result, values.warnings === true);
      console.error(`\nNot compiling: ${errors(result).length} error(s) in ${dataDir}/`);
      return 1;
    }
    const report = compile(result.records, result.checked, values.out, {
      ...(values['data-version'] !== undefined && { dataVersion: values['data-version'] }),
      ...(values['built-at'] !== undefined && { builtAt: values['built-at'] }),
    });
    for (const [table, n] of Object.entries(report.counts)) console.log(`${table.padEnd(18)} ${n}`);
    console.log(`\nWrote ${values.out} (data_version ${report.meta.data_version}); row counts match the sources; integrity_check ok${warningNote(result)}`);
    return 0;
  }

  if (command === 'shards') {
    if (!values.from || !values.out) {
      console.error('shards needs --from <dump.sqlite> and --out <dir>');
      return 1;
    }
    const report = await generateShards(values.from, values.out);
    console.log(`Wrote ${report.files} files to ${values.out} (${report.works} works, ${report.sequences} sequences, ${report.groups} groups); meta.json last`);
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

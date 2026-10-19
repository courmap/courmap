import { Reporter, type Diagnostic } from './diagnostics.js';
import { checkFiles, type CheckedFiles } from './checks.js';
import { loadData } from './load.js';
import { loadRejected } from './rejected.js';
import { MemoryDataset, toRecords, type Records } from './records.js';
import { checkRoundTrips } from './roundtrip.js';

export interface ValidateOptions {
  /** Base for the file paths in diagnostics. Default: process.cwd(). */
  cwd?: string;
}

export interface ValidateResult {
  /** No errors. Warnings do not fail validation. */
  ok: boolean;
  diagnostics: Diagnostic[];
  /** YAML files read. */
  fileCount: number;
  /** Seed lines read from data/seeds/. */
  seedCount: number;
  checked: CheckedFiles;
  /** Present only when ok. */
  records?: Records;
}

/**
 * Full validation of a data directory (works/, sequences/, groups/ and seeds/): YAML and JSON
 * syntax, schemas, the manual-over-seed merge, overlap, gap, bounds and reference checks,
 * then round-trip translation checks. Round trips run only once everything else is free of
 * errors, since they need a consistent dataset.
 */
export async function validate(dataDir: string, opts: ValidateOptions = {}): Promise<ValidateResult> {
  const reporter = new Reporter();
  const loaded = await loadData(dataDir, reporter, opts.cwd);
  const checked = checkFiles(loaded, reporter);
  await loadRejected(dataDir, reporter, { cwd: opts.cwd, works: new Set(checked.works.map((w) => w.id)) });
  const result: ValidateResult = {
    ok: false,
    diagnostics: reporter.diagnostics,
    fileCount: loaded.files.length,
    seedCount: loaded.seeds.length,
    checked,
  };
  if (reporter.errorCount > 0) return result;

  const records = toRecords(checked);
  const ds = new MemoryDataset(records, { data_version: 'validate', git_sha: '', built_at: '', schema_version: '' });
  await checkRoundTrips(ds, checked, reporter);
  result.ok = reporter.errorCount === 0;
  if (result.ok) result.records = records;
  return result;
}

import { Reporter, type Diagnostic } from './diagnostics.js';
import { checkFiles, type CheckedFiles } from './checks.js';
import { loadSources, type DataSource } from './load.js';
import { MemoryDataset, toRecords, type Records } from './records.js';
import { checkRoundTrips } from './roundtrip.js';

export interface ValidateResult {
  ok: boolean;
  diagnostics: Diagnostic[];
  fileCount: number;
  checked: CheckedFiles;
  /** Present only when ok. */
  records?: Records;
}

/**
 * Full validation: YAML syntax, schemas, overlap, gap, bounds and reference checks, then
 * round-trip translation checks. Round trips run only once everything else passes, since
 * they need a consistent dataset.
 */
export async function validate(sources: readonly DataSource[], cwd = process.cwd()): Promise<ValidateResult> {
  const reporter = new Reporter();
  const files = await loadSources(sources, reporter, cwd);
  const checked = checkFiles(files, reporter);
  const result: ValidateResult = { ok: false, diagnostics: reporter.diagnostics, fileCount: files.length, checked };
  if (reporter.count > 0) return result;

  const records = toRecords(checked);
  const ds = new MemoryDataset(records, { data_version: 'validate', git_sha: '', built_at: '', schema_version: '' });
  await checkRoundTrips(ds, checked, reporter);
  result.ok = reporter.count === 0;
  if (result.ok) result.records = records;
  return result;
}

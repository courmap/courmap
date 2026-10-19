// Runs tests/releases.yaml and checks it against tests/releases.baseline.json.
// Usage: pnpm corpus [--update-baseline] [--summary <file>] [--json <file>]
// Fails when the verified pass rate drops below the baseline, or when any case expected to be
// ambiguous or unmatched comes back ok. Writes a Markdown report to --summary, or to
// $GITHUB_STEP_SUMMARY in CI.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { parse } from 'yaml';
import { MemoryDataset, validate } from '@courmap/builder';
import { createClient, type CourmapClient, type ResolveResult } from '../src/index.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const corpusFile = `${root}tests/releases.yaml`;
const baselineFile = `${root}tests/releases.baseline.json`;

export interface CorpusCase {
  name: string;
  expect: { status: 'ok' | 'ambiguous' | 'unmatched'; work?: string; episode?: number | null; episode_to?: number; top?: string };
  dataset?: 'data' | 'conformance';
  verified: boolean;
  source: string;
  notes?: string;
}

export interface Outcome {
  c: CorpusCase;
  r: ResolveResult;
  pass: boolean;
  /** Expected ambiguous or unmatched, got ok: never allowed. */
  falseOk: boolean;
}

export function judge(c: CorpusCase, r: ResolveResult): Outcome {
  const x = c.expect;
  let pass = r.status === x.status;
  if (pass && x.status === 'ok') {
    if (x.work !== undefined) pass &&= r.match?.work === x.work;
    if (x.episode !== undefined) pass &&= (r.match?.episode ?? null) === x.episode;
    if (x.episode_to !== undefined) pass &&= r.match?.episode_to === x.episode_to;
  }
  if (pass && x.status === 'ambiguous' && x.top !== undefined) pass &&= r.candidates[0]?.work === x.top;
  return { c, r, pass, falseOk: x.status !== 'ok' && r.status === 'ok' };
}

async function client(dataDir: string): Promise<CourmapClient> {
  const v = await validate(dataDir);
  if (!v.ok || !v.records) throw new Error(`${dataDir} does not validate`);
  return createClient(new MemoryDataset(v.records, { data_version: 'corpus', git_sha: '', built_at: '', schema_version: '' }));
}

const got = (r: ResolveResult) =>
  r.status === 'ok' ? `ok ${r.match!.work} ${r.match!.episode ?? ''}${r.match!.episode_to ? `-${r.match!.episode_to}` : ''}`.trim() : `${r.status}${r.candidates[0] ? ` (top ${r.candidates[0].work})` : ''}`;
const want = (c: CorpusCase) =>
  c.expect.status === 'ok' ? `ok ${c.expect.work ?? ''} ${c.expect.episode ?? ''}${c.expect.episode_to ? `-${c.expect.episode_to}` : ''}`.trim() : `${c.expect.status}${c.expect.top ? ` (top ${c.expect.top})` : ''}`;

async function main(): Promise<number> {
  const { values } = parseArgs({ options: { 'update-baseline': { type: 'boolean' }, summary: { type: 'string' }, json: { type: 'string' } } });
  const { cases } = parse(readFileSync(corpusFile, 'utf8')) as { cases: CorpusCase[] };
  const clients = { data: await client(`${root}data`), conformance: await client(`${root}tests/conformance/data`) };
  const outcomes: Outcome[] = [];
  for (const c of cases) outcomes.push(judge(c, await clients[c.dataset ?? 'data'].resolve(c.name)));

  const verified = outcomes.filter((o) => o.c.verified);
  const passed = verified.filter((o) => o.pass).length;
  const rate = verified.length === 0 ? 1 : passed / verified.length;
  const unverified = outcomes.filter((o) => !o.c.verified);
  const falseOks = outcomes.filter((o) => o.falseOk);
  const baseline = JSON.parse(readFileSync(baselineFile, 'utf8')) as { verified: number; passed: number; pass_rate: number };
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

  const lines = [
    '## Resolver corpus',
    '',
    `Verified pass rate: **${passed}/${verified.length} (${pct(rate)})**; baseline ${baseline.passed}/${baseline.verified} (${pct(baseline.pass_rate)}).`,
    `Unverified (imported, not counted): ${unverified.length}${unverified.length ? `, of which ${unverified.filter((o) => o.pass).length} match their recorded expectation` : ''}.`,
    `Ambiguous or unmatched cases returned as ok: **${falseOks.length}**.`,
    '',
  ];
  const failing = verified.filter((o) => !o.pass);
  if (failing.length > 0) {
    lines.push('| Failing release | Expected | Got |', '| --- | --- | --- |');
    for (const o of failing) lines.push(`| \`${o.c.name.replace(/\|/g, '\\|')}\` | ${want(o.c)} | ${got(o.r)} |`);
    lines.push('');
  }
  const report = lines.join('\n');
  console.log(report);
  for (const file of new Set([values.summary, process.env.GITHUB_STEP_SUMMARY])) if (file) appendFileSync(file, `${report}\n`);
  // Machine-readable result, for the README badge.
  if (values.json) writeFileSync(values.json, `${JSON.stringify({ verified: verified.length, passed, pass_rate: Number(rate.toFixed(4)), unverified: unverified.length })}\n`);

  if (values['update-baseline']) {
    writeFileSync(baselineFile, `${JSON.stringify({ verified: verified.length, passed, pass_rate: Number(rate.toFixed(4)) }, null, 2)}\n`);
    console.log(`Baseline updated to ${passed}/${verified.length}.`);
    return falseOks.length > 0 ? 1 : 0;
  }
  let code = 0;
  if (falseOks.length > 0) {
    console.error(`FAIL: ${falseOks.length} case(s) expected to be ambiguous or unmatched came back ok.`);
    code = 1;
  }
  // Compare exact fractions (passed / verified), not the rounded rate stored for reading.
  const lower = passed * baseline.verified < baseline.passed * verified.length;
  const higher = passed * baseline.verified > baseline.passed * verified.length;
  if (lower) {
    console.error(`FAIL: verified pass rate ${pct(rate)} is below the baseline ${pct(baseline.pass_rate)}.`);
    code = 1;
  } else if (higher || verified.length !== baseline.verified) {
    console.log('The pass rate or case count changed; run `pnpm corpus --update-baseline` and commit the new baseline.');
  }
  return code;
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

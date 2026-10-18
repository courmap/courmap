// Appends release names from a plain text file to tests/releases.yaml as unverified cases.
// Usage: pnpm corpus:import <names.txt> [--source <label>]
//
// Input: one release name (or file name, or full path) per line, UTF-8. Blank lines and lines
// starting with # are skipped; names already in the corpus are skipped.
//
// Each new case records what the resolver answers today as its expectation, marked
// verified: false, so it is excluded from the pass rate. A person then checks each one, fixes
// the expectation if it is wrong, and sets verified: true.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { parseDocument, isSeq } from 'yaml';
import { MemoryDataset, validate } from '@courmap/builder';
import { createClient, type ResolveResult } from '../src/index.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const corpusFile = `${root}tests/releases.yaml`;

/** Reads names from the text format: one per line, # comments, paths reduced to file names. */
export function readNames(text: string): string[] {
  return text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'))
    .map((l) => l.replace(/^.*[\\/]/, ''));
}

export function expectationOf(r: ResolveResult): Record<string, unknown> {
  if (r.status === 'ok') {
    return { status: 'ok', work: r.match!.work, ...(r.match!.episode !== null && { episode: r.match!.episode }), ...(r.match!.episode_to !== undefined && { episode_to: r.match!.episode_to }) };
  }
  if (r.status === 'ambiguous' && r.candidates[0]) return { status: 'ambiguous', top: r.candidates[0].work };
  return { status: r.status };
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { source: { type: 'string', default: 'imported' } } });
  const file = positionals[0];
  if (!file) {
    console.error('Usage: pnpm corpus:import <names.txt> [--source <label>]');
    return 1;
  }
  const doc = parseDocument(readFileSync(corpusFile, 'utf8'));
  const cases = doc.get('cases');
  if (!isSeq(cases)) throw new Error('tests/releases.yaml has no cases list');
  const existing = new Set((doc.toJS() as { cases: { name: string }[] }).cases.map((c) => c.name));

  const v = await validate(`${root}data`);
  if (!v.ok || !v.records) throw new Error('data/ does not validate');
  const client = createClient(new MemoryDataset(v.records, { data_version: 'import', git_sha: '', built_at: '', schema_version: '' }));

  const names = [...new Set(readNames(readFileSync(file, 'utf8')))].filter((n) => !existing.has(n));
  const today = new Date().toISOString().slice(0, 10);
  const tally: Record<string, number> = {};
  for (const name of names) {
    const r = await client.resolve(name);
    tally[r.status] = (tally[r.status] ?? 0) + 1;
    cases.add(
      doc.createNode({
        name,
        expect: expectationOf(r),
        verified: false,
        source: values.source,
        notes: `Imported ${today}: this is what the resolver answered then. Check it, correct it if needed, then set verified: true.`,
      }),
    );
  }
  writeFileSync(corpusFile, doc.toString({ lineWidth: 0 }));
  console.log(`Added ${names.length} unverified case(s) (${JSON.stringify(tally)}); skipped ${readNames(readFileSync(file, 'utf8')).length - names.length} already present or repeated.`);
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

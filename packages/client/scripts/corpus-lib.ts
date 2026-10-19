// Shared by corpus:import and corpus:from-proxy: adds release names to the corpus as unverified
// cases whose expectation is what the resolver answers today.
import { readFileSync, writeFileSync } from 'node:fs';
import { isSeq, parseDocument } from 'yaml';
import { MemoryDataset, validate } from '@courmap/builder';
import { createClient, type ResolveResult } from '../src/index.js';

export interface NewCase {
  name: string;
  source: string;
  /** Why the case was added, in addition to the standard "check it, then verify" note. */
  note?: string;
}

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

/**
 * Appends `cases` to the corpus file, skipping names it already has and repeats, each with today's
 * answer as its expectation and verified: false. Returns how many were added, by resolve status.
 */
export async function importCases(cases: NewCase[], opts: { corpusFile: string; dataDir: string; today?: string }): Promise<{ added: number; skipped: number; byStatus: Record<string, number> }> {
  const doc = parseDocument(readFileSync(opts.corpusFile, 'utf8'));
  const list = doc.get('cases');
  if (!isSeq(list)) throw new Error(`${opts.corpusFile} has no cases list`);
  const seen = new Set((doc.toJS() as { cases: { name: string }[] }).cases.map((c) => c.name));

  const v = await validate(opts.dataDir);
  if (!v.ok || !v.records) throw new Error(`${opts.dataDir} does not validate`);
  const client = createClient(new MemoryDataset(v.records, { data_version: 'import', git_sha: '', built_at: '', schema_version: '' }));

  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const byStatus: Record<string, number> = {};
  let added = 0;
  for (const c of cases) {
    if (seen.has(c.name)) continue;
    seen.add(c.name);
    const r = await client.resolve(c.name);
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    list.add(
      doc.createNode({
        name: c.name,
        expect: expectationOf(r),
        verified: false,
        source: c.source,
        notes: `Imported ${today}: this is what the resolver answered then. ${c.note ? `${c.note} ` : ''}Check it, correct it if needed, then set verified: true.`,
      }),
    );
    added++;
  }
  writeFileSync(opts.corpusFile, doc.toString({ lineWidth: 0 }));
  return { added, skipped: cases.length - added, byStatus };
}

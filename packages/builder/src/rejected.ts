import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { LineCounter, parseDocument } from 'yaml';
import type { AiringRejection, RejectedFile, RelationRejection, TmdbSplitRejection } from '@courmap/core';
import { makeLocator, type Reporter } from './diagnostics.js';
import { schemaIssues } from './schema.js';

/** data/rejected.yaml: bot proposals a maintainer rejected, which the bots never propose again. */
export const REJECTED_FILE = 'rejected.yaml';

export type Rejection = RelationRejection | AiringRejection | TmdbSplitRejection;

/**
 * Reads data/rejected.yaml (optional) and checks it against schema/rejected.schema.json and,
 * when `works` is given, that every work it names exists. Problems go to the reporter; the valid
 * entries are returned either way, so one bad entry never unblocks the others.
 */
export async function loadRejected(dataDir: string, reporter: Reporter, opts: { cwd?: string; works?: ReadonlySet<string> } = {}): Promise<Rejection[]> {
  const abs = path.join(dataDir, REJECTED_FILE);
  let text: string;
  try {
    text = await readFile(abs, 'utf8');
  } catch {
    return [];
  }
  const file = path.relative(opts.cwd ?? process.cwd(), abs).split(path.sep).join('/');
  const lineCounter = new LineCounter();
  const doc = parseDocument(text, { lineCounter, prettyErrors: false, uniqueKeys: true });
  if (doc.errors.length > 0) {
    for (const e of doc.errors) {
      const { line, col } = lineCounter.linePos(e.pos[0]);
      reporter.diagnostics.push({ severity: 'error', code: 'yaml-parse', file, line, column: col, path: [], message: e.message.split('\n')[0]! });
    }
    return [];
  }
  const loc = makeLocator(file, doc, lineCounter);
  const data = doc.toJS() as RejectedFile;
  const issues = schemaIssues('rejected', data);
  for (const issue of issues) reporter.report(loc, 'schema', issue.path, issue.message, { key: issue.key });
  const bad = new Set(issues.map((i) => i.path[1]).filter((i): i is number => typeof i === 'number'));
  if (issues.some((i) => i.path.length < 2)) return [];
  const out: Rejection[] = [];
  (data.rejected ?? []).forEach((r, i) => {
    if (bad.has(i)) return;
    if (opts.works) {
      for (const key of ['work', 'prequel'] as const) {
        const id = (r as Partial<RelationRejection>)[key];
        if (id !== undefined && !opts.works.has(id)) reporter.report(loc, 'unknown-work', ['rejected', i, key], `"${id}" is not a work in the data`);
      }
    }
    out.push(r);
  });
  return out;
}

/** Whether a proposed prequel link was rejected. */
export const rejectsRelation = (list: readonly Rejection[], work: string, prequel: string): Rejection | undefined =>
  list.find((r) => r.kind === 'relation' && r.work === work && r.prequel === prequel);

/** Whether the TMDB checker's split-cour proposal for a work was rejected. */
export const rejectsTmdbSplit = (list: readonly Rejection[], work: string): Rejection | undefined => list.find((r) => r.kind === 'tmdb-split' && r.work === work);

/** Whether a proposed airing update was rejected: same work, and every value the rejection names matches. */
export const rejectsAiring = (list: readonly Rejection[], work: string, update: { episodes: number | null; status: string }): Rejection | undefined =>
  list.find(
    (r) =>
      r.kind === 'airing' &&
      r.work === work &&
      (r.episodes === undefined || r.episodes === update.episodes) &&
      (r.status === undefined || r.status === update.status),
  );

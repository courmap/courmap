import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  AIRING_FILE,
  RELATIONS_FILE,
  Reporter,
  checkFiles,
  loadData,
  makeLineLocator,
  toRecords,
  type AiringLine,
  type Diagnostic,
  type LoadedData,
  type MergedWork,
  type Records,
  type RelationLine,
  type SeedSource,
} from '@courmap/builder';

/** The data the bots compare against: merged works, compiled records and the bot files as they are. */
export interface State {
  dataDir: string;
  loaded: LoadedData;
  merged: Map<string, MergedWork>;
  records: Records;
  /** AniList ID to work id. */
  byAnilist: Map<number, string>;
  relations: RelationLine[];
  airing: AiringLine[];
  /** Bounds warnings the data already has, as boundsKey strings. */
  boundsWarnings: Set<string>;
}

/** Bounds problems are warnings for seed-only works, so they never fail validation; the bots still must not add any. */
const BOUNDS_CODES = new Set(['out-of-bounds', 'open-ended-not-airing']);
const boundsKey = (d: Diagnostic) => `${d.work ?? ''}|${d.code}|${d.path.join('.')}`;

const sourceLines = (file: string, rows: readonly object[]): SeedSource[] =>
  rows.map((data, i) => ({ file, line: i + 1, data, loc: makeLineLocator(file, i + 1) }));

/** Compiles loaded data with the given bot files in place of the ones on disk. Errors are returned, not thrown. */
export function evaluate(
  loaded: LoadedData,
  relations: readonly RelationLine[],
  airing: readonly AiringLine[],
): { records: Records | null; merged: Map<string, MergedWork>; errors: Diagnostic[]; bounds: Map<string, Diagnostic> } {
  const reporter = new Reporter();
  const checked = checkFiles(
    { ...loaded, relations: sourceLines(`data/seeds/${RELATIONS_FILE}`, relations), airing: sourceLines(`data/seeds/${AIRING_FILE}`, airing) },
    reporter,
  );
  const errors = reporter.diagnostics.filter((d) => d.severity === 'error');
  const bounds = new Map(reporter.diagnostics.filter((d) => d.severity === 'warning' && BOUNDS_CODES.has(d.code)).map((d) => [boundsKey(d), d]));
  return { records: errors.length === 0 ? toRecords(checked) : null, merged: new Map(checked.works.map((w) => [w.id, w])), errors, bounds };
}

export async function loadState(dataDir: string): Promise<State> {
  const reporter = new Reporter();
  const loaded = await loadData(dataDir, reporter);
  if (reporter.errorCount > 0) throw new Error(`${dataDir} does not load: ${reporter.diagnostics.find((d) => d.severity === 'error')!.message}`);
  const relations = loaded.relations.map((s) => s.data as RelationLine);
  const airing = loaded.airing.map((s) => s.data as AiringLine);
  const { records, merged, errors, bounds } = evaluate(loaded, relations, airing);
  if (!records) throw new Error(`${dataDir} does not validate: ${errors[0]!.file}:${errors[0]!.line ?? ''} ${errors[0]!.message}`);
  const byAnilist = new Map<number, string>();
  for (const w of records.works.values()) if (w.ids.anilist !== undefined) byAnilist.set(Number(w.ids.anilist), w.id);
  return { dataDir, loaded, merged, records, byAnilist, relations, airing, boundsWarnings: new Set(bounds.keys()) };
}

/** Bot files are one JSON object per line, sorted by work, keys in a fixed order. */
export function relationsJsonl(rows: readonly RelationLine[]): string {
  return [...rows]
    .sort((a, b) => (a.work < b.work ? -1 : a.work > b.work ? 1 : 0))
    .map((r) => JSON.stringify({ work: r.work, prequel: r.prequel, relation: r.relation, origin: 'bot', ...(r.anilist && { anilist: r.anilist }) }) + '\n')
    .join('');
}

export function airingJsonl(rows: readonly AiringLine[]): string {
  return [...rows]
    .sort((a, b) => (a.work < b.work ? -1 : a.work > b.work ? 1 : 0))
    .map((r) => JSON.stringify({ work: r.work, episodes: r.episodes, status: r.status, origin: 'bot', ...(r.anilist !== undefined && { anilist: r.anilist }) }) + '\n')
    .join('');
}

/** The bot file currently on disk, or an empty string. */
export const readBotFile = (dataDir: string, name: string) => readFile(path.join(dataDir, 'seeds', name), 'utf8').catch(() => '');

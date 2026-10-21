import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { LineCounter, parseDocument, type Document } from 'yaml';
import { makeLineLocator, makeLocator, type Locator, type Reporter } from './diagnostics.js';

export type FileKind = 'work' | 'sequence' | 'group';
export const KIND_DIRS: Record<FileKind, string> = { work: 'works', sequence: 'sequences', group: 'groups' };

/** Where rows came from; becomes the `origin` column. Hand-written files are `manual`. */
export type Origin = 'manual' | 'bot' | 'offline-db' | 'anime-lists' | 'derived';
export const SEED_ORIGINS: readonly Origin[] = ['bot', 'offline-db', 'anime-lists'];

/** Seed shards are `data/seeds/works-NNN.jsonl`; other files in data/seeds/ are registry and reports. */
export const SEED_SHARD_RE = /^works-\d{3}\.jsonl$/;
/**
 * What the bots write, one small file per work so that two bot PRs never touch the same file
 * (decided by Xwolv, 2026-10-20): data/seeds/<dir>/<work-id>.json, each holding one JSON object.
 */
/** Prequel relations written by the bots from AniList (decision S4.1). */
export const RELATIONS_DIR = 'relations';
/** Episode counts and status of airing works, written by the bots' airing tracker. */
export const AIRING_DIR = 'airing';
/** TMDB projections for cours that TMDB keeps inside the previous season, proposed by the bots' TMDB checker. */
export const TMDB_SPLITS_DIR = 'tmdb-splits';
/** The path of a work's bot file under data/seeds/, forward slashes. */
export const botFilePath = (dir: string, work: string) => `data/seeds/${dir}/${work}.json`;

/** A hand-written YAML file under works/, sequences/ or groups/. */
export interface SourceFile {
  kind: FileKind;
  /** Path relative to the working directory, forward slashes, for messages. */
  file: string;
  /** File name without extension. */
  name: string;
  doc: Document;
  data: unknown;
  loc: Locator;
}

/** One seeded work: a line of a seed shard. */
export interface SeedSource {
  file: string;
  line: number;
  data: unknown;
  loc: Locator;
}

export interface LoadedData {
  files: SourceFile[];
  seeds: SeedSource[];
  /** Files of data/seeds/relations/, one object each. */
  relations: SeedSource[];
  /** Files of data/seeds/airing/, one object each. */
  airing: SeedSource[];
  /** Files of data/seeds/tmdb-splits/, one object each. */
  tmdbSplits: SeedSource[];
}

const toPosix = (p: string) => p.split(path.sep).join('/');

async function listDir(dir: string, test: (name: string) => boolean): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && test(e.name))
      .map((e) => path.join(dir, e.name))
      .sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

/**
 * Loads a data directory: YAML under works/, sequences/ and groups/, and seed works from
 * seeds/works-NNN.jsonl. Syntax errors are reported and the file or line is skipped.
 */
export async function loadData(dataDir: string, reporter: Reporter, cwd = process.cwd()): Promise<LoadedData> {
  const files: SourceFile[] = [];
  for (const kind of Object.keys(KIND_DIRS) as FileKind[]) {
    for (const abs of await listDir(path.join(dataDir, KIND_DIRS[kind]), (n) => /\.ya?ml$/.test(n))) {
      const file = toPosix(path.relative(cwd, abs));
      const lineCounter = new LineCounter();
      const text = await readFile(abs, 'utf8');
      const doc = parseDocument(text, { lineCounter, prettyErrors: false, uniqueKeys: true });
      const loc = makeLocator(file, doc, lineCounter);
      if (doc.errors.length > 0) {
        for (const e of doc.errors) {
          const { line, col } = lineCounter.linePos(e.pos[0]);
          reporter.diagnostics.push({ severity: 'error', code: 'yaml-parse', file, line, column: col, path: [], message: e.message.split('\n')[0]! });
        }
        continue;
      }
      files.push({ kind, file, name: path.basename(abs).replace(/\.ya?ml$/, ''), doc, data: doc.toJS(), loc });
    }
  }

  const seeds: SeedSource[] = [];
  for (const abs of await listDir(path.join(dataDir, 'seeds'), (n) => SEED_SHARD_RE.test(n))) seeds.push(...(await readJsonl(abs, reporter, cwd)));
  const botFiles = async (dir: string) => {
    const out: SeedSource[] = [];
    for (const abs of await listDir(path.join(dataDir, 'seeds', dir), (n) => n.endsWith('.json'))) {
      const file = toPosix(path.relative(cwd, abs));
      const loc = makeLineLocator(file, 1);
      try {
        out.push({ file, line: 1, data: JSON.parse(await readFile(abs, 'utf8')) as unknown, loc });
      } catch (err) {
        reporter.report(loc, 'seed-parse', [], `not valid JSON: ${(err as Error).message}`);
      }
    }
    return out;
  };
  return { files, seeds, relations: await botFiles(RELATIONS_DIR), airing: await botFiles(AIRING_DIR), tmdbSplits: await botFiles(TMDB_SPLITS_DIR) };
}

/** One JSON value per line; blank lines are skipped and bad lines reported as seed-parse. */
async function readJsonl(abs: string, reporter: Reporter, cwd: string): Promise<SeedSource[]> {
  const file = toPosix(path.relative(cwd, abs));
  const out: SeedSource[] = [];
  (await readFile(abs, 'utf8')).split('\n').forEach((text, i) => {
    if (text.trim() === '') return;
    const loc = makeLineLocator(file, i + 1);
    try {
      out.push({ file, line: i + 1, data: JSON.parse(text) as unknown, loc });
    } catch (err) {
      reporter.report(loc, 'seed-parse', [], `not valid JSON: ${(err as Error).message}`);
    }
  });
  return out;
}

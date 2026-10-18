import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { LineCounter, parseDocument, type Document } from 'yaml';
import { makeLocator, type Locator, type Reporter } from './diagnostics.js';

export type FileKind = 'work' | 'sequence' | 'group';
export const KIND_DIRS: Record<FileKind, string> = { work: 'works', sequence: 'sequences', group: 'groups' };

/** Where rows came from; becomes the `origin` column. Hand-written files are `manual`. */
export type Origin = 'manual' | 'bot' | 'offline-db' | 'anime-lists';

/** A directory laid out like data/: works/, sequences/ and groups/ subdirectories of YAML files. */
export interface DataSource {
  dir: string;
  origin: Origin;
}

export interface SourceFile {
  kind: FileKind;
  origin: Origin;
  /** Path relative to the working directory, forward slashes, for messages. */
  file: string;
  /** File name without extension. */
  name: string;
  doc: Document;
  data: unknown;
  loc: Locator;
}

const toPosix = (p: string) => p.split(path.sep).join('/');

async function listYaml(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && /\.ya?ml$/.test(e.name))
      .map((e) => path.join(dir, e.name))
      .sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
}

/**
 * Loads every YAML file from the given sources. YAML syntax errors are reported and the
 * file is skipped. Later build steps add seed sources here (data/seeds/ with its own origin).
 */
export async function loadSources(sources: readonly DataSource[], reporter: Reporter, cwd = process.cwd()): Promise<SourceFile[]> {
  const files: SourceFile[] = [];
  for (const source of sources) {
    for (const kind of Object.keys(KIND_DIRS) as FileKind[]) {
      for (const abs of await listYaml(path.join(source.dir, KIND_DIRS[kind]))) {
        const file = toPosix(path.relative(cwd, abs));
        const lineCounter = new LineCounter();
        const text = await readFile(abs, 'utf8');
        const doc = parseDocument(text, { lineCounter, prettyErrors: false, uniqueKeys: true });
        const loc = makeLocator(file, doc, lineCounter);
        if (doc.errors.length > 0) {
          for (const e of doc.errors) {
            const { line, col } = lineCounter.linePos(e.pos[0]);
            reporter.diagnostics.push({ code: 'yaml-parse', file, line, column: col, path: [], message: e.message.split('\n')[0]! });
          }
          continue;
        }
        files.push({
          kind,
          origin: source.origin,
          file,
          name: path.basename(abs).replace(/\.ya?ml$/, ''),
          doc,
          data: doc.toJS(),
          loc,
        });
      }
    }
  }
  return files;
}

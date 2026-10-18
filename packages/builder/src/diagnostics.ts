import { isMap, isScalar, isSeq, type Document, type LineCounter, type Node } from 'yaml';

export type DiagnosticCode =
  | 'yaml-parse'
  | 'schema'
  | 'filename-mismatch'
  | 'duplicate-id'
  | 'unknown-episode-count'
  | 'invalid-range'
  | 'kind-mismatch'
  | 'start-target-conflict'
  | 'invalid-target'
  | 'missing-provider-id'
  | 'open-ended-not-airing'
  | 'out-of-bounds'
  | 'overlap'
  | 'gap'
  | 'gap-marker-unused'
  | 'coverage-notes'
  | 'coverage-unused'
  | 'target-overlap'
  | 'unknown-work'
  | 'duplicate-provider-id'
  | 'sequence-overlap'
  | 'open-ended-not-last'
  | 'sequence-default'
  | 'override-sequence'
  | 'offset-mismatch'
  | 'missing-prequel'
  | 'duplicate-alias'
  | 'round-trip'
  | 'seed-parse'
  | 'seed-origin'
  | 'missing-field'
  | 'slug-conflict';

export type PathSegment = string | number;

/** info: noted, never a problem (movie part counts). warning: shown, never fails validation. */
export type Severity = 'error' | 'warning' | 'info';

export interface Diagnostic {
  severity: Severity;
  code: DiagnosticCode;
  /** Repo-relative path with forward slashes. */
  file: string;
  line?: number;
  column?: number;
  path: PathSegment[];
  message: string;
  /** The work this is about, when it is about one; with path, names the part at fault. */
  work?: string;
  /** For conflicts between two parts: the other side. */
  related?: { work: string; path: PathSegment[] };
}

export function formatPath(path: readonly PathSegment[]): string {
  let out = '';
  for (const seg of path) out += typeof seg === 'number' ? `[${seg}]` : out ? `.${seg}` : seg;
  return out;
}

export function formatDiagnostic(d: Diagnostic): string {
  const loc = d.line !== undefined ? `${d.file}:${d.line}:${d.column ?? 1}` : d.file;
  const where = d.path.length > 0 ? ` ${formatPath(d.path)}:` : '';
  const level = d.severity === 'error' ? '' : `${d.severity} `;
  return `${loc} [${level}${d.code}]${where} ${d.message}`;
}

/**
 * Finds the YAML node at `path`, falling back to the deepest existing ancestor,
 * so a diagnostic about a missing field points at the object that lacks it.
 */
function nodeAt(doc: Document, path: readonly PathSegment[], key: boolean): Node | null {
  let node: unknown = doc.contents;
  let best: Node | null = (doc.contents as Node | null) ?? null;
  for (let i = 0; i < path.length; i++) {
    const seg = path[i];
    const last = i === path.length - 1;
    if (isMap(node)) {
      const pair = node.items.find((p) => isScalar(p.key) && p.key.value === seg);
      if (!pair) return best;
      if (last && key && pair.key) return pair.key as Node;
      node = pair.value;
    } else if (isSeq(node) && typeof seg === 'number') {
      node = node.items[seg];
    } else {
      return best;
    }
    if (node && typeof node === 'object' && 'range' in node) best = node as Node;
    else return best;
  }
  return best;
}

export interface Location {
  file: string;
  line?: number;
  column?: number;
}

/** Maps a path inside one work, sequence or group to a place in a source file. */
export interface Locator {
  locate(path: readonly PathSegment[], opts?: { key?: boolean }): Location;
}

/** Locator for a YAML document: resolves paths to node positions. */
export function makeLocator(file: string, doc: Document | null, lineCounter: LineCounter | null): Locator {
  return {
    locate(path, opts = {}) {
      if (!doc || !lineCounter) return { file };
      const node = nodeAt(doc, path, opts.key ?? false);
      const offset = node?.range?.[0];
      if (offset === undefined) return { file };
      const { line, col } = lineCounter.linePos(offset);
      return { file, line, column: col };
    },
  };
}

/** Locator for one JSONL line: every path points at the line. */
export function makeLineLocator(file: string, line: number): Locator {
  return { locate: () => ({ file, line, column: 1 }) };
}

export interface ReportOptions {
  key?: boolean;
  severity?: Severity;
  work?: string;
  related?: { work: string; path: PathSegment[] };
}

/** Collects diagnostics with source positions attached. */
export class Reporter {
  readonly diagnostics: Diagnostic[] = [];

  report(loc: Locator, code: DiagnosticCode, path: PathSegment[], message: string, opts: ReportOptions = {}): void {
    this.diagnostics.push({
      severity: opts.severity ?? 'error',
      code,
      ...loc.locate(path, opts),
      path,
      message,
      ...(opts.work !== undefined && { work: opts.work }),
      ...(opts.related !== undefined && { related: opts.related }),
    });
  }

  /** Number of errors (warnings do not fail validation). */
  get errorCount(): number {
    return this.diagnostics.filter((d) => d.severity === 'error').length;
  }
}

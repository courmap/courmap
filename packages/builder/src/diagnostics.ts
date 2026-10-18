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
  | 'target-overlap'
  | 'unknown-work'
  | 'duplicate-provider-id'
  | 'sequence-overlap'
  | 'open-ended-not-last'
  | 'work-in-multiple-sequences'
  | 'offset-mismatch'
  | 'missing-prequel'
  | 'duplicate-alias'
  | 'round-trip';

export type PathSegment = string | number;

export interface Diagnostic {
  code: DiagnosticCode;
  /** Repo-relative path with forward slashes. */
  file: string;
  line?: number;
  column?: number;
  path: PathSegment[];
  message: string;
}

export function formatPath(path: readonly PathSegment[]): string {
  let out = '';
  for (const seg of path) out += typeof seg === 'number' ? `[${seg}]` : out ? `.${seg}` : seg;
  return out;
}

export function formatDiagnostic(d: Diagnostic): string {
  const loc = d.line !== undefined ? `${d.file}:${d.line}:${d.column ?? 1}` : d.file;
  const where = d.path.length > 0 ? ` ${formatPath(d.path)}:` : '';
  return `${loc} [${d.code}]${where} ${d.message}`;
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

export interface Locator {
  file: string;
  locate(path: readonly PathSegment[], opts?: { key?: boolean }): { line?: number; column?: number };
}

export function makeLocator(file: string, doc: Document | null, lineCounter: LineCounter | null): Locator {
  return {
    file,
    locate(path, opts = {}) {
      if (!doc || !lineCounter) return {};
      const node = nodeAt(doc, path, opts.key ?? false);
      const offset = node?.range?.[0];
      if (offset === undefined) return {};
      const { line, col } = lineCounter.linePos(offset);
      return { line, column: col };
    },
  };
}

/** Collects diagnostics with source positions attached. */
export class Reporter {
  readonly diagnostics: Diagnostic[] = [];

  report(loc: Locator, code: DiagnosticCode, path: PathSegment[], message: string, opts?: { key?: boolean }): void {
    this.diagnostics.push({ code, file: loc.file, path, message, ...loc.locate(path, opts) });
  }

  get count(): number {
    return this.diagnostics.length;
  }
}

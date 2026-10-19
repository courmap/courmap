import { readFileSync } from 'node:fs';
import { writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import type { AssistedMapping } from './assist.js';
import type { PassReason, RewriteOutcome } from './rewrite.js';

export interface IndexerStats {
  requests: number;
  searches: number;
  translated: number;
  items: number;
  rewritten: number;
  /** Of `rewritten`, how many used Sonarr-assisted numbering (decision S7.1). */
  assisted: number;
  passed: Partial<Record<PassReason, number>>;
  upstreamErrors: number;
  lastSearch: string | null;
}

export interface UnresolvedEntry {
  name: string;
  status: 'ambiguous' | 'unmatched';
  detail: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
}

/** One work numbered with Sonarr's help, with how often it was used and example release names. */
export interface AssistedEntry {
  mapping: AssistedMapping;
  count: number;
  examples: string[];
  firstSeen: string;
  lastSeen: string;
}

const MAX_UNRESOLVED = 500;
const MAX_ASSISTED = 500;
const MAX_EXAMPLES = 5;

/**
 * Counters per indexer, the local log of names Courmap could not resolve (decision S5.3: local
 * only, nothing is sent anywhere), and the works numbered with Sonarr's help (decision S7.1).
 * The logs are kept in <dataDir>/unresolved.jsonl and <dataDir>/assisted.jsonl.
 */
export class Stats {
  readonly started = new Date().toISOString();
  readonly indexers = new Map<string, IndexerStats>();
  private unresolved = new Map<string, UnresolvedEntry>();
  private assisted = new Map<string, AssistedEntry>();
  private saveTimer: NodeJS.Timeout | null = null;

  /** `dir` is where the logs live; null keeps everything in memory (tests). */
  constructor(private readonly dir: string | null) {
    if (!dir) return;
    for (const e of readJsonl<UnresolvedEntry>(path.join(dir, 'unresolved.jsonl'))) this.unresolved.set(e.name, e);
    for (const e of readJsonl<AssistedEntry>(path.join(dir, 'assisted.jsonl'))) this.assisted.set(e.mapping.work, e);
  }

  static in(dataDir: string): Stats {
    return new Stats(dataDir);
  }

  of(indexer: string): IndexerStats {
    let s = this.indexers.get(indexer);
    if (!s) this.indexers.set(indexer, (s = { requests: 0, searches: 0, translated: 0, items: 0, rewritten: 0, assisted: 0, passed: {}, upstreamErrors: 0, lastSearch: null }));
    return s;
  }

  record(indexer: string, name: string, outcome: RewriteOutcome, now = new Date()): void {
    const s = this.of(indexer);
    const at = now.toISOString();
    s.items++;
    if (outcome.kind === 'rewritten') {
      s.rewritten++;
      if (outcome.assisted) {
        s.assisted++;
        const prev = this.assisted.get(outcome.assisted.work);
        const examples = prev ? (prev.examples.includes(name) || prev.examples.length >= MAX_EXAMPLES ? prev.examples : [...prev.examples, name]) : [name];
        // The newest mapping wins: Sonarr's episode list may have grown since.
        this.assisted.set(outcome.assisted.work, { mapping: outcome.assisted, count: (prev?.count ?? 0) + 1, examples, firstSeen: prev?.firstSeen ?? at, lastSeen: at });
        trim(this.assisted, MAX_ASSISTED);
        this.scheduleSave();
      }
      return;
    }
    s.passed[outcome.reason] = (s.passed[outcome.reason] ?? 0) + 1;
    if (outcome.reason !== 'ambiguous' && outcome.reason !== 'unmatched') return;
    const prev = this.unresolved.get(name);
    this.unresolved.set(name, prev ? { ...prev, count: prev.count + 1, lastSeen: at, detail: outcome.detail } : { name, status: outcome.reason, detail: outcome.detail, count: 1, firstSeen: at, lastSeen: at });
    trim(this.unresolved, MAX_UNRESOLVED);
    this.scheduleSave();
  }

  /** Most frequent first. */
  unresolvedList(): UnresolvedEntry[] {
    return [...this.unresolved.values()].sort((a, b) => b.count - a.count || (a.lastSeen < b.lastSeen ? 1 : -1));
  }

  /** Most used first. */
  assistedList(): AssistedEntry[] {
    return [...this.assisted.values()].sort((a, b) => b.count - a.count || (a.mapping.work < b.mapping.work ? -1 : 1));
  }

  private scheduleSave(): void {
    if (!this.dir || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.save();
    }, 5_000);
    this.saveTimer.unref();
  }

  async save(): Promise<void> {
    if (!this.dir) return;
    await writeJsonl(path.join(this.dir, 'unresolved.jsonl'), this.unresolvedList());
    await writeJsonl(path.join(this.dir, 'assisted.jsonl'), this.assistedList());
  }
}

/** Drops the least recently seen entries beyond `max`. */
function trim<T extends { lastSeen: string }>(map: Map<string, T>, max: number): void {
  while (map.size > max) {
    const oldest = [...map].sort((a, b) => (a[1].lastSeen < b[1].lastSeen ? -1 : 1))[0]!;
    map.delete(oldest[0]);
  }
}

function readJsonl<T>(file: string): T[] {
  try {
    return readFileSync(file, 'utf8')
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as T);
  } catch {
    return []; // no log yet
  }
}

async function writeJsonl(file: string, rows: unknown[]): Promise<void> {
  const text = rows.map((e) => JSON.stringify(e)).join('\n') + '\n';
  await writeFile(`${file}.tmp`, text)
    .then(() => rename(`${file}.tmp`, file))
    .catch(() => {});
}

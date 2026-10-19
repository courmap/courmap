import { readFileSync } from 'node:fs';
import { writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import type { PassReason, RewriteOutcome } from './rewrite.js';

export interface IndexerStats {
  requests: number;
  searches: number;
  translated: number;
  items: number;
  rewritten: number;
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

const MAX_UNRESOLVED = 500;

/**
 * Counters per indexer and the local log of names Courmap could not resolve (decision S5.3:
 * local only, nothing is sent anywhere). The log is kept in <dataDir>/unresolved.jsonl.
 */
export class Stats {
  readonly started = new Date().toISOString();
  readonly indexers = new Map<string, IndexerStats>();
  private unresolved = new Map<string, UnresolvedEntry>();
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(private readonly file: string | null) {
    if (!file) return;
    try {
      for (const line of readFileSync(file, 'utf8').split('\n')) if (line.trim()) {
        const e = JSON.parse(line) as UnresolvedEntry;
        this.unresolved.set(e.name, e);
      }
    } catch {
      // No log yet.
    }
  }

  static in(dataDir: string): Stats {
    return new Stats(path.join(dataDir, 'unresolved.jsonl'));
  }

  of(indexer: string): IndexerStats {
    let s = this.indexers.get(indexer);
    if (!s) this.indexers.set(indexer, (s = { requests: 0, searches: 0, translated: 0, items: 0, rewritten: 0, passed: {}, upstreamErrors: 0, lastSearch: null }));
    return s;
  }

  record(indexer: string, name: string, outcome: RewriteOutcome, now = new Date()): void {
    const s = this.of(indexer);
    s.items++;
    if (outcome.kind === 'rewritten') {
      s.rewritten++;
      return;
    }
    s.passed[outcome.reason] = (s.passed[outcome.reason] ?? 0) + 1;
    if (outcome.reason !== 'ambiguous' && outcome.reason !== 'unmatched') return;
    const at = now.toISOString();
    const prev = this.unresolved.get(name);
    this.unresolved.set(name, prev ? { ...prev, count: prev.count + 1, lastSeen: at, detail: outcome.detail } : { name, status: outcome.reason, detail: outcome.detail, count: 1, firstSeen: at, lastSeen: at });
    if (this.unresolved.size > MAX_UNRESOLVED) {
      const oldest = [...this.unresolved.values()].sort((a, b) => (a.lastSeen < b.lastSeen ? -1 : 1))[0]!;
      this.unresolved.delete(oldest.name);
    }
    this.scheduleSave();
  }

  /** Most frequent first. */
  unresolvedList(): UnresolvedEntry[] {
    return [...this.unresolved.values()].sort((a, b) => b.count - a.count || (a.lastSeen < b.lastSeen ? 1 : -1));
  }

  private scheduleSave(): void {
    if (!this.file || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.save();
    }, 5_000);
    this.saveTimer.unref();
  }

  async save(): Promise<void> {
    if (!this.file) return;
    const text = this.unresolvedList().map((e) => JSON.stringify(e)).join('\n') + '\n';
    await writeFile(`${this.file}.tmp`, text).then(() => rename(`${this.file}.tmp`, this.file!)).catch(() => {});
  }
}

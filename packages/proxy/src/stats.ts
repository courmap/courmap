import { readFileSync } from 'node:fs';
import { writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import type { AssistedMapping } from './assist.js';
import type { Protocol, UpstreamFailure } from './feed.js';
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
  /** What the upstream feed's results say its protocol is; null until a feed has said. */
  detected: Protocol | null;
  /** Requests actually sent to the indexer (not counting cache hits), and how often a cached answer was used instead. */
  upstreamRequests: number;
  upstreamCacheHits: number;
  /** Queries not sent because an earlier query of the same episode search already found the episode. */
  upstreamSkipped: number;
  /** Why upstream requests failed, by kind (`upstreamErrors` is their sum), and the latest failure in words. */
  upstreamFailures: Partial<Record<UpstreamFailure, number>>;
  lastUpstreamError: { at: string; kind: UpstreamFailure; detail: string } | null;
  /** When an upstream request last succeeded, so the status page can tell a past failure from a current one. */
  lastUpstreamOk: string | null;
}

/** What one indexer was asked on one UTC day: indexers enforce their API limits per day. */
export interface DayCount {
  requests: number;
  cacheHits: number;
  errors: number;
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
const DAYS_KEPT = 14;

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
  /** indexer -> UTC date (YYYY-MM-DD) -> counts. */
  private days = new Map<string, Map<string, DayCount>>();
  private saveTimer: NodeJS.Timeout | null = null;

  /** `dir` is where the logs live; null keeps everything in memory (tests). */
  constructor(private readonly dir: string | null) {
    if (!dir) return;
    for (const e of readJsonl<UnresolvedEntry>(path.join(dir, 'unresolved.jsonl'))) this.unresolved.set(e.name, e);
    for (const e of readJsonl<AssistedEntry>(path.join(dir, 'assisted.jsonl'))) this.assisted.set(e.mapping.work, e);
    for (const [indexer, byDay] of Object.entries(readJson<Record<string, Record<string, DayCount>>>(path.join(dir, 'upstream-days.json')) ?? {})) this.days.set(indexer, new Map(Object.entries(byDay)));
  }

  static in(dataDir: string): Stats {
    return new Stats(dataDir);
  }

  of(indexer: string): IndexerStats {
    let s = this.indexers.get(indexer);
    if (!s) this.indexers.set(indexer, (s = { requests: 0, searches: 0, translated: 0, items: 0, rewritten: 0, assisted: 0, passed: {}, upstreamErrors: 0, lastSearch: null, detected: null, upstreamRequests: 0, upstreamCacheHits: 0, upstreamSkipped: 0, upstreamFailures: {}, lastUpstreamError: null, lastUpstreamOk: null }));
    return s;
  }

  /** One request sent to an indexer, and how it went (`failure` is null on success). */
  countUpstream(indexer: string, failure: { kind: UpstreamFailure; detail: string } | null, now = new Date()): void {
    const s = this.of(indexer);
    const day = this.day(indexer, now);
    s.upstreamRequests++;
    day.requests++;
    if (failure) {
      s.upstreamErrors++;
      day.errors++;
      s.upstreamFailures[failure.kind] = (s.upstreamFailures[failure.kind] ?? 0) + 1;
      s.lastUpstreamError = { at: now.toISOString(), kind: failure.kind, detail: failure.detail };
    } else {
      s.lastUpstreamOk = now.toISOString();
    }
    this.scheduleSave();
  }

  /** A request answered from the cache instead of the indexer. */
  countCacheHit(indexer: string, now = new Date()): void {
    this.of(indexer).upstreamCacheHits++;
    this.day(indexer, now).cacheHits++;
    this.scheduleSave();
  }

  private day(indexer: string, now: Date): DayCount {
    let byDay = this.days.get(indexer);
    if (!byDay) this.days.set(indexer, (byDay = new Map()));
    const date = now.toISOString().slice(0, 10);
    let c = byDay.get(date);
    if (!c) {
      byDay.set(date, (c = { requests: 0, cacheHits: 0, errors: 0 }));
      for (const old of [...byDay.keys()].sort().slice(0, -DAYS_KEPT)) byDay.delete(old);
    }
    return c;
  }

  /** The last `n` UTC days (today first) for an indexer, zeros where nothing was asked. */
  recentDays(indexer: string, n = 7, now = new Date()): { date: string; requests: number; cacheHits: number; errors: number }[] {
    const byDay = this.days.get(indexer);
    return Array.from({ length: n }, (_, i) => {
      const date = new Date(now.getTime() - i * 86_400_000).toISOString().slice(0, 10);
      return { date, ...(byDay?.get(date) ?? { requests: 0, cacheHits: 0, errors: 0 }) };
    });
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
    const days = Object.fromEntries([...this.days].map(([indexer, byDay]) => [indexer, Object.fromEntries(byDay)]));
    await writeFile(path.join(this.dir, 'upstream-days.json.tmp'), JSON.stringify(days))
      .then(() => rename(path.join(this.dir!, 'upstream-days.json.tmp'), path.join(this.dir!, 'upstream-days.json')))
      .catch(() => {});
  }
}

/** Drops the least recently seen entries beyond `max`. */
function trim<T extends { lastSeen: string }>(map: Map<string, T>, max: number): void {
  while (map.size > max) {
    const oldest = [...map].sort((a, b) => (a[1].lastSeen < b[1].lastSeen ? -1 : 1))[0]!;
    map.delete(oldest[0]);
  }
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    return null; // not written yet
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

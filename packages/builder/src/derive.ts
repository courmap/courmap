import type { SequenceFile } from '@courmap/core';
import { parseEntry, landingEnd, type ParsedEntry, type Typed } from './checks.js';
import { readBlock } from './blocks.js';
import type { MergedWork } from './merge.js';

/** A sequence derived from TVDB order (Xwolv decision S3.7). */
export interface DerivedSequence {
  id: string;
  members: { work: string; ep_from: number; ep_to: number | null; absolute_start: number }[];
}

export interface Derived {
  /** Work id to prequel id, for works with no prequel of their own (decision S3.6). */
  prequels: Map<string, string>;
  sequences: DerivedSequence[];
  /** Runs skipped because a member already has a manual sequence. */
  skippedRuns: number;
}

interface Placed {
  work: MergedWork;
  first: { season: number; target: number };
  last: { season: number; target: number };
  /** Regular episodes 1..episodes are all mapped, without holes, and the last row is closed. */
  complete: boolean;
  open: boolean;
  /** Finished with a closed range: its count is final, so another work may follow it. */
  finished: boolean;
}

/** Where a work's regular TVDB episodes start and end, or null when it has none in seasons 1 and up. */
function place(w: MergedWork): Placed | null {
  const written = w.data.projections?.tvdb_show;
  if (!written || w.data.type === 'movie') return null;
  const rows = readBlock(written, 'tvdb_show')
    .ranges.map((e, i) => parseEntry(e, i, () => {}))
    .filter((p): p is ParsedEntry => p !== null && p.kind === 'regular')
    .sort((a, b) => a.span.from - b.span.from);
  if (rows.length === 0) return null;
  const firstRow = rows[0]!;
  const lastRow = rows[rows.length - 1]!;
  // Specials (season 0) and seasonless orderings do not take part in season order.
  if (firstRow.season === null || firstRow.season === 0 || lastRow.season === null) return null;
  const episodes = w.data.episodes ?? null;
  let next = 1;
  let holes = false;
  for (const r of rows) {
    if (r.span.from !== next) holes = true;
    next = r.span.to === null ? Infinity : r.span.to + 1;
  }
  const open = lastRow.span.to === null;
  // Upcoming works carry placeholder counts (cedya77 often says 1), so they never join a sequence.
  const status = w.data.status ?? 'finished';
  const complete = status !== 'upcoming' && !holes && episodes !== null && (open || next === episodes + 1);
  const finished = status === 'finished' && !open;
  const end = landingEnd(lastRow);
  return {
    work: w,
    first: { season: firstRow.season, target: firstRow.targetFrom },
    last: { season: lastRow.season, target: end },
    complete,
    open,
    finished,
  };
}

/** b continues a: same season, next episode; or the next season from episode 1. Only a finished work can be followed. */
const continues = (a: Placed, b: Placed) =>
  a.complete &&
  a.finished &&
  b.complete &&
  ((b.first.season === a.last.season && b.first.target === a.last.target + 1) || (b.first.season === a.last.season + 1 && b.first.target === 1));

/**
 * Derives prequel chains and absolute sequences from works that share a TVDB show
 * (Xwolv decisions S3.6 and S3.7). Works are ordered by where their regular episodes start in
 * TVDB (season, then episode). Each work's prequel is the work before it, unless it already
 * has one. Runs of two or more works that continue each other without a gap become one
 * sequence, unless any of them is in a manual sequence.
 */
export function deriveFromTvdb(works: readonly MergedWork[], manualSequences: readonly Typed<SequenceFile>[]): Derived {
  const inManualSequence = new Set(manualSequences.flatMap((s) => s.data.members.map((m) => m.work)));
  const takenIds = new Set(manualSequences.map((s) => s.data.id));
  const byShow = new Map<string, Placed[]>();
  for (const w of works) {
    const show = w.data.ids?.tvdb_show;
    if (show == null) continue;
    const p = place(w);
    if (p) byShow.set(String(show), [...(byShow.get(String(show)) ?? []), p]);
  }

  const prequels = new Map<string, string>();
  const sequences: DerivedSequence[] = [];
  let skippedRuns = 0;
  for (const show of [...byShow.keys()].sort((a, b) => Number(a) - Number(b))) {
    const chain = byShow.get(show)!.sort(
      (a, b) => a.first.season - b.first.season || a.first.target - b.first.target || (a.work.id < b.work.id ? -1 : 1),
    );
    for (let i = 1; i < chain.length; i++) {
      const w = chain[i]!.work;
      if (w.data.prequel === undefined) prequels.set(w.id, chain[i - 1]!.work.id);
    }

    let run: Placed[] = [chain[0]!];
    const flush = () => {
      if (run.length >= 2) {
        if (run.some((p) => inManualSequence.has(p.work.id))) skippedRuns++;
        else {
          let id = `${run[0]!.work.id}-absolute`;
          if (takenIds.has(id)) id = `${id}-derived`;
          takenIds.add(id);
          let start = 1;
          sequences.push({
            id,
            members: run.map((p) => {
              const member = { work: p.work.id, ep_from: 1, ep_to: p.open ? null : p.work.data.episodes!, absolute_start: start };
              start += p.work.data.episodes ?? 0;
              return member;
            }),
          });
        }
      }
    };
    for (let i = 1; i < chain.length; i++) {
      if (continues(chain[i - 1]!, chain[i]!)) run.push(chain[i]!);
      else {
        flush();
        run = [chain[i]!];
      }
    }
    flush();
  }
  return { prequels, sequences, skippedRuns };
}

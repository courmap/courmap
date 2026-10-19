import type { Records } from '@courmap/builder';
import type { SequenceRecord } from '@courmap/core';

export interface AbsoluteRange {
  sequence: string;
  from: number;
  /** null while open-ended. */
  to: number | null;
}

/** A work whose absolute numbers differ between two datasets. */
export interface Shift {
  work: string;
  before: AbsoluteRange;
  /** null when the work left the sequence. */
  after: AbsoluteRange | null;
  /** The work is finished, so releases numbered the old way exist: tier C (decision S4.2). */
  finished: boolean;
}

export interface SequenceDiff {
  /** Existing sequences whose members changed in any way (at least tier B). */
  changed: string[];
  /** Sequences that did not exist before. */
  added: string[];
  shifts: Shift[];
}

type Member = SequenceRecord['members'][number];

const key = (m: Member) => `${m.work}:${m.ep_from}:${m.ep_to}:${m.absolute_start}`;
const range = (sequence: string, m: Member): AbsoluteRange => ({
  sequence,
  from: m.absolute_start,
  to: m.ep_to === null ? null : m.absolute_start + (m.ep_to - m.ep_from),
});

/**
 * Compares absolute sequences between two compiled datasets (Xwolv decision S4.2). Sequences are
 * matched by id, and a derived sequence that was renamed (an earlier work joined its chain) is
 * matched by the members it shares. Every work whose absolute range changes, or that leaves its
 * sequence, is a shift; appending a member after the last one shifts nothing.
 */
export function diffSequences(before: Records, after: Records): SequenceDiff {
  const matched = new Map<string, string | null>();
  const taken = new Set<string>();
  for (const [id] of before.sequences) {
    if (after.sequences.has(id)) {
      matched.set(id, id);
      taken.add(id);
    }
  }
  for (const [id, seq] of before.sequences) {
    if (matched.has(id)) continue;
    const works = new Set(seq.members.map((m) => m.work));
    let best: { id: string; shared: number } | null = null;
    for (const [aid, aseq] of after.sequences) {
      if (taken.has(aid)) continue;
      const shared = aseq.members.filter((m) => works.has(m.work)).length;
      if (shared > 0 && (!best || shared > best.shared || (shared === best.shared && aid < best.id))) best = { id: aid, shared };
    }
    matched.set(id, best?.id ?? null);
    if (best) taken.add(best.id);
  }

  const diff: SequenceDiff = { changed: [], added: [...after.sequences.keys()].filter((id) => !taken.has(id)).sort(), shifts: [] };
  for (const [id, seq] of [...before.sequences].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const afterId = matched.get(id) ?? null;
    const next = afterId === null ? null : after.sequences.get(afterId)!;
    const same = next !== null && afterId === id && next.members.length === seq.members.length && next.members.every((m, i) => key(m) === key(seq.members[i]!));
    if (same) continue;
    diff.changed.push(id);
    for (const m of seq.members) {
      const old = range(id, m);
      const now = next?.members.find((x) => x.work === m.work && x.ep_from === m.ep_from);
      const moved = now === undefined ? null : range(afterId!, now);
      if (moved && moved.from === old.from && moved.to === old.to) continue;
      const status = (after.works.get(m.work) ?? before.works.get(m.work))?.status;
      diff.shifts.push({ work: m.work, before: old, after: moved, finished: status === 'finished' });
    }
  }
  return diff;
}

const fmt = (r: AbsoluteRange | null) => (r === null ? 'none' : `${r.sequence} ${r.from}-${r.to ?? ''}`);

/** Markdown lines for a PR body: every work whose absolute numbers shift. */
export function shiftLines(d: SequenceDiff): string[] {
  if (d.shifts.length === 0) return d.changed.length === 0 ? [] : [`Sequences changed: ${d.changed.join(', ')}. No work's absolute numbers shift.`];
  return [
    '| Work | Absolute before | Absolute after | Finished |',
    '| --- | --- | --- | --- |',
    ...d.shifts.map((s) => `| ${s.work} | ${fmt(s.before)} | ${fmt(s.after)} | ${s.finished ? 'yes (tier C)' : 'no'} |`),
  ];
}

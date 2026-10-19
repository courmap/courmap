import { describe, expect, it } from 'vitest';
import type { Records } from '@courmap/builder';
import type { SequenceRecord, WorkRecord } from '@courmap/core';
import { diffSequences, shiftLines } from '../src/shifts.js';

const work = (id: string, status: WorkRecord['status']) => ({ id, status }) as WorkRecord;
function records(seqs: SequenceRecord[], works: WorkRecord[]): Records {
  return { works: new Map(works.map((w) => [w.id, w])), sequences: new Map(seqs.map((s) => [s.id, s])), groups: new Map(), origins: { works: new Map(), sequences: new Map(), groups: new Map() } };
}
const m = (w: string, absolute_start: number, ep_to: number | null = 12) => ({ work: w, ep_from: 1, ep_to, absolute_start });
const works = [work('a', 'finished'), work('b', 'finished'), work('c', 'airing'), work('pre', 'finished')];

describe('absolute shifts (decision S4.2)', () => {
  const before = records([{ id: 'a-absolute', members: [m('a', 1), m('b', 13), m('c', 25, null)] }], works);

  it('reports nothing for identical sequences', () => {
    expect(diffSequences(before, before)).toEqual({ changed: [], added: [], shifts: [] });
  });

  it('treats an appended member as a change with no shift', () => {
    const after = records([{ id: 'a-absolute', members: [m('a', 1), m('b', 13), m('c', 25), m('d', 37)] }], works);
    const d = diffSequences(before, after);
    expect(d.changed).toEqual(['a-absolute']);
    expect(d.shifts).toEqual([{ work: 'c', before: { sequence: 'a-absolute', from: 25, to: null }, after: { sequence: 'a-absolute', from: 25, to: 36 }, finished: false }]);
  });

  it('follows a renamed derived sequence and flags shifts on finished works', () => {
    // An earlier work joined the chain: the sequence is renamed and every member moves up 12.
    const after = records([{ id: 'pre-absolute', members: [m('pre', 1), m('a', 13), m('b', 25), m('c', 37, null)] }], works);
    const d = diffSequences(before, after);
    expect(d.changed).toEqual(['a-absolute']);
    expect(d.added).toEqual([]);
    expect(d.shifts.map((s) => [s.work, s.before.from, s.after?.from, s.finished])).toEqual([
      ['a', 1, 13, true],
      ['b', 13, 25, true],
      ['c', 25, 37, false],
    ]);
    expect(shiftLines(d)[2]).toBe('| a | a-absolute 1-12 | pre-absolute 13-24 | yes (tier C) |');
  });

  it('reports a work that leaves its sequence', () => {
    const after = records([{ id: 'a-absolute', members: [m('a', 1), m('b', 13)] }], works);
    expect(diffSequences(before, after).shifts).toEqual([{ work: 'c', before: { sequence: 'a-absolute', from: 25, to: null }, after: null, finished: false }]);
  });
});

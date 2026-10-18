import {
  PROJECTION_PROVIDERS,
  UNIQUE_ID_PROVIDERS,
  formatSpan,
  parseEpisodeRange,
  parseTargetRange,
  rangesOverlap,
  type EpisodeKind,
  type EpisodeSpan,
  type GroupFile,
  type ProjectionEntry,
  type ProjectionProvider,
  type SequenceFile,
  type WorkFile,
} from '@courmap/core';
import type { Reporter } from './diagnostics.js';
import type { SourceFile } from './load.js';
import { schemaIssues } from './schema.js';
import { readBlock, type Block } from './blocks.js';

export interface Typed<T> {
  src: SourceFile;
  data: T;
}

export interface CheckedFiles {
  works: Typed<WorkFile>[];
  sequences: Typed<SequenceFile>[];
  groups: Typed<GroupFile>[];
}

/** A projection entry after parsing, with everything a check or the compiler needs. */
export interface ParsedEntry {
  index: number;
  kind: EpisodeKind;
  span: EpisodeSpan;
  season: number | null;
  targetFrom: number;
  targetTo: number | null;
  gap: boolean;
}

/** Last provider episode an entry lands on (Infinity when open-ended). */
export const landingEnd = (p: ParsedEntry) =>
  p.targetTo ?? (p.span.to === null ? Infinity : p.targetFrom + (p.span.to - p.span.from));

/**
 * Parses one projection entry, reporting problems. Returns null when the entry is unusable.
 * The compiler calls this too (with a throwaway reporter), so parsing rules live in one place.
 */
export function parseEntry(entry: ProjectionEntry, index: number, report: (code: Parameters<Reporter['report']>[1], field: string | null, msg: string) => void): ParsedEntry | null {
  const r = parseEpisodeRange(entry.episodes);
  if (!r.ok) {
    report('invalid-range', 'episodes', r.error);
    return null;
  }
  const span = r.value;
  if (entry.kind !== undefined && entry.kind !== span.kind) {
    const fix = formatSpan({ ...span, kind: entry.kind });
    report('kind-mismatch', 'kind', `kind is ${entry.kind} but episodes "${entry.episodes}" are ${span.kind}; write episodes as "${fix}"`);
    return null;
  }
  if (entry.start !== undefined && entry.target !== undefined) {
    report('start-target-conflict', 'target', 'use either start (a plain offset) or target (an N-to-M split), not both');
    return null;
  }
  let targetFrom = entry.start ?? span.from;
  let targetTo: number | null = null;
  if (entry.target !== undefined) {
    const t = parseTargetRange(entry.target);
    if (!t.ok) {
      report('invalid-target', 'target', t.error);
      return null;
    }
    const n = span.to === null ? Infinity : span.to - span.from + 1;
    const m = t.value.to - t.value.from + 1;
    if (span.to === null) {
      report('invalid-target', 'target', 'an open-ended range cannot use target');
      return null;
    }
    if (n === 1 && m === 1) {
      report('invalid-target', 'target', 'target is only for N-to-M splits; for a 1-to-1 offset use start');
      return null;
    }
    if (n > 1 && m > 1) {
      report('invalid-target', 'target', `${n} canonical episodes onto ${m} provider episodes is not a split; target needs one side to be a single episode`);
      return null;
    }
    targetFrom = t.value.from;
    targetTo = t.value.to;
  }
  return { index, kind: span.kind, span, season: entry.season ?? null, targetFrom, targetTo, gap: entry.gap === true };
}

/** Runs schema checks, then per-file and cross-file semantic checks. */
export function checkFiles(files: readonly SourceFile[], reporter: Reporter): CheckedFiles {
  const out: CheckedFiles = { works: [], sequences: [], groups: [] };

  // Every id seen, even in files that fail the schema, so references to them don't add noise.
  const knownIds: Record<SourceFile['kind'], Set<string>> = { work: new Set(), sequence: new Set(), group: new Set() };
  const firstFileForId = new Map<string, SourceFile>();

  for (const src of files) {
    const id = (src.data as { id?: unknown } | null)?.id;
    if (typeof id === 'string') {
      const key = `${src.kind}:${id}`;
      const prev = firstFileForId.get(key);
      if (prev) reporter.report(src.loc, 'duplicate-id', ['id'], `${src.kind} id "${id}" is already used by ${prev.file}`);
      else firstFileForId.set(key, src);
      knownIds[src.kind].add(id);
      if (id !== src.name) {
        reporter.report(src.loc, 'filename-mismatch', ['id'], `"${id}" must match the file name "${src.name}"`);
      }
    }
    const issues = schemaIssues(src.kind, src.data);
    for (const issue of issues) reporter.report(src.loc, 'schema', issue.path, issue.message, { key: issue.key });
    if (issues.length > 0) continue;
    if (src.kind === 'work') out.works.push({ src, data: src.data as WorkFile });
    else if (src.kind === 'sequence') out.sequences.push({ src, data: src.data as SequenceFile });
    else out.groups.push({ src, data: src.data as GroupFile });
  }

  const works = new Map(out.works.map((w) => [w.data.id, w]));
  for (const w of out.works) checkWork(w, knownIds.work, reporter);
  checkProviderIds(out.works, reporter);
  checkSharedTargets(out.works, reporter);
  checkSequences(out.sequences, works, knownIds.work, reporter);
  checkGroups(out.groups, works, out.sequences, knownIds.work, reporter);
  return out;
}

const isAiring = (w: WorkFile) => w.status === 'airing';

function checkWork({ src, data: w }: Typed<WorkFile>, knownWorks: Set<string>, reporter: Reporter): void {
  const at = (path: (string | number)[], code: Parameters<Reporter['report']>[1], msg: string) => reporter.report(src.loc, code, path, msg);

  if (w.episodes === null && w.status !== 'airing' && w.status !== 'upcoming') {
    at(['episodes'], 'unknown-episode-count', 'episodes may be null only when status is airing or upcoming');
  }
  if (w.prequel !== undefined) {
    if (w.prequel === w.id) at(['prequel'], 'unknown-work', 'a work cannot be its own prequel');
    else if (!knownWorks.has(w.prequel)) at(['prequel'], 'unknown-work', `prequel "${w.prequel}" is not a work in data/works/`);
  }

  for (const provider of PROJECTION_PROVIDERS) {
    const written = w.projections?.[provider];
    if (!written) continue;
    const block = readBlock(written, provider);
    const entries = block.ranges;
    const base = block.base;
    if (w.ids?.[provider] === undefined) {
      at(['projections', provider], 'missing-provider-id', `projections.${provider} needs ids.${provider} to be set`);
    }
    if (block.coverage === 'partial' && block.notes === null) {
      at(['projections', provider, 'coverage'], 'coverage-notes', 'coverage: partial needs notes saying why the mapping stops early');
    }
    const parsed: ParsedEntry[] = [];
    let unusable = false;
    entries.forEach((entry, i) => {
      const p = parseEntry(entry, i, (code, field, msg) => at(field ? [...base, i, field] : [...base, i], code, msg));
      if (!p) {
        unusable = true;
        return;
      }
      parsed.push(p);
      checkBounds(w, p, [...base, i, 'episodes'], at);
    });
    // With an entry already rejected, coverage checks would only report its absence again.
    if (!unusable) checkOverlapsAndGaps(w, provider, parsed, block, at);
    checkLandingOverlaps(provider, parsed, base, at);
  }
}

function checkBounds(
  w: WorkFile,
  p: ParsedEntry,
  path: (string | number)[],
  at: (path: (string | number)[], code: Parameters<Reporter['report']>[1], msg: string) => void,
): void {
  const label = formatSpan(p.span);
  if (p.span.to === null) {
    if (!isAiring(w)) {
      at(path, 'open-ended-not-airing', `open-ended range "${label}" is allowed only when status is airing`);
      return;
    }
  }
  const limit = p.kind === 'regular' ? w.episodes : p.kind === 'special' ? (w.specials ?? null) : null;
  if (limit === null) return;
  const end = p.span.to ?? p.span.from;
  if (end > limit) {
    const what = p.kind === 'regular' ? `episodes: ${limit}` : `specials: ${limit}`;
    at(path, 'out-of-bounds', `range "${label}" goes past the work's ${what}`);
  }
}

function checkOverlapsAndGaps(
  w: WorkFile,
  provider: ProjectionProvider,
  parsed: ParsedEntry[],
  block: Block,
  at: (path: (string | number)[], code: Parameters<Reporter['report']>[1], msg: string) => void,
): void {
  const base = block.base;
  const byKind = new Map<EpisodeKind, ParsedEntry[]>();
  for (const p of parsed) byKind.set(p.kind, [...(byKind.get(p.kind) ?? []), p]);

  for (const [kind, list] of byKind) {
    const sorted = [...list].sort((a, b) => a.span.from - b.span.from);
    for (let i = 1; i < sorted.length; i++) {
      for (let j = 0; j < i; j++) {
        const a = sorted[j]!;
        const b = sorted[i]!;
        if (rangesOverlap(a.span, b.span)) {
          at([...base, b.index, 'episodes'], 'overlap', `"${formatSpan(b.span)}" overlaps "${formatSpan(a.span)}" in ${provider}[${a.index}]`);
        }
      }
    }
    if (kind !== 'regular') continue;

    // Regular episodes must be covered without holes unless a hole is marked with gap: true.
    let next = 1;
    for (const p of sorted) {
      if (p.span.from > next) {
        if (!p.gap) {
          at([...base, p.index, 'episodes'], 'gap', `${missing(kind, next, p.span.from - 1)} no ${provider} mapping; add gap: true to this entry if that is intended`);
        }
      } else if (p.gap) {
        at([...base, p.index, 'gap'], 'gap-marker-unused', 'gap: true is set but no episodes are missing before this entry');
      }
      next = p.span.to === null ? Infinity : Math.max(next, p.span.to + 1);
    }
    const stopsEarly = w.episodes !== null && next !== Infinity && next <= w.episodes && sorted.length > 0;
    if (stopsEarly && block.coverage !== 'partial') {
      const last = sorted[sorted.length - 1]!;
      at([...base, last.index, 'episodes'], 'gap', `${missing(kind, next, w.episodes!)} no ${provider} mapping; if the provider really stops there, write this block as { coverage: partial, notes, ranges }`);
    }
    if (!stopsEarly && block.coverage === 'partial') {
      at(['projections', provider, 'coverage'], 'coverage-unused', 'coverage: partial is set but the ranges reach the last episode');
    }
  }
}

function checkLandingOverlaps(
  provider: ProjectionProvider,
  parsed: ParsedEntry[],
  base: (string | number)[],
  at: (path: (string | number)[], code: Parameters<Reporter['report']>[1], msg: string) => void,
): void {
  for (let i = 0; i < parsed.length; i++) {
    for (let j = 0; j < i; j++) {
      const a = parsed[j]!;
      const b = parsed[i]!;
      if (a.season !== b.season) continue;
      if (rangesOverlap({ from: a.targetFrom, to: landingEnd(a) }, { from: b.targetFrom, to: landingEnd(b) })) {
        at([...base, b.index], 'target-overlap', `lands on the same ${provider} ${seasonLabel(b.season)} episodes as ${provider}[${a.index}]`);
      }
    }
  }
}

const missing = (kind: EpisodeKind, from: number, to: number) =>
  from === to ? `episode ${formatSpan({ kind, from, to })} has` : `episodes ${formatSpan({ kind, from, to })} have`;

const seasonLabel = (s: number | null) => (s === null ? '(no season)' : `season ${s}`);

function checkProviderIds(works: Typed<WorkFile>[], reporter: Reporter): void {
  const seen = new Map<string, Typed<WorkFile>>();
  for (const w of works) {
    for (const provider of UNIQUE_ID_PROVIDERS) {
      const id = w.data.ids?.[provider as keyof NonNullable<WorkFile['ids']>];
      if (id === undefined) continue;
      const key = `${provider}:${id}`;
      const prev = seen.get(key);
      if (prev) reporter.report(w.src.loc, 'duplicate-provider-id', ['ids', provider], `${key} is already used by work "${prev.data.id}"`);
      else seen.set(key, w);
    }
  }
}

/** Two works sharing a season-based show must not land on the same season and episodes. */
function checkSharedTargets(works: Typed<WorkFile>[], reporter: Reporter): void {
  for (const provider of PROJECTION_PROVIDERS) {
    const byShow = new Map<string, { w: Typed<WorkFile>; p: ParsedEntry }[]>();
    for (const w of works) {
      const id = w.data.ids?.[provider];
      const written = w.data.projections?.[provider];
      if (id === undefined || !written) continue;
      const entries = readBlock(written, provider).ranges;
      const list = byShow.get(String(id)) ?? [];
      entries.forEach((e, i) => {
        const p = parseEntry(e, i, () => {});
        if (p) list.push({ w, p });
      });
      byShow.set(String(id), list);
    }
    for (const [show, list] of byShow) {
      for (let i = 0; i < list.length; i++) {
        for (let j = 0; j < i; j++) {
          const a = list[j]!;
          const b = list[i]!;
          if (a.w === b.w || a.p.season !== b.p.season) continue;
          if (rangesOverlap({ from: a.p.targetFrom, to: landingEnd(a.p) }, { from: b.p.targetFrom, to: landingEnd(b.p) })) {
            reporter.report(
              b.w.src.loc,
              'target-overlap',
              ['projections', provider, b.p.index],
              `${provider}:${show} ${seasonLabel(b.p.season)} episodes are also claimed by work "${a.w.data.id}" (${provider}[${a.p.index}])`,
            );
          }
        }
      }
    }
  }
}

function checkSequences(seqs: Typed<SequenceFile>[], works: Map<string, Typed<WorkFile>>, knownWorks: Set<string>, reporter: Reporter): void {
  // work -> sequence -> member positions, for the default-sequence rule
  const memberships = new Map<string, Map<string, { src: SourceFile; i: number; isDefault: boolean }[]>>();
  for (const { src, data: s } of seqs) {
    const spans: { i: number; work: string; span: EpisodeSpan; abs: { from: number; to: number | null } }[] = [];
    s.members.forEach((m, i) => {
      const at = (field: string, code: Parameters<Reporter['report']>[1], msg: string) => reporter.report(src.loc, code, ['members', i, field], msg);
      if (!knownWorks.has(m.work)) {
        at('work', 'unknown-work', `work "${m.work}" is not in data/works/`);
        return;
      }
      const r = parseEpisodeRange(m.episodes);
      if (!r.ok) return at('episodes', 'invalid-range', r.error);
      if (r.value.kind !== 'regular') return at('episodes', 'invalid-range', 'absolute sequences cover regular episodes only');
      const work = works.get(m.work)?.data;
      if (work) {
        if (r.value.to === null && !isAiring(work)) {
          at('episodes', 'open-ended-not-airing', `open-ended range "${formatSpan(r.value)}" needs work "${m.work}" to have status airing`);
        } else if (work.episodes !== null && (r.value.to ?? r.value.from) > work.episodes) {
          at('episodes', 'out-of-bounds', `range "${formatSpan(r.value)}" goes past work "${m.work}" episodes: ${work.episodes}`);
        }
      }
      const abs = { from: m.absolute_start, to: r.value.to === null ? null : m.absolute_start + (r.value.to - r.value.from) };
      spans.push({ i, work: m.work, span: r.value, abs });

      const bySeq = memberships.get(m.work) ?? new Map();
      bySeq.set(s.id, [...(bySeq.get(s.id) ?? []), { src, i, isDefault: m.default === true }]);
      memberships.set(m.work, bySeq);
    });

    const maxStart = Math.max(...spans.map((x) => x.abs.from));
    const misplaced = new Set<number>();
    for (const x of spans) {
      if (x.abs.to === null && x.abs.from !== maxStart) {
        misplaced.add(x.i);
        reporter.report(src.loc, 'open-ended-not-last', ['members', x.i, 'episodes'], 'only the member with the highest absolute_start may be open-ended');
      }
    }
    for (let i = 0; i < spans.length; i++) {
      for (let j = 0; j < i; j++) {
        const a = spans[j]!;
        const b = spans[i]!;
        if (!misplaced.has(a.i) && !misplaced.has(b.i) && rangesOverlap(a.abs, b.abs)) {
          reporter.report(src.loc, 'sequence-overlap', ['members', b.i, 'absolute_start'], `absolute episodes ${fmtAbs(b.abs)} overlap members[${a.i}] (${fmtAbs(a.abs)})`);
        }
        if (a.work === b.work && rangesOverlap(a.span, b.span)) {
          reporter.report(src.loc, 'sequence-overlap', ['members', b.i, 'episodes'], `episodes of "${b.work}" are already covered by members[${a.i}]`);
        }
      }
    }
  }
  checkDefaultSequences(memberships, reporter);
}

/** A work in several sequences needs exactly one of them marked default: true. */
function checkDefaultSequences(memberships: Map<string, Map<string, { src: SourceFile; i: number; isDefault: boolean }[]>>, reporter: Reporter): void {
  for (const [work, bySeq] of memberships) {
    if (bySeq.size < 2) continue;
    const defaults = [...bySeq].filter(([, ms]) => ms.some((m) => m.isDefault));
    const seqs = [...bySeq.keys()].sort();
    if (defaults.length === 1) continue;
    if (defaults.length === 0) {
      for (const [, ms] of bySeq) {
        const m = ms[0]!;
        reporter.report(m.src.loc, 'sequence-default', ['members', m.i, 'work'], `work "${work}" is in ${seqs.length} sequences (${seqs.join(', ')}); mark exactly one membership default: true`);
      }
    } else {
      for (const [, ms] of defaults) {
        const m = ms.find((x) => x.isDefault)!;
        reporter.report(m.src.loc, 'sequence-default', ['members', m.i, 'default'], `work "${work}" has ${defaults.length} default sequences (${defaults.map(([id]) => id).sort().join(', ')}); only one may be default`);
      }
    }
  }
}

const fmtAbs = (a: { from: number; to: number | null }) => (a.to === null ? `${a.from}-` : `${a.from}-${a.to}`);

function checkGroups(
  groups: Typed<GroupFile>[],
  works: Map<string, Typed<WorkFile>>,
  seqs: Typed<SequenceFile>[],
  knownWorks: Set<string>,
  reporter: Reporter,
): void {
  const seqMembers = new Map(seqs.map((s) => [s.data.id, new Set(s.data.members.map((m) => m.work))]));
  const aliasOwner = new Map<string, string>();
  for (const { src, data: g } of groups) {
    (g.aliases ?? []).forEach((alias, i) => {
      const key = alias.toLowerCase();
      const owner = aliasOwner.get(key);
      if (owner !== undefined && owner !== g.id) {
        reporter.report(src.loc, 'duplicate-alias', ['aliases', i], `alias "${alias}" is already used by group "${owner}"`);
      } else aliasOwner.set(key, g.id);
    });
    (g.overrides ?? []).forEach((o, i) => {
      const at = (field: string, code: Parameters<Reporter['report']>[1], msg: string) => reporter.report(src.loc, code, ['overrides', i, field], msg);
      if (!knownWorks.has(o.work)) return at('work', 'unknown-work', `work "${o.work}" is not in data/works/`);
      if (o.numbering === 'offset' && o.offset === undefined) at('numbering', 'offset-mismatch', 'numbering: offset needs an offset value');
      if (o.numbering !== 'offset' && o.offset !== undefined) at('offset', 'offset-mismatch', `offset is only used with numbering: offset, not ${o.numbering}`);
      if (o.sequence !== undefined) {
        if (o.numbering !== 'absolute') at('sequence', 'override-sequence', `sequence is only used with numbering: absolute, not ${o.numbering}`);
        else if (!seqMembers.has(o.sequence)) at('sequence', 'override-sequence', `sequence "${o.sequence}" is not in data/sequences/`);
        else if (!seqMembers.get(o.sequence)!.has(o.work)) at('sequence', 'override-sequence', `work "${o.work}" is not a member of sequence "${o.sequence}"`);
      }
      if (o.numbering === 'continue_prequel' && works.get(o.work) && works.get(o.work)!.data.prequel === undefined) {
        at('numbering', 'missing-prequel', `continue_prequel needs work "${o.work}" to have a prequel`);
      }
    });
  }
}



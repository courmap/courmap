import { PREFIX_KIND, type EpisodeKind } from './providers.js';

/** A parsed canonical episode range. `to` is null for an open-ended range ("892-"). */
export interface EpisodeSpan {
  kind: EpisodeKind;
  from: number;
  to: number | null;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

const RANGE_RE = /^([SCTP]?)(\d+)(?:-([SCTP]?)(\d*))?$/;

/**
 * Parses an episode range as written in YAML: 12, "12", "1-12", "S1-S2", "S1-2", "892-".
 * Episode numbers start at 1 for every kind.
 */
export function parseEpisodeRange(input: number | string): ParseResult<EpisodeSpan> {
  if (typeof input === 'number') {
    if (!Number.isInteger(input) || input < 1) return { ok: false, error: `episode ${input} must be a whole number of at least 1` };
    return { ok: true, value: { kind: 'regular', from: input, to: input } };
  }
  const m = RANGE_RE.exec(input.trim());
  if (!m) return { ok: false, error: `"${input}" is not an episode range (expected forms: 12, 1-12, S1-S2, 892-)` };
  const [, prefix = '', fromStr = '', toPrefix, toStr] = m;
  if (toPrefix && toPrefix !== prefix) {
    return { ok: false, error: `"${input}" mixes episode kinds (${prefix || 'regular'} and ${toPrefix})` };
  }
  const kind = PREFIX_KIND[prefix] ?? 'regular';
  const from = Number(fromStr);
  if (from < 1) return { ok: false, error: `"${input}" starts at ${from}; episodes are numbered from 1` };
  if (toPrefix === undefined && toStr === undefined) return { ok: true, value: { kind, from, to: from } };
  if (toStr === '' || toStr === undefined) {
    if (toPrefix) return { ok: false, error: `"${input}" has a prefix but no end number` };
    return { ok: true, value: { kind, from, to: null } };
  }
  const to = Number(toStr);
  if (to < from) return { ok: false, error: `"${input}" ends before it starts` };
  return { ok: true, value: { kind, from, to } };
}

/** Parses a provider-side target range: 12 or "12-13". */
export function parseTargetRange(input: number | string): ParseResult<{ from: number; to: number }> {
  if (typeof input === 'number') return { ok: true, value: { from: input, to: input } };
  const m = /^(\d+)-(\d+)$/.exec(input.trim());
  if (!m) return { ok: false, error: `"${input}" is not a target range (expected 12 or 12-13)` };
  const from = Number(m[1]);
  const to = Number(m[2]);
  if (to < from) return { ok: false, error: `target "${input}" ends before it starts` };
  return { ok: true, value: { from, to } };
}

/** Formats a span back to the YAML notation, for error messages. */
export function formatSpan(span: { kind: EpisodeKind; from: number; to: number | null }): string {
  const p = span.kind === 'regular' ? '' : span.kind[0]!.toUpperCase();
  if (span.to === span.from) return `${p}${span.from}`;
  return `${p}${span.from}-${span.to === null ? '' : `${p}${span.to}`}`;
}

/** True when two inclusive ranges share at least one number. A null end means unbounded. */
export function rangesOverlap(a: { from: number; to: number | null }, b: { from: number; to: number | null }): boolean {
  const aTo = a.to ?? Infinity;
  const bTo = b.to ?? Infinity;
  return a.from <= bTo && b.from <= aTo;
}

/** Parses a translate/lookup episode argument: 5, "5", "S1". */
export function parseEpisode(input: number | string): ParseResult<{ kind: EpisodeKind; episode: number }> {
  const r = parseEpisodeRange(input);
  if (!r.ok) return r;
  if (r.value.to !== r.value.from) return { ok: false, error: `"${input}" is a range; pass a single episode` };
  return { ok: true, value: { kind: r.value.kind, episode: r.value.from } };
}

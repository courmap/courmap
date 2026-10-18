import {
  PROJECTION_PROVIDERS,
  PROVIDERS,
  parseEpisodeRange,
  buildAliasIndex,
  normalizeTitle,
  type AliasIndex,
  type Dataset,
  type GroupRecord,
  type Meta,
  type ProjectionRow,
  type Provider,
  type SequenceMembership,
  type SequenceRecord,
  type WorkRecord,
} from '@courmap/core';
import { parseEntry, type CheckedFiles } from './checks.js';
import type { Origin } from './load.js';
import type { WorkOrigins } from './merge.js';
import { readBlock } from './blocks.js';

export type { GroupRecord };


/** Everything compile writes, in memory, with the origin of every row kept alongside. */
export interface Records {
  works: Map<string, WorkRecord>;
  sequences: Map<string, SequenceRecord>;
  groups: Map<string, GroupRecord>;
  origins: { works: Map<string, WorkOrigins>; sequences: Map<string, Origin>; groups: Map<string, Origin> };
}

const byKindThenFrom = (a: ProjectionRow, b: ProjectionRow) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : a.ep_from - b.ep_from);

/**
 * Converts checked files to records. Only call this on files that passed checkFiles with
 * no errors: it assumes every range parses.
 */
export function toRecords(files: CheckedFiles): Records {
  const records: Records = {
    works: new Map(),
    sequences: new Map(),
    groups: new Map(),
    origins: { works: new Map(), sequences: new Map(), groups: new Map() },
  };

  for (const { data: w, origins } of files.works) {
    const ids: Partial<Record<Provider, string>> = {};
    for (const p of PROVIDERS) {
      const v = w.ids?.[p];
      if (v != null) ids[p] = String(v);
    }
    const projections: WorkRecord['projections'] = {};
    for (const p of PROJECTION_PROVIDERS) {
      const written = w.projections?.[p];
      if (!written) continue;
      const entries = readBlock(written, p).ranges;
      projections[p] = entries
        .map((e, i) => {
          const parsed = parseEntry(e, i, (_c, _f, msg) => {
            throw new Error(`work ${w.id}: ${msg}`);
          })!;
          return {
            kind: parsed.kind,
            ep_from: parsed.span.from,
            ep_to: parsed.span.to,
            season: parsed.season,
            target_from: parsed.targetFrom,
            target_to: parsed.targetTo,
          };
        })
        .sort(byKindThenFrom);
    }
    const titles = { romaji: w.titles?.romaji ?? null, english: w.titles?.english ?? null, native: w.titles?.native ?? null };
    const aliases = [...new Set([titles.romaji, titles.english, titles.native, ...(w.aliases ?? [])].filter((a): a is string => a !== null))];
    records.works.set(w.id, {
      id: w.id,
      type: w.type!,
      status: w.status ?? 'finished',
      year: w.year ?? null,
      episodes: w.episodes ?? null,
      specials: w.specials ?? null,
      titles,
      ids,
      projections,
      prequel: w.prequel ?? files.derived.prequels.get(w.id) ?? null,
      sequences: [],
      aliases,
    });
    const derivedPrequel = w.prequel === undefined && files.derived.prequels.has(w.id);
    records.origins.works.set(w.id, derivedPrequel ? { ...origins, prequel: 'derived' } : origins);
  }

  // A work's default sequence: its only one, or the one where a member for it says default: true.
  const seqsByWork = new Map<string, Set<string>>();
  const flagged = new Map<string, string>();
  for (const { data: s } of files.sequences) {
    for (const m of s.members) {
      seqsByWork.set(m.work, (seqsByWork.get(m.work) ?? new Set()).add(s.id));
      if (m.default) flagged.set(m.work, s.id);
    }
  }
  const isDefault = (work: string, seq: string) => (seqsByWork.get(work)!.size === 1 ? true : flagged.get(work) === seq);

  for (const { src, data: s } of files.sequences) {
    const members = s.members.map((m) => {
      const r = parseEpisodeRange(m.episodes);
      if (!r.ok) throw new Error(`${src.file}: ${r.error}`);
      return { work: m.work, ep_from: r.value.from, ep_to: r.value.to, absolute_start: m.absolute_start };
    });
    members.sort((a, b) => a.absolute_start - b.absolute_start);
    records.sequences.set(s.id, { id: s.id, members });
    records.origins.sequences.set(s.id, 'manual');
    for (const m of members) {
      const membership: SequenceMembership = {
        sequence: s.id,
        ep_from: m.ep_from,
        ep_to: m.ep_to,
        absolute_start: m.absolute_start,
        default: isDefault(m.work, s.id),
      };
      records.works.get(m.work)?.sequences.push(membership);
    }
  }
  // Derived sequences: a work is in at most one (one TVDB show) and never in a manual one, so it is the default.
  for (const s of files.derived.sequences) {
    records.sequences.set(s.id, { id: s.id, members: s.members });
    records.origins.sequences.set(s.id, 'derived');
    for (const m of s.members) {
      records.works.get(m.work)?.sequences.push({ sequence: s.id, ep_from: m.ep_from, ep_to: m.ep_to, absolute_start: m.absolute_start, default: true });
    }
  }
  for (const w of records.works.values()) {
    w.sequences.sort((a, b) => (a.sequence < b.sequence ? -1 : a.sequence > b.sequence ? 1 : a.ep_from - b.ep_from));
  }

  for (const { src, data: g } of files.groups) {
    records.groups.set(g.id, {
      id: g.id,
      aliases: g.aliases ?? [],
      overrides: (g.overrides ?? []).map((o) => ({ work: o.work, numbering: o.numbering, offset: o.offset ?? null, sequence: o.sequence ?? null })),
    });
    records.origins.groups.set(g.id, 'manual');
  }
  return records;
}

/** A Dataset over in-memory records: used for round-trip checks before anything is compiled. */
export class MemoryDataset implements Dataset {
  private readonly refIndex = new Map<string, string[]>();

  constructor(
    private readonly records: Records,
    private readonly metaValue: Meta,
  ) {
    for (const w of records.works.values()) {
      for (const [p, id] of Object.entries(w.ids)) {
        const key = `${p}:${id}`;
        this.refIndex.set(key, [...(this.refIndex.get(key) ?? []), w.id].sort());
      }
    }
  }

  async meta(): Promise<Meta> {
    return this.metaValue;
  }

  async getWork(id: string): Promise<WorkRecord | undefined> {
    return this.records.works.get(id);
  }

  async findWorkIds(provider: Provider, providerId: string): Promise<string[]> {
    return this.refIndex.get(`${provider}:${providerId}`) ?? [];
  }

  async getSequence(id: string): Promise<SequenceRecord | undefined> {
    return this.records.sequences.get(id);
  }

  private aliasCache: AliasIndex | null = null;

  async aliasIndex(): Promise<AliasIndex> {
    this.aliasCache ??= buildAliasIndex(
      this.metaValue.data_version,
      [...this.records.works.values()].flatMap((w) => w.aliases.map((a) => [normalizeTitle(a), w.id] as const)),
    );
    return this.aliasCache;
  }

  async groups(): Promise<GroupRecord[]> {
    return [...this.records.groups.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
  }
}

import { buildAliasIndex, type AliasIndex } from './aliases.js';
import type { Dataset } from './engine.js';
import type { GroupRecord, Meta, ProjectionRow, SequenceRecord, WorkRecord, WorkStatus, WorkType } from './model.js';
import type { EpisodeKind, ProjectionProvider, Provider } from './providers.js';

/** Dump schema versions this code reads (meta.schema_version). */
export const SUPPORTED_DUMP_SCHEMA_VERSIONS: ReadonlySet<string> = new Set(['3']);

/**
 * The two calls the dump reader needs from a SQLite driver. better-sqlite3 in Node, and any
 * other driver a port uses, adapts to this, so the read logic exists once.
 */
export interface SqlReader {
  all<T>(sql: string, params?: readonly unknown[]): T[];
  get<T>(sql: string, params?: readonly unknown[]): T | undefined;
}

interface WorkRow {
  id: string;
  type: WorkType;
  status: WorkStatus | null;
  year: number | null;
  episodes: number | null;
  specials: number | null;
  title_romaji: string | null;
  title_english: string | null;
  title_native: string | null;
  prequel_id: string | null;
}

const Q = {
  meta: 'SELECT key, value FROM meta',
  work: 'SELECT * FROM works WHERE id = ?',
  refs: 'SELECT provider, provider_id FROM provider_refs WHERE work_id = ? ORDER BY provider',
  projections: 'SELECT provider, kind, ep_from, ep_to, season, target_from, target_to FROM projections WHERE work_id = ? ORDER BY provider, kind, ep_from',
  memberships: 'SELECT sequence_id, ep_from, ep_to, absolute_start, is_default FROM sequence_members WHERE work_id = ? ORDER BY sequence_id, ep_from',
  aliases: 'SELECT alias FROM aliases WHERE work_id = ? ORDER BY rowid',
  byRef: 'SELECT work_id FROM provider_refs WHERE provider = ? AND provider_id = ? ORDER BY work_id',
  sequence: 'SELECT id FROM sequences WHERE id = ?',
  members: 'SELECT work_id, ep_from, ep_to, absolute_start FROM sequence_members WHERE sequence_id = ? ORDER BY absolute_start',
  group: 'SELECT id FROM groups WHERE id = ?',
  groupAliases: 'SELECT alias FROM group_aliases WHERE group_id = ? ORDER BY rowid',
  groupOverrides: 'SELECT work_id, numbering, offset, sequence_id FROM group_overrides WHERE group_id = ? ORDER BY rowid',
  workIds: 'SELECT id FROM works ORDER BY id',
  sequenceIds: 'SELECT id FROM sequences ORDER BY id',
  groupIds: 'SELECT id FROM groups ORDER BY id',
  allRefs: 'SELECT provider, provider_id, work_id FROM provider_refs ORDER BY provider, provider_id, work_id',
  allAliases: 'SELECT normalized, work_id FROM aliases',
} as const;

/** A Dataset over a compiled SQLite dump. The dump never changes, so works are cached once read. */
export class DumpDataset implements Dataset {
  private readonly metaValue: Meta;
  private readonly works = new Map<string, WorkRecord | undefined>();
  private aliasCache: AliasIndex | null = null;

  constructor(
    private readonly sql: SqlReader,
    label = 'dump',
  ) {
    const rows = sql.all<{ key: string; value: string }>(Q.meta);
    const meta = Object.fromEntries(rows.map((r) => [r.key, r.value])) as Partial<Meta>;
    if (!meta.data_version || !meta.schema_version) {
      throw new Error(`${label} is not a Courmap dump (meta lacks data_version or schema_version)`);
    }
    if (!SUPPORTED_DUMP_SCHEMA_VERSIONS.has(meta.schema_version)) {
      throw new Error(`${label} has schema_version ${meta.schema_version}; this code reads ${[...SUPPORTED_DUMP_SCHEMA_VERSIONS].join(', ')}`);
    }
    this.metaValue = { data_version: meta.data_version, git_sha: meta.git_sha ?? '', built_at: meta.built_at ?? '', schema_version: meta.schema_version };
  }

  async meta(): Promise<Meta> {
    return this.metaValue;
  }

  async getWork(id: string): Promise<WorkRecord | undefined> {
    if (!this.works.has(id)) this.works.set(id, this.readWork(id));
    return this.works.get(id);
  }

  async findWorkIds(provider: Provider, providerId: string): Promise<string[]> {
    return this.sql.all<{ work_id: string }>(Q.byRef, [provider, providerId]).map((r) => r.work_id);
  }

  async getSequence(id: string): Promise<SequenceRecord | undefined> {
    if (!this.sql.get(Q.sequence, [id])) return undefined;
    const members = this.sql.all<{ work_id: string; ep_from: number; ep_to: number | null; absolute_start: number }>(Q.members, [id]);
    return { id, members: members.map((m) => ({ work: m.work_id, ep_from: m.ep_from, ep_to: m.ep_to, absolute_start: m.absolute_start })) };
  }

  async getGroup(id: string): Promise<GroupRecord | undefined> {
    if (!this.sql.get(Q.group, [id])) return undefined;
    const overrides = this.sql.all<{ work_id: string; numbering: GroupRecord['overrides'][number]['numbering']; offset: number | null; sequence_id: string | null }>(
      Q.groupOverrides,
      [id],
    );
    return {
      id,
      aliases: this.sql.all<{ alias: string }>(Q.groupAliases, [id]).map((a) => a.alias),
      overrides: overrides.map((o) => ({ work: o.work_id, numbering: o.numbering, offset: o.offset, sequence: o.sequence_id })),
    };
  }

  async aliasIndex(): Promise<AliasIndex> {
    this.aliasCache ??= buildAliasIndex(
      this.metaValue.data_version,
      this.sql.all<{ normalized: string; work_id: string }>(Q.allAliases).map((r) => [r.normalized, r.work_id] as const),
    );
    return this.aliasCache;
  }

  async groups(): Promise<GroupRecord[]> {
    const out: GroupRecord[] = [];
    for (const id of this.listGroupIds()) out.push((await this.getGroup(id))!);
    return out;
  }

  /** Everything below is for exporting the dump (static shards), not for lookups. */
  listWorkIds(): string[] {
    return this.sql.all<{ id: string }>(Q.workIds).map((r) => r.id);
  }

  listSequenceIds(): string[] {
    return this.sql.all<{ id: string }>(Q.sequenceIds).map((r) => r.id);
  }

  listGroupIds(): string[] {
    return this.sql.all<{ id: string }>(Q.groupIds).map((r) => r.id);
  }

  listRefs(): { provider: Provider; provider_id: string; work_id: string }[] {
    return this.sql.all(Q.allRefs);
  }

  private readWork(id: string): WorkRecord | undefined {
    const w = this.sql.get<WorkRow>(Q.work, [id]);
    if (!w) return undefined;
    const ids: Partial<Record<Provider, string>> = {};
    for (const r of this.sql.all<{ provider: Provider; provider_id: string }>(Q.refs, [id])) ids[r.provider] = r.provider_id;
    const projections: Partial<Record<ProjectionProvider, ProjectionRow[]>> = {};
    for (const r of this.sql.all<ProjectionRow & { provider: ProjectionProvider; kind: EpisodeKind }>(Q.projections, [id])) {
      const { provider, ...row } = r;
      (projections[provider] ??= []).push(row);
    }
    const memberships = this.sql.all<{ sequence_id: string; ep_from: number; ep_to: number | null; absolute_start: number; is_default: number }>(Q.memberships, [id]);
    return {
      id: w.id,
      type: w.type,
      status: w.status ?? 'finished',
      year: w.year,
      episodes: w.episodes,
      specials: w.specials,
      titles: { romaji: w.title_romaji, english: w.title_english, native: w.title_native },
      ids,
      projections,
      prequel: w.prequel_id,
      sequences: memberships.map((m) => ({
        sequence: m.sequence_id,
        ep_from: m.ep_from,
        ep_to: m.ep_to,
        absolute_start: m.absolute_start,
        default: m.is_default === 1,
      })),
      aliases: this.sql.all<{ alias: string }>(Q.aliases, [id]).map((a) => a.alias),
    };
  }
}

/**
 * The refs shard a provider ID lives in: floor(id / 1000) for numeric IDs, and the same rule on
 * the digits of an IMDb ID (the spec's "first 2 chars" would put every tt-prefixed ID in one shard).
 */
export function refShard(provider: Provider, providerId: string): string {
  const digits = provider === 'imdb' ? providerId.replace(/^tt/, '') : providerId;
  if (!/^\d+$/.test(digits)) throw new Error(`cannot shard ${provider}:${providerId}`);
  return String(Math.floor(Number(digits) / 1000));
}

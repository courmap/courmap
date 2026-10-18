import Database from 'better-sqlite3';
import type {
  Dataset,
  EpisodeKind,
  Meta,
  ProjectionProvider,
  ProjectionRow,
  Provider,
  SequenceRecord,
  WorkRecord,
  WorkStatus,
  WorkType,
} from '@courmap/core';
import { createClient, type CourmapClient } from './client.js';

/** Dump schema versions this client can read. */
const SUPPORTED_SCHEMA_VERSIONS = new Set(['2']);

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

/** A Dataset reading a compiled SQLite dump. The dump is immutable, so rows are cached after the first read. */
export class SqliteDataset implements Dataset {
  private readonly db: Database.Database;
  private readonly metaValue: Meta;
  private readonly works = new Map<string, WorkRecord | undefined>();
  private readonly stmts;

  constructor(dumpPath: string) {
    this.db = new Database(dumpPath, { readonly: true, fileMustExist: true });
    const rows = this.db.prepare('SELECT key, value FROM meta').all() as { key: string; value: string }[];
    const meta = Object.fromEntries(rows.map((r) => [r.key, r.value])) as Partial<Meta>;
    if (!meta.data_version || !meta.schema_version) {
      this.db.close();
      throw new Error(`${dumpPath} is not a Courmap dump (meta table lacks data_version or schema_version)`);
    }
    if (!SUPPORTED_SCHEMA_VERSIONS.has(meta.schema_version)) {
      this.db.close();
      throw new Error(`${dumpPath} has schema_version ${meta.schema_version}; this client reads ${[...SUPPORTED_SCHEMA_VERSIONS].join(', ')}`);
    }
    this.metaValue = { data_version: meta.data_version, git_sha: meta.git_sha ?? '', built_at: meta.built_at ?? '', schema_version: meta.schema_version };
    this.stmts = {
      work: this.db.prepare('SELECT * FROM works WHERE id = ?'),
      refs: this.db.prepare('SELECT provider, provider_id FROM provider_refs WHERE work_id = ? ORDER BY provider'),
      projections: this.db.prepare(
        'SELECT provider, kind, ep_from, ep_to, season, target_from, target_to FROM projections WHERE work_id = ? ORDER BY provider, kind, ep_from',
      ),
      memberships: this.db.prepare(
        'SELECT sequence_id, ep_from, ep_to, absolute_start FROM sequence_members WHERE work_id = ? ORDER BY sequence_id, ep_from',
      ),
      aliases: this.db.prepare('SELECT alias FROM aliases WHERE work_id = ? ORDER BY rowid'),
      byRef: this.db.prepare('SELECT work_id FROM provider_refs WHERE provider = ? AND provider_id = ? ORDER BY work_id'),
      sequence: this.db.prepare('SELECT id FROM sequences WHERE id = ?'),
      members: this.db.prepare('SELECT work_id, ep_from, ep_to, absolute_start FROM sequence_members WHERE sequence_id = ? ORDER BY absolute_start'),
    };
  }

  async meta(): Promise<Meta> {
    return this.metaValue;
  }

  async getWork(id: string): Promise<WorkRecord | undefined> {
    if (!this.works.has(id)) this.works.set(id, this.readWork(id));
    return this.works.get(id);
  }

  async findWorkIds(provider: Provider, providerId: string): Promise<string[]> {
    return (this.stmts.byRef.all(provider, providerId) as { work_id: string }[]).map((r) => r.work_id);
  }

  async getSequence(id: string): Promise<SequenceRecord | undefined> {
    if (!this.stmts.sequence.get(id)) return undefined;
    const members = this.stmts.members.all(id) as { work_id: string; ep_from: number; ep_to: number | null; absolute_start: number }[];
    return { id, members: members.map((m) => ({ work: m.work_id, ep_from: m.ep_from, ep_to: m.ep_to, absolute_start: m.absolute_start })) };
  }

  close(): void {
    this.db.close();
  }

  private readWork(id: string): WorkRecord | undefined {
    const w = this.stmts.work.get(id) as WorkRow | undefined;
    if (!w) return undefined;
    const ids: Partial<Record<Provider, string>> = {};
    for (const r of this.stmts.refs.all(id) as { provider: Provider; provider_id: string }[]) ids[r.provider] = r.provider_id;
    const projections: Partial<Record<ProjectionProvider, ProjectionRow[]>> = {};
    for (const r of this.stmts.projections.all(id) as (ProjectionRow & { provider: ProjectionProvider; kind: EpisodeKind })[]) {
      const { provider, ...row } = r;
      (projections[provider] ??= []).push(row);
    }
    const memberships = this.stmts.memberships.all(id) as { sequence_id: string; ep_from: number; ep_to: number | null; absolute_start: number }[];
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
      sequences: memberships.map((m) => ({ sequence: m.sequence_id, ep_from: m.ep_from, ep_to: m.ep_to, absolute_start: m.absolute_start })),
      aliases: (this.stmts.aliases.all(id) as { alias: string }[]).map((a) => a.alias),
    };
  }
}

/** A client over a downloaded SQLite dump. No network access at all. */
export function createOfflineClient(dumpPath: string): CourmapClient {
  const dataset = new SqliteDataset(dumpPath);
  return createClient(dataset, () => dataset.close());
}

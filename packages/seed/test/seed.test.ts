import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { Reporter, loadData, validate } from '@courmap/builder';
import { manualChanges, writeSeedDir } from '../src/files.js';
import { runSeed, type Pins, type SeedInputs } from '../src/seed.js';

// Small fake inputs in fixtures/: a cedya77-style JSONL, an Anime-Lists-style XML, and a
// data/ tree with one manual override file.
const fixtures = fileURLToPath(new URL('./fixtures/', import.meta.url));
const tmp = mkdtempSync(path.join(tmpdir(), 'courmap-seed-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const pins: Pins = {
  offline_db: { repo: 'fixture/offline-db', tag: 'fixture', asset: 'offline-db.jsonl', sha256: 'fixture' },
  anime_lists: { repo: 'fixture/anime-lists', commit: '0'.repeat(40), path: 'anime-list.xml', sha256: 'fixture' },
};

async function inputs(dataDir: string, registry: SeedInputs['registry'] = [], offlineDbJsonl?: string): Promise<SeedInputs> {
  const reporter = new Reporter();
  const { files } = await loadData(dataDir, reporter, dataDir);
  return {
    offlineDbJsonl: offlineDbJsonl ?? readFileSync(path.join(fixtures, 'offline-db.jsonl'), 'utf8'),
    animeListsXml: readFileSync(path.join(fixtures, 'anime-list.xml'), 'utf8'),
    pins,
    manual: { files },
    registry,
  };
}

const lines = (text: string | undefined) => (text ?? '').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);

describe('seed run', async () => {
  const dataDir = path.join(tmp, 'data');
  cpSync(path.join(fixtures, 'data'), dataDir, { recursive: true });
  const manualBefore = readFileSync(path.join(dataDir, 'works', 'hand-fixed.yaml'), 'utf8');

  const first = await runSeed(await inputs(dataDir));
  const second = await runSeed(await inputs(dataDir));
  await writeSeedDir(path.join(dataDir, 'seeds'), first.files);
  const works = [...first.files].filter(([n]) => n.startsWith('works-')).flatMap(([, t]) => lines(t));
  const byId = new Map(works.map((w) => [w.id as string, w]));

  it('is byte-identical when rerun with the same inputs', () => {
    expect([...second.files.keys()]).toEqual([...first.files.keys()]);
    for (const [name, text] of first.files) expect(second.files.get(name), name).toBe(text);
  });

  it('writes sharded JSONL plus manifest, registry and conflicts', () => {
    expect(readdirSync(path.join(dataDir, 'seeds')).sort()).toEqual([
      'conflicts.jsonl',
      'manifest.json',
      'slugs.jsonl',
      ...Array.from({ length: 16 }, (_, i) => `works-${String(i).padStart(3, '0')}.jsonl`),
    ]);
    const manifest = JSON.parse(first.files.get('manifest.json')!) as { pins: Pins & { offline_db: { last_update: string } } };
    expect(manifest.pins.offline_db).toMatchObject({ tag: 'fixture', last_update: '2026-10-01' });
  });

  it('assigns slugs by the collision rules, with the manual file claiming its own', () => {
    expect(lines(first.files.get('slugs.jsonl'))).toEqual([
      // Every anchor a work is known by, so a later run finds it by any of them.
      { anidb: 900001, anilist: 900011, mal: 900021, slug: 'fixture-show' },
      { anidb: 900002, anilist: 900012, slug: 'fixture-show-2021' },
      { anidb: 900003, slug: 'fixture-ova' },
      { anidb: 900004, anilist: 900014, slug: 'hand-fixed' },
      { anidb: 900005, slug: 'two-anilists' },
      { mal: 900099, slug: 'no-anidb' }, // anchored by MAL (decision S3.9)
    ]);
  });

  it('never changes a manual mapping, on disk or in the merge', async () => {
    expect(readFileSync(path.join(dataDir, 'works', 'hand-fixed.yaml'), 'utf8')).toBe(manualBefore);
    const result = await validate(dataDir, { cwd: dataDir });
    expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    expect(manualChanges(result.checked)).toEqual([]);
    const merged = result.checked.works.find((w) => w.id === 'hand-fixed')!;
    expect(merged.data.projections?.tvdb_show).toEqual([{ season: 2, episodes: '1-12' }]); // manual block
    expect(merged.data.projections?.tmdb_show).toEqual([{ season: 1, episodes: '1-12' }]); // seed block
    expect(merged.data.ids).toEqual({ anidb: 900004, anilist: 900014, tvdb_show: 9104, tmdb_show: 9204 }); // imdb removed
  });

  it('keeps the seed line itself complete; the override applies at merge time', () => {
    expect(byId.get('hand-fixed')).toMatchObject({
      ids: { anidb: 900004, anilist: 900014, tvdb_show: 9104, tmdb_show: 9204, imdb: 'tt0900004' },
      projections: { tvdb_show: [{ season: 1, episodes: '1-12' }] },
      origin: { default: 'offline-db', ids: { tvdb_show: 'anime-lists', tmdb_show: 'anime-lists', imdb: 'anime-lists' } },
    });
  });

  it('drops the special when it claims the same TVDB episode as another work regular episode', () => {
    expect(byId.get('fixture-show')!.projections).toEqual({ tvdb_show: [{ season: 1, episodes: '1-12' }] });
    expect(byId.get('fixture-ova')!.projections).toEqual({ tvdb_show: [{ season: 0, episodes: 1 }] });
    const conflicts = lines(first.files.get('conflicts.jsonl'));
    expect(conflicts).toContainEqual(expect.objectContaining({ key: 'anidb:900001', part: 'projections.tvdb_show.special:1-1', reason: 'validate-target-overlap' }));
  });

  it('logs what it skipped', () => {
    const reasons = lines(first.files.get('conflicts.jsonl')).map((c) => `${c.key} ${c.reason}`);
    expect(reasons).toEqual(expect.arrayContaining(['anidb:900005 offline-db-multiple-ids', 'anidb:900006 offline-db-unknown-type']));
    expect(first.summary.offline_db_entries_without_anchor).toBe(0);
    expect(first.summary.seeded_without_anidb).toBe(1);
    expect(first.summary.seeded_without_anidb_with_projections).toBe(0);
    expect(first.summary.anime_lists_entries_without_offline_db).toBe(1); // 900999
  });

  it('seeds an entry without AniDB from its MAL ID, with IDs but no projections', () => {
    expect(byId.get('no-anidb')).toEqual({
      id: 'no-anidb',
      type: 'tv',
      status: 'finished',
      episodes: 12,
      titles: { romaji: 'No AniDB' },
      ids: { mal: 900099 },
      origin: { default: 'offline-db' },
    });
  });

  it('keeps published slugs when a later run sees a changed title', async () => {
    const renamed = readFileSync(path.join(fixtures, 'offline-db.jsonl'), 'utf8').replace('"title":"Fixture OVA"', '"title":"Renamed OVA"');
    const registry = lines(first.files.get('slugs.jsonl')) as { slug: string; anidb?: number }[];
    const later = await runSeed(await inputs(dataDir, registry, renamed));
    expect(lines(later.files.get('slugs.jsonl'))).toEqual(registry);
  });
});

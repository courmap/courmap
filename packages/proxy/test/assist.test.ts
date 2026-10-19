import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { compile, validate } from '@courmap/builder';
import { mappingYaml } from '../src/assist.js';
import { DataManager } from '../src/data.js';
import { Rewriter } from '../src/rewrite.js';
import { SonarrClient, type SonarrEpisode, type SonarrSeries } from '../src/sonarr.js';
import { Stats } from '../src/stats.js';
import { issueText } from '../src/status.js';
import { fakeSonarr, tmp } from './helpers.js';

// Decision S7.1: when the data has no TVDB projection, number from the user's Sonarr.
const fixture = fileURLToPath(new URL('./fixtures/assist/', import.meta.url));
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const seasons = (counts: number[], absolute = true): SonarrEpisode[] => {
  let abs = 0;
  return counts.flatMap((n, s) => range(1, n).map((e) => ({ seasonNumber: s + 1, episodeNumber: e, ...(absolute && { absoluteEpisodeNumber: ++abs }) })));
};
type FakeSeries = SonarrSeries & { episodes: SonarrEpisode[] };
const series = (id: number, title: string, year: number, episodes: SonarrEpisode[], alternate: string[] = []): FakeSeries => ({
  id,
  title,
  tvdbId: 9000 + id,
  seriesType: 'anime',
  useSceneNumbering: false,
  year,
  alternateTitles: alternate.map((t) => ({ title: t })),
  episodes,
});

async function setup(list: FakeSeries[]) {
  const v = await validate(fixture);
  if (!v.ok) throw new Error(JSON.stringify(v.diagnostics.filter((d) => d.severity === 'error')));
  const dump = path.join(tmp, `assist-${Math.random().toString(36).slice(2)}.sqlite`);
  compile(v.records!, v.checked, dump, { dataVersion: 'assist', builtAt: '2026-01-01T00:00:00.000Z', gitSha: 'test' });
  const data = new DataManager({ dataDir: path.join(tmp, 'assist-data'), metaUrl: 'unused', dump, refreshHours: 24 });
  await data.start();
  const server = await fakeSonarr(list);
  const sonarr = new SonarrClient({ url: server.url, apiKey: 'sonarr-key', refreshMinutes: 60 });
  await sonarr.refresh();
  return { rewriter: new Rewriter(data, sonarr), close: async () => (data.stop(), server.close()) };
}

describe('Sonarr-assisted numbering', async () => {
  const library = [
    series(1, 'Assist First', 2024, seasons([12, 12]), ['Assist Second']), // the chain as one series
    series(2, 'Assist After', 2026, seasons([12])),
    series(3, 'Assist Twin', 2024, seasons([12])),
    series(4, 'Assist Twin', 2025, seasons([12])), // a second series with the same title, a year apart
    series(100, 'Assist Projected', 2024, seasons([12, 12])), // TVDB 9100, the real projection's show
    series(5, 'Assist Projected', 2024, seasons([12])), // a decoy with the same title
    series(6, 'Assist Orphan', 2024, seasons([12, 12])), // season 2 is asw-orphan-2, whose prequel the data lacks
    series(7, 'Assist Split', 2023, seasons([3])), // asw-split-1 alone
    series(8, 'Assist Split Two', 2024, seasons([12])), // its sequel as a separate series, absolute 1-12
    series(10, 'Assist Other Next', 2025, seasons([12])), // asw-other-2; its prequel is TVDB 9009, not this show
  ];
  const { rewriter, close } = await setup(library);
  afterAll(close);

  it('numbers a single title match from its first season', async () => {
    const r = await rewriter.rewrite('[Other] Assist First - 03 [1080p]');
    expect(r).toMatchObject({ kind: 'rewritten', title: 'Assist First S01E03 [1080p] [Other]', tvdbId: 9001 });
    expect(r.kind === 'rewritten' && r.assisted).toEqual({
      work: 'asw-first',
      series: { title: 'Assist First', tvdbId: 9001, year: 2024 },
      matchedBy: 'title',
      method: 'first-season',
      projection: [{ season: 1, episodes: '1-12' }],
      partial: false,
    });
  });

  it('numbers a sequel by absolute number when every prequel count is known', async () => {
    // asw-second follows asw-first (12 episodes): its episode 5 is absolute 17, Sonarr's S02E05.
    const r = await rewriter.rewrite('[Other] Assist Second - 05 [1080p]');
    expect(r).toMatchObject({ kind: 'rewritten', title: 'Assist First S02E05 [1080p] [Other]', assisted: { method: 'absolute', projection: [{ season: 2, episodes: '1-12' }] } });
  });

  it('passes through when several series match', async () => {
    expect(await rewriter.rewrite('[Other] Assist Twin - 01 [1080p]')).toMatchObject({ kind: 'pass', reason: 'assist-ambiguous' });
  });

  it('passes through when no series matches', async () => {
    expect(await rewriter.rewrite('[Other] Assist Long - 01 [1080p]')).toMatchObject({ kind: 'pass', reason: 'assist-no-match' });
  });

  it('passes through when a prequel in the chain has no known count', async () => {
    expect(await rewriter.rewrite('[Other] Assist After - 02 [1080p]')).toMatchObject({ kind: 'pass', reason: 'assist-no-numbering', detail: expect.stringContaining('asw-long has no known episode count') });
  });

  it('does not read a sequel with a missing prequel as the first season', async () => {
    expect(await rewriter.rewrite('[Other] Assist Orphan 2nd Season - 05 [1080p]')).toMatchObject({ kind: 'pass', reason: 'assist-no-numbering', detail: expect.stringContaining('has 2 seasons and nothing shows asw-orphan-2 is the first') });
  });

  it('does not offset a sequel that Sonarr keeps as its own series', async () => {
    // Prequel counts (3) plus episode 1 would be absolute 4 here, the wrong episode.
    expect(await rewriter.rewrite('[Other] Assist Split Two - 01 [1080p]')).toMatchObject({ kind: 'pass', reason: 'assist-no-numbering', detail: expect.stringContaining('does not start with asw-split-1') });
    expect(await rewriter.rewrite('[Other] Assist Other Next - 01 [1080p]')).toMatchObject({ kind: 'pass', reason: 'assist-no-numbering', detail: expect.stringContaining('does not start with asw-other-1') });
  });

  it('never overrides a real projection from the data', async () => {
    const r = await rewriter.rewrite('[Other] Assist Projected - 04 [1080p]');
    expect(r).toMatchObject({ kind: 'rewritten', title: 'Assist Projected S02E04 [1080p] [Other]', tvdbId: 9100 });
    expect(r.kind === 'rewritten' && r.assisted).toBeUndefined();
  });

  it('counts assisted results and turns them into a contribution', async () => {
    const stats = new Stats(null);
    for (const name of ['[Other] Assist First - 03 [1080p]', '[Other] Assist First - 04 [1080p]']) stats.record('nyaa', name, await rewriter.rewrite(name));
    expect(stats.of('nyaa')).toMatchObject({ rewritten: 2, assisted: 2 });
    const [entry] = stats.assistedList();
    expect([entry!.count, entry!.examples]).toEqual([2, ['[Other] Assist First - 03 [1080p]', '[Other] Assist First - 04 [1080p]']]);
    const text = issueText([], 'assist', stats.assistedList());
    expect(text).toContain(mappingYaml(entry!.mapping));
    expect(mappingYaml(entry!.mapping)).toBe(
      [
        '# data/works/asw-first.yaml',
        'id: asw-first',
        'ids:',
        '  tvdb_show: 9001',
        'projections:',
        '  tvdb_show:',
        '    - { season: 1, episodes: 1-12 }',
        'sources:',
        '  - https://thetvdb.com/dereferrer/series/9001',
        'notes: Derived by the Courmap proxy from a local Sonarr (first season, matched by title to "Assist First"). Verify on TVDB before merging.',
      ].join('\n'),
    );
  });
});

describe('Sonarr without absolute numbers', async () => {
  const { rewriter, close } = await setup([series(1, 'Assist First', 2024, seasons([12, 12], false), ['Assist Second'])]);
  afterAll(close);

  it('still numbers a first season, but passes a sequel through', async () => {
    expect(await rewriter.rewrite('[Other] Assist First - 03 [1080p]')).toMatchObject({ kind: 'rewritten', title: 'Assist First S01E03 [1080p] [Other]' });
    expect(await rewriter.rewrite('[Other] Assist Second - 05 [1080p]')).toMatchObject({ kind: 'pass', reason: 'assist-no-numbering', detail: expect.stringContaining('no absolute numbers') });
  });
});

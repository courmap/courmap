import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { MemoryDataset, validate } from '@courmap/builder';
import { createClient, type CourmapClient } from '../src/index.js';

// Fixes made from the proxy export of 2026-10-28 (issue #154), checked against the real data.

const root = fileURLToPath(new URL('../../../', import.meta.url));

describe('proxy export 2026-10-28', () => {
  let client: CourmapClient;
  beforeAll(async () => {
    const v = await validate(`${root}data`);
    if (!v.ok || !v.records) throw new Error('data does not validate');
    client = createClient(new MemoryDataset(v.records, { data_version: 'test', git_sha: '', built_at: '', schema_version: '' }));
  }, 120_000);

  const at = async (name: string) => {
    const r = await client.resolve(name);
    return { status: r.status, work: r.match?.work, episode: r.match?.episode };
  };

  it('a release year that belongs to the work the episode lands in counts as evidence (S01E19 of 2025 is the second season)', async () => {
    expect(await at('Dandadan.S01E19.2025.V2.1080p.WEB-DL.H.264.AAC-ADWeb')).toEqual({ status: 'ok', work: 'dandadan-2nd-season', episode: 7 });
  });

  it('with a season token the year may be the series\' first year (Ascendance of a Bookworm 2019 S04E17)', async () => {
    const r = await at('Ascendance of a Bookworm 2019 S04E17 1080p CR WEB-DL AAC 2.0 H.264-OldT');
    expect(r).toMatchObject({ status: 'ok', episode: 17 });
    expect(r.work).toMatch(/^honzuki-no-gekokujou.*-2026$/);
  });

  it('without a season token a year on another work is still a mismatch (Bonobono 2016 stays at its own work and episode)', async () => {
    expect(await at('[SubsPlease] Bonobono (TV 2016) - 600 (1080p) [ABCD1234]')).toEqual({ status: 'ok', work: 'bonobono-tv-2016', episode: 600 });
  });

  it('streaming tags and the 1x12 form no longer end up in the title (Dandadan)', async () => {
    expect(await at('Dandadan.S01.2024.1080p.Baha.WEB-DL.x264.AAC-ADWeb')).toMatchObject({ status: 'ok', work: 'dandadan' });
    expect(await at('Dan.Da.Dan.1x12')).toEqual({ status: 'ok', work: 'dandadan', episode: 12 });
  });

  it('the short forms of Danganronpa 3 and the Japanese readings of three titles are aliases', async () => {
    expect(await at('Danganronpa 3 - Future Arc - 11 (1280x720 HEVC2 AAC)')).toEqual({ status: 'ok', work: 'danganronpa-3-the-end-of-kibougamine-gakuen-mirai-hen', episode: 11 });
    expect(await at('[HorribleSubs] Danganronpa 3 - Despair Arc - 06 [720p]')).toEqual({ status: 'ok', work: 'danganronpa-3-the-end-of-kibougamine-gakuen-zetsubou-hen', episode: 6 });
    expect(await at('Wandansu.S01E09.The.Style.Wall.1080p.DSNP.WEB-DL.AAC2.0.H.264-playWEB')).toEqual({ status: 'ok', work: 'wandance', episode: 9 });
    expect(await at('Medarisuto.S02E04.Ascendance.1080p.DSNP.WEB-DL.AAC2.0.H.264-playWEB')).toEqual({ status: 'ok', work: 'medalist-2nd-season', episode: 4 });
    expect(await at('Dejimon.Bitobureiku.S01E29.Dangerous.Fandom.1080p.CR.WEB-DL.AAC2.0.H.264-playWEB')).toEqual({ status: 'ok', work: 'digimon-beatbreak', episode: 29 });
  });

  it('what the data cannot settle stays ambiguous (Cat\'s Eye 1983 against 2025, One Piece anime against the live action)', async () => {
    expect((await at('Cats.Eye.S01E05.Night.Flight.Is.a.Dangerous.Scent.JAPANESE.576p.AMZN.WEB-DL.DDP2.0.x264-AndreMor')).status).toBe('ambiguous');
    expect((await at('One.Piece.S01E07.DANiSH.ENGLiSH.JAPANESE.1080p.WEB-DL.H.264.DDP2.0-NoTrace')).status).toBe('ambiguous');
  });

  describe("a remake, by posting date (Cat's Eye 1983 and 2025)", () => {
    const CATS = 'Cats.Eye.S01E05.Night.Flight.Is.a.Dangerous.Scent.JAPANESE.576p.AMZN.WEB-DL.DDP2.0.x264-AndreMor';
    const on = async (name: string, postedAt?: string, now = '2026-10-28') => {
      const r = await client.resolve(name, postedAt ? { postedAt, now } : undefined);
      return { status: r.status, work: r.match?.work, episode: r.match?.episode };
    };

    it('a release posted after the remake premiered goes to the remake', async () => {
      expect(await on(CATS, '2026-10-25')).toEqual({ status: 'ok', work: 'cat-s-eye-2025', episode: 5 });
      expect(await on(CATS, '2025-12-01')).toEqual({ status: 'ok', work: 'cat-s-eye-2025', episode: 5 });
    });

    it('without a posting date, or posted before the remake premiered, it stays ambiguous', async () => {
      expect((await on(CATS)).status).toBe('ambiguous');
      expect((await on(CATS, '2010-01-01')).status).toBe('ambiguous');
    });

    it('a sequel is not a remake: a posting date does not move Dandadan to its second season', async () => {
      expect(await on('Dandadan - 05', '2026-10-25')).toEqual({ status: 'ok', work: 'dandadan', episode: 5 });
    });
  });
});

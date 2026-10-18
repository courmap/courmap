import { describe, expect, it } from 'vitest';
import { parseAnimeLists } from '../src/anime-lists.js';
import type { Conflict } from '../src/conflicts.js';
import { buildEpisodeMap, emitBlock } from '../src/projections.js';

// Each case is one Anime-Lists <anime> element (fake IDs) and the TVDB block it should become.
function tvdb(attrs: string, mappings = '', episodes = 12) {
  const conflicts: Conflict[] = [];
  const xml = `<anime-list><anime anidbid="1" ${attrs}><name>ignored</name>${mappings ? `<mapping-list>${mappings}</mapping-list>` : ''}</anime></anime-list>`;
  const al = parseAnimeLists(xml, conflicts).get(1)!;
  const map = buildEpisodeMap(al, 'tvdb_show', episodes, conflicts);
  const out = map ? emitBlock(map, 'tvdb_show', episodes, new Set(), 1, conflicts) : null;
  return { block: out?.block ?? null, conflicts: conflicts.map((c) => c.reason) };
}

describe('Anime-Lists to projections', () => {
  it('default season, no offset', () => {
    expect(tvdb('tvdbid="10" defaulttvdbseason="1" episodeoffset=""').block).toEqual([{ season: 1, episodes: '1-12' }]);
  });

  it('default season with an offset (split cour)', () => {
    expect(tvdb('tvdbid="10" defaulttvdbseason="1" episodeoffset="12"').block).toEqual([{ season: 1, episodes: '1-12', start: 13 }]);
  });

  it('absolute order has no season', () => {
    expect(tvdb('tvdbid="10" defaulttvdbseason="a" episodeoffset=""').block).toEqual([{ episodes: '1-12' }]);
  });

  it('season 0 without an offset is an ID only: the special episode is not given', () => {
    expect(tvdb('tvdbid="10" defaulttvdbseason="0" episodeoffset=""', '', 1).block).toBeNull();
  });

  it('season 0 with an explicit offset maps', () => {
    expect(tvdb('tvdbid="10" defaulttvdbseason="0" episodeoffset="2"', '', 1).block).toEqual([{ season: 0, episodes: 1, start: 3 }]);
  });

  it('range mappings split a long-runner into seasons, the last one open-ended', () => {
    const block = tvdb(
      'tvdbid="10" defaulttvdbseason="a" episodeoffset=""',
      '<mapping anidbseason="1" tvdbseason="1" start="1" end="8" offset="0"/><mapping anidbseason="1" tvdbseason="2" start="9" offset="-8"/>',
      20,
    ).block;
    expect(block).toEqual([
      { season: 1, episodes: '1-8' },
      { season: 2, episodes: '9-', start: 1 },
    ]);
  });

  it('explicit lists: specials into season 0, a hole marked with gap', () => {
    const block = tvdb(
      'tvdbid="10" defaulttvdbseason="1" episodeoffset=""',
      '<mapping anidbseason="1" tvdbseason="1">;4-0;</mapping><mapping anidbseason="0" tvdbseason="0">;1-5;2-6;3-0;</mapping>',
    ).block;
    expect(block).toEqual([
      { season: 1, episodes: '1-3' },
      { season: 1, episodes: '5-12', gap: true },
      { season: 0, episodes: 'S1-S2', start: 5 },
    ]);
  });

  it('one canonical episode spanning two provider episodes becomes a target split', () => {
    const block = tvdb('tvdbid="10" defaulttvdbseason="1" episodeoffset=""', '<mapping anidbseason="1" tvdbseason="1">;12-12+13;</mapping>').block;
    expect(block).toEqual([
      { season: 1, episodes: '1-11' },
      { season: 1, episodes: 12, target: '12-13' },
    ]);
  });

  it('consecutive canonical episodes sharing one provider episode become a merge', () => {
    const block = tvdb('tvdbid="10" defaulttvdbseason="1" episodeoffset="-1"', '<mapping anidbseason="1" tvdbseason="1">;1-1;2-1;</mapping>').block;
    expect(block).toEqual([
      { season: 1, episodes: '1-2', target: 1 },
      { season: 1, episodes: '3-12', start: 2 },
    ]);
  });

  it('coverage that stops early is partial, with a note', () => {
    const block = tvdb('tvdbid="10" defaulttvdbseason="1" episodeoffset=""', '<mapping anidbseason="1" tvdbseason="1">;11-0;12-0;</mapping>').block;
    expect(block).toEqual({ coverage: 'partial', notes: 'Anime-Lists maps TVDB only through episode 10 of 12.', ranges: [{ season: 1, episodes: '1-10' }] });
  });

  it('logs and skips a split onto non-consecutive episodes', () => {
    const r = tvdb('tvdbid="10" defaulttvdbseason="1" episodeoffset=""', '<mapping anidbseason="1" tvdbseason="1">;12-12+14;</mapping>');
    expect(r.block).toEqual({ coverage: 'partial', notes: 'Anime-Lists maps TVDB only through episode 11 of 12.', ranges: [{ season: 1, episodes: '1-11' }] });
    expect(r.conflicts).toEqual(['anime-lists-split-not-consecutive']);
  });

  it('non-numeric tvdbid (movie, OVA, hentai) gives no TVDB mapping', () => {
    expect(tvdb('tvdbid="movie" defaulttvdbseason="" episodeoffset=""').block).toBeNull();
  });

  it('never reads <name>', () => {
    const conflicts: Conflict[] = [];
    const al = parseAnimeLists('<anime-list><anime anidbid="1" tvdbid="10"><name>A Title</name></anime></anime-list>', conflicts).get(1)!;
    expect(JSON.stringify(al)).not.toContain('A Title');
  });
});

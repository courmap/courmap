import { describe, expect, it } from 'vitest';
import { aliasBands, buildAliasIndex, normalizeTitle, parseEpisodeRange, parseRef, parseTargetRange, projectForward, projectReverse, type ProjectionRow } from '../src/index.js';

describe('parseEpisodeRange', () => {
  it.each([
    [12, { kind: 'regular', from: 12, to: 12 }],
    ['1-28', { kind: 'regular', from: 1, to: 28 }],
    ['S1-S2', { kind: 'special', from: 1, to: 2 }],
    ['S1-2', { kind: 'special', from: 1, to: 2 }],
    ['S3', { kind: 'special', from: 3, to: 3 }],
    ['C1-C4', { kind: 'credit', from: 1, to: 4 }],
    ['892-', { kind: 'regular', from: 892, to: null }],
  ] as const)('%s', (input, value) => {
    expect(parseEpisodeRange(input)).toEqual({ ok: true, value });
  });

  it.each(['12-1', 'S1-C2', '0-3', 'x', '1~12', 'S-'])('rejects %s', (input) => {
    expect(parseEpisodeRange(input).ok).toBe(false);
  });
});

describe('parseTargetRange', () => {
  it('parses splits', () => {
    expect(parseTargetRange('12-13')).toEqual({ ok: true, value: { from: 12, to: 13 } });
    expect(parseTargetRange(4)).toEqual({ ok: true, value: { from: 4, to: 4 } });
    expect(parseTargetRange('13-12').ok).toBe(false);
  });
});

describe('parseRef', () => {
  it.each([
    ['anilist:154587', { namespace: 'anilist', id: '154587', season: null }],
    ['tvdb_show:405920:s1', { namespace: 'tvdb_show', id: '405920', season: 1 }],
    ['tmdb_show:120089:s0', { namespace: 'tmdb_show', id: '120089', season: 0 }],
    ['work:sousou-no-frieren', { namespace: 'work', id: 'sousou-no-frieren', season: null }],
    ['absolute:spy-x-family-absolute', { namespace: 'absolute', id: 'spy-x-family-absolute', season: null }],
    ['imdb:tt0123456', { namespace: 'imdb', id: 'tt0123456', season: null }],
  ] as const)('%s', (input, value) => {
    expect(parseRef(input)).toEqual({ ok: true, value });
  });

  it.each(['anilist', 'anilist:', 'foo:1', 'anilist:abc', 'anilist:1:s1', 'tvdb_show:1:season1', 'work:Bad_Slug', 'imdb:123'])(
    'rejects %s',
    (input) => {
      expect(parseRef(input).ok).toBe(false);
    },
  );
});

describe('normalizeTitle', () => {
  it('folds case, punctuation, apostrophes, macrons and full-width characters', () => {
    expect(normalizeTitle("Frieren: Beyond Journey's End")).toBe('frieren beyond journeys end');
    expect(normalizeTitle('Shingeki no Kyōjin')).toBe('shingeki no kyojin');
    expect(normalizeTitle('ＳＰＹ×ＦＡＭＩＬＹ')).toBe('spy x family');
    expect(normalizeTitle('葬送のフリーレン')).toBe('葬送のフリーレン');
  });

  it.each([
    ['multiplication sign reads as x', 'SPY×FAMILY', 'spy x family'],
    ['ampersand reads as and', 'Welsh & Shedar', 'welsh and shedar'],
    ['spaced multiplication sign', 'Hunter × Hunter', 'hunter x hunter'],
    ['white star', 'Kirarin☆Revolution', 'kirarin revolution'],
    ['black star', 'Star★Twinkle', 'star twinkle'],
    ['eighth note', 'Uta no Prince-sama♪', 'uta no prince sama'],
    ['colon', 'Re:Zero', 're zero'],
    ['full-width colon', 'Re：Zero', 're zero'],
    ['full-width exclamation and question marks', 'Ｋ－ＯＮ！！？', 'k on'],
    ['katakana middle dot', 'ソードアート・オンライン', 'ソードアート オンライン'],
    ['wave dash and corner brackets', '「ゆるキャン△」〜ふゆ〜', 'ゆるキャン ふゆ'],
    ['ideographic comma and full stop', 'けいおん、です。', 'けいおん です'],
  ])('folds %s', (_name, input, expected) => {
    expect(normalizeTitle(input)).toBe(expected);
  });

  it('keeps kana voicing marks: ha, ba and pa stay distinct', () => {
    expect(new Set(['ハル', 'バル', 'パル'].map(normalizeTitle)).size).toBe(3);
    expect(normalizeTitle('Shōnen')).toBe('shonen');
  });

  it('matches the same title written either way', () => {
    expect(normalizeTitle('SPY×FAMILY')).toBe(normalizeTitle('Spy x Family'));
    expect(normalizeTitle('Re：ゼロから始める異世界生活')).toBe(normalizeTitle('Re:ゼロから始める異世界生活'));
  });

  it('drops filler words', () => {
    expect(normalizeTitle('The Apothecary Diaries Season 2 Part 1')).toBe('apothecary diaries 2 1');
  });
});

describe('projection math', () => {
  const row = (r: Partial<ProjectionRow>): ProjectionRow => ({
    kind: 'regular',
    ep_from: 1,
    ep_to: 12,
    season: 1,
    target_from: 1,
    target_to: null,
    ...r,
  });

  it('offsets', () => {
    const rows = [row({ target_from: 13 })];
    expect(projectForward(rows, 'regular', 5)).toEqual({ season: 1, from: 17, to: 17 });
    expect(projectReverse(rows, 1, 17)).toEqual([{ kind: 'regular', from: 5, to: 5 }]);
    expect(projectReverse(rows, 1, 12)).toEqual([]);
  });

  it('one canonical episode to two provider episodes', () => {
    const rows = [row({ ep_from: 12, ep_to: 12, target_from: 12, target_to: 13 })];
    expect(projectForward(rows, 'regular', 12)).toEqual({ season: 1, from: 12, to: 13 });
    expect(projectReverse(rows, 1, 13)).toEqual([{ kind: 'regular', from: 12, to: 12 }]);
  });

  it('two canonical episodes to one provider episode', () => {
    const rows = [row({ ep_from: 3, ep_to: 4, target_from: 3, target_to: 3 })];
    expect(projectForward(rows, 'regular', 4)).toEqual({ season: 1, from: 3, to: 3 });
    expect(projectReverse(rows, 1, 3)).toEqual([{ kind: 'regular', from: 3, to: 4 }]);
  });

  it('open-ended ranges', () => {
    const rows = [row({ ep_from: 892, ep_to: null, season: 21, target_from: 1 })];
    expect(projectForward(rows, 'regular', 1000)).toEqual({ season: 21, from: 109, to: 109 });
    expect(projectReverse(rows, 21, 109)).toEqual([{ kind: 'regular', from: 1000, to: 1000 }]);
  });
});

describe('alias bands (decision S4.3)', () => {
  const shared = (alias: string, n: number) => Array.from({ length: n }, (_, i) => [alias, `w${String(i).padStart(3, '0')}`] as const);
  const pairs = [...shared('solo', 1), ...shared('pair', 2), ...shared('five', 5), ...shared('six', 6), ...shared('fifty', 50), ...shared('fifty one', 51)];

  it('sorts aliases into unique, shared, flagged and excluded bands', () => {
    const bands = aliasBands(pairs);
    expect([bands.unique, bands.shared]).toEqual([1, 2]);
    expect(bands.review.map(([a, ws]) => [a, ws.length])).toEqual([['fifty', 50], ['six', 6]]);
    expect(bands.excluded.map(([a, ws]) => [a, ws.length])).toEqual([['fifty one', 51]]);
  });

  it('keeps flagged aliases in the resolver index and drops excluded ones', () => {
    expect(buildAliasIndex('v', pairs).aliases.map(([a]) => a)).toEqual(['fifty', 'five', 'pair', 'six', 'solo']);
  });
});

describe('buildAliasIndex (decision S3.4)', () => {
  it('dedupes by normalized form, lists every work, drops short forms and sorts', () => {
    const index = buildAliasIndex('v', [
      ['spy x family', 'spy-x-family-part-2'],
      ['spy x family', 'spy-x-family'],
      ['spy x family', 'spy-x-family'],
      ['op', 'one-piece'],
      ['葬送', 'sousou-no-frieren'],
      ['葬送のフリーレン', 'sousou-no-frieren'],
      ['abc', 'x'],
    ]);
    expect(index).toEqual({
      data_version: 'v',
      aliases: [
        ['abc', ['x']],
        ['spy x family', ['spy-x-family', 'spy-x-family-part-2']],
        ['葬送のフリーレン', ['sousou-no-frieren']],
      ],
    });
  });
});

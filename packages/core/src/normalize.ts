/** Words dropped from titles before matching: they vary freely between releases. */
export const FILLER_WORDS: ReadonlySet<string> = new Set(['the', 'season', 'part', 'cour']);

/**
 * Characters folded before anything else (Xwolv decision S3.5). `×` reads as "x" in titles
 * (SPY×FAMILY is "Spy x Family"); the rest are decoration or punctuation that releases
 * write inconsistently, so they become word breaks. Full-width ASCII forms are already
 * folded by NFKC; this table covers the full-width and CJK punctuation NFKC leaves alone.
 */
export const FOLD: ReadonlyMap<string, string> = new Map([
  ['×', ' x '], // multiplication sign
  ['✕', ' x '], // multiplication x
  ['✖', ' x '], // heavy multiplication x
  ['&', ' and '], // ampersand reads as "and" (Welsh & Shedar, Welsh and Shedar)
  ['☆', ' '], // white star
  ['★', ' '], // black star
  ['♪', ' '], // eighth note
  ['♫', ' '], // beamed eighth notes
  ['♥', ' '], // heart
  ['♡', ' '], // white heart
  [':', ' '],
  ['：', ' '], // full-width colon (also NFKC)
  ['・', ' '], // katakana middle dot
  ['･', ' '], // half-width katakana middle dot
  ['、', ' '], // ideographic comma
  ['。', ' '], // ideographic full stop
  ['〜', ' '], // wave dash
  ['～', ' '], // full-width tilde
  ['「', ' '], // corner brackets
  ['」', ' '],
  ['『', ' '],
  ['』', ' '],
  ['【', ' '], // black lenticular brackets
  ['】', ' '],
  ['〈', ' '], // angle brackets
  ['〉', ' '],
]);

const FOLD_RE = new RegExp(`[${[...FOLD.keys()].join('')}]`, 'gu');

/**
 * Normalizes a title for alias matching: NFKC (folds full-width characters), the fold table,
 * lowercase, strip Latin diacritics such as macrons (not kana voicing marks), drop
 * apostrophes, turn other punctuation and symbols into spaces, drop filler words, collapse
 * whitespace.
 *
 * "Frieren: Beyond Journey's End" and "frieren beyond journeys end" normalize the same,
 * and so do "SPY×FAMILY" and "Spy x Family".
 */
export function normalizeTitle(title: string): string {
  const folded = title
    .normalize('NFKC')
    .replace(FOLD_RE, (c) => FOLD.get(c)!)
    .toLowerCase()
    .normalize('NFD')
    // Only the Latin combining diacritics (macrons, accents); kana voicing marks are meaningful.
    .replace(/[̀-ͯ]/g, '')
    .normalize('NFC')
    .replace(/['’ʼ`]/g, '')
    .replace(/[\p{P}\p{S}]/gu, ' ');
  return folded
    .split(/\s+/)
    .filter((w) => w && !FILLER_WORDS.has(w))
    .join(' ');
}

/** Length in code points, so a two-character Japanese title counts as 2, not by UTF-16 units. */
export const codePointLength = (s: string): number => [...s].length;

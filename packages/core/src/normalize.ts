/** Words dropped from titles before matching: they vary freely between releases. */
export const FILLER_WORDS: ReadonlySet<string> = new Set(['the', 'season', 'part', 'cour']);

/**
 * Normalizes a title for alias matching: NFKC (folds full-width characters), lowercase,
 * strip diacritics such as macrons, drop apostrophes, turn other punctuation and symbols
 * into spaces, drop filler words, collapse whitespace.
 *
 * "Frieren: Beyond Journey's End" and "frieren beyond journeys end" normalize the same.
 */
export function normalizeTitle(title: string): string {
  const folded = title
    .normalize('NFKC')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .normalize('NFC')
    .replace(/['’ʼ`]/g, '')
    .replace(/[\p{P}\p{S}]/gu, ' ');
  return folded
    .split(/\s+/)
    .filter((w) => w && !FILLER_WORDS.has(w))
    .join(' ');
}

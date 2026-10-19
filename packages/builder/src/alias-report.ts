import { ALIAS_EXCLUDE_OVER, ALIAS_REVIEW_OVER, aliasBands, type AliasBands } from '@courmap/core';

export interface AliasReport {
  bands: AliasBands;
  /** One line with the count in each band. */
  summary: string;
  /** The summary plus every flagged and excluded alias, for a PR comment or the digest. */
  markdown: string;
}

const LIST_WORKS = 8;

/** Counts aliases by how many works share them (decision S4.3) and lists the flagged ones. */
export function aliasReport(pairs: Iterable<readonly [string, string]>): AliasReport {
  const bands = aliasBands(pairs);
  const summary =
    `aliases: ${bands.unique} unique, ${bands.shared} shared by 2 to ${ALIAS_REVIEW_OVER} works, ` +
    `${bands.review.length} flagged for review (${ALIAS_REVIEW_OVER + 1} to ${ALIAS_EXCLUDE_OVER} works), ` +
    `${bands.excluded.length} excluded from resolver matching (over ${ALIAS_EXCLUDE_OVER} works)`;
  const row = ([alias, works]: [string, string[]]) =>
    `| \`${alias.replace(/\|/g, '\|')}\` | ${works.length} | ${works.slice(0, LIST_WORKS).join(', ')}${works.length > LIST_WORKS ? ', ...' : ''} |`;
  const table = (title: string, entries: [string, string[]][]) =>
    entries.length === 0
      ? []
      : [`### ${title}`, '', '| Alias (normalized) | Works | Examples |', '| --- | --- | --- |', ...[...entries].sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1)).map(row), ''];
  const markdown = [
    '## Alias quality',
    '',
    summary.replace(/^aliases: /, 'Aliases: ') + '.',
    '',
    ...table(`Excluded from resolver matching (over ${ALIAS_EXCLUDE_OVER} works)`, bands.excluded),
    ...table(`Flagged for review (${ALIAS_REVIEW_OVER + 1} to ${ALIAS_EXCLUDE_OVER} works)`, bands.review),
  ].join('\n');
  return { bands, summary, markdown };
}

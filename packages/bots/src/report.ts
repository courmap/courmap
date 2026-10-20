import type { Classification, Finding, FindingKind, Tier, TrackerRow, TrackerState } from './classify.js';
import { shiftLines, type SequenceDiff } from './shifts.js';

export const LABELS = {
  bot: 'bot',
  A: 'auto',
  B: 'needs-review',
  conflict: 'mapping-conflict',
  firstMapping: 'good first mapping',
  tracker: 'season-tracker',
  botFailure: 'bot-failure',
} as const;

const KIND_TITLE: Record<FindingKind, string> = {
  'count-bump': 'Count update',
  finished: 'Finished',
  'finished-open-range': 'Finished, open range',
  'sequence-change': 'Sequence change',
  sequel: 'Sequel',
  'count-conflict': 'Count conflict',
  'manual-change': 'AniList disagrees with a manual file',
  'relation-conflict': 'Several prequels',
  'missing-ids': 'Needs TVDB/TMDB mapping',
  'absolute-shift': 'Would renumber a finished work',
  'projection-short': 'Projection short of the count',
  invalid: 'Invalid bot update',
  'projection-mismatch': 'TMDB projection mismatch',
  'tmdb-split': 'TMDB split cour',
};

/** Labels for a finding's PR or issue. */
export function labelsFor(f: Finding): string[] {
  if (f.tier === 'A') return [LABELS.bot, LABELS.A];
  if (f.tier === 'B') return [LABELS.bot, LABELS.B];
  return [LABELS.bot, f.kind === 'missing-ids' || f.kind === 'projection-short' ? LABELS.firstMapping : LABELS.conflict];
}

const anilistLink = (id: number | null) => (id === null ? '' : `[AniList ${id}](https://anilist.co/anime/${id})`);
const subject = (f: Finding) => (f.work ? `${f.title} (${f.work})` : f.title);

/** Stable per kind and work, so the bot finds and updates its own issue instead of opening another. */
/** The title prefix of a projection-mismatch issue; the work's id follows. */
export const TMDB_ISSUE_PREFIX = 'TMDB projection mismatch';

export const tmdbLagComment = () =>
  'Closed by the projection checker: TMDB is behind our data, which is expected while a show is still starting (an airing or upcoming work, premiered less than six weeks ago or not yet). Nothing is wrong on our side. The checker looks again every week and opens a new issue if the difference is still there six weeks after the premiere, or if TMDB lists more than we map.';

export function tmdbSplitPrBody(f: Finding): string {
  const rows = f.split!.tmdb_show.map((r) => `season ${r.season}, episodes ${r.episodes}${r.start !== undefined ? ` from TMDB episode ${r.start}` : ''}`).join('; ');
  return [
    `Tier B: TMDB keeps **${subject(f)}** ${anilistLink(f.anilist)} inside an earlier season instead of giving it a season of its own ([TMDB show ${f.data.tmdb_show}](${f.data.url})).`,
    '',
    `The projection checker found that TMDB has no season for it, and that the season before it lists exactly as many episodes as everything we map there plus this cour. The mapping that fits is: ${rows}.`,
    '',
    '| | TMDB mapping |',
    '| --- | --- |',
    `| Before | ${(f.data.problems as string[]).join('; ')} |`,
    `| After | ${rows} (origin: bot) |`,
    '',
    'TVDB is untouched. Writes one line to `data/seeds/tmdb-splits.jsonl`. Approve or edit; a manual `projections.tmdb_show` in `data/works/` would override it, and rejecting it in `data/rejected.yaml` (kind: tmdb-split) stops the proposal.',
  ].join('\n');
}

export const tmdbProposedComment = () =>
  'Closed by the projection checker: TMDB keeps this cour inside the previous season, and a pull request proposes (or within a run or two will propose) the mapping that continues it there (data/seeds/tmdb-splits.jsonl). It reopens the question as an issue if that proposal is rejected and the mismatch remains.';

export const tmdbResolvedComment = () => 'Closed by the projection checker: a later run found our TMDB projection and TMDB agree for this work. It opens a new issue if that changes.';

export const issueTitle = (f: Finding) => `${KIND_TITLE[f.kind]}: ${f.work ?? `AniList ${f.anilist}`}`;

export function issueBody(f: Finding): string {
  return [
    `**${subject(f)}** ${anilistLink(f.anilist)}`,
    '',
    f.summary.charAt(0).toUpperCase() + f.summary.slice(1) + '.',
    '',
    'Source data:',
    '',
    '```json',
    JSON.stringify(f.data, null, 2),
    '```',
    '',
    f.kind === 'missing-ids' || f.kind === 'projection-short'
      ? 'Add the missing IDs or ranges and projections in a file under `data/works/` (see CONTRIBUTING.md). The bot closes nothing itself; close this issue in the PR that fixes it.'
      : 'This needs a person: the sources disagree, or the change touches a manual file or renumbers released episodes. Fix the data in a PR and close this issue there.',
    '',
    '<sub>Opened by the Courmap bots. Tier C: a person decides.</sub>',
  ].join('\n');
}

export function airingPrBody(fs: Finding[], diff: SequenceDiff, tier: Tier): string {
  return [
    tier === 'A'
      ? 'Tier A: AniList and the data agree apart from these airing updates. Labeled `auto`; while the bots run in dry-run mode, nothing is merged automatically.'
      : 'Tier B: these airing updates need a look before merging (see each note).',
    '',
    '| Work | AniList | Update |',
    '| --- | --- | --- |',
    ...fs.map((f) => `| ${subject(f)} | ${anilistLink(f.anilist)} | ${f.summary} |`),
    '',
    ...(diff.changed.length + diff.added.length > 0 ? ['### Absolute sequences', '', ...shiftLines(diff), ...(diff.added.length > 0 ? ['', `New sequences: ${diff.added.join(', ')}.`] : []), ''] : []),
    'Writes `data/seeds/airing.jsonl` only (origin: bot). Manual files win over it per key.',
  ].join('\n');
}

export function sequelPrBody(f: Finding, diff: SequenceDiff): string {
  const r = f.relation!;
  return [
    `Tier B: AniList lists a ${r.relation} relation that makes **${r.prequel}** the prequel of **${subject(f)}** ${anilistLink(f.anilist)}.`,
    '',
    '| | Prequel |',
    '| --- | --- |',
    `| Before | ${(f.data.ours as { prequel: string | null } | undefined)?.prequel ?? 'none'} |`,
    `| After | ${r.prequel} (origin: bot) |`,
    '',
    'Translation diff: a prequel changes how release names without a season token are scored and where `continue_prequel` group overrides start; projections are unchanged.',
    ...(diff.shifts.length > 0 || diff.changed.length > 0 ? ['', '### Absolute sequences', '', ...shiftLines(diff)] : ['', 'No absolute numbers shift.']),
    '',
    'Writes one line to `data/seeds/relations.jsonl`. Approve or edit; a manual `prequel:` in `data/works/` would override it.',
  ].join('\n');
}

const STATE_ORDER: TrackerState[] = ['conflict', 'awaiting review', 'auto-update', 'waiting for seed', 'upcoming', 'mapped'];
const MAX_BODY = 60_000;

/** The pinned Season tracker issue body, rewritten on every scan. */
export function trackerBody(season: string, rows: TrackerRow[], when: Date): string {
  const counts = STATE_ORDER.map((s) => [s, rows.filter((r) => r.state === s).length] as const).filter(([, n]) => n > 0);
  const row = (r: TrackerRow) =>
    `| ${anilistLink(r.anilist)} | ${r.work ?? ''} | ${r.title.replace(/\|/g, '\\|')} | ${r.format ?? ''} | ${r.episodes ?? ''} | ${r.state} | ${r.note.slice(0, 160).replace(/\|/g, '\\|')} |`;
  const head = [
    `Every show of ${season} on AniList and where it stands in Courmap. Rewritten by the bots on every scan; last run ${when.toISOString().slice(0, 16).replace('T', ' ')} UTC.`,
    '',
    counts.map(([s, n]) => `${n} ${s}`).join(', ') + '.',
    '',
    '| AniList | Work | Title | Format | Eps | State | Note |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ];
  const sorted = [...rows].sort((a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state) || a.anilist - b.anilist);
  const lines = [...head];
  let length = head.join('\n').length;
  let omitted = 0;
  for (const r of sorted) {
    const l = row(r);
    if (length + l.length + 1 > MAX_BODY) omitted++;
    else {
      lines.push(l);
      length += l.length + 1;
    }
  }
  if (omitted > 0) lines.push('', `${omitted} more (mapped) not listed: GitHub limits issue length.`);
  lines.push('', '<sub>States: mapped (in the data, nothing to do), auto-update (tier A PR), awaiting review (tier B PR), conflict (tier C issue), waiting for seed (not yet in cedya77), upcoming.</sub>');
  return lines.join('\n');
}

/** One line per tier, for logs and the job summary. */
export function summaryLine(c: Pick<Classification, 'findings'>): string {
  const n = (t: Tier) => c.findings.filter((f) => f.tier === t).length;
  return `${n('A')} tier A, ${n('B')} tier B, ${n('C')} tier C`;
}

export interface DigestInput {
  since: Date;
  autoMerged: { title: string; url: string }[];
  autoOpen: { title: string; url: string }[];
  review: { title: string; url: string }[];
  conflicts: { title: string; url: string }[];
  trackers: { title: string; url: string }[];
}

/** The weekly digest. "Nothing needs review" is the line that tells Xwolv the week is done. */
export function digestText(d: DigestInput): { title: string; body: string } {
  const title = `Courmap: ${d.autoMerged.length} auto-merged, ${d.review.length} need review, ${d.conflicts.length} conflict${d.conflicts.length === 1 ? '' : 's'}`;
  const list = (items: { title: string; url: string }[], max = 10) => [...items.slice(0, max).map((i) => `- ${i.title}: ${i.url}`), ...(items.length > max ? [`- and ${items.length - max} more`] : [])];
  const body = [
    `Week since ${d.since.toISOString().slice(0, 10)}.`,
    ...(d.autoOpen.length > 0 ? [`${d.autoOpen.length} tier A PR(s) open (dry run: the bots never merge).`] : []),
    d.review.length === 0 && d.conflicts.length === 0 ? 'Nothing needs review this week.' : '',
    ...(d.review.length > 0 ? ['', 'Needs review:', ...list(d.review)] : []),
    ...(d.conflicts.length > 0 ? ['', 'Conflicts:', ...list(d.conflicts)] : []),
    ...(d.trackers.length > 0 ? ['', 'Season trackers:', ...list(d.trackers)] : []),
  ]
    .filter((l, i, a) => !(l === '' && (i === 0 || a[i - 1] === '')))
    .join('\n');
  return { title, body };
}

#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { AIRING_DIR, RELATIONS_DIR, TMDB_SPLITS_DIR, aliasPairs, aliasReport, botFilePath } from '@courmap/builder';
import { AniListClient, type AniListMedia } from './anilist.js';
import { classify, type Classification, type Finding } from './classify.js';
import { GitHubWriter } from './github.js';
import { sendDigest } from './notify.js';
import { LABELS, TMDB_ISSUE_PREFIX, airingPrBody, tmdbLagComment, tmdbProposedComment, tmdbResolvedComment, tmdbSplitPrBody, digestText, issueBody, issueTitle, labelsFor, sequelPrBody, summaryLine, trackerBody } from './report.js';
import { nextSeason, seasonName, seasonOf, type SeasonRef } from './season.js';
import { diffSequences } from './shifts.js';
import { airingJson, evaluate, loadState, relationJson, tmdbSplitJson, type State } from './state.js';
import { TmdbClient, checkProjectionsDetailed, issuesToClose, searchShows, showInfo } from './tmdb.js';

const USAGE = `Usage: courmap-bots <command> [options]

Commands:
  scan     Season scanner and airing tracker (AniList), classifier, tier A/B PRs, tier C
           issues and the Season tracker issues
  tmdb     Projection checker: our TMDB projections against TMDB season counts (needs
           TMDB_API_KEY; CI only, nothing is stored)
  tmdb-show <work|q:title|tmdb:id>...  What TMDB says about the TMDB show of each work (name, seasons, air dates) and which
           shows a search for its title finds, next to our mapping; for reading in a CI log (needs TMDB_API_KEY)
  digest   The weekly digest, to ntfy (NTFY_URL) and Discord (DISCORD_WEBHOOK_URL) when set

Options:
  --data <dir>          Data directory (default: data)
  --apply               Open and update PRs and issues, send the digest. Without it every
                        action is printed only. PRs are never merged either way.
  --json <file>         Write the findings as JSON
  --media <file>        scan: read AniList media from this file instead of calling AniList
  --save-media <file>   scan: save the AniList media that were fetched
  --now <iso>           scan: classify as of this time (default: now)
  --max-prs <n>         Tier B sequel PRs per run (default 10)
  --max-issues <n>      New or updated tier C issues per run (default 15)
  --all                 tmdb: check every work with a TMDB projection, not just recent and manual ones
  -h, --help            Show this help
`;

interface MediaFile {
  seasons: { ref: SeasonRef; media: AniListMedia[] }[];
  airing: AniListMedia[];
  requests: number;
}

async function fetchMedia(state: State, now: Date, log: (l: string) => void): Promise<MediaFile> {
  const anilist = new AniListClient({ log });
  const cur = seasonOf(now);
  const seasons: MediaFile['seasons'] = [];
  for (const ref of [cur, nextSeason(cur)]) {
    seasons.push({ ref, media: await anilist.seasonMedia(ref.season, ref.year) });
    log(`AniList ${seasonName(ref)}: ${seasons.at(-1)!.media.length} media`);
  }
  const seen = new Set(seasons.flatMap((s) => s.media.map((m) => m.id)));
  const airingIds = [...state.records.works.values()].filter((w) => w.status === 'airing' && w.ids.anilist !== undefined).map((w) => Number(w.ids.anilist));
  const airing = await anilist.mediaByIds(airingIds.filter((id) => !seen.has(id)));
  log(`AniList airing works: ${airingIds.length} in the data, ${airing.length} fetched outside the two seasons; ${anilist.requests} requests in all`);
  return { seasons, airing, requests: anilist.requests };
}

const cap = <T>(xs: T[], n: number) => xs.slice(0, Math.max(0, n));

async function publish(c: Classification, state: State, writer: GitHubWriter, now: Date, limits: { prs: number; issues: number }): Promise<void> {
  await writer.ensureLabels();
  const tierA = c.findings.filter((f) => f.tier === 'A' && f.airing);
  const reviewAiring = c.findings.filter((f) => f.tier === 'B' && f.airing);
  const sequels = c.findings.filter((f) => f.tier === 'B' && f.relation);
  const issues = c.findings.filter((f) => f.tier === 'C');

  const airingPr = async (fs: Finding[], branch: string, tier: 'A' | 'B') => {
    if (fs.length === 0) return;
    const lines = new Map(state.airing.map((a) => [a.work, a]));
    for (const f of fs) lines.set(f.airing!.work, f.airing!);
    const after = evaluate(state.loaded, state.relations, [...lines.values()]);
    const diff = after.records ? diffSequences(state.records, after.records) : c.diff;
    await writer.upsertPullRequest(branch, `Airing updates for ${fs.length} work${fs.length === 1 ? '' : 's'}${tier === 'B' ? ' (review)' : ''}`, airingPrBody(fs, diff, tier), labelsFor(fs[0]!), new Map(fs.map((f) => [botFilePath(AIRING_DIR, f.airing!.work), airingJson(f.airing!)])));
  };
  await airingPr(tierA, 'bots/airing-updates', 'A');
  await airingPr(reviewAiring, 'bots/airing-review', 'B');

  for (const f of cap(sequels, limits.prs)) {
    const rel = new Map(state.relations.map((r) => [r.work, r]));
    rel.set(f.relation!.work, f.relation!);
    const after = evaluate(state.loaded, [...rel.values()], state.airing);
    const diff = after.records ? diffSequences(state.records, after.records) : c.diff;
    await writer.upsertPullRequest(`bots/sequel-${f.work}`, `Sequel: ${f.work} follows ${f.relation!.prequel}`, sequelPrBody(f, diff), labelsFor(f), new Map([[botFilePath(RELATIONS_DIR, f.relation!.work), relationJson(f.relation!)]]));
  }
  if (sequels.length > limits.prs) console.log(`${sequels.length - limits.prs} more sequel PR(s) wait for the next run (--max-prs ${limits.prs}).`);

  for (const f of cap(issues, limits.issues)) await writer.upsertIssue(issueTitle(f), issueBody(f), labelsFor(f));
  if (issues.length > limits.issues) console.log(`${issues.length - limits.issues} more issue(s) wait for the next run (--max-issues ${limits.issues}).`);

  for (const [season, rows] of c.tracker) await writer.upsertIssue(`Season tracker: ${season}`, trackerBody(season, rows, now), [LABELS.bot, LABELS.tracker], { pin: true });
}

function printFindings(findings: Finding[]): void {
  for (const tier of ['A', 'B', 'C'] as const) {
    const fs = findings.filter((f) => f.tier === tier);
    if (fs.length === 0) continue;
    console.log(`\nTier ${tier} (${fs.length}):`);
    for (const f of fs) console.log(`  ${f.kind.padEnd(20)} ${(f.work ?? `anilist:${f.anilist}`).padEnd(48)} ${f.summary}`);
  }
}

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      data: { type: 'string', default: 'data' },
      apply: { type: 'boolean' },
      json: { type: 'string' },
      media: { type: 'string' },
      'save-media': { type: 'string' },
      now: { type: 'string' },
      'max-prs': { type: 'string', default: '10' },
      'max-issues': { type: 'string', default: '15' },
      all: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const command = positionals[0];
  if (values.help || !command) {
    process.stdout.write(USAGE);
    return command || values.help ? 0 : 1;
  }
  const apply = values.apply === true;
  const log = (l: string) => console.log(l);
  const writer = new GitHubWriter({ apply, repoDir: process.cwd(), log, issuesToken: process.env.GH_ISSUES_TOKEN || undefined });
  const limits = { prs: Number(values['max-prs']), issues: Number(values['max-issues']) };

  if (command === 'scan') {
    const now = values.now ? new Date(values.now) : new Date();
    const state = await loadState(values.data!);
    const media: MediaFile = values.media ? (JSON.parse(await readFile(values.media, 'utf8')) as MediaFile) : await fetchMedia(state, now, log);
    if (values['save-media']) await writeFile(values['save-media'], JSON.stringify(media));
    const c = classify({ state, seasons: media.seasons, airing: media.airing, now });
    console.log(`\nClassified: ${summaryLine(c)}.`);
    for (const [season, rows] of c.tracker) {
      const counts = new Map<string, number>();
      for (const r of rows) counts.set(r.state, (counts.get(r.state) ?? 0) + 1);
      console.log(`${season}: ${rows.length} shows; ${[...counts].map(([s, n]) => `${n} ${s}`).join(', ')}`);
    }
    if (c.diff.changed.length + c.diff.added.length > 0) console.log(`Absolute sequences: ${c.diff.changed.length} changed, ${c.diff.added.length} new, ${c.diff.shifts.length} work(s) shift.`);
    printFindings(c.findings);
    if (values.json) await writeFile(values.json, JSON.stringify({ generated: now.toISOString(), anilist_requests: media.requests, findings: c.findings, tracker: Object.fromEntries(c.tracker), diff: c.diff }, null, 2));
    console.log('');
    await publish(c, state, writer, now, limits);
    return 0;
  }

  if (command === 'tmdb') {
    const key = process.env.TMDB_API_KEY;
    if (!key) {
      console.log('TMDB_API_KEY is not set: the projection checker is skipped.');
      return 0;
    }
    const state = await loadState(values.data!);
    const year = new Date().getUTCFullYear();
    const ids = [...state.records.works.values()]
      .filter((w) => values.all || state.merged.get(w.id)!.isManual || w.status === 'airing' || (w.year !== null && w.year >= year - 1))
      .map((w) => w.id);
    const tmdb = new TmdbClient(key);
    // When each airing or upcoming work's season premiered: TMDB gets six weeks after that before a lag is a finding.
    const premieres = new Map<string, Date | null>();
    const young = ids.filter((id) => ['airing', 'upcoming'].includes(state.records.works.get(id)!.status) && state.records.works.get(id)!.ids.anilist !== undefined);
    if (young.length > 0) {
      const byAniList = new Map(young.map((id) => [Number(state.records.works.get(id)!.ids.anilist), id]));
      for (const m of await new AniListClient({ log }).mediaByIds([...byAniList.keys()])) {
        const id = byAniList.get(m.id);
        const d = m.startDate;
        if (id !== undefined) premieres.set(id, d.year !== null && d.month !== null ? new Date(Date.UTC(d.year, d.month - 1, d.day ?? 1)) : null);
      }
    }
    // Cours TMDB keeps inside the previous season become tier B PRs, unless one exists or was rejected.
    const noSplit = new Set([...state.tmdbSplits.map((s) => s.work), ...state.rejected.filter((r) => r.kind === 'tmdb-split').map((r) => r.work)]);
    const result = await checkProjectionsDetailed(state.records, ids, tmdb, { now: new Date(), noSplit, premieres, onError: (show, err) => console.log(`TMDB show ${show} skipped: ${err.message}`) });
    // Each proposal is compiled with the current data first; one that does not validate is an ordinary issue instead.
    const splitLines = new Map(state.tmdbSplits.map((s) => [s.work, s]));
    const proposals = result.splits.slice();
    result.splits = [];
    let prs = 0;
    for (const f of proposals) {
      const next = new Map(splitLines).set(f.work!, f.split!);
      const ev = evaluate(state.loaded, state.relations, state.airing, [...next.values()]);
      if (!ev.records) {
        console.log(`TMDB split for ${f.work} does not validate (${ev.errors[0]?.message}); it becomes an issue.`);
        result.findings.push({ ...f, tier: 'C', kind: 'projection-mismatch', summary: `TMDB projection disagrees with TMDB: ${(f.data.problems as string[]).join('; ')}`, split: undefined as never });
        continue;
      }
      result.splits.push(f);
      if (prs >= limits.prs) continue;
      prs++;
      await writer.upsertPullRequest(`bots/tmdb-split-${f.work}`, `TMDB split cour: ${f.work}`, tmdbSplitPrBody(f), labelsFor(f), new Map([[botFilePath(TMDB_SPLITS_DIR, f.work!), tmdbSplitJson(f.split!)]]));
    }
    if (result.splits.length > prs) console.log(`${result.splits.length - prs} more TMDB split PR(s) wait for the next run (--max-prs ${limits.prs}).`);
    const { findings, lagging } = result;
    console.log(`Projection checker: ${ids.length} works considered, ${tmdb.requests} TMDB shows fetched, ${findings.length} mismatch(es), ${lagging.length} more only because TMDB lags a show that is still starting.`);
    printFindings(findings);
    if (lagging.length > 0) console.log(`TMDB lag, no issue: ${lagging.map((f) => f.work).join(', ')}`);
    if (values.json) await writeFile(values.json, JSON.stringify({ findings, lagging: lagging.map((f) => f.work) }, null, 2));
    await writer.ensureLabels();
    for (const f of cap(findings, limits.issues)) await writer.upsertIssue(issueTitle(f), issueBody(f), labelsFor(f));
    // An issue the checker opened closes itself once a later run finds no mismatch worth one for that work.
    const prefix = `${TMDB_ISSUE_PREFIX}: `;
    for (const c of issuesToClose(await writer.openIssues(prefix), prefix, result)) await writer.closeIssue(c.number, c.reason === 'lag' ? tmdbLagComment() : c.reason === 'proposed' ? tmdbProposedComment() : tmdbResolvedComment());
    return 0;
  }

  if (command === 'tmdb-show') {
    const key = process.env.TMDB_API_KEY;
    if (!key) return (console.log('TMDB_API_KEY is not set.'), 1);
    const state = await loadState(values.data!);
    const tmdb = new TmdbClient(key);
    for (const id of positionals.slice(1)) {
      // q:Title searches TMDB for a title instead of reading one of our works.
      if (id.startsWith('q:')) {
        for (const r of await searchShows(tmdb, id.slice(2).replace(/_/g, ' '))) console.log(`search "${id.slice(2)}": ${r.id} "${r.name}" ${r.firstAirDate ?? ''}`);
        continue;
      }
      // tmdb:ID reads a TMDB show by its ID, for a show none of our works points at.
      if (id.startsWith('tmdb:')) {
        const info = await showInfo(tmdb, id.slice(5));
        console.log(`
== TMDB ${id.slice(5)}: ${info ? `"${info.name}" (${info.status})` : 'no such show'}`);
        for (const s of info?.seasons ?? []) console.log(`     season ${s.number}: ${s.episodes} episodes, ${s.airDate ?? 'no air date'}, "${s.name}"`);
        continue;
      }
      const w = state.records.works.get(id);
      if (!w) {
        console.log(`${id}: not in the data`);
        continue;
      }
      console.log(`\n== ${id} (${w.status}, ${w.year}) tmdb_show ${w.ids.tmdb_show ?? '-'}; ours: ${JSON.stringify(w.projections.tmdb_show ?? [])}`);
      if (w.ids.tmdb_show !== undefined) {
        const info = await showInfo(tmdb, w.ids.tmdb_show);
        if (!info) console.log('   TMDB has no such show');
        else {
          console.log(`   TMDB: "${info.name}" (${info.status})`);
          for (const s of info.seasons) console.log(`     season ${s.number}: ${s.episodes} episodes, ${s.airDate ?? 'no air date'}, "${s.name}"`);
        }
      }
      for (const r of await searchShows(tmdb, w.titles.romaji ?? id)) console.log(`   search "${w.titles.romaji ?? id}": ${r.id} "${r.name}" ${r.firstAirDate ?? ''}`);
    }
    return 0;
  }

  if (command === 'digest') {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const recent = <T extends { createdAt: string; mergedAt?: string | null }>(xs: T[], field: 'createdAt' | 'mergedAt' = 'createdAt') => xs.filter((x) => new Date(x[field] ?? 0) >= since);
    const ghList = async (...a: Parameters<GitHubWriter['list']>) => {
      try {
        return await new GitHubWriter({ apply: true, repoDir: process.cwd(), log }).list(...a);
      } catch (err) {
        console.log(`gh ${a.join(' ')} failed (${(err as Error).message.split('\n')[0]}); counting none`);
        return [];
      }
    };
    const d = digestText({
      since,
      autoMerged: recent(await ghList('pr', LABELS.A, 'merged'), 'mergedAt'),
      autoOpen: await ghList('pr', LABELS.A, 'open'),
      review: await ghList('pr', LABELS.B, 'open'),
      conflicts: await ghList('issue', LABELS.conflict, 'open'),
      trackers: await ghList('issue', LABELS.tracker, 'open'),
    });
    const state = await loadState(values.data!);
    const aliases = aliasReport(aliasPairs(state.records));
    const body = `${d.body}\n\nAliases: ${aliases.bands.review.length} flagged for review, ${aliases.bands.excluded.length} excluded from resolving.`;
    console.log(`${d.title}\n\n${body}`);
    if (apply) {
      const sent = await sendDigest(d.title, body, { ntfyUrl: process.env.NTFY_URL, discordWebhook: process.env.DISCORD_WEBHOOK_URL });
      console.log(sent.length > 0 ? `\nSent to ${sent.join(' and ')}.` : '\nNo NTFY_URL or DISCORD_WEBHOOK_URL set: printed only.');
    }
    return 0;
  }

  console.error(`Unknown command "${command}"\n`);
  process.stderr.write(USAGE);
  return 1;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err instanceof Error ? (err.stack ?? err.message) : err);
    process.exit(2);
  },
);

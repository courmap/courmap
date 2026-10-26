import { rejectsAiring, rejectsRelation, type AiringLine, type RelationLine, type TmdbSplitLine } from '@courmap/builder';
import type { WorkRecord } from '@courmap/core';
import type { AniListMedia } from './anilist.js';
import { seasonName, type SeasonRef } from './season.js';
import { diffSequences, type SequenceDiff } from './shifts.js';
import { evaluate, type State } from './state.js';

export type Tier = 'A' | 'B' | 'C';

export type FindingKind =
  | 'count-bump' // A: an airing work's total or status changed
  | 'finished' // A: an airing work finished and the counts agree
  | 'finished-open-range' // B: finished, but a projection is still open-ended
  | 'sequence-change' // B: an update that changes an existing absolute sequence
  | 'sequel' // B: AniList names a prequel the data lacks
  | 'count-conflict' // C: counts disagree on a finished work
  | 'manual-change' // C: AniList disagrees with a manual file
  | 'relation-conflict' // C: AniList names several prequels in the data
  | 'missing-ids' // C: no TVDB/TMDB IDs (or no work at all) four weeks after premiere
  | 'absolute-shift' // C: a change would renumber a finished work
  | 'projection-short' // C: a new count runs past a seed projection (Anime-Lists has not caught up)
  | 'invalid' // C: a proposed line does not validate
  | 'projection-mismatch' // C: our TMDB projection disagrees with TMDB's season counts
  | 'tmdb-fill' // B: TMDB lists episodes we do not map, and exactly one other work of the show fills the gap
  | 'tmdb-split'; // B: TMDB keeps this cour inside the previous season: continue it there

export interface Finding {
  tier: Tier;
  kind: FindingKind;
  work: string | null;
  anilist: number | null;
  /** Our romaji title (cedya77), or "AniList <id>" for media not in the data. Never an AniList title. */
  title: string;
  summary: string;
  airing?: AiringLine;
  relation?: RelationLine;
  /** tmdb-split: the file the PR adds under data/seeds/tmdb-splits/. */
  split?: TmdbSplitLine;
  /** Source values attached to issues and PR bodies. */
  data: Record<string, unknown>;
}

export type TrackerState = 'mapped' | 'auto-update' | 'awaiting review' | 'conflict' | 'waiting for seed' | 'upcoming';

export interface TrackerRow {
  anilist: number;
  work: string | null;
  title: string;
  format: string | null;
  status: string | null;
  episodes: number | null;
  state: TrackerState;
  note: string;
}

export interface Classification {
  findings: Finding[];
  /** Per season name, every scanned show with its state, sorted by AniList ID. */
  tracker: Map<string, TrackerRow[]>;
  /** Bot files after every tier A and B proposal (what the PRs would make main look like). */
  proposed: { relations: RelationLine[]; airing: AiringLine[] };
  diff: SequenceDiff;
}

export interface ClassifyInput {
  state: State;
  seasons: { ref: SeasonRef; media: AniListMedia[] }[];
  /** Media for the data's airing works, fetched by ID (may overlap the seasons). */
  airing: AniListMedia[];
  now: Date;
}

/** No TVDB or TMDB IDs this long after premiere is a tier C issue. */
const FOUR_WEEKS = 28 * 24 * 60 * 60 * 1000;
/** Formats expected to get TVDB or TMDB IDs; shorts, specials and music often never do. */
const EXPECT_IDS = new Set(['TV', 'MOVIE']);

const STATUS: Partial<Record<string, WorkRecord['status']>> = { RELEASING: 'airing', FINISHED: 'finished', NOT_YET_RELEASED: 'upcoming' };

const premiere = (m: AniListMedia): Date | null =>
  m.startDate.year && m.startDate.month && m.startDate.day ? new Date(Date.UTC(m.startDate.year, m.startDate.month - 1, m.startDate.day)) : null;

const hasOwn = (o: object | undefined, k: string) => o !== undefined && Object.prototype.hasOwnProperty.call(o, k);

const isOpen = (w: WorkRecord) => Object.values(w.projections).some((rows) => rows?.some((r) => r.ep_to === null));

/**
 * The classifier (docs/SPEC.md, "Automation"): compares what AniList reports with the data and
 * sorts every difference into tier A (auto PR), B (review PR) or C (issue). Applies the
 * guardrails: a manual file is never changed by a bot (tier C), any change to an existing
 * absolute sequence is at least tier B, and renumbering a finished work is tier C (S4.2).
 */
export function classify(input: ClassifyInput): Classification {
  const { state, now } = input;
  const findings: Finding[] = [];
  const titleOf = (id: number, w: WorkRecord | undefined) => (w ? (w.titles.romaji ?? w.id) : `AniList ${id}`);
  const workOf = (anilist: number) => {
    const id = state.byAnilist.get(anilist);
    return id === undefined ? undefined : state.records.works.get(id);
  };

  const media = new Map<number, AniListMedia>();
  for (const m of [...input.seasons.flatMap((s) => s.media), ...input.airing]) if (m.format !== 'MUSIC') media.set(m.id, m);

  // Prequel candidates per work, from PREQUEL edges and from SEQUEL edges seen from the other side.
  const prequels = new Map<string, Map<string, RelationLine>>();
  const addPrequel = (work: WorkRecord, prequel: WorkRecord, relation: RelationLine['relation'], anilist: [number, number]) => {
    if (work.id === prequel.id) return;
    let m = prequels.get(work.id);
    if (!m) prequels.set(work.id, (m = new Map()));
    if (!m.has(prequel.id)) m.set(prequel.id, { work: work.id, prequel: prequel.id, relation, origin: 'bot', anilist });
  };
  for (const m of media.values()) {
    const w = workOf(m.id);
    for (const e of m.relations?.edges ?? []) {
      if (e.node.type !== 'ANIME') continue;
      const other = workOf(e.node.id);
      if (!w || !other) continue;
      if (e.relationType === 'PREQUEL') addPrequel(w, other, 'PREQUEL', [m.id, e.node.id]);
      if (e.relationType === 'SEQUEL') addPrequel(other, w, 'SEQUEL', [e.node.id, m.id]);
    }
  }

  const airing = new Map(state.airing.map((a) => [a.work, a]));
  /** Tracker notes for media with nothing to do. */
  const notes = new Map<number, string>();
  const relations = new Map(state.relations.map((r) => [r.work, r]));

  for (const m of [...media.values()].sort((a, b) => a.id - b.id)) {
    const w = workOf(m.id);
    const title = titleOf(m.id, w);
    const base = { anilist: m.id, title, data: { anilist: { id: m.id, url: `https://anilist.co/anime/${m.id}`, format: m.format, status: m.status, episodes: m.episodes, start: premiere(m)?.toISOString().slice(0, 10) ?? null } } };
    const started = premiere(m);
    const overdue = started !== null && now.getTime() - started.getTime() >= FOUR_WEEKS;

    if (!w) {
      if (overdue && m.format !== null && EXPECT_IDS.has(m.format)) {
        findings.push({ ...base, tier: 'C', kind: 'missing-ids', work: null, summary: 'not in the data four weeks after premiere (no cedya77 entry carries this AniList ID)' });
      }
      continue;
    }
    const merged = state.merged.get(w.id)!;
    const manual = merged.manual?.data as object | undefined;
    const at = { ...base, work: w.id, data: { ...base.data, ours: { status: w.status, episodes: w.episodes, prequel: w.prequel } } };

    // Counts and status. Tier A needs the counts to agree or to grow (cedya77's counts for airing
    // works lag behind); a smaller count, or a finished work airing again, is for a person.
    const want = m.status ? STATUS[m.status] : undefined;
    if (want === 'airing' || want === 'finished') {
      let episodes = m.episodes ?? (want === 'airing' ? w.episodes : null);
      // 1 episode on an airing TV season is a placeholder (Koori no Jouheki 2nd Season, PR #2),
      // whether AniList shows it or the data carries it from before the premiere: never a count
      // to write. A real count in the data stays; otherwise the count is unknown.
      const placeholder = want === 'airing' && m.format === 'TV' && episodes === 1;
      if (placeholder) episodes = w.status !== 'upcoming' && w.episodes !== 1 ? w.episodes : null;
      const differs = want !== w.status || (episodes !== null && episodes !== w.episodes);
      const rejected = rejectsAiring(state.rejected, w.id, { episodes, status: want });
      if (differs && rejected) notes.set(m.id, `airing update rejected in data/rejected.yaml: ${rejected.reason}`);
      // A finished work with no count on AniList tells us nothing to write.
      if (differs && !rejected && (episodes !== null || want === 'airing')) {
        const line: AiringLine = { work: w.id, episodes, status: want, origin: 'bot', anilist: m.id };
        const was = `${w.status}, ${w.episodes ?? '?'} episodes here`;
        const manualStatus = hasOwn(manual, 'status') && want !== w.status;
        const manualEpisodes = hasOwn(manual, 'episodes') && episodes !== w.episodes;
        // Upcoming works carry placeholder counts, so only airing and finished counts are compared.
        const known = w.status !== 'upcoming' && w.episodes !== null;
        const conflict = (msg: string) => findings.push({ ...at, tier: 'C', kind: 'count-conflict', summary: msg });
        if (manualStatus || manualEpisodes) {
          findings.push({ ...at, tier: 'C', kind: 'manual-change', summary: `AniList says ${want}, ${episodes ?? '?'} episodes; the manual file says ${w.status}, ${w.episodes ?? '?'}` });
        } else if (want === 'finished' && known && (w.status === 'finished' ? episodes !== w.episodes : episodes! < w.episodes!)) {
          conflict(`finished with ${episodes} episodes on AniList, ${was}`);
        } else if (want === 'airing' && w.status === 'finished') {
          conflict(`airing again on AniList (${episodes ?? '?'} episodes), ${was}`);
        } else if (want === 'airing' && known && episodes !== null && episodes < w.episodes!) {
          conflict(`AniList lowers the count to ${episodes}, ${was}`);
        } else if (want === 'finished' && isOpen(w)) {
          findings.push({ ...at, tier: 'B', kind: 'finished-open-range', airing: line, summary: `finished with ${episodes} episodes, but a projection is still open-ended and needs closing` });
        } else if (want === 'finished') {
          findings.push({ ...at, tier: 'A', kind: 'finished', airing: line, summary: `finished with ${episodes} episodes (was ${was})` });
        } else {
          findings.push({ ...at, tier: 'A', kind: 'count-bump', airing: line, summary: `airing, ${episodes ?? 'unknown'} episodes (was ${was})${placeholder ? "; AniList's 1 episode is a placeholder" : ''}` });
        }
      }
    }

    // Prequel relations. A candidate a maintainer rejected is never proposed again.
    const all = [...(prequels.get(w.id)?.values() ?? [])];
    const cands = all.filter((c) => !rejectsRelation(state.rejected, c.work, c.prequel));
    const rejectedRel = all.map((c) => rejectsRelation(state.rejected, c.work, c.prequel)).find((r) => r !== undefined);
    if (rejectedRel && rejectedRel.kind === 'relation' && w.prequel !== rejectedRel.prequel) notes.set(m.id, `prequel ${rejectedRel.prequel} rejected in data/rejected.yaml: ${rejectedRel.reason}`);
    if (cands.length > 1 && !cands.some((c) => c.prequel === w.prequel)) {
      findings.push({ ...at, tier: 'C', kind: 'relation-conflict', summary: `AniList names ${cands.length} prequels in the data: ${cands.map((c) => c.prequel).join(', ')}`, data: { ...at.data, candidates: cands } });
    } else if (cands.length === 1 && cands[0]!.prequel !== w.prequel) {
      const c = cands[0]!;
      const p = state.records.works.get(c.prequel)!;
      if (p.type !== w.type) {
        // A TV series after a movie or a one-shot special is not the next season: chaining it would
        // give the series the sequel penalty in resolve. Noted, never proposed.
        notes.set(m.id, `AniList prequel ${c.prequel} is a ${p.type}, this is a ${w.type}: not chained`);
      } else if (hasOwn(manual, 'prequel')) {
        findings.push({ ...at, tier: 'C', kind: 'manual-change', relation: c, summary: `AniList says the prequel is ${c.prequel}; the manual file says ${w.prequel}` });
      } else {
        findings.push({ ...at, tier: 'B', kind: 'sequel', relation: c, summary: `sequel of ${c.prequel} per AniList ${c.relation} (prequel now: ${w.prequel ?? 'none'})` });
      }
    }

    // IDs.
    if (overdue && m.format !== null && EXPECT_IDS.has(m.format) && w.ids.tvdb_show === undefined && w.ids.tmdb_show === undefined && w.ids.tmdb_movie === undefined) {
      findings.push({ ...at, tier: 'C', kind: 'missing-ids', summary: 'no TVDB or TMDB ID four weeks after premiere' });
    }
  }

  // Guardrails on derived data (S4.2): evaluate every proposal together and compare sequences.
  const propose = (fs: Finding[]) => {
    const rel = new Map(relations);
    const air = new Map(airing);
    for (const f of fs) {
      if (f.relation) rel.set(f.relation.work, f.relation);
      if (f.airing) air.set(f.airing.work, f.airing);
    }
    return { relations: [...rel.values()], airing: [...air.values()] };
  };
  let proposed = propose(findings.filter((f) => f.tier !== 'C'));
  let after = evaluate(state.loaded, proposed.relations, proposed.airing);
  for (let round = 0; after.errors.length > 0 && round < 3; round++) {
    const bad = new Set(after.errors.map((e) => e.work).filter((w): w is string => w !== undefined));
    for (const f of findings) {
      if (f.tier !== 'C' && f.work !== null && bad.has(f.work)) {
        const e = after.errors.find((x) => x.work === f.work)!;
        f.tier = 'C';
        if (f.airing && e.code === 'gap') {
          f.kind = 'projection-short';
          f.summary = `AniList lists ${f.airing.episodes} episodes, but a seed projection stops short (${e.path.slice(0, 2).join('.')}): ${e.message.split(';')[0]}`;
        } else {
          f.kind = 'invalid';
          f.summary = `the proposed update does not validate: ${e.message}`;
        }
      }
    }
    proposed = propose(findings.filter((f) => f.tier !== 'C'));
    after = evaluate(state.loaded, proposed.relations, proposed.airing);
  }
  if (after.errors.length > 0) throw new Error(`proposed bot files do not validate: ${after.errors[0]!.message}`);

  // An update that puts a projection out of bounds means a source disagrees (AniList's count
  // against Anime-Lists' episodes): a conflict, not an update. Bounds problems are only warnings
  // for seed-only works, so validation alone would let them through.
  const newBounds = [...after.bounds].filter(([k]) => !state.boundsWarnings.has(k)).map(([, d]) => d);
  if (newBounds.length > 0) {
    for (const f of findings) {
      const d = f.tier !== 'C' && f.airing ? newBounds.find((x) => x.work === f.work) : undefined;
      if (!d) continue;
      f.tier = 'C';
      f.kind = 'count-conflict';
      f.summary = `AniList says ${f.airing!.status}, ${f.airing!.episodes ?? '?'} episodes, but ${d.path.slice(0, 2).join('.')} disagrees: ${d.message}`;
    }
    proposed = propose(findings.filter((f) => f.tier !== 'C'));
    after = evaluate(state.loaded, proposed.relations, proposed.airing);
  }
  const diff = diffSequences(state.records, after.records!);
  const touched = new Set<string>();
  for (const id of diff.changed) for (const m of state.records.sequences.get(id)!.members) touched.add(m.work);
  for (const id of [...diff.changed, ...diff.added]) for (const m of after.records!.sequences.get(id)?.members ?? []) touched.add(m.work);
  const finishedShift = diff.shifts.filter((s) => s.finished);
  for (const f of findings) {
    if (f.work === null || f.tier === 'C' || !touched.has(f.work)) continue;
    if (finishedShift.length > 0) {
      f.tier = 'C';
      f.kind = 'absolute-shift';
      f.summary = `${f.summary}; this would shift absolute numbers on finished works (${finishedShift.map((s) => s.work).join(', ')})`;
      f.data = { ...f.data, shifts: finishedShift };
    } else if (f.tier === 'A') {
      f.tier = 'B';
      f.kind = 'sequence-change';
      f.summary = `${f.summary}; this changes an existing absolute sequence`;
    }
  }
  if (finishedShift.length > 0) {
    proposed = propose(findings.filter((f) => f.tier !== 'C'));
    after = evaluate(state.loaded, proposed.relations, proposed.airing);
  }

  // The Season tracker: every scanned show of each season with its state.
  const tracker = new Map<string, TrackerRow[]>();
  const byAnilist = new Map<number, Finding[]>();
  for (const f of findings) if (f.anilist !== null) byAnilist.set(f.anilist, [...(byAnilist.get(f.anilist) ?? []), f]);
  for (const s of input.seasons) {
    const rows: TrackerRow[] = [];
    for (const m of [...s.media].sort((a, b) => a.id - b.id)) {
      if (m.format === 'MUSIC') continue;
      const w = workOf(m.id);
      const fs = byAnilist.get(m.id) ?? [];
      const worst = fs.some((f) => f.tier === 'C') ? 'conflict' : fs.some((f) => f.tier === 'B') ? 'awaiting review' : fs.some((f) => f.tier === 'A') ? 'auto-update' : null;
      const state: TrackerState = worst ?? (w ? 'mapped' : m.status === 'NOT_YET_RELEASED' ? 'upcoming' : 'waiting for seed');
      const note = fs.length > 0 ? fs.map((f) => f.summary).join('; ') : (notes.get(m.id) ?? '');
      rows.push({ anilist: m.id, work: w?.id ?? null, title: titleOf(m.id, w), format: m.format, status: m.status, episodes: m.episodes, state, note });
    }
    tracker.set(seasonName(s.ref), rows);
  }

  return { findings, tracker, proposed, diff: after.records ? diffSequences(state.records, after.records) : diff };
}

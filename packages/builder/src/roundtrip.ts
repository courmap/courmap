import {
  CourmapError,
  KIND_PREFIX,
  PROJECTION_PROVIDERS,
  isCanonicalProvider,
  isIdOnlyProvider,
  isProjectionProvider,
  translate,
  type Dataset,
  type EpisodeKind,
  type Target,
  type TargetResult,
  type TranslateResult,
  type WorkRecord,
} from '@courmap/core';
import type { Reporter } from './diagnostics.js';
import type { CheckedFiles } from './checks.js';

/** How far past the start of an open-ended range to probe. */
const OPEN_ENDED_PROBE = 100;

const epInput = (kind: EpisodeKind, e: number): number | string => (kind === 'regular' ? e : `${KIND_PREFIX[kind]}${e}`);

/** Canonical episodes worth probing for a work: both ends of every projection and sequence range, plus neighbours. */
function samples(work: WorkRecord): { kind: EpisodeKind; e: number }[] {
  const out = new Map<string, { kind: EpisodeKind; e: number }>();
  const add = (kind: EpisodeKind, e: number) => {
    if (e < 1) return;
    if (kind === 'regular' && work.type !== 'movie' && work.episodes !== null && e > work.episodes) return;
    if (kind === 'special' && work.specials !== null && e > work.specials) return;
    out.set(`${kind}${e}`, { kind, e });
  };
  const addRange = (kind: EpisodeKind, from: number, to: number | null) => {
    add(kind, from);
    add(kind, from + 1);
    if (to !== null) {
      add(kind, to - 1);
      add(kind, to);
    } else add(kind, from + OPEN_ENDED_PROBE);
  };
  add('regular', 1);
  if (work.episodes !== null) add('regular', work.episodes);
  for (const p of PROJECTION_PROVIDERS) for (const r of work.projections[p] ?? []) addRange(r.kind, r.ep_from, r.ep_to);
  for (const s of work.sequences) addRange('regular', s.ep_from, s.ep_to);
  return [...out.values()];
}

/** The ref and episode that name a translate result in its own provider's terms. */
function backRef(target: Target, r: TargetResult, kind: EpisodeKind): { ref: string; episode: number | string } | null {
  if (target === 'absolute') {
    const a = r as { sequence: string; episode: number };
    return { ref: `absolute:${a.sequence}`, episode: a.episode };
  }
  if (isIdOnlyProvider(target)) return null; // identifies the work only, nothing to round-trip
  const x = r as { id: string; season?: number; episode: number };
  if (isProjectionProvider(target)) {
    return { ref: x.season === undefined ? `${target}:${x.id}` : `${target}:${x.id}:s${x.season}`, episode: x.episode };
  }
  if (isCanonicalProvider(target)) return { ref: `${target}:${x.id}`, episode: epInput(kind, x.episode) };
  return null;
}

/**
 * True when `got` equals `original`, or is a range on the same provider entry that contains it.
 * A many-to-one merge (two canonical episodes in one provider episode) loses information, so
 * the best a round trip through it can return is the range.
 */
function sameOrContains(original: TargetResult | undefined, got: TargetResult | undefined): boolean {
  if (JSON.stringify(original) === JSON.stringify(got)) return true;
  if (!original || !got) return false;
  const o = original as unknown as { episode?: number; episode_to?: number } & Record<string, unknown>;
  const g = got as unknown as { episode?: number; episode_to?: number } & Record<string, unknown>;
  if (o.episode === undefined || g.episode === undefined || o.episode_to !== undefined) return false;
  const strip = ({ episode: _e, episode_to: _t, ...rest }: typeof o) => JSON.stringify(rest);
  return strip(o) === strip(g) && o.episode >= g.episode && o.episode <= (g.episode_to ?? g.episode);
}

const describeErr =(err: unknown) => (err instanceof CourmapError ? `${err.code}: ${err.message}` : String(err));

async function hubOf(ds: Dataset, ref: string, episode: number | string): Promise<TranslateResult['work'] | string> {
  try {
    return (await translate(ds, ref, episode, [])).work;
  } catch (err) {
    return describeErr(err);
  }
}

/**
 * For every work and probed episode: hub to each target and back must land on the input,
 * and A to hub to B to hub to A must return A's original answer.
 */
export async function checkRoundTrips(ds: Dataset, files: CheckedFiles, reporter: Reporter): Promise<void> {
  for (const merged of files.works) {
    const work = (await ds.getWork(merged.id))!;
    const targets: Target[] = [...(Object.keys(work.ids) as Target[]), ...(work.sequences.length > 0 ? (['absolute'] as const) : [])];
    // Point at the part that failed, so a seed run can drop exactly that part.
    const partOf = (t: Target | null) =>
      t === null ? [] : t === 'absolute' ? ['sequences'] : isProjectionProvider(t) ? ['projections', t] : ['ids', t];
    const fail = (msg: string, t: Target | null = null) => reporter.report(merged.loc, 'round-trip', partOf(t), msg, { work: merged.id });
    // Every target goes through the hub, so A -> hub -> B -> hub -> A adds information only
    // when some row is a split or merge. Hand-written works always get the full check.
    const pairwise = merged.isManual || Object.values(work.projections).some((rows) => rows.some((r) => r.target_to !== null));

    for (const { kind, e } of samples(work)) {
      const label = `${work.id} ${epInput(kind, e)}`;
      let forward: TranslateResult;
      try {
        forward = await translate(ds, `work:${work.id}`, epInput(kind, e), targets);
      } catch (err) {
        fail(`${label}: ${describeErr(err)}`);
        continue;
      }
      const backs = new Map<Target, { ref: string; episode: number | string }>();
      for (const [t, r] of Object.entries(forward.results) as [Target, TargetResult][]) {
        const back = backRef(t, r, kind);
        if (!back) continue;
        backs.set(t, back);
        const hub = await hubOf(ds, back.ref, back.episode);
        if (typeof hub === 'string') {
          fail(`${label} -> ${back.ref} ep ${back.episode} -> ${hub}`, t);
          continue;
        }
        const to = hub.episode_to ?? hub.episode;
        if (hub.id !== work.id || hub.kind !== kind || e < hub.episode || e > to) {
          fail(`${label} -> ${back.ref} ep ${back.episode} -> ${hub.id} ${epInput(hub.kind, hub.episode)}, expected ${label}`, t);
        }
      }

      // A -> hub -> B -> hub -> A
      if (!pairwise) continue;
      for (const [a, backA] of backs) {
        for (const b of backs.keys()) {
          if (a === b) continue;
          const hubA = await hubOf(ds, backA.ref, backA.episode);
          if (typeof hubA === 'string') continue; // already reported above
          try {
            const toB = await translate(ds, `work:${hubA.id}`, epInput(hubA.kind, hubA.episode), [b]);
            const rb = toB.results[b];
            if (!rb) continue; // B does not map this episode; not a round-trip failure
            const backB = backRef(b, rb, hubA.kind)!;
            const toA = await translate(ds, backB.ref, backB.episode, [a]);
            const original = forward.results[a];
            if (!sameOrContains(original, toA.results[a])) {
              fail(`${label}: ${a} -> hub -> ${b} -> hub -> ${a} gave ${JSON.stringify(toA.results[a] ?? null)}, expected ${JSON.stringify(original)}`, b);
            }
          } catch (err) {
            fail(`${label}: ${a} -> hub -> ${b} -> hub -> ${a} failed: ${describeErr(err)}`, b);
          }
        }
      }
    }
  }
}

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** A shields.io endpoint badge: https://shields.io/badges/endpoint-badge */
export interface Badge {
  schemaVersion: 1;
  label: string;
  message: string;
  color: string;
}

export interface BadgeInputs {
  /** The release's meta.json, or null when nothing is released yet. */
  meta: { data_version: string } | null;
  /** `pnpm corpus --json` output. */
  corpus: { verified: number; passed: number; pass_rate: number } | null;
  /** Open Season tracker issues (`gh issue list --label season-tracker --json title,body`). */
  trackers: { title: string; body: string }[] | null;
  /** The season the coverage badge reports, as the tracker titles name it ("Fall 2026"). */
  season: string;
}

const NONE = 'lightgrey';

/**
 * The README badges: data version, current-season coverage and corpus pass
 * rate, as shields.io endpoint files the release workflow pushes to the `badges` branch. Every
 * badge has a clean "no release yet" (or similar) state instead of a broken image.
 */
export function makeBadges(x: BadgeInputs): Record<string, Badge> {
  const badge = (label: string, message: string, color: string): Badge => ({ schemaVersion: 1, label, message, color });
  const data = x.meta ? badge('data', x.meta.data_version, 'e04e39') : badge('data', 'no release yet', NONE);

  let coverage = badge(`${x.season} coverage`, 'no tracker yet', NONE);
  const tracker = x.trackers?.find((t) => t.title === `Season tracker: ${x.season}`);
  if (tracker) {
    const n = (state: string) => Number(new RegExp(`(\\d+) ${state}\\b`).exec(tracker.body)?.[1] ?? 0);
    const states = ['mapped', 'auto-update', 'awaiting review', 'conflict', 'waiting for seed', 'upcoming'];
    const total = states.reduce((a, s) => a + n(s), 0);
    const covered = n('mapped') + n('auto-update');
    const pct = total === 0 ? 0 : Math.round((covered / total) * 100);
    coverage = badge(`${x.season} coverage`, total === 0 ? 'no shows yet' : `${pct}% of ${total} shows`, pct >= 80 ? '2f6f73' : pct >= 50 ? 'a98b2c' : 'e04e39');
  }

  const corpus = x.corpus
    ? badge('resolver corpus', `${x.corpus.passed}/${x.corpus.verified} (${(x.corpus.pass_rate * 100).toFixed(1)}%)`, x.corpus.pass_rate >= 0.95 ? '2f6f73' : 'a98b2c')
    : badge('resolver corpus', 'no release yet', NONE);
  return { data, coverage, corpus };
}

/** Writes <out>/<name>.json for each badge. */
export async function writeBadges(out: string, badges: Record<string, Badge>): Promise<string[]> {
  await mkdir(out, { recursive: true });
  for (const [name, b] of Object.entries(badges)) await writeFile(path.join(out, `${name}.json`), `${JSON.stringify(b)}\n`);
  return Object.keys(badges).map((n) => `${n}.json`);
}

export const readJsonOrNull = async <T>(file: string | undefined): Promise<T | null> => {
  if (!file) return null;
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch {
    return null;
  }
};

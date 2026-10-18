import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { WorkFile } from '@courmap/core';
import { SEED_SHARD_RE, type CheckedFiles } from '@courmap/builder';
import type { Pins } from './seed.js';
import type { SlugEntry } from './slugs.js';

export interface PreviousSeed {
  pins: Pins | null;
  registry: SlugEntry[];
}

/** Reads the pins and slug registry the last seed run left in data/seeds/. */
export async function readPrevious(seedDir: string): Promise<PreviousSeed> {
  const manifest = await readFile(path.join(seedDir, 'manifest.json'), 'utf8').catch(() => null);
  const slugs = await readFile(path.join(seedDir, 'slugs.jsonl'), 'utf8').catch(() => '');
  return {
    pins: manifest ? (JSON.parse(manifest) as { pins: Pins }).pins : null,
    registry: slugs
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as SlugEntry),
  };
}

/** Replaces data/seeds/ with the new files: stale shards are removed, nothing else in data/ is touched. */
export async function writeSeedDir(seedDir: string, files: Map<string, string>): Promise<void> {
  await mkdir(seedDir, { recursive: true });
  const existing = await readdir(seedDir);
  for (const name of existing) if (SEED_SHARD_RE.test(name) && !files.has(name)) await rm(path.join(seedDir, name));
  for (const [name, text] of files) await writeFile(path.join(seedDir, name), text);
}

/**
 * The step 5 check: every part a manual file sets must survive the merge unchanged.
 * Returns one line per part that differs (empty when all manual mappings are intact).
 */
export function manualChanges(checked: CheckedFiles): string[] {
  const out: string[] = [];
  const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  for (const w of checked.works) {
    if (!w.manual) continue;
    const m = w.manual.data as WorkFile & Record<string, unknown>;
    const merged = w.data as WorkFile & Record<string, unknown>;
    for (const [key, value] of Object.entries(m)) {
      if (key === 'ids' || key === 'projections' || key === 'titles') {
        for (const [k, v] of Object.entries(value as object)) {
          const got = (merged[key] as Record<string, unknown> | undefined)?.[k];
          if (v === null ? got !== undefined : !eq(got, v)) out.push(`${w.id}: ${key}.${k}`);
        }
      } else if (key === 'aliases') {
        for (const a of value as string[]) if (!merged.aliases?.includes(a)) out.push(`${w.id}: aliases "${a}"`);
      } else if (!eq(merged[key], value)) out.push(`${w.id}: ${key}`);
    }
  }
  return out;
}

import type { Pins, SeedSummary } from './seed.js';

interface Manifest {
  pins: Pins;
  shards: { name: string; works: number; sha256: string }[];
  summary: SeedSummary;
}

const fmt = (n: number | undefined) => (n === undefined ? '0' : n.toLocaleString('en-US'));
const delta = (a: number | undefined, b: number | undefined) => {
  const d = (b ?? 0) - (a ?? 0);
  return d === 0 ? '' : d > 0 ? `+${fmt(d)}` : `-${fmt(-d)}`;
};

function table(title: string, before: Record<string, number> | undefined, after: Record<string, number> | undefined): string[] {
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])].sort();
  if (keys.length === 0) return [];
  return [
    `| ${title} | Before | After | Change |`,
    '| --- | ---: | ---: | ---: |',
    ...keys.map((k) => `| ${k} | ${fmt(before?.[k])} | ${fmt(after?.[k])} | ${delta(before?.[k], after?.[k])} |`),
    '',
  ];
}

/** A Markdown before/after of a seed run, for the body of the weekly seed PR. */
export function renderReport(previousManifest: string | null, nextManifest: string): string {
  const prev = previousManifest ? (JSON.parse(previousManifest) as Manifest) : null;
  const next = JSON.parse(nextManifest) as Manifest;
  const p = prev?.summary;
  const n = next.summary;
  const changedShards = next.shards.filter((s) => prev?.shards.find((x) => x.name === s.name)?.sha256 !== s.sha256).map((s) => s.name);
  return [
    '## Seed update',
    '',
    `- cedya77/anime-offline-database: ${prev ? `\`${prev.pins.offline_db.tag}\` to ` : ''}\`${next.pins.offline_db.tag}\``,
    `- Anime-Lists: ${prev ? `\`${prev.pins.anime_lists.commit.slice(0, 7)}\` to ` : ''}\`${next.pins.anime_lists.commit.slice(0, 7)}\``,
    `- Shards changed: ${changedShards.length ? changedShards.join(', ') : 'none'}`,
    '',
    ...table('Coverage', { works: p?.works ?? 0 }, { works: n.works }),
    ...table('Provider refs', p?.provider_refs as Record<string, number>, n.provider_refs as Record<string, number>),
    ...table('Projection rows', p?.projection_rows as Record<string, number>, n.projection_rows as Record<string, number>),
    ...table('Validation warnings', p?.warnings, n.warnings),
    ...table('Dropped or defaulted (conflicts.jsonl)', p?.conflicts, n.conflicts),
    'The seed job ran `pnpm seed --verify` (two runs, byte-identical), `pnpm validate`, `pnpm compile` and `pnpm test` before opening this PR. No file in `data/works/` is changed by a seed run.',
    '',
  ].join('\n');
}

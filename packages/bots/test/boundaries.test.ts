import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Hard constraints (CLAUDE.md): AniList calls only from packages/bots; TMDB API calls only in the
// bots' CI projection checker; AniDB's API never. This scans every package's source.
const root = fileURLToPath(new URL('../../../', import.meta.url));

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === 'fixtures') continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (/\.(ts|mjs|js)$/.test(name)) out.push(p);
  }
  return out;
}

const files = [...sources(path.join(root, 'packages')), ...sources(path.join(root, 'worker'))].map((f) => [path.relative(root, f).split(path.sep).join('/'), readFileSync(f, 'utf8')] as const);
const using = (re: RegExp) => files.filter(([, text]) => re.test(text)).map(([f]) => f);

describe('API boundaries', () => {
  it('only packages/bots calls AniList', () => {
    expect(using(/graphql\.anilist\.co/)).toEqual(['packages/bots/src/anilist.ts']);
  });

  it('only the bots projection checker calls TMDB', () => {
    expect(using(/api\.themoviedb\.org/)).toEqual(['packages/bots/src/tmdb.ts']);
  });

  it('nothing calls the AniDB API', () => {
    expect(using(/api\.anidb\.net|anidb\.net:9001|anidb\.net\/httpapi/)).toEqual([]);
  });
});

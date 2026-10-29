// Step 11's check against a deployed Worker (docs/SPEC.md, "Build order"): the Worker must give
// exactly the library's answers. It compares the Worker at <url> with the offline client over the
// dump of the same data release: every name in tests/releases.yaml (resolve), and lookup plus
// translate for a sample of works across every provider.
// Usage: tsx --conditions=@courmap/source worker/scripts/check-deployed.ts <worker url> <dump.sqlite> [--works 200]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { parse } from 'yaml';
import { CourmapError, createOfflineClient, SqliteDataset } from '@courmap/client';
import { fetchWithRetry } from './retry.js';

const { positionals, values } = parseArgs({ allowPositionals: true, options: { works: { type: 'string', default: '200' } } });
const [base, dumpPath] = positionals;
if (!base || !dumpPath) {
  console.error('usage: check-deployed.ts <worker url> <dump.sqlite> [--works 200]');
  process.exit(1);
}
const root = fileURLToPath(new URL('../../', import.meta.url));
const api = base.replace(/\/+$/, '');
const offline = createOfflineClient(dumpPath);
const ds = new SqliteDataset(dumpPath);

// The Worker allows 60 requests a minute per client: stay under it, and wait out a 429 if one comes. A dropped
// connection or a 502 to 504 (a deploy in progress) is retried a few times before the check gives up.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let last = 0;
const get = async (path: string): Promise<{ status: number; body: unknown }> => {
  const wait = last + 1100 - Date.now();
  if (wait > 0) await sleep(wait);
  last = Date.now();
  const res = await fetchWithRetry(`${api}${path}`);
  if (res.status === 429) {
    await sleep(Number(res.headers.get('Retry-After') ?? 60) * 1000);
    return get(path);
  }
  return { status: res.status, body: (await res.json()) as unknown };
};
const local = async (f: () => Promise<unknown>) =>
  f().then(
    (v) => ({ status: 200, body: JSON.parse(JSON.stringify(v)) as unknown }),
    (e: unknown) => (e instanceof CourmapError ? { status: { invalid_input: 400, not_found: 404, ambiguous: 409 }[e.code], body: e.toJSON() } : Promise.reject(e)),
  );

const meta = (await get('/v1/meta')).body as { data_version: string };
const want = (await offline.meta()).data_version;
if (meta.data_version !== want) {
  console.error(`The Worker serves data ${meta.data_version}; the dump is ${want}. Compare the same release.`);
  process.exit(1);
}

let checked = 0;
const problems: string[] = [];
const same = (what: string, a: { status: number; body: unknown }, b: { status: number | undefined; body: unknown }) => {
  checked++;
  if (a.status !== b.status || JSON.stringify(a.body) !== JSON.stringify(b.body)) problems.push(`${what}: Worker ${a.status} ${JSON.stringify(a.body).slice(0, 200)} vs library ${b.status} ${JSON.stringify(b.body).slice(0, 200)}`);
};

const { cases } = parse(readFileSync(`${root}tests/releases.yaml`, 'utf8')) as { cases: { name: string; dataset?: string }[] };
for (const c of cases.filter((x) => (x.dataset ?? 'data') === 'data')) {
  same(`resolve ${c.name}`, await get(`/v1/resolve?release=${encodeURIComponent(c.name)}`), await local(() => offline.resolve(c.name)));
}

const targets = ['anidb', 'anilist', 'mal', 'kitsu', 'tvdb_show', 'tmdb_show', 'tmdb_movie', 'imdb', 'absolute'];
const ids = ds.listWorkIds();
const step = Math.max(1, Math.floor(ids.length / Number(values.works)));
for (let i = 0; i < ids.length; i += step) {
  const ref = `work:${ids[i]}`;
  same(`lookup ${ref}`, await get(`/v1/lookup?ref=${encodeURIComponent(ref)}`), await local(() => offline.lookup(ref)));
  same(`translate ${ref} 1`, await get(`/v1/translate?from=${encodeURIComponent(ref)}&episode=1&to=${targets.join(',')}`), await local(() => offline.translate(ref, 1, targets)));
}

offline.close();
ds.close();
console.log(`${checked} answers compared against data ${want}: ${problems.length === 0 ? 'all identical' : `${problems.length} differ`}.`);
for (const p of problems.slice(0, 20)) console.error(p);
process.exit(problems.length === 0 ? 0 : 1);

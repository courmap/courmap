import { createHash } from 'node:crypto';
import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import Database from 'better-sqlite3';

export interface VerifyReport {
  dataVersion: string | null;
  files: string[];
  problems: string[];
}

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

/**
 * Checks a release directory before anything is published (decision S6.2): exactly the
 * expected files, every SHA256SUMS line correct, meta.json pointing at this release's dumps with
 * their real checksums, both dumps opening with the same data_version, and the license files
 * matching the repository's. An empty `problems` list means the release is safe to publish.
 */
export async function verifyRelease(dir: string, repoRoot: string, repo: string): Promise<VerifyReport> {
  const problems: string[] = [];
  const files = (await readdir(dir)).sort();
  const read = (f: string) => readFile(path.join(dir, f));
  let meta: { data_version?: string; dumps?: { tag: string; sqlite: { url: string; sha256: string }; json: { url: string; sha256: string }; sha256sums: string } | null } = {};
  try {
    meta = JSON.parse((await read('meta.json')).toString('utf8'));
  } catch (err) {
    problems.push(`meta.json: ${(err as Error).message}`);
  }
  const v = meta.data_version ?? null;
  const expected = [`courmap-${v}.json.gz`, `courmap-${v}.sqlite.gz`, 'ATTRIBUTION.md', 'DATA_LICENSE', 'LICENSE', 'SHA256SUMS', 'meta.json'].sort();
  for (const f of expected) if (!files.includes(f)) problems.push(`missing ${f}`);
  for (const f of files) if (!expected.includes(f)) problems.push(`unexpected file ${f}`);

  // SHA256SUMS covers every other file, once.
  const sums = new Map<string, string>();
  try {
    for (const line of (await read('SHA256SUMS')).toString('utf8').split('\n').filter(Boolean)) {
      const m = /^([0-9a-f]{64}) {2}(\S+)$/.exec(line);
      if (!m) problems.push(`SHA256SUMS: malformed line "${line}"`);
      else sums.set(m[2]!, m[1]!);
    }
  } catch {
    // reported as missing above
  }
  for (const f of expected.filter((x) => x !== 'SHA256SUMS' && files.includes(x))) {
    const want = sums.get(f);
    if (!want) problems.push(`SHA256SUMS has no line for ${f}`);
    else if (want !== sha256(await read(f))) problems.push(`SHA256SUMS: wrong checksum for ${f}`);
  }

  // meta.json names this release and its dumps.
  const tag = `data-${v}`;
  const base = `https://github.com/${repo}/releases/download/${tag}/`;
  if (!meta.dumps) problems.push('meta.json has no dumps');
  else {
    if (meta.dumps.tag !== tag) problems.push(`meta.json dumps.tag is ${meta.dumps.tag}, expected ${tag}`);
    for (const [key, name] of [['sqlite', `courmap-${v}.sqlite.gz`], ['json', `courmap-${v}.json.gz`]] as const) {
      const d = meta.dumps[key];
      if (d.url !== base + name) problems.push(`meta.json dumps.${key}.url is ${d.url}, expected ${base + name}`);
      if (files.includes(name) && d.sha256 !== sha256(await read(name))) problems.push(`meta.json dumps.${key}.sha256 does not match ${name}`);
    }
    if (meta.dumps.sha256sums !== `${base}SHA256SUMS`) problems.push('meta.json dumps.sha256sums points elsewhere');
  }

  // Both dumps open and agree on the data version.
  if (files.includes(`courmap-${v}.sqlite.gz`)) {
    const tmp = path.join(dir, '..', `.verify-${process.pid}.sqlite`);
    try {
      await writeFile(tmp, gunzipSync(await read(`courmap-${v}.sqlite.gz`)));
      const db = new Database(tmp, { readonly: true });
      try {
        const got = (db.prepare("SELECT value FROM meta WHERE key = 'data_version'").get() as { value: string } | undefined)?.value;
        if (got !== v) problems.push(`the SQLite dump says data_version ${got}, meta.json says ${v}`);
        const ok = (db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check;
        if (ok !== 'ok') problems.push(`the SQLite dump fails integrity_check: ${ok}`);
      } finally {
        db.close();
      }
    } catch (err) {
      problems.push(`the SQLite dump does not open: ${(err as Error).message}`);
    } finally {
      await rm(tmp, { force: true });
    }
  }
  if (files.includes(`courmap-${v}.json.gz`)) {
    try {
      const json = JSON.parse(gunzipSync(await read(`courmap-${v}.json.gz`)).toString('utf8')) as { meta?: { data_version?: string }; works?: unknown[] };
      if (json.meta?.data_version !== v) problems.push(`the JSON dump says data_version ${json.meta?.data_version}, meta.json says ${v}`);
      if (!Array.isArray(json.works) || json.works.length === 0) problems.push('the JSON dump has no works');
    } catch (err) {
      problems.push(`the JSON dump does not parse: ${(err as Error).message}`);
    }
  }

  // Licenses are the repository's own files.
  for (const f of ['LICENSE', 'DATA_LICENSE', 'ATTRIBUTION.md']) {
    if (files.includes(f) && !(await read(f)).equals(await readFile(path.join(repoRoot, f)))) problems.push(`${f} differs from the repository's`);
  }
  return { dataVersion: v, files, problems };
}

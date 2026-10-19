import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface DumpLink {
  url: string;
  sha256: string;
}

/** The `dumps` field of /v1/meta.json: where this data version's release assets live. */
export interface MetaDumps {
  /** GitHub release tag, data-<data_version>. */
  tag: string;
  sqlite: DumpLink;
  json: DumpLink;
  sha256sums: string;
}

/**
 * Points meta.json at the GitHub release for its data version (docs/SPEC.md, "Release"):
 * fills `dumps` from the assets' SHA256SUMS, then copies meta.json into the assets and adds it
 * to SHA256SUMS. Refuses when the assets belong to another data version, so a shard tree can
 * never advertise the wrong dump.
 */
export async function fillMetaDumps(shardsDir: string, assetsDir: string, repo: string): Promise<MetaDumps> {
  const metaPath = path.join(shardsDir, 'meta.json');
  const meta = JSON.parse(await readFile(metaPath, 'utf8')) as { data_version: string; dumps: MetaDumps | null };
  const sums = new Map(
    (await readFile(path.join(assetsDir, 'SHA256SUMS'), 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [hash, name] = line.split(/\s+/, 2);
        return [name!, hash!] as const;
      }),
  );
  const v = meta.data_version;
  const tag = `data-${v}`;
  const base = `https://github.com/${repo}/releases/download/${tag}/`;
  const link = (name: string): DumpLink => {
    const sha256 = sums.get(name);
    if (!sha256) throw new Error(`${assetsDir}/SHA256SUMS has no ${name}; were the assets built from data_version ${v}?`);
    return { url: base + name, sha256 };
  };
  const dumps: MetaDumps = { tag, sqlite: link(`courmap-${v}.sqlite.gz`), json: link(`courmap-${v}.json.gz`), sha256sums: `${base}SHA256SUMS` };
  meta.dumps = dumps;
  const text = JSON.stringify(meta);
  await writeFile(metaPath, text);
  // The same meta.json is a release asset, so the proxy can update from GitHub alone (decision S6.2).
  await writeFile(path.join(assetsDir, 'meta.json'), text);
  const lines = [...sums].filter(([name]) => name !== 'meta.json').map(([name, hash]) => `${hash}  ${name}\n`);
  lines.push(`${createHash('sha256').update(text).digest('hex')}  meta.json\n`);
  await writeFile(path.join(assetsDir, 'SHA256SUMS'), lines.join(''));
  return dumps;
}

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { zstdDecompressSync } from 'node:zlib';
import type { Pins } from './seed.js';

export const OFFLINE_DB = { repo: 'cedya77/anime-offline-database', asset: 'anime-offline-database.jsonl.zst' } as const;
export const ANIME_LISTS = { repo: 'Anime-Lists/anime-lists', path: 'anime-list-master.xml' } as const;

const USER_AGENT = 'courmap-seed (+https://github.com/courmap/courmap)';

/** Only these two hosts are ever contacted: the seed job downloads the two seed datasets and nothing else. */
const ALLOWED_HOSTS = new Set(['api.github.com', 'github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com', 'raw.githubusercontent.com']);

async function get(url: string): Promise<Response> {
  const host = new URL(url).hostname;
  if (!ALLOWED_HOSTS.has(host)) throw new Error(`refusing to fetch ${url}: seeds come from GitHub only`);
  const headers: Record<string, string> = { 'user-agent': USER_AGENT };
  if (host === 'api.github.com') {
    headers.accept = 'application/vnd.github+json';
    if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  const res = await fetch(url, { headers, redirect: 'follow' });
  if (!res.ok) throw new Error(`GET ${url}: HTTP ${res.status}`);
  return res;
}

/** The newest cedya77 release tag and the current Anime-Lists master commit. */
export async function resolveLatest(): Promise<{ tag: string; commit: string }> {
  const release = (await (await get(`https://api.github.com/repos/${OFFLINE_DB.repo}/releases/latest`)).json()) as { tag_name: string };
  const commit = (await (await get(`https://api.github.com/repos/${ANIME_LISTS.repo}/commits/master`)).json()) as { sha: string };
  return { tag: release.tag_name, commit: commit.sha };
}

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

/** Downloads once into the cache; later runs read the cached copy. */
async function cached(cacheDir: string, name: string, url: string): Promise<Buffer> {
  const file = path.join(cacheDir, name);
  try {
    return await readFile(file);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  const body = Buffer.from(await (await get(url)).arrayBuffer());
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(`${file}.part`, body);
  await rename(`${file}.part`, file);
  return body;
}

export interface Downloaded {
  pins: Pins;
  offlineDbJsonl: string;
  animeListsXml: string;
}

/**
 * Fetches (or reads from cache) the pinned inputs. When `expect` carries checksums from a
 * previous manifest, a mismatch is an error: the same pin must always mean the same bytes.
 */
export async function download(tag: string, commit: string, cacheDir: string, expect?: Pins): Promise<Downloaded> {
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error(`Anime-Lists pin must be a full 40-character commit SHA, got "${commit}"`);
  const zst = await cached(cacheDir, `offline-db/${tag}/${OFFLINE_DB.asset}`, `https://github.com/${OFFLINE_DB.repo}/releases/download/${encodeURIComponent(tag)}/${OFFLINE_DB.asset}`);
  const xml = await cached(cacheDir, `anime-lists/${commit}/${ANIME_LISTS.path}`, `https://raw.githubusercontent.com/${ANIME_LISTS.repo}/${commit}/${ANIME_LISTS.path}`);
  const pins: Pins = {
    offline_db: { repo: OFFLINE_DB.repo, tag, asset: OFFLINE_DB.asset, sha256: sha256(zst) },
    anime_lists: { repo: ANIME_LISTS.repo, commit, path: ANIME_LISTS.path, sha256: sha256(xml) },
  };
  if (expect) {
    if (expect.offline_db.tag === tag && expect.offline_db.sha256 !== pins.offline_db.sha256) {
      throw new Error(`cedya77 release ${tag} changed: sha256 ${pins.offline_db.sha256}, manifest says ${expect.offline_db.sha256}`);
    }
    if (expect.anime_lists.commit === commit && expect.anime_lists.sha256 !== pins.anime_lists.sha256) {
      throw new Error(`Anime-Lists ${commit} does not match the manifest checksum`);
    }
  }
  return { pins, offlineDbJsonl: zstdDecompressSync(zst).toString('utf8'), animeListsXml: xml.toString('utf8') };
}

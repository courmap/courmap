import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ShardStore } from './remote.js';

/**
 * Shard files on disk under <dir>/<data_version>/, so a new data version starts a fresh cache.
 * A cached 404 is stored as the literal "null". Node only; the browser entry never imports it.
 */
export function diskStore(dir: string): ShardStore {
  const file = (version: string, rel: string) => path.join(dir, version, ...rel.split('/'));
  return {
    async read(version, rel) {
      try {
        const text = await readFile(file(version, rel), 'utf8');
        return text === 'null' ? null : text;
      } catch {
        return undefined;
      }
    },
    async write(version, rel, body) {
      const f = file(version, rel);
      await mkdir(path.dirname(f), { recursive: true });
      await writeFile(f, body ?? 'null');
    },
  };
}

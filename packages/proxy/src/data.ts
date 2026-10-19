import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { createOfflineClient, type CourmapClient } from '@courmap/client';

/** The `dumps` field of meta.json, as the release workflow writes it. */
interface MetaJson {
  data_version: string;
  dumps: { tag: string; sqlite: { url: string; sha256: string } } | null;
}

export interface DataStatus {
  dataVersion: string | null;
  /** The dump in use. */
  file: string | null;
  lastCheck: string | null;
  lastChange: string | null;
  lastError: string | null;
}

const SAFE = /^[A-Za-z0-9._-]+$/;

/**
 * Keeps the offline dump current (docs/SPEC.md, "Sonarr proxy"): checks meta.json on a schedule,
 * downloads a dump only when data_version changes, verifies its SHA-256 against meta.json, and
 * swaps the client atomically: requests in flight finish on the old dump, new ones see the new
 * one, and a failed download or checksum never replaces a working dump.
 */
export class DataManager {
  private current: { client: CourmapClient; version: string; file: string } | null = null;
  readonly status: DataStatus = { dataVersion: null, file: null, lastCheck: null, lastChange: null, lastError: null };
  private timer: NodeJS.Timeout | null = null;
  private checking: Promise<void> | null = null;

  constructor(
    private readonly opts: { dataDir: string; metaUrl: string; dump: string | null; refreshHours: number; fetch?: typeof fetch; log?: (l: string) => void; now?: () => Date },
  ) {}

  private log(l: string): void {
    (this.opts.log ?? console.log)(l);
  }

  private now(): string {
    return (this.opts.now?.() ?? new Date()).toISOString();
  }

  /** The client for the current dump, or null while there is none (the proxy then passes everything through). */
  get client(): CourmapClient | null {
    return this.current?.client ?? null;
  }

  /** Opens the fixed dump or the last downloaded one, then checks for a newer one. */
  async start(): Promise<void> {
    if (this.opts.dump) {
      await this.open(this.opts.dump);
      return;
    }
    try {
      await mkdir(this.opts.dataDir, { recursive: true });
      await writeFile(path.join(this.opts.dataDir, '.write-test'), '');
      await rm(path.join(this.opts.dataDir, '.write-test'), { force: true });
    } catch (err) {
      this.status.lastError = `the data folder ${this.opts.dataDir} is not writable (${(err as NodeJS.ErrnoException).code ?? (err as Error).message}); fix its owner or permissions`;
      return;
    }
    const pointer = path.join(this.opts.dataDir, 'current.json');
    if (existsSync(pointer)) {
      try {
        const { file } = JSON.parse(await readFile(pointer, 'utf8')) as { file: string };
        await this.open(path.join(this.opts.dataDir, file));
      } catch (err) {
        this.status.lastError = `could not open the last dump: ${(err as Error).message}`;
      }
    }
    await this.check();
    this.timer = setInterval(() => void this.check(), this.opts.refreshHours * 3600_000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.current?.client.close();
    this.current = null;
  }

  private async open(file: string): Promise<void> {
    const client = createOfflineClient(file);
    // The version comes from the dump itself, so a renamed file cannot lie about it.
    const m = await client.meta();
    this.current = { client, version: m.data_version, file };
    Object.assign(this.status, { dataVersion: m.data_version, file, lastChange: this.now() });
  }

  /** One meta.json check. Never throws: failures are logged and kept in status.lastError. */
  check(): Promise<void> {
    if (this.opts.dump) return Promise.resolve();
    this.checking ??= this.doCheck().finally(() => (this.checking = null));
    return this.checking;
  }

  private async doCheck(): Promise<void> {
    const fetchFn = this.opts.fetch ?? ((i, init) => fetch(i, init));
    try {
      const res = await fetchFn(this.opts.metaUrl);
      if (!res.ok) throw new Error(`GET ${this.opts.metaUrl}: HTTP ${res.status}`);
      const meta = (await res.json()) as MetaJson;
      this.status.lastCheck = this.now();
      if (!SAFE.test(meta.data_version)) throw new Error(`meta.json has an unusable data_version "${meta.data_version}"`);
      if (meta.data_version === this.current?.version) {
        this.status.lastError = null;
        return;
      }
      if (!meta.dumps) throw new Error(`meta.json for ${meta.data_version} names no dump yet`);
      const file = await this.download(meta.data_version, meta.dumps.sqlite.url, meta.dumps.sqlite.sha256, fetchFn);
      const before = this.current;
      const client = createOfflineClient(file);
      const m = await client.meta();
      if (m.data_version !== meta.data_version) {
        client.close();
        throw new Error(`the downloaded dump is ${m.data_version}, meta.json says ${meta.data_version}`);
      }
      this.current = { client, version: m.data_version, file };
      Object.assign(this.status, { dataVersion: m.data_version, file, lastChange: this.now(), lastError: null });
      await writeAtomic(path.join(this.opts.dataDir, 'current.json'), JSON.stringify({ file: path.basename(file), data_version: m.data_version }));
      this.log(`data ${m.data_version} in use (${path.basename(file)})`);
      if (before) {
        before.client.close();
        await this.prune(path.basename(file));
      }
    } catch (err) {
      this.status.lastCheck = this.now();
      this.status.lastError = (err as Error).message;
      this.log(`data refresh failed: ${(err as Error).message}`);
    }
  }

  /** Streams the gzipped dump to disk, verifies its SHA-256, then unpacks it next to the old one. */
  private async download(version: string, url: string, sha256: string, fetchFn: typeof fetch): Promise<string> {
    const gz = path.join(this.opts.dataDir, `courmap-${version}.sqlite.gz.part`);
    const out = path.join(this.opts.dataDir, `courmap-${version}.sqlite`);
    try {
      const res = await fetchFn(url);
      if (!res.ok || !res.body) throw new Error(`GET ${url}: HTTP ${res.status}`);
      const hash = createHash('sha256');
      const body = Readable.fromWeb(res.body as import('node:stream/web').ReadableStream);
      body.on('data', (chunk: Buffer) => hash.update(chunk));
      await pipeline(body, createWriteStream(gz));
      const got = hash.digest('hex');
      if (got !== sha256.toLowerCase()) throw new Error(`checksum mismatch for ${path.basename(url)}: expected ${sha256}, got ${got}; the old dump stays in use`);
      await pipeline(createReadStream(gz), createGunzip(), createWriteStream(`${out}.part`));
      await rename(`${out}.part`, out);
      return out;
    } finally {
      await rm(gz, { force: true });
      await rm(`${out}.part`, { force: true });
    }
  }

  /** Deletes dumps other than the one in use. */
  private async prune(keep: string): Promise<void> {
    for (const name of await readdir(this.opts.dataDir)) {
      if (/^courmap-.+\.sqlite$/.test(name) && name !== keep) await rm(path.join(this.opts.dataDir, name), { force: true }).catch(() => {});
    }
  }
}

async function writeAtomic(file: string, text: string): Promise<void> {
  await writeFile(`${file}.tmp`, text);
  await rename(`${file}.tmp`, file);
}

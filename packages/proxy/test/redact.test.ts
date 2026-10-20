import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { DataManager } from '../src/data.js';
import { Redactor, redactorFromEnv } from '../src/redact.js';
import { createProxyServer } from '../src/server.js';
import { SonarrClient } from '../src/sonarr.js';
import { Stats } from '../src/stats.js';
import { fakeSonarr, fixtureDump, serve, tmp } from './helpers.js';

// Nothing secret may appear in a log line, the status page, its JSON, an export or an error response.

// Distinct, recognizable values, so one that shows up anywhere fails a test.
const SONARR_KEY = 'SONARRKEY-0123456789abcdef';
const INDEXER_KEY = 'INDEXERKEY-0123456789abcdef';
const URL_KEY = 'URLKEY-0123456789abcdef';
const SENT_KEY = 'SENTKEY-0123456789abcdef';
const PASSWORD = 'PASSWORD-0123456789abcdef';
const SECRETS = [SONARR_KEY, INDEXER_KEY, URL_KEY, SENT_KEY, PASSWORD];
const leaks = (text: string) => SECRETS.filter((s) => text.includes(s));

describe('Redactor', () => {
  it('masks every secret it knows wherever it occurs, longest first', () => {
    const r = new Redactor('abcdef123456', 'abcdef123456789');
    expect(r.redact('key abcdef123456789 and abcdef123456 and again abcdef123456.')).toBe('key *** and *** and again ***.');
  });

  it('ignores values too short to be a secret, and empty ones', () => {
    const r = new Redactor('abc', '', null, undefined);
    expect(r.redact('abc abc')).toBe('abc abc');
  });

  it('masks credential parameters in any URL, known or not', () => {
    const r = new Redactor();
    expect(r.redact('GET https://api.example.org/api?t=get&id=7&apikey=zzz999&x=1')).toBe('GET https://api.example.org/api?t=get&id=7&apikey=***&x=1');
    expect(r.redact('failed: http://h/api?API_KEY=zzz999')).toBe('failed: http://h/api?API_KEY=***');
    expect(r.redact('(http://h/x?token=zzz999)')).toBe('(http://h/x?token=***)');
    expect(r.redact('https://nzb.example/getnzb/1.nzb?i=42&r=zzz999')).toBe('https://nzb.example/getnzb/1.nzb?i=42&r=***');
    // Ordinary parameters stay.
    expect(r.redact('/api?t=tvsearch&tvdbid=5002&season=1&cat=5070')).toBe('/api?t=tvsearch&tvdbid=5002&season=1&cat=5070');
  });

  it('masks user:password in a URL, API-key headers and config lines quoted in an error', () => {
    const r = new Redactor();
    expect(r.redact('connect http://admin:hunter22@host:8989/x')).toBe('connect http://***@host:8989/x');
    expect(r.redact('request had X-Api-Key: abc123def456 set')).toBe('request had X-Api-Key: *** set');
    expect(r.redact('Authorization: Bearer abc123def456')).toBe('Authorization: ***');
    expect(r.redact('at line 3:\n\n  api_key: abc123def456\n  url: http://x\n')).toBe('at line 3:\n\n  api_key: ***\n  url: http://x\n');
    expect(r.redact('{"apikey":"abc123def456"}')).toBe('{"apikey":"***"}');
  });

  it('learns secrets from URLs and from the environment', () => {
    const r = redactorFromEnv({ SONARR_API_KEY: 'envkey123456', INDEXER_A_URL: 'http://h/api?apikey=urlkey123456', INDEXER_A_APIKEY: 'idxkey123456', PORT: '9797', PATH: '/usr/bin' });
    expect(r.redact('envkey123456 urlkey123456 idxkey123456 9797 /usr/bin')).toBe('*** *** *** 9797 /usr/bin');
    const u = new Redactor();
    u.addFromUrl('https://user:p%40ssw0rd9@host/api?apikey=a%2Fb-secret-1');
    expect(u.redact('p@ssw0rd9 a/b-secret-1 and p%40ssw0rd9')).toBe('*** *** and ***');
  });
});

describe('a running proxy leaks no secret', async () => {
  const dump = await fixtureDump('2026.03');
  // An indexer that fails every way an indexer can, with the secrets in the errors.
  const throwing = ((input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('/api/v3/')) return Promise.reject(new TypeError(`Failed to parse URL from ${url}`));
    return Promise.reject(new TypeError(`fetch failed: Failed to parse URL from ${url} (header X-Api-Key: ${INDEXER_KEY})`));
  }) as typeof fetch;
  const sonarrServer = await fakeSonarr(undefined, SONARR_KEY);
  const echoing = await serve((_url, res) => void res.writeHead(200, { 'Content-Type': 'application/xml' }).end(`<error code="100" description="Incorrect key ${INDEXER_KEY} sent as apikey=${SENT_KEY}"/>`));
  const lines: string[] = [];
  const data = new DataManager({ dataDir: path.join(tmp, 'redact-d1'), metaUrl: 'unused', dump, refreshHours: 24, log: (l) => lines.push(l) });
  await data.start();
  const sonarr = new SonarrClient({ url: sonarrServer.url, apiKey: SONARR_KEY, refreshMinutes: 60 });
  await sonarr.start();
  const stats = new Stats(null);
  const redactor = new Redactor(SONARR_KEY);
  const indexers = [
    { name: 'throws', url: `http://127.0.0.1:1/api?apikey=${URL_KEY}`, apikey: INDEXER_KEY },
    { name: 'echoes', url: `${echoing.url}/api` },
  ];
  const mk = (fetchFn?: typeof fetch) => createProxyServer({ indexers, data, sonarr, stats, version: 'test', timeoutMs: 3000, log: (l) => lines.push(l), redactor, ...(fetchFn && { fetch: fetchFn }) });
  const servers = [mk(throwing)];
  await new Promise<void>((r) => servers[0]!.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(servers[0]!.address() as AddressInfo).port}`;
  afterAll(async () => {
    servers[0]!.close();
    data.stop();
    await sonarrServer.close();
    await echoing.close();
  });

  it('keeps the keys out of logs, error responses, the status page, its JSON and the exports', async () => {
    const bodies: string[] = [];
    const get = async (p: string) => {
      const res = await fetch(`${base}${p}`);
      const text = await res.text();
      bodies.push(text);
      return { status: res.status, text };
    };
    // Searches that fail inside the proxy (its fetch throws errors that quote the URL) ...
    expect((await get(`/throws/api?apikey=${SENT_KEY}&t=search&q=Split%20Show`)).status).toBe(502);
    await get(`/throws/api?apikey=${SENT_KEY}&t=caps`);
    // ... and one whose upstream answers with an error document that echoes the keys (served by a second proxy over real fetch).
    const second = mk();
    await new Promise<void>((r) => second.listen(0, '127.0.0.1', r));
    const base2 = `http://127.0.0.1:${(second.address() as AddressInfo).port}`;
    bodies.push(await (await fetch(`${base2}/echoes/api?apikey=${SENT_KEY}&t=search&q=x`)).text());
    // The pages Xwolv and Sonarr can read.
    await get('/');
    await get('/status.json');
    await get('/export.json');
    await get('/export.txt');
    second.close();
    // Both proxies share the stats and the redactor, so the page now lists what happened.
    const all = [...lines, ...bodies].join('\n');
    expect(leaks(all)).toEqual([]);
    // Something was masked, so the test did exercise the leak paths.
    expect(bodies.some((b) => b.includes('upstream throws: ') && b.includes('***'))).toBe(true);
    expect(bodies.some((b) => b.includes('Incorrect key *** sent as apikey=***'))).toBe(true);
  });

  it('keeps the Sonarr key out of the status page when Sonarr cannot be reached', async () => {
    const down = new SonarrClient({ url: 'http://127.0.0.1:1', apiKey: SONARR_KEY, refreshMinutes: 60, fetch: (() => Promise.reject(new Error(`connect failed for http://127.0.0.1:1/api/v3/series?apikey=${SONARR_KEY}`))) as typeof fetch });
    await down.refresh();
    expect(down.status.lastError).toContain(SONARR_KEY); // the raw error does carry it ...
    const server = createProxyServer({ indexers, data, sonarr: down, stats, version: 'test', timeoutMs: 1000, redactor });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const page = await (await fetch(url)).text();
    const json = await (await fetch(`${url}/status.json`)).text();
    server.close();
    expect(page).toContain('Sonarr error'); // ... and the page shows the error without the key
    expect(leaks(page + json)).toEqual([]);
  });
});

describe('the proxy process', () => {
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const entry = path.join(root, 'packages/proxy/src/main.ts');
  const freePort = () =>
    new Promise<number>((resolve) => {
      const s = createServer().listen(0, '127.0.0.1', () => {
        const { port } = s.address() as AddressInfo;
        s.close(() => resolve(port));
      });
    });

  /** Runs the real entry point; resolves with everything it printed and how it ended. */
  async function run(env: Record<string, string>, act?: (port: number) => Promise<void>, ms = 20_000): Promise<{ out: string; code: number | null }> {
    const port = await freePort();
    const child = spawn(process.execPath, ['--import', 'tsx', '--conditions=@courmap/source', entry], {
      cwd: root,
      env: { PATH: process.env.PATH ?? '', DATA_DIR: path.join(tmp, `proc-${port}`), PORT: String(port), ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d: Buffer) => (out += d));
    child.stderr.on('data', (d: Buffer) => (out += d));
    const exited = new Promise<number | null>((r) => child.on('exit', (code) => r(code)));
    const timer = setTimeout(() => child.kill(), ms);
    if (act) {
      // Wait until it is listening and Sonarr has been tried, then poke it and stop it.
      const until = Date.now() + ms;
      while (!/Sonarr: /.test(out) && Date.now() < until && child.exitCode === null) await new Promise((r) => setTimeout(r, 100));
      await act(port);
      child.kill();
    }
    const code = await exited;
    clearTimeout(timer);
    return { out, code };
  }

  it('prints no key at startup, in errors from unreachable servers, or on the status page', async () => {
    const dump = await fixtureDump('2026.04');
    let pages = '';
    const { out } = await run(
      { SONARR_URL: 'http://127.0.0.1:1', SONARR_API_KEY: SONARR_KEY, INDEXER_A_URL: `http://127.0.0.1:1/api?apikey=${URL_KEY}`, INDEXER_A_APIKEY: INDEXER_KEY, COURMAP_DUMP: dump },
      async (port) => {
        const b = `http://127.0.0.1:${port}`;
        await (await fetch(`${b}/a/api?apikey=${SENT_KEY}&t=search&q=x`)).text();
        pages = [await (await fetch(b)).text(), await (await fetch(`${b}/status.json`)).text(), await (await fetch(`${b}/export.json`)).text()].join('\n');
      },
    );
    expect(out).toContain('Courmap proxy');
    expect(out).toContain('Sonarr: ');
    expect(leaks(out + pages)).toEqual([]);
  }, 40_000);

  it('prints no key when the configuration file is broken and quotes the key', async () => {
    const file = path.join(tmp, 'broken.yaml');
    // The syntax error is on the key's own line, so the parser's excerpt quotes the key.
    writeFileSync(file, `sonarr:\n  url: http://x\n  api_key: "${SONARR_KEY}\n`);
    const { out, code } = await run({ COURMAP_CONFIG: file });
    expect(code).not.toBe(0);
    expect(out).toContain('invalid configuration');
    expect(leaks(out)).toEqual([]);
  }, 40_000);

  it('prints no key when an indexer URL is rejected', async () => {
    const { out, code } = await run({ SONARR_API_KEY: SONARR_KEY, INDEXER_A_URL: `ftp://x/api?apikey=${URL_KEY}&password=${PASSWORD}` });
    expect(code).not.toBe(0);
    expect(leaks(out)).toEqual([]);
  }, 40_000);
});

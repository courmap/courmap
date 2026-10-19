import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { afterAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { compile, generateShards, validate } from '@courmap/builder';
import { createOfflineClient } from '@courmap/client';
import { serveStatic } from '../../packages/client/test/static-server.js';
import { handle, MAX_RESOLVE_BATCH, MAX_TRANSLATE_BATCH, type Env } from '../src/api.js';

// The Worker over shards generated from the conformance fixture, served locally, checked against
// the offline client case by case (step 11's check runs the same suite against the deployed URL).
const root = fileURLToPath(new URL('../../', import.meta.url));
const tmp = mkdtempSync(path.join(tmpdir(), 'courmap-worker-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

interface Case {
  name: string;
  op: 'lookup' | 'translate' | 'resolve';
  ref: string;
  release?: string;
  episode?: number | string;
  targets?: string[];
}

describe('Worker', async () => {
  const v = await validate(path.join(root, 'tests/conformance/data'));
  const dump = path.join(tmp, 'c.sqlite');
  compile(v.records!, v.checked, dump, { dataVersion: 'conformance', builtAt: '2026-01-01T00:00:00.000Z', gitSha: 'conformance' });
  await generateShards(dump, path.join(tmp, 'shards'));
  const server = await serveStatic(path.join(tmp, 'shards'));
  const offline = createOfflineClient(dump);
  afterAll(async () => {
    offline.close();
    await server.close();
  });
  const env: Env = { DATA_URL: server.url };
  const call = async (pathAndQuery: string, init?: RequestInit, e: Env = env) => {
    const res = await handle(new Request(`https://api.courmap.com${pathAndQuery}`, init), e);
    return { status: res.status, headers: res.headers, body: res.status === 204 ? null : ((await res.json()) as Record<string, unknown>) };
  };

  const cases = readdirSync(path.join(root, 'tests/conformance/cases'))
    .filter((f) => f.endsWith('.yaml'))
    .flatMap((f) => (parse(readFileSync(path.join(root, 'tests/conformance/cases', f), 'utf8')) as { cases: Case[] }).cases.map((c) => [`${f}: ${c.name}`, c] as const));

  it.each(cases)('conformance: %s', async (_label, c) => {
    const url =
      c.op === 'lookup'
        ? `/v1/lookup?ref=${encodeURIComponent(c.ref)}`
        : c.op === 'resolve'
          ? `/v1/resolve?release=${encodeURIComponent(c.release!)}`
          : `/v1/translate?from=${encodeURIComponent(c.ref)}&episode=${encodeURIComponent(String(c.episode))}&to=${(c.targets ?? []).join(',')}`;
    const got = await call(url);
    const want = await (c.op === 'lookup' ? offline.lookup(c.ref) : c.op === 'resolve' ? offline.resolve(c.release!) : offline.translate(c.ref, c.episode!, c.targets ?? [])).then(
      (value) => ({ status: 200, body: JSON.parse(JSON.stringify(value)) }),
      (err: { code: string; toJSON(): unknown }) => ({ status: { invalid_input: 400, not_found: 404, ambiguous: 409 }[err.code]!, body: err.toJSON() }),
    );
    expect(got.status).toBe(want.status);
    // Over HTTP every episode arrives as text, so "5" and 5 are the same request; the Worker echoes
    // the number, as the spec's response shape does.
    const input = (want.body as { input?: { episode?: unknown } }).input;
    if (input && typeof input.episode === 'string' && /^\d+$/.test(input.episode)) input.episode = Number(input.episode);
    expect(got.body).toEqual(want.body);
  });

  it('answers search and meta', async () => {
    const s = await call('/v1/search?q=simple%20show');
    expect((s.body as unknown as { id: string }[])[0]!.id).toBe('simple-show');
    expect((await call('/v1/meta')).body).toMatchObject({ data_version: 'conformance' });
  });

  it('takes POST batches up to the caps, with per-item errors', async () => {
    const post = (p: string, body: unknown) => call(p, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
    const t = await post('/v1/translate', { items: [{ ref: 'anilist:2003', episode: 5, targets: ['tvdb_show'] }, { ref: 'anilist:9999', episode: 1, targets: [] }] });
    const results = (t.body as { results: Record<string, unknown>[] }).results;
    expect(results[0]).toMatchObject({ status: 'ok', work: { id: 'split-show-part-2', episode: 5 } });
    expect(results[1]).toMatchObject({ error: { code: 'not_found' } });
    const tooMany = await post('/v1/translate', { items: Array.from({ length: MAX_TRANSLATE_BATCH + 1 }, () => ({ ref: 'anilist:2001', episode: 1 })) });
    expect([tooMany.status, tooMany.body]).toEqual([400, { code: 'invalid_input', field: 'items', message: `at most ${MAX_TRANSLATE_BATCH} per request, got ${MAX_TRANSLATE_BATCH + 1}` }]);
    const r = await post('/v1/resolve', { releases: ['[Other] Simple Show - 05 (1080p)'] });
    expect((r.body as { results: { status: string }[] }).results[0]!.status).toBe('ok');
    expect((await post('/v1/resolve', { releases: Array.from({ length: MAX_RESOLVE_BATCH + 1 }, () => 'x') })).status).toBe(400);
    expect((await post('/v1/resolve', 'not json')).status).toBe(400);
  });

  it('allows any origin', async () => {
    const pre = await call('/v1/translate', { method: 'OPTIONS' });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect((await call('/v1/meta')).headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('rate limits per client and explains missing parameters', async () => {
    const limited = await call('/v1/meta', undefined, { ...env, LIMITER: { limit: async () => ({ success: false }) } });
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('60');
    expect(await call('/v1/lookup')).toMatchObject({ status: 400, body: { code: 'invalid_input', field: 'ref' } });
    expect((await call('/v2/nothing')).status).toBe(404);
  });

  it('exports only the default handler from the entry (workerd reads every export as a handler)', async () => {
    expect(Object.keys(await import('../src/index.js'))).toEqual(['default']);
  });

  it('bundles for the Workers runtime with no Node-only module', async () => {
    const r = await build({
      entryPoints: [path.join(root, 'worker/src/index.ts')],
      bundle: true,
      platform: 'browser',
      format: 'esm',
      conditions: ['@courmap/source', 'workerd', 'worker', 'browser'],
      alias: { '@courmap/client/remote': path.join(root, 'packages/client/src/browser.ts') },
      write: false,
      metafile: true,
      logLevel: 'silent',
    });
    expect(Object.keys(r.metafile.inputs).filter((f) => /node:|better-sqlite3|offline\.ts|disk-store\.ts/.test(f))).toEqual([]);
  });
});

describe('schedule watchdog (decision S7.3)', async () => {
  const { watchdog, WATCHED } = await import('../src/watchdog.js');
  const now = new Date('2026-10-20T07:53:00Z');
  const fake = (runsToday: number) => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const f = (async (url: string, init?: RequestInit) => {
      calls.push({ url, ...(init && { init }) });
      return url.endsWith('/dispatches') ? new Response(null, { status: 204 }) : new Response(JSON.stringify({ total_count: runsToday }));
    }) as unknown as typeof fetch;
    return { f, calls };
  };

  it('does nothing without the dispatch token', async () => {
    const { f, calls } = fake(0);
    expect(await watchdog('53 7 * * *', {}, now, f)).toEqual({ workflow: 'bots.yml', action: 'disabled' });
    expect(calls).toEqual([]);
  });

  it('leaves a workflow that already ran today alone', async () => {
    const { f, calls } = fake(1);
    expect(await watchdog('53 7 * * *', { GITHUB_DISPATCH_TOKEN: 't' }, now, f)).toEqual({ workflow: 'bots.yml', action: 'already-ran' });
    expect(calls[0]!.url).toContain('/actions/workflows/bots.yml/runs?created=%3E%3D2026-10-20');
    expect(calls).toHaveLength(1);
  });

  it('dispatches a workflow whose schedule did not fire', async () => {
    const { f, calls } = fake(0);
    expect(await watchdog('53 7 * * *', { GITHUB_DISPATCH_TOKEN: 't' }, now, f)).toEqual({ workflow: 'bots.yml', action: 'dispatched' });
    expect(JSON.parse(String(calls[1]!.init!.body))).toEqual({ ref: 'main', inputs: { job: 'scan' } });
  });

  it('backs up every GitHub schedule, 30 minutes later, and wrangler.toml lists the same crons', () => {
    const wrangler = readFileSync(path.join(root, 'worker/wrangler.toml'), 'utf8');
    expect(JSON.parse(/crons = (\[.*\])/.exec(wrangler)![1]!)).toEqual(Object.keys(WATCHED));
    const github = (file: string) => [...readFileSync(path.join(root, '.github/workflows', file), 'utf8').matchAll(/cron: '([^']+)'/g)].map((m) => m[1]!);
    const later = (cron: string) => cron.replace(/^(\d+) /, (_, m: string) => `${Number(m) + 30} `);
    expect(Object.keys(WATCHED)).toEqual([later(github('bots.yml')[0]!), later(github('seed.yml')[0]!), later(github('release.yml')[0]!)]);
  });

  it('deploys only to api.courmap.com, reads data.courmap.com and keeps the dispatch token out of the config', () => {
    const wrangler = readFileSync(path.join(root, 'worker/wrangler.toml'), 'utf8');
    expect(wrangler).toMatch(/^workers_dev = false$/m);
    expect(wrangler).toMatch(/^preview_urls = false$/m);
    expect(wrangler).toMatch(/^routes = \[\{ pattern = "api\.courmap\.com", custom_domain = true \}\]$/m);
    const vars = /^\[vars\]\n([\s\S]*?)(?=^\[)/m.exec(wrangler)![1]!;
    expect(vars).toMatch(/^DATA_URL = "https:\/\/data\.courmap\.com\/v1\/"$/m);
    // A dashboard-managed secret: naming it as a var or anywhere else in the config would let a deploy replace it.
    expect(wrangler.split('\n').filter((l) => !l.startsWith('#')).join('\n')).not.toContain('GITHUB_DISPATCH_TOKEN');
  });
});

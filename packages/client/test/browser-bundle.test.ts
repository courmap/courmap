import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { build } from 'esbuild';
import { afterAll, describe, expect, it } from 'vitest';
import { MemoryDataset, compile, generateShards, validate } from '@courmap/builder';
import { createClient } from '../src/index.js';
import { serveStatic } from './static-server.js';

// Decision S4.7: the docs site runs @courmap/client in the browser in remote mode. This bundles
// the browser entry for the browser platform (which fails on any node: import), then runs the
// bundle in a bare JavaScript context with only browser globals and checks it answers like the
// in-memory dataset.
const pkg = fileURLToPath(new URL('../', import.meta.url));
const data = fileURLToPath(new URL('../../../tests/conformance/data/', import.meta.url));
const tmp = mkdtempSync(path.join(tmpdir(), 'courmap-browser-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

interface BundledClient {
  translate(ref: string, episode: number, targets: string[]): Promise<unknown>;
  resolve(name: string): Promise<unknown>;
  search(q: string): Promise<unknown>;
}

describe('browser bundle of the remote client (decision S4.7)', async () => {
  const result = await build({
    entryPoints: [path.join(pkg, 'src/browser.ts')],
    bundle: true,
    platform: 'browser',
    format: 'iife',
    globalName: 'Courmap',
    conditions: ['@courmap/source', 'browser'],
    target: 'es2022',
    write: false,
    metafile: true,
    logLevel: 'silent',
  });
  const code = result.outputFiles[0]!.text;
  const inputs = Object.keys(result.metafile.inputs);

  it('bundles for the browser platform with no Node-only module', () => {
    expect(result.errors).toEqual([]);
    expect(inputs.filter((f) => /better-sqlite3|offline\.ts|disk-store\.ts|node:/.test(f))).toEqual([]);
    expect(code).not.toMatch(/\brequire\(|from ["']node:/);
  });

  it('resolves @courmap/client to the browser entry under the browser condition', () => {
    const exports = JSON.parse(readFileSync(path.join(pkg, 'package.json'), 'utf8')).exports;
    expect(exports['.']['@courmap/source'].browser).toBe('./src/browser.ts');
    expect(exports['.'].browser).toBe('./dist/browser.js');
    expect(exports['./remote'].default).toBe('./dist/browser.js');
  });

  it('runs in a context with only browser globals and answers like the in-memory dataset', async () => {
    const v = await validate(data);
    const dump = path.join(tmp, 'fixture.sqlite');
    compile(v.records!, v.checked, dump, { dataVersion: '2026.01', builtAt: '2026-01-01T00:00:00.000Z', gitSha: 'test' });
    await generateShards(dump, path.join(tmp, 'shards'));
    const server = await serveStatic(path.join(tmp, 'shards'));
    try {
      // No process, require, Buffer or module: only what a browser page has.
      const context = vm.createContext({ fetch, TextDecoder, TextEncoder, URL, console, setTimeout, clearTimeout });
      vm.runInContext(`${code}\nglobalThis.Courmap = Courmap;`, context);
      expect(vm.runInContext('typeof process + typeof require + typeof Buffer', context)).toBe('undefinedundefinedundefined');
      const bundled = (context.Courmap as { createRemoteClient(url: string): BundledClient }).createRemoteClient(server.url);
      const memory = createClient(new MemoryDataset(v.records!, { data_version: '2026.01', git_sha: 'test', built_at: '2026-01-01T00:00:00.000Z', schema_version: '4' }));
      // Results cross the vm boundary, so compare their JSON.
      const same = async (a: Promise<unknown>, b: Promise<unknown>) => expect(JSON.parse(JSON.stringify(await a))).toEqual(JSON.parse(JSON.stringify(await b)));
      await same(bundled.translate('anilist:2003', 5, ['tvdb_show', 'absolute']), memory.translate('anilist:2003', 5, ['tvdb_show', 'absolute']));
      await same(bundled.resolve('[Other] Split Show - 13 [1080p]'), memory.resolve('[Other] Split Show - 13 [1080p]'));
      await same(bundled.search('simple show'), memory.search('simple show'));
    } finally {
      await server.close();
    }
  });
});

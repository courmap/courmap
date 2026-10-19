import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { casesFromExport } from '../scripts/corpus-from-proxy.js';
import { importCases } from '../scripts/corpus-lib.js';

const fixture = fileURLToPath(new URL('../../../tests/conformance/data/', import.meta.url));
const tmp = mkdtempSync(path.join(tmpdir(), 'courmap-corpus-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** The shape the proxy serves at /export.json (packages/proxy/src/server.ts exportJson). */
const exported = {
  courmap_proxy_export: 1,
  data_version: '2026.43',
  unresolved: [
    { name: '[Other] Twin Title - 01 [1080p]', status: 'ambiguous', count: 2, detail: 'best candidate split-show at 0.5' },
    { name: '[Other] Unknown Thing - 03 [1080p]', status: 'unmatched', count: 7, detail: 'no candidate' },
  ],
  assisted: [{ work: 'tie-show', count: 3, examples: ['[Other] Tie Show - 01 [1080p]', '[Other] Tie Show - 02 [1080p]'], mapping: { series: { title: 'Tie Show', tvdbId: 9999 } } }],
};

describe('corpus:from-proxy', () => {
  it('reads the JSON export, most frequent first, and the text export', () => {
    const cases = casesFromExport(JSON.stringify(exported));
    expect(cases.map((c) => [c.name, c.source])).toEqual([
      ['[Other] Unknown Thing - 03 [1080p]', 'proxy-unresolved'],
      ['[Other] Twin Title - 01 [1080p]', 'proxy-unresolved'],
      ['[Other] Tie Show - 01 [1080p]', 'proxy-assisted'],
      ['[Other] Tie Show - 02 [1080p]', 'proxy-assisted'],
    ]);
    expect(cases[2]!.note).toContain('tie-show as "Tie Show" (TVDB 9999)');
    expect(casesFromExport('# from the status page\n[Other] A - 01\n\n/downloads/[Other] B - 02.mkv\n').map((c) => c.name)).toEqual(['[Other] A - 01', '[Other] B - 02.mkv']);
  });

  it('adds unverified cases with today\'s answer, deduplicated across exports and against the corpus', async () => {
    const corpusFile = path.join(tmp, 'releases.yaml');
    writeFileSync(corpusFile, 'cases:\n  - name: "[Other] Twin Title - 01 [1080p]"\n    expect: { status: ambiguous }\n    verified: true\n    source: hand-written\n');
    const cases = [...casesFromExport(JSON.stringify(exported)), ...casesFromExport(JSON.stringify(exported))];
    const r = await importCases(cases, { corpusFile, dataDir: fixture, today: '2026-10-19' });
    expect([r.added, r.skipped]).toEqual([3, 5]);
    const after = (parse(readFileSync(corpusFile, 'utf8')) as { cases: { name: string; expect: unknown; verified: boolean; source: string; notes?: string }[] }).cases;
    expect(after.map((c) => [c.name, c.expect, c.verified, c.source])).toEqual([
      ['[Other] Twin Title - 01 [1080p]', { status: 'ambiguous' }, true, 'hand-written'],
      ['[Other] Unknown Thing - 03 [1080p]', { status: 'unmatched' }, false, 'proxy-unresolved'],
      ['[Other] Tie Show - 01 [1080p]', { status: 'ok', work: 'tie-show', episode: 1 }, false, 'proxy-assisted'],
      ['[Other] Tie Show - 02 [1080p]', { status: 'ok', work: 'tie-show', episode: 2 }, false, 'proxy-assisted'],
    ]);
    expect(after[1]!.notes).toBe('Imported 2026-10-19: this is what the resolver answered then. A proxy saw it 7 time(s) on data 2026.43 and got unmatched (no candidate). Check it, correct it if needed, then set verified: true.');
  });
});

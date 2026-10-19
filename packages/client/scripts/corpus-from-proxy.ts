// Turns what a Courmap proxy saw into corpus cases: release names it could
// not resolve, and names it rewrote only with Sonarr's help (assisted numbering), from the
// proxy's export (http://<proxy>:9797/export.json, or export.txt with one name per line).
// Usage: pnpm corpus:from-proxy <export.json | export.txt> [<more exports> ...]
//
// Several exports (several installs, several weeks) can be passed at once; names are deduplicated
// across them and against the corpus. Every new case is unverified, with today's answer as its
// expectation and a note saying where it came from. Assisted names also say which work and which
// Sonarr series the proxy used, which is the hint for the TVDB mapping the data still lacks.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { importCases, readNames, type NewCase } from './corpus-lib.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));

interface ProxyExport {
  courmap_proxy_export: number;
  data_version: string | null;
  unresolved: { name: string; status: string; count: number; detail: string }[];
  assisted: { work: string; count: number; examples: string[]; mapping: { series: { title: string; tvdbId: number } } }[];
}

/** Cases from one export file, most frequent first; JSON when it parses as a proxy export, else text. */
export function casesFromExport(text: string): NewCase[] {
  let data: ProxyExport | null = null;
  try {
    const parsed = JSON.parse(text) as ProxyExport;
    if (parsed && parsed.courmap_proxy_export === 1) data = parsed;
  } catch {
    // not JSON: the text format
  }
  if (!data) return readNames(text).map((name) => ({ name, source: 'proxy' }));
  const version = data.data_version ?? 'unknown';
  return [
    ...[...data.unresolved]
      .sort((a, b) => b.count - a.count)
      .map((u) => ({ name: u.name, source: 'proxy-unresolved', note: `A proxy saw it ${u.count} time(s) on data ${version} and got ${u.status} (${u.detail}).` })),
    ...[...data.assisted]
      .sort((a, b) => b.count - a.count)
      .flatMap((a) =>
        a.examples.map((name) => ({
          name,
          source: 'proxy-assisted',
          note: `A proxy numbered it with Sonarr's help on data ${version}: ${a.work} as "${a.mapping.series.title}" (TVDB ${a.mapping.series.tvdbId}); the data has no TVDB projection for ${a.work} yet.`,
        })),
      ),
  ];
}

async function main(): Promise<number> {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error('Usage: pnpm corpus:from-proxy <export.json | export.txt> [...]');
    return 1;
  }
  const cases = files.flatMap((f) => casesFromExport(readFileSync(f, 'utf8')));
  const r = await importCases(cases, { corpusFile: `${root}tests/releases.yaml`, dataDir: `${root}data` });
  console.log(`Added ${r.added} unverified case(s) from ${files.length} export(s) (${JSON.stringify(r.byStatus)}); skipped ${r.skipped} already in the corpus or repeated.`);
  if (r.added > 0) console.log('Next: check each new case in tests/releases.yaml, fix its expectation, set verified: true, and run pnpm corpus.');
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.error(err);
      process.exit(2);
    },
  );
}

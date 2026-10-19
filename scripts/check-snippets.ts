// Every code snippet in the README and the docs is extracted and checked in CI (docs/SPEC.md,
// "Quality bar"). What "checked" means depends on the language:
//   ts, js     executed against the compiled data (out/courmap.sqlite, out/shards/v1); remote
//              calls to data.courmap.com are served from the local shards. A console.log line
//              ending in "// <expected>" must print exactly that.
//   yaml       parsed; work, sequence and group files validated against schema/; Docker Compose
//              files checked against the proxy's own config loader.
//   json       parsed.
//   sh         every "pnpm <script>" must name a script that exists; other commands (curl,
//              docker, npm install) are listed as not executed.
//   anything else (diagrams, plain text) is skipped.
// Usage: tsx --conditions=@courmap/source scripts/check-snippets.ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'yaml';
import { schemaIssues } from '../packages/builder/src/schema.js';
import { loadConfig } from '../packages/proxy/src/config.js';
import { serveStatic } from '../packages/client/test/static-server.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const dump = path.join(root, 'out/courmap.sqlite');
const shards = path.join(root, 'out/shards/v1');
const GENERATED = ['site/src/content/docs/reference/library/api', 'site/src/content/docs/reference/data-format.md', 'site/src/content/docs/coverage.md'];

function docs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    const rel = path.relative(root, p).split(path.sep).join('/');
    if (GENERATED.some((g) => rel === g || rel.startsWith(`${g}/`))) continue;
    if (statSync(p).isDirectory()) out.push(...docs(p));
    else if (/\.mdx?$/.test(name)) out.push(p);
  }
  return out;
}

interface Snippet {
  file: string;
  line: number;
  lang: string;
  code: string;
}

/** Fenced code blocks, including indented ones inside lists and Starlight steps. */
function snippets(file: string): Snippet[] {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  const out: Snippet[] = [];
  for (let i = 0; i < lines.length; i++) {
    const open = /^(\s*)(```+)\s*([\w-]*)/.exec(lines[i]!);
    if (!open) continue;
    const [, indent, fence, lang] = open;
    const body: string[] = [];
    let j = i + 1;
    for (; j < lines.length && !new RegExp(`^\\s*${fence}\\s*$`).test(lines[j]!); j++) body.push(lines[j]!.startsWith(indent!) ? lines[j]!.slice(indent!.length) : lines[j]!.trimStart());
    out.push({ file: path.relative(root, file).split(path.sep).join('/'), line: i + 1, lang: lang!.toLowerCase(), code: body.join('\n') });
    i = j;
  }
  return out;
}

const scripts = new Set(Object.keys((JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> }).scripts));
const PNPM_BUILTINS = new Set(['install', 'add', 'run', 'exec', 'dlx', 'build', 'test', '--filter', '-s', 'vitest']);

const problems: string[] = [];
const counts = { executed: 0, yaml: 0, json: 0, shell: 0, skipped: 0 };
const notExecuted = new Set<string>();

const files = [path.join(root, 'README.md'), path.join(root, 'packages/proxy/README.md'), ...docs(path.join(root, 'site/src/content/docs'))].filter(existsSync);
const all = files.flatMap(snippets);

const work = mkdtempSync(path.join(tmpdir(), 'courmap-snippets-'));
const server = existsSync(shards) ? await serveStatic(shards) : null;
try {
  if (existsSync(dump)) copyFileSync(dump, path.join(work, 'courmap.sqlite'));
  // Redirects the published data URL to the local shards, so remote snippets run offline.
  writeFileSync(
    path.join(work, 'redirect-fetch.mjs'),
    `const real = globalThis.fetch;\nglobalThis.fetch = (input, init) => real(String(input).replace('https://data.courmap.com/v1/', process.env.COURMAP_SNIPPET_DATA), init);\n`,
  );
  const client = pathToFileURL(path.join(root, 'packages/client/src/index.ts')).href;
  // tsx's CLI through this Node, asynchronously: the local shard server runs in this process.
  const tsxCli = path.join(root, 'node_modules/tsx/dist/cli.mjs');
  const run = promisify(execFile);

  for (const s of all) {
    const at = `${s.file}:${s.line}`;
    if (['ts', 'typescript', 'js', 'javascript'].includes(s.lang)) {
      if (!existsSync(dump) || !server) {
        problems.push(`${at}: needs out/courmap.sqlite and out/shards/v1 (run pnpm compile and pnpm builder shards first)`);
        continue;
      }
      const file = path.join(work, `snippet-${counts.executed}.mts`);
      writeFileSync(file, s.code.replace(/from '@courmap\/client(?:\/remote)?'/g, `from '${client}'`));
      let stdout = '';
      try {
        stdout = (
          await run(process.execPath, [tsxCli, '--conditions=@courmap/source', '--import', pathToFileURL(path.join(work, 'redirect-fetch.mjs')).href, file], {
            cwd: work,
            encoding: 'utf8',
            env: { ...process.env, COURMAP_SNIPPET_DATA: server.url },
          })
        ).stdout;
      } catch (err) {
        problems.push(`${at}: snippet failed:\n${(err as { stderr?: string }).stderr ?? (err as Error).message}`);
        continue;
      }
      counts.executed++;
      const expected = s.code.split('\n').filter((l) => /console\.log\(/.test(l) && /\/\/ (.+)$/.test(l)).map((l) => /\/\/ (.+)$/.exec(l)![1]!.trim());
      const printed = stdout.trim().split(/\r?\n/).map((l) => l.trim());
      if (expected.length > 0 && printed.length !== s.code.split('\n').filter((l) => /console\.log\(/.test(l)).length) problems.push(`${at}: expected ${expected.length} printed lines, got:\n${stdout}`);
      const logLines = s.code.split('\n').filter((l) => /console\.log\(/.test(l));
      logLines.forEach((l, i) => {
        const want = /\/\/ (.+)$/.exec(l)?.[1]?.trim();
        if (want !== undefined && printed[i] !== want) problems.push(`${at}: line ${i + 1} printed\n    ${printed[i]}\n  but the snippet says\n    ${want}`);
      });
    } else if (['yaml', 'yml'].includes(s.lang)) {
      counts.yaml++;
      let doc: unknown;
      try {
        doc = parse(s.code);
      } catch (err) {
        problems.push(`${at}: YAML does not parse: ${(err as Error).message}`);
        continue;
      }
      const d = doc as Record<string, unknown> | null;
      if (d && typeof d === 'object' && 'services' in d) {
        // A Docker Compose file for the proxy: its environment must be accepted by the proxy itself.
        const svc = Object.values(d.services as Record<string, { image?: string; environment?: Record<string, string> }>)[0]!;
        if (!svc.image?.startsWith('ghcr.io/courmap/proxy')) problems.push(`${at}: compose service image is ${svc.image}`);
        try {
          const c = loadConfig({ ...(svc.environment ?? {}), COURMAP_CONFIG: '/nonexistent' }, () => null);
          if (c.indexers.length === 0) problems.push(`${at}: compose environment configures no indexer`);
        } catch (err) {
          problems.push(`${at}: the proxy rejects this environment: ${(err as Error).message}`);
        }
      } else if (d && typeof d === 'object' && typeof d.id === 'string') {
        const kind = 'members' in d ? 'sequence' : 'overrides' in d ? 'group' : 'work';
        for (const issue of schemaIssues(kind, d)) problems.push(`${at}: not a valid ${kind} file: ${issue.message} (at ${issue.path.join('.') || 'top level'})`);
      }
    } else if (s.lang === 'json') {
      counts.json++;
      try {
        JSON.parse(s.code);
      } catch (err) {
        problems.push(`${at}: JSON does not parse: ${(err as Error).message}`);
      }
    } else if (['sh', 'bash', 'shell', 'console'].includes(s.lang)) {
      counts.shell++;
      for (const raw of s.code.split('\n')) {
        const line = raw.replace(/#.*$/, '').trim();
        if (!line) continue;
        const words = line.split(/\s+/);
        if (words[0] === 'pnpm') {
          const cmd = words[1] === '-s' ? words[2]! : words[1]!;
          if (!scripts.has(cmd) && !PNPM_BUILTINS.has(cmd)) problems.push(`${at}: "pnpm ${cmd}" is not a script in package.json`);
        } else notExecuted.add(words[0]!);
      }
    } else counts.skipped++;
  }
} finally {
  await server?.close();
  rmSync(work, { recursive: true, force: true });
}

console.log(`Snippets in ${files.length} files: ${counts.executed} executed (ts/js), ${counts.yaml} YAML and ${counts.json} JSON validated, ${counts.shell} shell checked for pnpm scripts, ${counts.skipped} skipped (diagrams, plain text).`);
if (notExecuted.size > 0) console.log(`Shell commands not executed: ${[...notExecuted].sort().join(', ')}.`);
for (const p of problems) console.error(`\n${p}`);
if (problems.length > 0) {
  console.error(`\n${problems.length} snippet problem(s).`);
  process.exit(1);
}

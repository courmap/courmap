// Generates packages/core/src/generated/*.ts from schema/*.schema.json.
// Usage: pnpm gen:types            (write files)
//        pnpm gen:types --check    (exit 1 if generated files are stale)
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { compile, type JSONSchema } from 'json-schema-to-typescript';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const outDir = path.join(root, 'packages/core/src/generated');
const kinds = ['work', 'sequence', 'group', 'rejected'] as const;
const check = process.argv.includes('--check');

const banner = (kind: string) =>
  `// Generated from schema/${kind}.schema.json by \`pnpm gen:types\`. Do not edit by hand.\n`;

let stale = 0;
await mkdir(outDir, { recursive: true });
for (const kind of kinds) {
  const schema = JSON.parse(await readFile(path.join(root, 'schema', `${kind}.schema.json`), 'utf8')) as JSONSchema;
  const ts = await compile(schema, schema.title ?? kind, {
    bannerComment: banner(kind),
    additionalProperties: false,
    style: { singleQuote: true },
    unreachableDefinitions: false,
  });
  const file = path.join(outDir, `${kind}.ts`);
  if (check) {
    const current = await readFile(file, 'utf8').catch(() => '');
    if (current !== ts) {
      stale++;
      console.error(`stale: ${path.relative(root, file)}`);
    }
  } else {
    await writeFile(file, ts);
    console.log(`wrote ${path.relative(root, file)}`);
  }
}

if (stale > 0) {
  console.error('Generated types are out of date. Run `pnpm gen:types` and commit the result.');
  process.exit(1);
}

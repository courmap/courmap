// Rewrites expect.yaml for the named fixtures from what validate reports now.
// Review the diagnostics first (pnpm builder validate --data <fixture dir>); this only records them.
// Usage: pnpm fixtures:expect <fixture-name> [...]
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringify } from 'yaml';
import { validate } from '../src/validate.js';

const root = fileURLToPath(new URL('../test/fixtures/invalid/', import.meta.url));
const names = process.argv.slice(2);
if (names.length === 0) {
  console.error('Usage: pnpm fixtures:expect <fixture-name> [...]');
  process.exit(1);
}
for (const name of names) {
  const dir = path.join(root, name);
  const r = await validate(dir, { cwd: dir });
  const pick = (severity: string) =>
    r.diagnostics.filter((d) => d.severity === severity).map((d) => ({ code: d.code, file: d.file, line: d.line, message: d.message }));
  const body = { errors: pick('error'), warnings: pick('warning') };
  writeFileSync(path.join(dir, 'expect.yaml'), '# Diagnostics `builder validate` must report for this fixture, exactly.\n' + stringify(body, { lineWidth: 0 }));
  console.log(`${name}: ${body.errors.length} error(s), ${body.warnings.length} warning(s)`);
}

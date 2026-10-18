// Fails if any tracked text file we author contains an em dash (U+2014). Project rule: no em dashes
// in anything we write. data/seeds/ is exempt: it holds upstream titles and synonyms verbatim.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const EM_DASH = String.fromCharCode(0x2014);
const BINARY = /\.(png|jpe?g|gif|ico|sqlite|zst|gz|woff2?)$/i;
// Upstream data kept verbatim (Xwolv decision S3.3). Everything we author is still checked.
const UPSTREAM = /^data\/seeds\//;

const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' })
  .split('\n')
  .filter((f) => f && !BINARY.test(f) && !UPSTREAM.test(f));

let failures = 0;
for (const file of files) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue; // deleted in the working tree
  }
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    if (line.includes(EM_DASH)) {
      failures++;
      console.error(`${file}:${i + 1}: em dash found`);
    }
  });
}

if (failures > 0) {
  console.error(`\n${failures} line(s) contain an em dash. Use a colon, comma, parentheses or a plain hyphen instead.`);
  process.exit(1);
}
console.log(`No em dashes in ${files.length} files.`);

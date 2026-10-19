// Fails if any tracked or new file contains a string shaped like a GitHub token. Secrets such as
// the Worker's GITHUB_DISPATCH_TOKEN live only in the Cloudflare dashboard or as repository
// secrets, never in a committed file. Checks every text file, data/seeds/ included.
// `--self-test` checks that the patterns catch synthetic tokens and pass ordinary text.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const BINARY = /\.(png|jpe?g|gif|ico|sqlite|zst|gz|woff2?)$/i;
// Classic tokens (personal, OAuth, user-to-server, server-to-server, refresh) and fine-grained ones.
const PATTERNS = [/\bgh[pousr]_[A-Za-z0-9]{36,}\b/, /\bgithub_pat_[A-Za-z0-9_]{40,}\b/];

export const findToken = (line) => PATTERNS.some((p) => p.test(line));

function selfTest() {
  const body = 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0U1v2W3x4Y5z6'; // not a token
  const caught = ['ghp_', 'gho_', 'ghs_', 'github_pat_11ABCDEFG0_'].map((prefix) => `token = "${prefix}${body}"`);
  const passed = ['ghp_short', 'GITHUB_DISPATCH_TOKEN', 'secrets.SEED_PR_TOKEN', 'github_pat_ is the fine-grained prefix'];
  const wrong = [...caught.filter((l) => !findToken(l)), ...passed.filter((l) => findToken(l))];
  if (wrong.length > 0) {
    console.error(`Self-test failed on: ${wrong.join(' | ')}`);
    process.exit(1);
  }
  console.log('Token patterns self-test passed.');
}

function main() {
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' })
    .split('\n')
    .filter((f) => f && !BINARY.test(f));
  let failures = 0;
  for (const file of files) {
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue; // deleted in the working tree
    }
    text.split('\n').forEach((line, i) => {
      if (findToken(line)) {
        failures++;
        console.error(`${file}:${i + 1}: looks like a GitHub token`);
      }
    });
  }
  if (failures > 0) {
    console.error(`\n${failures} line(s) look like a GitHub token. Remove it, revoke it on GitHub, and keep secrets in repository or Worker secrets.`);
    process.exit(1);
  }
  console.log(`No GitHub tokens in ${files.length} files.`);
}

if (process.argv.includes('--self-test')) selfTest();
else main();

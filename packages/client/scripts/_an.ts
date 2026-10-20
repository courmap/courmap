import { readFileSync } from 'node:fs';
import { createOfflineClient } from '@courmap/client';
const [dump, file] = process.argv.slice(2) as [string, string];
const c = createOfflineClient(dump);
const names: { name: string; status: string; detail: string }[] = JSON.parse(readFileSync(file, 'utf8')).unresolved;
const seen = new Set<string>();
for (const n of names) {
  // One line per distinct title and episode: the same release in other resolutions behaves the same.
  const r = (await c.resolve(n.name)) as any;
  const key = `${r.parsed?.title}|${r.parsed?.season}|${r.parsed?.episode}`;
  if (seen.has(key)) continue;
  seen.add(key);
  const cands = (r.candidates ?? []).slice(0, 3).map((x: any) => `${x.work} ${x.score ?? x.confidence ?? ''}${x.reason ? ' [' + String(x.reason).slice(0, 110) + ']' : ''}`).join('\n      ');
  console.log(`\n${n.name.slice(0, 100)}\n   parsed: title="${r.parsed?.title}" S${r.parsed?.season} E${r.parsed?.episode} year=${r.parsed?.year}  was: ${n.status} ${n.detail}\n   now: ${r.status}${r.match ? ` ${r.match.work} ${r.match.episode} (${r.match.confidence}) ${r.match.reason.slice(0, 120)}` : ''}${cands ? '\n      ' + cands : ''}`);
}

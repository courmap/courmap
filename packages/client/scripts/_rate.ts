import { readFileSync } from 'node:fs';
import { createOfflineClient } from '@courmap/client';
const [dump, file] = process.argv.slice(2) as [string, string];
const c = createOfflineClient(dump);
const j = JSON.parse(readFileSync(file, 'utf8'));
let n = 0, ok = 0, tvdb = 0;
const bad: [number, string, string][] = [];
for (const u of j.unresolved) {
  const w = u.count ?? 1; n += w;
  const r: any = await c.resolve(u.name);
  if (r.status === 'ok') { ok += w; if (r.match.projections?.tvdb_show) tvdb += w; }
  else bad.push([w, u.name, `${r.status} ${r.candidates?.[0]?.work ?? ''} ${r.candidates?.[0]?.confidence ?? ''} ${String(r.candidates?.[0]?.reason ?? '').slice(0, 150)}`]);
}
console.log({ names: j.unresolved.length, items: n, ok, tvdb });
for (const [w, name, why] of bad.filter(([, nm]) => !/^S02E\d+-Ah/.test(nm))) console.log(w, name.slice(0, 95), '=>', why);

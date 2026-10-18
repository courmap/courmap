import { MemoryDataset, validate } from '@courmap/builder';
import { createClient } from './src/index.js';
const v = await validate('../../data');
const c = createClient(new MemoryDataset(v.records!, { data_version: 't', git_sha: '', built_at: '', schema_version: '3' }));
for (const n of process.argv.slice(2)) { const r = await c.resolve(n); console.log(r.status, r.match ? `${r.match.work} ${r.match.episode}${r.match.episode_to ? '-' + r.match.episode_to : ''} ${r.match.confidence}` : r.candidates.slice(0, 3).map((x) => `${x.work}:${x.episode}:${x.confidence}`).join(' '), '|', n); }

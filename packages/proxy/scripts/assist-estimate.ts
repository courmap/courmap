// Estimates what Sonarr-assisted numbering (decision S7.1) would add for one anime season.
// Without a real Sonarr, the library is approximated by every TVDB show in the data: its title
// set is the titles and aliases of the works that carry that show, its year the earliest of them.
// Usage: tsx --conditions=@courmap/source packages/proxy/scripts/assist-estimate.ts <bots media.json> [season name]
// (media.json from `pnpm bots scan --save-media`)
import { readFileSync } from 'node:fs';
import { validate } from '@courmap/builder';
import { cleanTitle } from '../src/sonarr.js';

const [mediaFile, seasonName = 'Fall 2026'] = process.argv.slice(2);
if (!mediaFile) {
  console.error('usage: assist-estimate.ts <media.json> [season name]');
  process.exit(1);
}
const media = JSON.parse(readFileSync(mediaFile, 'utf8')) as { seasons: { ref: { season: string; year: number }; media: { id: number; format: string | null }[] }[] };
const [name, year] = seasonName.split(' ');
const season = media.seasons.find((s) => s.ref.season === name!.toUpperCase() && s.ref.year === Number(year));
if (!season) throw new Error(`${seasonName} is not in ${mediaFile}`);

const v = await validate('data');
const works = [...v.records!.works.values()];
const byAnilist = new Map(works.filter((w) => w.ids.anilist).map((w) => [Number(w.ids.anilist), w]));
const titlesOf = (w: (typeof works)[number]) => [w.titles.romaji, w.titles.english, w.titles.native, ...w.aliases].filter((t): t is string => !!t).map(cleanTitle).filter((t) => t.length >= 3);

// The stand-in Sonarr library: one "series" per TVDB show in the data.
const library = new Map<string, { titles: Set<string>; year: number | null }>();
for (const w of works) {
  const show = w.ids.tvdb_show;
  if (!show) continue;
  const s = library.get(show) ?? { titles: new Set<string>(), year: null };
  for (const t of titlesOf(w)) s.titles.add(t);
  if (w.year !== null) s.year = s.year === null ? w.year : Math.min(s.year, w.year);
  library.set(show, s);
}

const inSeason = season.media.filter((m) => m.format !== 'MUSIC').map((m) => byAnilist.get(m.id)).filter((w) => w !== undefined);
const lacking = inSeason.filter((w) => !w.projections.tvdb_show?.length && w.type !== 'movie');
let byId = 0;
let single = 0;
let several = 0;
let none = 0;
for (const w of lacking) {
  if (w.ids.tvdb_show && library.has(w.ids.tvdb_show)) {
    byId++;
    continue;
  }
  const mine = new Set(titlesOf(w));
  const hits = [...library].filter(([, s]) => [...s.titles].some((t) => mine.has(t)) && (w.year === null || s.year === null || Math.abs(s.year - w.year) <= 1));
  if (hits.length === 1) single++;
  else if (hits.length > 1) several++;
  else none++;
}
console.log(`${seasonName}: ${season.media.length} AniList media, ${inSeason.length} in the data (non-music).`);
console.log(`Without a TVDB projection (series types): ${lacking.length}.`);
console.log(`  matched by their own TVDB ID: ${byId}`);
console.log(`  exactly one title match in the data's TVDB shows: ${single}`);
console.log(`  several title matches (would pass through): ${several}`);
console.log(`  no title match among the data's TVDB shows: ${none} (a real Sonarr that has the show would decide)`);

# Decisions

Choices made where `docs/SPEC.md` was ambiguous, silent or seemed wrong. One entry per decision, with a one-line rationale. Newest entries at the bottom of each section. Entries marked *decided by Xwolv* were made by the project owner and override any earlier entry they contradict.

## Repository and tooling

- **Brand asset names.** `assets/` holds `logo.svg` and `courmap-banner.png`, not the `logo.png` / `banner.png` the spec names; the README uses `courmap-banner.png`. Rationale: use the files that exist and leave renaming to the asset owner. *Superseded by Xwolv decision 13.*
- **Source export condition.** Workspace packages export `src/*.ts` under a custom `@courmap/source` condition used by tsx, Vitest and tsc. Rationale: no build step in the dev, test or CI loop, while `dist/` stays the published entry point.
- **Unbuilt packages are README stubs.** `packages/parser`, `seed`, `bots`, `proxy` and `worker/` contain only a README until their build step. Rationale: matches the layout without shipping empty packages that would need versioning.
- **One DATA_LICENSE file.** It contains the full ODbL 1.0 text followed by the full DbCL 1.0 text. Rationale: the spec names a single file for both licenses.
- **CI runs on Node 22.** Local development works on Node 22 or later. Rationale: the spec targets Node 22 LTS as the floor, so CI tests the floor.

## Data format (schema/)

- **Schemas are standalone files.** Shared `$defs` (slug, sources, episode range) are duplicated in each schema, and a test keeps the copies identical. Rationale: any JSON Schema tool, editor or doc generator can read one file without resolving cross-file refs.
- **Episode range notation.** A range is an integer or a string like `1-12`, `S1-S2` (or `S1-2`), `892-`; prefixes S, C, T, P follow AniDB for special, credit, trailer, parody. Rationale: the spec's examples use exactly these forms.
- **`kind` must agree with the range prefix.** `kind` may be omitted and is then inferred from the prefix; a mismatch such as `kind: special, episodes: 1-2` is an error. Rationale: two ways of saying the kind must never disagree silently.
- **`episodes` is required, `null` only while airing or upcoming.** Rationale: the spec's long-runner example uses `episodes: null`, and requiring the key makes "unknown" explicit.
- **`specials` is optional and means unknown when omitted.** The specials bounds check runs only when it is set; compiled as NULL. Rationale: neither seed gives AniDB specials counts, and storing 0 would be a guess.
- **`status` defaults to finished.** Rationale: most works are finished, and open-ended ranges already require an explicit `status: airing`.
- **`gap: true` marks the hole before an entry.** Leading and interior holes in regular coverage need it; a marker with no hole is an error; trailing holes (coverage ends before `episodes`) are always errors; specials have no coverage rule. Rationale: the spec says "no gaps unless marked" without saying where the mark goes. *Superseded by Xwolv decision 4 (trailing holes may be marked `coverage: partial`).*
- **`target` needs one side to be a single episode.** One canonical to many provider episodes, or many to one; `start` and `target` together are an error. Rationale: an N-to-M mapping with both sides larger than one has no defined per-episode answer.
- **No season means a seasonless ordering.** A projection entry without `season` describes an ordering with no seasons (for example TVDB absolute order). Refs into it take no `:sN` scope. Rationale: Anime-Lists uses this ordering (`defaulttvdbseason="a"`), and the SQL `season` column is already nullable.
- **Provider IDs that must be unique per work:** anidb, anilist, mal, kitsu and tmdb_movie. TVDB, TMDB TV and IMDb IDs may be shared across works. Rationale: split cours and sequels share one TVDB or TMDB show.
- **A work belongs to at most one absolute sequence.** Rationale: with two sequences the `absolute` target would have to pick one silently. *Superseded by Xwolv decision 9.*
- **Target landings must not overlap,** within a work or across works sharing a show and season. Rationale: overlapping landings make the reverse lookup ambiguous, and catching them as a named error is clearer than a round-trip failure.

## Validation

- **Round trips probe sample episodes.** The probes are both ends of every range and their neighbours, plus 100 past the start of an open-ended range. Rationale: an exhaustive check on long-runners would be slow and adds nothing for linear ranges.
- **A many-to-one round trip may return a range.** A to hub to B to A passes when the answer is a range that contains the original episode. Rationale: merging two canonical episodes into one provider episode loses information by design.
- **Fixture expectations are exact.** Each broken fixture lists every diagnostic (code, file, line, message) it must produce, and nothing else. Rationale: this catches noisy follow-on errors as well as missing ones.

## Hand-mapped data (data/)

- **Seven real works, one fictional group.** Frieren (simple), Spy x Family parts 1 and 2 (split cour plus absolute sequence), Attack on Titan (specials), One Piece (long-runner, open-ended), Apothecary Diaries 1 and 2 (TVDB and TMDB disagree on the sequel). Every ID was checked against cedya77 release 2026-42 and Anime-Lists commit 996d6a8. Rationale: the step asks for real IDs only where verified.
- **The group override uses a fictional group** (`examplesubs`, marked placeholder). Rationale: neither seed documents real group numbering quirks, and a real group's behaviour must not be guessed. *Superseded by Xwolv decision 11.*
- **Slugs come from the romaji title** (cedya77 main title), for example `shingeki-no-kyojin`. Rationale: stable and source-derived; English titles change between releases and regions.
- **Titles and aliases come only from cedya77 synonyms,** never from AniDB or the `<name>` elements in Anime-Lists. Rationale: the AniDB title license conflicts with ODbL.

## Compile (SQLite)

- **SQL is the spec's DDL verbatim, minus column comments.** Rationale: "using the schema in the spec"; deviations are proposed in the spec instead (see the end of this file). *Superseded by Xwolv decision 5 and 6 (the spec's DDL now carries those changes, and the compiler follows it).*
- **Titles become aliases.** The `aliases` table holds the romaji, English and native titles plus `aliases:`, deduplicated, each with `normalized` from `normalizeTitle`. Rationale: the resolver matches against one index, and titles are the most common release names.
- **`normalized` strips filler words** (the, season, part, cour), using the same function the resolver will apply to parsed titles. Rationale: exact matches only work when both sides normalize identically.
- **`data_version` defaults to the ISO week of the build,** formatted `YYYY.WW` with a two-digit week (`2026.42`, `2026.05`). Rationale: matches the spec's example and the `data-YYYY.WW` release tags.
- **Expected row counts come from the YAML, not the records.** The compiler counts rows straight from the parsed files and compares them with the table counts, so a bug in record conversion cannot hide itself. Rationale: the step 3 check is "row counts match the YAML".
- **`specials` NULL means unknown,** even though the column has `DEFAULT 0`. Rationale: see the data format entry on `specials`; the compiler always writes the value explicitly. *Superseded by Xwolv decision 6.*

## Client API (lookup, translate)

- **Errors are thrown as `CourmapError`** with `code` `not_found` (404), `invalid_input` (400) or `ambiguous`, plus `field` and, for ambiguous, sorted `candidates`. Rationale: the spec types `lookup` as `Promise<Work>`, so failures cannot live in the result; the codes map onto its HTTP statuses.
- **Lookup on a ref shared by several works is `ambiguous`,** for example an unscoped TVDB show, or a season two cours share. Rationale: "never guesses silently".
- **Refs gain two namespaces:** `work:<slug>` (the hub itself) and `absolute:<sequence-id>` (translate source only). Rationale: the spec writes canonical episodes as `work:frieren / ep:12` and lists `absolute` as a target; both directions should be expressible.
- **Season-based refs need a `:sN` scope,** unless the show has a seasonless projection. Specials are reached through `:s0`. Rationale: `tvdb_show:X` with episode 5 has no single meaning when the show has seasons.
- **Canonical providers are anidb, anilist, mal and kitsu.** Their episode numbers are the work's own. Only AniDB (and `work:`) numbers specials; translating a special to AniList, MAL or Kitsu is unmapped. Rationale: those providers model specials as separate entries.
- **tmdb_movie and imdb are id-only.** As targets they return `{ id }`; as sources they pick the work and the episode is read as canonical. Rationale: they identify a work but have no episode numbering.
- **Partial success is `status: "unmapped"`.** Mapped targets still appear in `results`; the rest are listed in `unmapped`. Rationale: the spec defines `unmapped` per target, and dropping good answers helps nobody.
- **An unknown episode on a known ref is `not_found`;** an episode past the work's count is `invalid_input`. Rationale: the first is missing data, the second is a request that cannot be valid.
- **Results add `episode_to` for splits and merges,** both on target results and on `work`; `kind` appears on canonical results only for non-regular episodes. Optional fields are omitted rather than null. Rationale: the spec's response shape has no field for N-to-M answers, and omission keeps the common case identical to the spec example.
- **Episodes may be numbers or strings** (`5`, `"5"`, `"S1"`) on every ref type. Rationale: HTTP query parameters arrive as strings, and every mode must answer alike.
- **`Work` is the future `works/{id}.json` shard shape** plus `data_version`, with every provider ID as a string. Rationale: the remote client can then return shard files as they are.
- **The client has no `resolve` or `search` yet.** They are added with packages/parser in step 7; `createClient(dataset)` is the extension point for `createRemoteClient` in step 6. Rationale: the step says not to build ahead.

## Conformance suite

- **The suite has its own fixture dataset** (`tests/conformance/data/`, fake IDs) instead of using `data/`. Rationale: real data changes weekly, and conformance cases must be stable across data releases.
- **The fixture dump is compiled with `data_version: conformance`,** so expectations include it verbatim. Rationale: ports can compare whole results without special cases.
- **The TypeScript runner also runs the builder's in-memory dataset.** Rationale: it proves the engine gives the same answers over SQLite and over records before the remote mode exists.
- **The `ci` script is named `check`.** Rationale: `pnpm ci` is a reserved pnpm command.

## Decided by Xwolv (2026-10-17)

1. **Manual wins per provider block** (decided by Xwolv). A manual file's `projections.<provider>` block or `ids.<provider>` key replaces only that part of the seed; everything else comes from seeds. Implementation reading: every other key a manual file sets also wins at its own granularity (each top-level field such as `episodes` or `prequel`, each `titles.<lang>`); manual `aliases` are added to the seed's; a key set to `null` in a manual file removes the seed's value. Rationale: otherwise a manual fix to a seed's episode count or a wrong seed block could never land.
2. **Slugs** (decided by Xwolv). The base is the romaji title; on collision append `-<year>`, then `-<type>`, then `-a<anidb id>`, cumulatively (`x`, `x-2011`, `x-2011-ova`, `x-2011-ova-a1234`). The lower AniDB ID claims a contested slug first. Published slugs are never renamed: every assignment is kept in `data/seeds/slugs.jsonl`, including works that later leave the seeds, and reused on every run.
3. **Episode count authority** (decided by Xwolv). A seed work's `episodes` is cedya77's count for the entry that carries the AniDB source. Bounds violations are errors for works with a manual file and warnings for seed-only works.
4. **`coverage: partial`** (decided by Xwolv). A provider block may be written as an object `{ coverage: partial, notes, ranges }`; `notes` is required and gives the reason. It allows coverage to stop before the work's last episode. Without it, a mapping that stops early on a finished work stays an error. Leading and interior holes still need `gap: true`.
5. **Origin on every table** (decided by Xwolv). `sequences`, `sequence_members`, `groups`, `group_aliases` and `group_overrides` gain an `origin` column.
6. **`works.specials` has no default** (decided by Xwolv). NULL means unknown.
7. **TMDB rule** (decided by Xwolv). TMDB API responses never enter `data/` or the dumps. TMDB IDs and offsets sourced from Anime-Lists are allowed.
8. **API section reflects what was built** (decided by Xwolv): `CourmapError` codes, ambiguity on shared refs, `episode_to`, `work:` and `absolute:` refs, `:sN` scope rules, id-only targets, partial success as `status: "unmapped"`. The HTTP status for `ambiguous` is 409 (our choice; the spec named only 400 and 404).
9. **Several absolute sequences per work** (decided by Xwolv). When a work belongs to more than one, exactly one of its memberships is `default: true`, and the `absolute` target uses it. A group override with `numbering: absolute` may name another sequence with `sequence:`.
10. **Ref syntax is our own** (decided by Xwolv). anibridge-mappings uses the same `s{n}` season scope, but scopes AniDB refs by episode type, splits IMDb into `imdb_movie`/`imdb_show`, always requires a season scope on show providers and has no Kitsu. We keep our syntax, and the spec no longer claims it matches.
11. **No fictional group in data/** (decided by Xwolv). `data/groups/examplesubs.yaml` is deleted; test fixtures keep their own fake groups.
12. **Seeds are sharded JSONL** (decided by Xwolv) under `data/seeds/` (`works-000.jsonl`, ...), each shard kept to a few MB, never one YAML file per seeded work. Hand-written mappings stay YAML in `data/works/`.
13. **README banner is `assets/banner.png`** (decided by Xwolv). Dan is adding `assets/logo.png` and `assets/banner.png`; until then the README image link is broken on purpose.

## Seeds and merge (builder)

- **Override files need only `id`.** The work schema now requires just `id`; `type` and `episodes` are checked after the merge (`missing-field`), so a manual file over a seed can be a single block. Rationale: decision 1 makes short override files the normal way to fix a seed.
- **`null` removes a seed value** for `ids.<provider>` and `projections.<provider>`; on a work with no seed it is a no-op. Rationale: some seed data is wrong with nothing correct to replace it, and a seed run must never turn a no-op into an error.
- **Seed lines use the work schema plus a separate `origin` check** (`seed-origin`). `manual` is not a valid seed origin. Rationale: one format to maintain; origins are seed-only metadata.
- **Diagnostics carry a severity,** and name the work and, for conflicts, the other side (`related`). Warnings never fail validation; the CLI lists errors and counts warnings by code (`--warnings` lists them). Rationale: thousands of seed-only works may have count disagreements, and the seed job needs to know exactly which part to drop.
- **Round-trip diagnostics point at the failing part** (`projections.<provider>`, `ids.<provider>` or `sequences`). Rationale: the seed job drops parts, not whole works.
- **A to hub to B to hub to A runs for manual works and works with splits or merges only.** Hub round trips still run for every work. Rationale: for one-to-one rows the pairwise check cannot fail when every hub round trip passes, and it would multiply the cost on the full seed set.
- **Expected row counts come from the merged sources** (formerly "from the YAML"). Rationale: compiled rows now come from manual files and seeds together.

## Seed importer (packages/seed)

- **Only cedya77 entries with exactly one AniDB source are seeded.** Entries with two AniDB IDs (cedya77 merged two AniDB works) are skipped and logged. Rationale: the AniDB ID is the join key and the canonical grain.
- **Unknown cedya77 values are not guessed.** Type UNKNOWN skips the entry; status UNKNOWN leaves `status` unset (it then reads as finished) and is logged; two or more IDs for one provider drop that provider's ID. Rationale: never guess; every case is in `conflicts.jsonl`.
- **Anime-Lists precedence:** default season and offset, then range mappings, then explicit per-episode lists, later winning per episode. Rationale: that is how HAMA and Kometa read the file.
- **Season 0 with an empty offset is an ID, not a mapping.** `defaulttvdbseason="0"` (or `tmdbseason="0"`) with no offset means "a special of this show, episode not given". An explicit `0` offset maps; an empty offset on any other season is offset 0. Rationale: reading it as S00E01 put every movie of a franchise on the same episode (over 11,000 false conflicts in the first run).
- **Range mappings:** a start with no end is open-ended; neither start nor end covers every episode; an open-ended specials range is skipped (specials counts are unknown). Rationale: matches the 3 offset-only mappings in the file and keeps specials bounded.
- **The seed job repairs, never fails.** After rendering, it runs the builder's checks and round trips on seeds plus manual files, and drops exactly the failing seed part: the conflicting rows for landing overlaps (a special before a regular episode, both seed sides otherwise), the ID for duplicate IDs, the block for other block errors, the work for work-level errors. Manual parts are never dropped; an error in a manual file stops the run. Rationale: decision 3 makes only bounds a warning, so a weekly seed PR must not turn CI red.
- **Shards are chosen by FNV-1a hash of the slug, mod 16;** lines within a shard are sorted by slug. Rationale: adding or removing a work rewrites one shard, keeping weekly seed diffs reviewable.
- **Em dashes in upstream titles become hyphens** (172 strings in cedya77 2026-42), counted in `manifest.json`. Rationale: the no-em-dash rule covers all of `data/`, and normalized matching is unaffected.
- **Output has no timestamps.** `manifest.json` records pins, checksums and counts only. Rationale: reruns with the same pins must be byte-identical.
- **Pins are exact and checked.** The Anime-Lists pin must be a full commit SHA, and a cached or downloaded file whose checksum differs from the manifest for the same pin is an error. Downloads are cached in `.cache/seed/` (gitignored), from an allowlist of GitHub hosts only. Rationale: reproducibility, and a guard against calling any other API.
- **`@courmap/seed` is private.** Rationale: it is repo tooling, not a library others install.

## Static shards and remote mode

- **Work-keyed indexes added to the dump** (`idx_proj_work`, `idx_alias_work`, `idx_members_work`). Rationale: the spec's indexes all lead with provider or normalized text, so reading one work scanned every alias row (16 ms per lookup on the seeded dump; shard generation took over 4 minutes, now 5 seconds).

# Decisions

Choices made where `docs/SPEC.md` was ambiguous, silent or seemed wrong. One entry per decision, with a one-line rationale. Newest entries at the bottom of each section.

## Repository and tooling

- **Brand asset names.** `assets/` holds `logo.svg` and `courmap-banner.png`, not the `logo.png` / `banner.png` the spec names; the README uses `courmap-banner.png`. Rationale: use the files that exist and leave renaming to the asset owner.
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
- **`gap: true` marks the hole before an entry.** Leading and interior holes in regular coverage need it; a marker with no hole is an error; trailing holes (coverage ends before `episodes`) are always errors; specials have no coverage rule. Rationale: the spec says "no gaps unless marked" without saying where the mark goes.
- **`target` needs one side to be a single episode.** One canonical to many provider episodes, or many to one; `start` and `target` together are an error. Rationale: an N-to-M mapping with both sides larger than one has no defined per-episode answer.
- **No season means a seasonless ordering.** A projection entry without `season` describes an ordering with no seasons (for example TVDB absolute order). Refs into it take no `:sN` scope. Rationale: Anime-Lists uses this ordering (`defaulttvdbseason="a"`), and the SQL `season` column is already nullable.
- **Provider IDs that must be unique per work:** anidb, anilist, mal, kitsu and tmdb_movie. TVDB, TMDB TV and IMDb IDs may be shared across works. Rationale: split cours and sequels share one TVDB or TMDB show.
- **A work belongs to at most one absolute sequence.** Rationale: with two sequences the `absolute` target would have to pick one silently.
- **Target landings must not overlap,** within a work or across works sharing a show and season. Rationale: overlapping landings make the reverse lookup ambiguous, and catching them as a named error is clearer than a round-trip failure.

## Validation

- **Round trips probe sample episodes.** The probes are both ends of every range and their neighbours, plus 100 past the start of an open-ended range. Rationale: an exhaustive check on long-runners would be slow and adds nothing for linear ranges.
- **A many-to-one round trip may return a range.** A to hub to B to A passes when the answer is a range that contains the original episode. Rationale: merging two canonical episodes into one provider episode loses information by design.
- **Fixture expectations are exact.** Each broken fixture lists every diagnostic (code, file, line, message) it must produce, and nothing else. Rationale: this catches noisy follow-on errors as well as missing ones.

## Hand-mapped data (data/)

- **Seven real works, one fictional group.** Frieren (simple), Spy x Family parts 1 and 2 (split cour plus absolute sequence), Attack on Titan (specials), One Piece (long-runner, open-ended), Apothecary Diaries 1 and 2 (TVDB and TMDB disagree on the sequel). Every ID was checked against cedya77 release 2026-42 and Anime-Lists commit 996d6a8. Rationale: the step asks for real IDs only where verified.
- **The group override uses a fictional group** (`examplesubs`, marked placeholder). Rationale: neither seed documents real group numbering quirks, and a real group's behaviour must not be guessed.
- **Slugs come from the romaji title** (cedya77 main title), for example `shingeki-no-kyojin`. Rationale: stable and source-derived; English titles change between releases and regions.
- **Titles and aliases come only from cedya77 synonyms,** never from AniDB or the `<name>` elements in Anime-Lists. Rationale: the AniDB title license conflicts with ODbL.

## Compile (SQLite)

- **SQL is the spec's DDL verbatim, minus column comments.** Rationale: "using the schema in the spec"; deviations are proposed in the spec instead (see the end of this file).
- **Titles become aliases.** The `aliases` table holds the romaji, English and native titles plus `aliases:`, deduplicated, each with `normalized` from `normalizeTitle`. Rationale: the resolver matches against one index, and titles are the most common release names.
- **`normalized` strips filler words** (the, season, part, cour), using the same function the resolver will apply to parsed titles. Rationale: exact matches only work when both sides normalize identically.
- **`data_version` defaults to the ISO week of the build,** formatted `YYYY.WW` with a two-digit week (`2026.42`, `2026.05`). Rationale: matches the spec's example and the `data-YYYY.WW` release tags.
- **Expected row counts come from the YAML, not the records.** The compiler counts rows straight from the parsed files and compares them with the table counts, so a bug in record conversion cannot hide itself. Rationale: the step 3 check is "row counts match the YAML".
- **`specials` NULL means unknown,** even though the column has `DEFAULT 0`. Rationale: see the data format entry on `specials`; the compiler always writes the value explicitly.

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

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
13. **README banner is `assets/banner.png`** (decided by Xwolv). Xwolv provided `assets/logo.png` and `assets/banner.png`; both are committed and the README image works. (`assets/courmap-banner.png` is a byte-identical earlier copy.)

## Seeds and merge (builder)

- **Override files need only `id`.** The work schema now requires just `id`; `type` and `episodes` are checked after the merge (`missing-field`), so a manual file over a seed can be a single block. Rationale: decision 1 makes short override files the normal way to fix a seed.
- **`null` removes a seed value** for `ids.<provider>` and `projections.<provider>`; on a work with no seed it is a no-op. Rationale: some seed data is wrong with nothing correct to replace it, and a seed run must never turn a no-op into an error.
- **Seed lines use the work schema plus a separate `origin` check** (`seed-origin`). `manual` is not a valid seed origin. Rationale: one format to maintain; origins are seed-only metadata.
- **Diagnostics carry a severity,** and name the work and, for conflicts, the other side (`related`). Warnings never fail validation; the CLI lists errors and counts warnings by code (`--warnings` lists them). Rationale: thousands of seed-only works may have count disagreements, and the seed job needs to know exactly which part to drop.
- **Round-trip diagnostics point at the failing part** (`projections.<provider>`, `ids.<provider>` or `sequences`). Rationale: the seed job drops parts, not whole works.
- **A to hub to B to hub to A runs for manual works and works with splits or merges only.** Hub round trips still run for every work. Rationale: for one-to-one rows the pairwise check cannot fail when every hub round trip passes, and it would multiply the cost on the full seed set.
- **Expected row counts come from the merged sources** (formerly "from the YAML"). Rationale: compiled rows now come from manual files and seeds together.

## Seed importer (packages/seed)

- **Only cedya77 entries with exactly one AniDB source are seeded.** Entries with two AniDB IDs (cedya77 merged two AniDB works) are skipped and logged. Rationale: the AniDB ID is the join key and the canonical grain. *Superseded by Xwolv decision S3.9; entries with two AniDB IDs are still skipped.*
- **Unknown cedya77 values are not guessed.** Type UNKNOWN skips the entry; status UNKNOWN leaves `status` unset (it then reads as finished) and is logged; two or more IDs for one provider drop that provider's ID. Rationale: never guess; every case is in `conflicts.jsonl`.
- **Anime-Lists precedence:** default season and offset, then range mappings, then explicit per-episode lists, later winning per episode. Rationale: that is how HAMA and Kometa read the file.
- **Season 0 with an empty offset is an ID, not a mapping.** `defaulttvdbseason="0"` (or `tmdbseason="0"`) with no offset means "a special of this show, episode not given". An explicit `0` offset maps; an empty offset on any other season is offset 0. Rationale: reading it as S00E01 put every movie of a franchise on the same episode (over 11,000 false conflicts in the first run).
- **Range mappings:** a start with no end is open-ended; neither start nor end covers every episode; an open-ended specials range is skipped (specials counts are unknown). Rationale: matches the 3 offset-only mappings in the file and keeps specials bounded.
- **The seed job repairs, never fails.** After rendering, it runs the builder's checks and round trips on seeds plus manual files, and drops exactly the failing seed part: the conflicting rows for landing overlaps (a special before a regular episode, both seed sides otherwise), the ID for duplicate IDs, the block for other block errors, the work for work-level errors. Manual parts are never dropped; an error in a manual file stops the run. Rationale: decision 3 makes only bounds a warning, so a weekly seed PR must not turn CI red.
- **Shards are chosen by FNV-1a hash of the slug, mod 16;** lines within a shard are sorted by slug. Rationale: adding or removing a work rewrites one shard, keeping weekly seed diffs reviewable.
- **Em dashes in upstream titles become hyphens** (172 strings in cedya77 2026-42), counted in `manifest.json`. Rationale: the no-em-dash rule covers all of `data/`, and normalized matching is unaffected. *Superseded by Xwolv decision S3.3.*
- **Output has no timestamps.** `manifest.json` records pins, checksums and counts only. Rationale: reruns with the same pins must be byte-identical.
- **Pins are exact and checked.** The Anime-Lists pin must be a full commit SHA, and a cached or downloaded file whose checksum differs from the manifest for the same pin is an error. Downloads are cached in `.cache/seed/` (gitignored), from an allowlist of GitHub hosts only. Rationale: reproducibility, and a guard against calling any other API.
- **`@courmap/seed` is private.** Rationale: it is repo tooling, not a library others install.

## Static shards and remote mode

- **Work-keyed indexes added to the dump** (`idx_proj_work`, `idx_alias_work`, `idx_members_work`). Rationale: the spec's indexes all lead with provider or normalized text, so reading one work scanned every alias row (16 ms per lookup on the seeded dump; shard generation took over 4 minutes, now 5 seconds).
- **The shard generator reads the dump through `DumpDataset`,** the same code the offline client uses, and writes each record as returned. Rationale: offline and remote results cannot drift apart if one code path produces both.
- **Refs shards map each provider ID to a sorted list of work ids,** since TVDB, TMDB TV and IMDb IDs are shared. Rationale: lookup must see every candidate to report ambiguity.
- **IMDb refs are sharded by the digits after `tt`,** with the same floor(n / 1000) rule. Rationale: "first 2 chars" would put every IMDb ID in one `tt` shard.
- **`meta.json` carries `counts` and `dumps: null`** until the release workflow (step 8) fills in dump URLs. `aliases.json.zst` waits for step 7. Rationale: do not build ahead.
- **The remote client trusts `meta.json` for an hour** (configurable) and caches every other file by `data_version`, in memory and optionally on disk under `<cacheDir>/<data_version>/`; a 404 is cached as "no such record". `node:fs` is imported only when a disk cache is used. Rationale: the caching contract, and keeping the remote client loadable in the future Worker.
- **The generator refuses to replace a non-empty directory without `meta.json`.** Rationale: it deletes its output directory first, so a mistyped `--out` must not wipe unrelated files.

## Decided by Xwolv (2026-10-18, session 3)

Numbered as Xwolv numbered them for this session.

- **S3.0 The project owner is Xwolv** (decided by Xwolv). Every mention of the owner in the repo names Xwolv.
- **S3.1 Merge reading confirmed** (decided by Xwolv): any key a manual file sets wins, manual aliases are added to the seed's, and `null` removes a seed value, as implemented in session 2 (see decision 1 above).
- **S3.2 HTTP 409 for `ambiguous` is accepted** (decided by Xwolv). It is now the spec, not only our choice (see decision 8 above).
- **S3.3 Upstream text stays verbatim** (decided by Xwolv). `data/seeds/` keeps cedya77 titles and synonyms exactly as published, em dashes included, and is exempt from `pnpm check:dashes`. The rule still covers everything we author: code, comments, docs, commits, manual YAML and generated reports.
- **S3.5 One folding table for titles** (decided by Xwolv). `normalizeTitle` folds `×` (and its variants) to a spaced `x`, and turns stars, music notes, hearts, colons and the CJK and full-width punctuation NFKC leaves alone into word breaks, all from one table (`FOLD` in packages/core). The aliases index and the resolver use the same function.
- **Diacritic folding is Latin-only.** `normalizeTitle` strips U+0300 to U+036F (macrons, accents) instead of every combining mark. Rationale: stripping all marks also removed kana voicing marks, so ハ, バ and パ normalized alike (found while adding the S3.5 tests).
- **S3.8 Movies match by ID** (decided by Xwolv). For `type: movie`, a range past the episode count is informational (new severity `info`, counted, never a warning or error), and translate accepts part numbers past the count, so AniDB's movie parts can merge into one provider episode. The resolver matches movies on title and year, not on episode numbers.
- **S3.9 AniDB is optional** (decided by Xwolv). A work needs at least one of `anidb`, `anilist` or `mal` (`missing-anchor-id` otherwise). cedya77 entries without an AniDB source are seeded, keyed and slugged from the remaining anchors with the same rules; the last collision step uses `-al<anilist>` or `-m<mal>`.
- **Anchor details for S3.9.** AniDB-anchored entries are read first, and an entry without AniDB whose AniList or MAL ID is already taken is skipped as `offline-db-duplicate-ids`. An entry with several AniList (or MAL) IDs cannot be anchored by them. cedya77's `episodes: 0` becomes `null` for upcoming and airing works and is dropped otherwise. `slugs.jsonl` rows list every anchor ID, and conflict rows are keyed `anidb:69`, `anilist:21` or `mal:21`. Rationale: one identity per work, stable when cedya77 later adds an AniDB source.
- **S3.6 Derived prequels** (decided by Xwolv). Works sharing a `tvdb_show`, ordered by TVDB season then offset, form a prequel chain with `origin: derived` (`works.prequel_origin`). Manual prequels win; AniList relations from the bots will override derived ones.
- **S3.7 Derived absolute sequences** (decided by Xwolv). Works sharing a `tvdb_show` with consecutive regular projections form one sequence in TVDB order, `origin: derived`. A manual sequence for any of those works wins.
- **Derivation details for S3.6 and S3.7.** Season 0 (specials, OVAs, films filed as specials) and movies are left out of season order. "Consecutive" means the next work starts at the episode after the previous one's last TVDB episode, or at episode 1 of the next season. Every member must map its episodes 1 to N without holes; only a finished work can be followed, an airing work may end a run, and upcoming works never join (cedya77 gives them placeholder counts, which put Apothecary Diaries season 3 Part 2 at absolute 50 in the first attempt). When a run touches a manual sequence the whole run is skipped, since dropping one member would shift every later absolute number. Derived sequences are named `<first work>-absolute` (`-absolute-derived` if a manual sequence has that id); the name can change when an earlier work joins the chain, which is acceptable for derived data. The dump schema_version is 3 (`works.prequel_origin`).
- **S3.4 The resolver alias index** (decided by Xwolv). `aliases.json.zst` holds every alias, deduplicated by normalized form, each listing all works that use it. Normalized forms shorter than 3 characters are dropped; non-Latin scripts are kept. A shared alias splits its match weight across the works sharing it, and season token, episode fit and year break ties.
- **One alias index in every mode.** `buildAliasIndex` (core) builds it from the dump's `aliases` table offline, from the records in memory, and the shard generator writes the same thing to `aliases.json.zst`, so resolve sees identical candidates everywhere. Length is counted in code points, so a two-character Japanese title is dropped like a two-letter Latin one. The SQLite `aliases` table keeps every alias (the filter applies to the index). `groups.json` carries every group for the remote resolver.

## Parser and resolve (build step 7)

- **The parser keeps special words in the title.** "Show Movie" parses as title "Show Movie" with `special: movie`; resolve also tries the title without the word. Rationale: many real titles contain Movie or OVA ("Spy x Family Movie: Code: White"), and the parser cannot tell them apart.
- **A season token is read as a TVDB season before the canonical number** (spec step 4 reordered). Rationale: for a long-runner, S02E70 is canonical 120, not 70; for single-season works the answer is the same either way. Part and cour tokens are not TVDB seasons and skip this.
- **Scoring is evidence times share.** Evidence is season fit times episode fit times year fit (0.05 for a disagreeing tie-breaker); confidence is similarity times evidence times the work's share of evidence among the alias sharers. Rationale: it implements decision S3.4's split weight and tie-breakers, gives 1.0 for a unique exact match, and keeps a fuzzy or contested match below 0.85.
- **No season token reads as the first season.** A sequel matched without a season token gets the 0.05 season penalty. Rationale: cedya77 gives sequels the franchise name as a synonym ("Spy x Family" is shared by four works), and releases of sequels almost always carry a season token.
- **A third status, `unmatched`,** for names with no candidate at all. Rationale: "ambiguous" with an empty candidate list would read as a near miss.
- **Group history is not scored yet.** Rationale: there is no group history data; the field can join the evidence product later.
- **`search(query)` is part of the client** (exact alias hits, then trigram matches). Rationale: it is in the spec's API table and uses the same alias index as resolve.
- **The corpus runs on the real merged data,** plus a `dataset: conformance` option for branches the real data has no example of (group overrides). Rationale: release names map to real works; the fixture covers what data/ cannot yet.
- **The pass-rate gate compares against a committed baseline,** `tests/releases.baseline.json`, updated with `pnpm corpus --update-baseline`. A second, absolute gate fails CI whenever a case expected to be ambiguous or unmatched returns ok. Rationale: "never decreasing" needs a reference point, and the ambiguity rule must not be traded for pass rate.
- **Failing hand-written cases stay in the corpus.** Kimi no Na wa (2016) is expected ok and currently ambiguous. Rationale: recording today's answer as the expectation would hide a known weakness.
- **Imported cases record today's answer as their expectation, unverified.** Rationale: a person checks each one; until then it does not count.

## Decided by Xwolv (2026-10-18, session 4)

Numbered S4.1 to S4.7, in the order Xwolv gave them.

- **S4.1 AniList relations** (decided by Xwolv). Only `PREQUEL` and `SEQUEL` build prequel chains. Bot-sourced relations live in `data/seeds/relations.jsonl` with `origin: bot`. Precedence: manual over AniList, AniList over derived.
- **Relation line format.** `{"work", "prequel", "relation", "origin": "bot", "anilist": [work, prequel]}`, one line per work, keyed by slug with the AniList IDs kept for tracing; a `SEQUEL` edge is stored reversed as the sequel's prequel. A line naming an unknown work (or the work itself as prequel, or a second line for the same work) is a warning and is ignored; a malformed line (another relation type, another origin, unknown field) is an error. Rationale: seeds can drop a work between bot runs, and a seed PR must never fail because a relation went stale, while a malformed line is a bot bug worth stopping for.
- **S4.2 Derived data in the tiers** (decided by Xwolv). Any change to an existing sequence is at least tier B, and the PR diff lists every work whose absolute numbers shift. A change that shifts absolute numbers on a finished work is tier C.
- **What counts as a shift.** A work shifts when its absolute range (first and last absolute number) differs between the previous release's sequences and the new ones, or it leaves its sequence. Derived sequences are compared by member set as well as by id, since a derived name can change when an earlier work joins. Appending a member shifts no existing work. Rationale: the release diff is computed from compiled sequences, so manual and derived data are judged the same way.
- **S4.3 Alias quality** (decided by Xwolv). An alias shared by more than 5 works is flagged for review; one shared by more than 50 stays in the data but is excluded from resolver matching.
- **Where the bands apply.** Bands count normalized forms the index would hold (3 code points or more). Exclusion happens in `buildAliasIndex`, so it applies to resolve and search in every mode at once, while the SQLite `aliases` table and each work's `aliases` keep the alias. Flagged aliases are reported (`pnpm builder aliases`, the CI job summary and the bots' digest), not errors. First count on cedya77 2026-42: 205,972 unique, 6,883 shared by 2 to 5, 75 flagged, 2 excluded ("minna no uta", 1,034 works; "irodorimidori", 58). Rationale: one index feeds every mode, so one filter keeps results identical.

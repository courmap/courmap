# CLAUDE.md

Instructions for agents working in this repo. Start with `docs/HANDOFF.md` (where the build stands and what is next) and `docs/LAUNCH.md` (everything open before the public launch, with owners and checks; update it at the end of every session). `docs/SPEC.md` is the source of truth for scope, data model, layout, licensing and build order; read it before starting a new build step. Choices the spec left open, or where we deviated from it, are logged in `docs/DECISIONS.md`. Read that too, and add to it.

## Hard constraints

- Never call the AniDB HTTP or UDP API. Never redistribute AniDB titles (the AniDB title dump, or the `<name>` elements in Anime-Lists XML). AniDB IDs may be referenced as facts.
- AniList API calls are allowed only from `packages/bots` (season scanner, airing tracker), batched, respecting rate-limit headers. No other package may call AniList.
- TMDB API responses are used only in CI checks and never enter `data/` or any dump. TMDB IDs and offsets that come from Anime-Lists are allowed (they are Anime-Lists data, stored with `origin: anime-lists`).
- No AniList or TMDB API calls outside the packages the spec names (bots for AniList, CI checks for TMDB). The seed job downloads only the two seed datasets from GitHub.
- Never guess a provider ID. Use real IDs only when verified from the seed datasets (cedya77/anime-offline-database, Anime-Lists/anime-lists). Otherwise use clearly fake placeholder IDs and add `notes: placeholder IDs, verify before release` to the file.
- No em dashes (U+2014) in anything we author: code, comments, docs, commit messages, manual YAML, generated reports. `pnpm check:dashes` enforces this for files (it skips `data/seeds/`, which keeps upstream titles verbatim); check commit messages yourself.
- No secrets in committed files. `GITHUB_DISPATCH_TOKEN` is a Worker secret managed in the Cloudflare dashboard; never put it in `wrangler.toml` or anywhere else in the repo. `pnpm check:tokens` fails on anything shaped like a GitHub token.
- Licensing: code is Apache-2.0 (`LICENSE`); `data/` and every dump are ODbL 1.0 + DbCL 1.0 (`DATA_LICENSE`). Credit upstreams in `ATTRIBUTION.md`.

## Working agreements

- A build step is done when its CI check from the spec passes, not when the code looks right. Run `pnpm check` before pushing.
- Small, reviewable commits: one logical change each, clear message.
- If the spec is ambiguous or seems wrong, make the most reasonable choice, add a one-line entry with rationale to `docs/DECISIONS.md`, and keep going. Stop and ask only for decisions that are hard to reverse (published slugs, schema shapes already in a release, licensing).
- Do not build ahead of the current step. Leave clean extension points instead.

## Stack and layout

- TypeScript on Node 22 LTS or later, pnpm workspaces, Vitest, strict tsconfig, ESM only. SQLite via `better-sqlite3`.
- Workspace packages export TypeScript source under the `@courmap/source` export condition. `tsx`, Vitest and `tsc` (via `customConditions`) all use it, so nothing needs building for dev, tests or CI. `pnpm build` emits `dist/` for publishing.
- Imports between files use `.js` extensions (NodeNext resolution).
- `schema/*.schema.json` is the source of truth for the YAML formats. `packages/core/src/generated/` is generated from it by `pnpm gen:types`; never hand-edit it. CI fails if it is stale.
- Translation logic lives once, in `packages/core/src/engine.ts`, over the async `Dataset` interface. The builder (in-memory, for round-trip checks), the offline client (SQLite, via `DumpDataset` in core) and the remote client (static shards) are just `Dataset` implementations, which is what keeps results identical across modes. The shard generator writes exactly what `DumpDataset` returns.
- `tests/conformance/` holds language-neutral cases and a fixture dataset; every client implementation must pass them.

## Commands

```sh
pnpm install
pnpm validate                 # schema, merge, overlap, bounds, reference and round-trip checks on data/
pnpm fixtures:expect <name>   # record a reviewed validate fixture's diagnostics
pnpm compile --out out/courmap.sqlite
pnpm builder shards --from out/courmap.sqlite --out out/shards/v1
pnpm seed                     # rebuild data/seeds/ from the pins in its manifest (--latest for new pins, --verify to check reproducibility)
pnpm test                     # unit tests, broken-fixture tests, conformance suite
pnpm corpus                   # resolver corpus pass rate vs tests/releases.baseline.json (--update-baseline after an improvement)
pnpm corpus:import <file>     # add release names from a text file as unverified corpus cases
pnpm corpus:from-proxy <export.json>   # add a proxy's unresolved and assisted names as unverified corpus cases
pnpm builder aliases          # alias quality bands (shared by more than 5 works flagged, more than 50 excluded)
pnpm bots scan                # season scanner, airing tracker, classifier; prints only (--apply opens PRs and issues)
pnpm release assets --dump out/courmap.sqlite --out out/release   # release assets and SHA256SUMS
node packages/proxy/scripts/bundle.mjs dev   # the Sonarr proxy as one file (the Docker image runs it)
pnpm check                    # everything CI runs
```

## Data conventions

- One YAML file per hand-written work in `data/works/`, per absolute sequence in `data/sequences/`, per release group in `data/groups/`. File name equals `id`.
- Seeded works are sharded JSONL in `data/seeds/` (generated by `packages/seed`, never hand-edited). A YAML file with the same id overrides its seed line part by part (manual wins per `ids.<provider>` key and `projections.<provider>` block; `null` removes a seed value). To fix a seeded work, add a short override file rather than copying the whole seed line.
- Slugs are lowercase kebab-case, derived from the romaji title, and stable forever once published (`data/seeds/slugs.jsonl` records every assignment). Collision rules are in docs/SPEC.md, "Seeds and manual files".
- Non-obvious mappings carry `sources:` URLs. Titles and aliases come from the cedya77 dataset (ODbL), never from AniDB.

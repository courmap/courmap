# CLAUDE.md

Instructions for agents working in this repo. `docs/SPEC.md` is the source of truth for scope, data model, layout, licensing and build order; read it before starting a new build step. Choices the spec left open, or where we deviated from it, are logged in `docs/DECISIONS.md`. Read that too, and add to it.

## Hard constraints

- Never call the AniDB HTTP or UDP API. Never redistribute AniDB titles (the AniDB title dump, or the `<name>` elements in Anime-Lists XML). AniDB IDs may be referenced as facts.
- AniList API calls are allowed only from `packages/bots` (season scanner, airing tracker), batched, respecting rate-limit headers. No other package may call AniList.
- TMDB data is used only in CI checks. It is never written to `data/` or to any dump.
- Never guess a provider ID. Use real IDs only when verified from the seed datasets (cedya77/anime-offline-database, Anime-Lists/anime-lists). Otherwise use clearly fake placeholder IDs and add `notes: placeholder IDs, verify before release` to the file.
- No em dashes (U+2014) anywhere: code, comments, docs, commit messages, generated text. `pnpm check:dashes` enforces this for files; check commit messages yourself.
- Licensing: code is Apache-2.0 (`LICENSE`); `data/` and every dump are ODbL 1.0 + DbCL 1.0 (`DATA_LICENSE`). Credit upstreams in `ATTRIBUTION.md`.

## Working agreements

- A build step is done when its CI check from the spec passes, not when the code looks right. Run `pnpm ci` before pushing.
- Small, reviewable commits: one logical change each, clear message.
- If the spec is ambiguous or seems wrong, make the most reasonable choice, add a one-line entry with rationale to `docs/DECISIONS.md`, and keep going. Stop and ask only for decisions that are hard to reverse (published slugs, schema shapes already in a release, licensing).
- Do not build ahead of the current step. Leave clean extension points instead.

## Stack and layout

- TypeScript on Node 22 LTS or later, pnpm workspaces, Vitest, strict tsconfig, ESM only. SQLite via `better-sqlite3`.
- Workspace packages export TypeScript source under the `@courmap/source` export condition. `tsx`, Vitest and `tsc` (via `customConditions`) all use it, so nothing needs building for dev, tests or CI. `pnpm build` emits `dist/` for publishing.
- Imports between files use `.js` extensions (NodeNext resolution).
- `schema/*.schema.json` is the source of truth for the YAML formats. `packages/core/src/generated/` is generated from it by `pnpm gen:types`; never hand-edit it. CI fails if it is stale.
- Translation logic lives once, in `packages/core/src/engine.ts`, over the async `Dataset` interface. The builder (in-memory, for round-trip checks), the offline client (SQLite) and the future remote client (shards) are just `Dataset` implementations, which is what keeps results identical across modes.
- `tests/conformance/` holds language-neutral cases and a fixture dataset; every client implementation must pass them.

## Commands

```sh
pnpm install
pnpm validate                 # schema, overlap, bounds, reference and round-trip checks on data/
pnpm compile --out out/courmap.sqlite
pnpm test                     # unit tests, broken-fixture tests, conformance suite
pnpm ci                       # everything CI runs
```

## Data conventions

- One YAML file per work in `data/works/`, per absolute sequence in `data/sequences/`, per release group in `data/groups/`. File name equals `id`.
- Slugs are lowercase kebab-case, derived from the romaji title, and stable forever once published.
- Non-obvious mappings carry `sources:` URLs. Titles and aliases come from the cedya77 dataset (ODbL), never from AniDB.

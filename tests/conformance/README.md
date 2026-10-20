# Conformance suite

Language-neutral cases that every Courmap client must pass, in every mode (offline SQLite dump, remote shards). A port to another language is conformant when it passes all of them.

## Layout

- `data/`: a small fixture dataset with fake IDs, laid out like the repo's `data/`. It covers a simple show, a split cour sharing one TVDB season, specials, one-to-many and many-to-one episode splits, an open-ended long-runner, an airing show whose recorded count lags its open-ended mapping, a one-episode special, a seasonless (absolute order) projection, a movie, a movie AniDB splits into parts, a TV work and an OVA sharing a title (resolver tie-breakers), a remake whose prequel comes only from `seeds/relations/` (an AniList relation, `prequel_origin: bot`), and two absolute sequences sharing one work (one marked default).
- `cases/*.yaml`: the cases, grouped by operation.
- `shards.yaml`: the alias index layout a port must produce and read: prefix shard keys, trigram set buckets and one whole shard file from the fixture (docs/SPEC.md, `/v1/aliases/`). Resolve and search read aliases only through these shards in every mode, so a port that builds them differently gets different candidates.

## Building the fixture dump

```sh
pnpm builder compile --data tests/conformance/data --out out/conformance.sqlite \
  --data-version conformance --built-at 2026-01-01T00:00:00.000Z
```

Every `expect` assumes `data_version: conformance`.

## Case format

Each file has a `cases:` list. Every case has a `name` and an `op`:

- `op: lookup` takes `ref`.
- `op: translate` takes `ref`, `episode` (number or string such as `"S1"`) and `targets` (list).
- `op: resolve` takes `release` (a release name) and optionally `posted_at` (a date) and `now` (default: the same day, so the release is recent; the release then counts as seen that day, so a recent release favors works on air now over older works with the same title) and uses `expect_resolve` instead of `expect`: `status` must match, and any of `work`, `episode`, `episode_to`, `confidence` (three decimals), `version` (parsed), `batch_length` and `top` (the first candidates' works, in any order) that are given must match. Reasons are free text and not compared.

Then exactly one of:

- `expect`: the full result, compared by deep equality. The `absolute` target always answers in the work's default sequence. Object key order does not matter. Array order does: projections are ordered by kind, then `ep_from`; sequences by sequence id, then `ep_from`; aliases as stored (titles first, then aliases).
- `expect_id`: for `lookup`, only the returned work's `id` is checked.
- `error`: the call must fail. `code` must match (`not_found`, `ambiguous`, `invalid_input`). If `field` is given it must match; if `candidates` is given it must match exactly, in order (sorted by work id). Messages are free text and not compared.

Absent values are `null` in results (for example `titles.native`, `specials`, `prequel`), except in translate results, where optional fields (`season`, `episode_to`, `kind`) are omitted rather than null.

## Runners

- TypeScript: `packages/client/test/conformance.test.ts`, run by `pnpm test`. It runs every case in three modes: offline (the SQLite dump), remote (shards generated from that dump with `pnpm builder shards`, served over HTTP from a local server) and the builder's in-memory dataset.

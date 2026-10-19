# Handoff

Where the build stands, for the next session. Read CLAUDE.md, docs/SPEC.md and docs/DECISIONS.md first, as always; this file only says what is done and what is next. Update it at the end of every session.

Last updated 2026-10-19, end of session 4.

## Done

- Build steps 1 to 8 are complete and green in CI. Step 8's check runs on every push: the shard upload goes end to end against S3Mock (`adobe/s3mock:5.2.3`, a service container in `validate.yml`).
- Session 4 decisions S4.1 to S4.7 from Xwolv are applied, with spec text and DECISIONS.md entries:
  - S4.1 AniList relations in `data/seeds/relations.jsonl` (manual over AniList over derived).
  - S4.2 sequence changes are tier B, shifts on finished works tier C (`packages/bots/src/shifts.ts`).
  - S4.3 alias bands: 205,972 unique, 6,883 shared by 2 to 5, 75 flagged (6 to 50), 2 excluded (over 50). `pnpm builder aliases`.
  - S4.4 title-rank and type tie-breakers; Kimi no Na wa resolves; corpus 34/34.
  - S4.5 no FTS5 table: the dump is 74.7 MB raw, 21.8 MB gzipped (was 115.6 and 38.3). Dump schema 4.
  - S4.6 domains in `packages/core/src/site.ts`.
  - S4.7 the client bundles for the browser (`@courmap/client/remote`); `packages/client/test/browser-bundle.test.ts` proves it.
- `.github/workflows/release.yml` (weekly, Tuesdays 09:00 UTC, plus dispatch). Dry run until all four R2 secrets exist. `pnpm release meta` fills `meta.json` `dumps`.
- Step 9 is built and running in dry-run mode: `packages/bots` and `.github/workflows/bots.yml`. The scan runs daily at 07:30 UTC; the projection checker and digest run Tuesdays at 10:00 UTC. Bots open PRs and issues but never merge. Bot data lives in `data/seeds/airing.jsonl` and `data/seeds/relations.jsonl`; the builder applies both (manual wins per key).

## First bot dry run (local, print only, 2026-10-19)

- 12 AniList requests. Fall 2026: 111 shows, Winter 2027: 65 (music videos excluded).
- 66 tier A (39 finished, 27 count updates), 76 tier B (71 sequels, 5 sequence changes), 29 tier C (14 count conflicts, 10 projection-short, 3 missing IDs, 2 relation conflicts).
- 13 shows are not in the data yet (11 upcoming OVAs, 2 ONAs waiting for cedya77).
- The scheduled run opens at most 2 airing PRs, 10 sequel PRs and 15 issues a day, plus the two Season tracker issues.

## Next

1. **Check the first scheduled runs** (needs Xwolv or an admin token: my account cannot dispatch workflows or list secrets):
   - bots scan, 2026-10-19 07:30 UTC. Review what it opened. Step 9's check is "zero tier A PRs a reviewer would have rejected" over one full season.
   - seed, 2026-10-20 06:00 UTC. Its new "Check the PR token" step prints whether `SEED_PR_TOKEN` authenticates. This is the confirmation Xwolv asked for, and it has not happened yet.
   - release, 2026-10-20 09:00 UTC. The "Live or dry run" step names any missing R2 secrets.
2. **Tune the bots from real runs.** Likely candidates: the sequel PR cap, issue volume, and whether `projection-short` should wait some days after premiere before opening an issue.
3. **Step 10, the Sonarr proxy.** Do not start until the spec questions under "Before step 10" below are settled with Xwolv.

## Known gaps and notes

- **Not built from the detector table:** the seed differ and Anime-Lists differ as separate bots (the seed job's PR report covers the diff), unresolved-name reports (they need a place to receive reports, see below) and the monthly heartbeat job.
- **Tier A cannot close open ranges.** A finished work with an open-ended projection becomes tier B, because seed projections are not the bots' to rewrite.
- **The validate PR comment has no full translation diff yet.** Bot PR bodies list prequel and absolute-sequence changes; episode-level before/after on every PR (spec, "Validation CI") is still open.
- **Commit hygiene.** The resolver's "movie with an episode number" penalty landed inside the corpus commit (7454e60) rather than its own commit.
- **Local S3Mock on Docker Desktop for Windows is slow** (about 30 minutes for the 36,179-file tree). In CI it is quick; R2 timing is unknown until the secrets exist.

## Before step 10 (spec questions for Xwolv)

- Output numbering: rewrite to TVDB `SxxEyy` from `tvdb_show` projections, and also set the Torznab `tvdbid` attribute so Sonarr matches the series by ID, not by title (we have no TVDB titles).
- Ambiguous or unmatched names: pass the release through unchanged, so Sonarr behaves exactly as it does today.
- Batches: a season pack (`S01`) or a multi-episode range.
- Data mode: the offline dump, refreshed from `meta.json` `dumps` with SHA-256 checks.
- Unresolved reports need a receiver: the Worker at `api.courmap.com` with storage, or GitHub issues. Either way it is new spec.
- Resolver: the sequel penalty (no season token on a sequel) bites once AniList relations land. Doraemon (2005) gets Doraemon (1979) as its prequel. Proposal: apply the penalty only when the matched alias is shared with an earlier work in the chain.

## What Xwolv needs to provide

- **Dispatch `seed.yml` and `release.yml` once,** or let Tuesday's schedule run them, then read the token check and the dry-run notice.
- **`SEED_PR_TOKEN` scopes:** the bots use it too, so it needs Contents, Pull requests and Issues (read and write).
- **R2:** the four secrets; the custom domain `data.courmap.com` on the bucket; a CORS rule allowing `GET` and `HEAD` from any origin.
- **Optional secrets:** `TMDB_API_KEY` (the projection checker is skipped without it), `NTFY_URL`, `DISCORD_WEBHOOK_URL`.
- **Release-name export** for `pnpm corpus:import <file>`: UTF-8, one name per line.

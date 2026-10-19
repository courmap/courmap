# Handoff

Where the build stands, for the next session. Read CLAUDE.md, docs/SPEC.md and docs/DECISIONS.md first, as always; this file only says what is done and what is next. Update it at the end of every session.

Last updated 2026-10-19, end of session 5.

## Done

- **Build steps 1 to 9** are built and green in CI. Step 9 (bots) runs in dry-run mode on its schedule: the scan daily at 07:30 UTC, the weekly jobs on Tuesdays.
- **Session 5 decisions S5.1 to S5.3** are applied:
  - S5.1: the sequel penalty applies only to aliases shared with an earlier chain work. A trigram match counts as shared when an earlier work also matched by trigram.
  - S5.2: AniList prequels order chains only. Work records carry `prequel_origin`, and `continue_prequel` ignores bot prequels. Doraemon (2005) - 01 is a corpus case; `packages/bots/test/regressions.test.ts` checks it with the bots' relation applied.
  - S5.3: unresolved reports stay local.
- **The resolver also tries a parsed year as part of the alias** ("Doraemon (2005)"). The corpus is 35/35.
- **Step 10's code and its CI check are done.** `packages/proxy` is published by `.github/workflows/proxy.yml` as `ghcr.io/courmap/proxy:edge` for amd64 and arm64.
  - The end-to-end test (a Sonarr search for TVDB S01E17 of a split cour, answered by the absolute-numbered release, rewritten so Sonarr parses it) is in `packages/proxy/test/proxy.test.ts`.
  - DECISIONS.md, "Sonarr proxy", records what Sonarr's source says about matching.

## Next

1. **Step 10's real check:** Xwolv runs the image for a week of real RSS traffic with no wrong imports. Two things block that:
   - The GHCR package is private. It needs an admin to set `courmap/proxy` to public; until then pulls need a GitHub token.
   - There is no published dump yet: the release workflow is a dry run until the R2 secrets exist. Until then, run `pnpm compile --out courmap.sqlite` locally and mount it with `COURMAP_DUMP`.
2. **Read the first bot runs** when they happen. As of 02:34 UTC on 2026-10-19 no scheduled run (bots, seed, release) had fired yet, so nothing has been opened on GitHub. Review what they open, and check the seed job's "Check the PR token" step.
3. **When Xwolv's week finishes,** tag `proxy-v0.1.0` to publish `:0.1.0` and `:latest`, and log any misparsed release names as corpus cases.
4. **Then step 11 (Worker).** Settle the spec questions under "Before steps 11 and 12" first.

## Known gaps and notes

- **The proxy never sees Sonarr's own decision.** If a rewritten title still gets rejected, the cause is only visible in Sonarr's logs. A week of real traffic is the test for that.
- **Not built from the detector table:** the seed and Anime-Lists differs as separate bots, and the monthly heartbeat job.
- **Tier A cannot close open ranges.** A finished work with an open-ended projection becomes tier B.
- **No episode-level translation diff comment on PRs yet** (spec, "Validation CI").
- **Commit hygiene.** The resolver's "movie with an episode number" penalty landed inside the corpus commit (7454e60).

## Before steps 11 and 12 (spec questions for Xwolv)

- **Resolve on the free Worker is not feasible as specified.** Resolve needs the whole alias index (`aliases.json.zst`, 3.2 MB compressed, about 15 MB of JSON). Decompressing and parsing it exceeds the free plan's CPU time per request. The try-it box has the same cost in a phone browser. Proposal: shard the alias index (for example by the first characters of each normalized form, plus a small trigram shard set for fuzzy matching) so a resolve loads a few small files. That changes the static layout under `/v1/` and needs a spec decision.
- **Worker scope:** lookup and translate are cheap; resolve depends on the point above. Also decide the POST batch limits (500 and 100 in the spec) against CPU limits, CORS on `api.courmap.com`, and who holds the Cloudflare account token for deploys (an admin secret).
- **Docs site:** VitePress or Astro Starlight is still open. The Sonarr guide needs screenshots from Xwolv's install. The README badges (data version, coverage, corpus) need a published release first.

## What Xwolv needs to provide

- **Admin:**
  - Make the GHCR package `courmap/proxy` public.
  - Add the R2 secrets, the `data.courmap.com` custom domain and the CORS rule.
  - Dispatch `seed.yml`, `release.yml` and `bots.yml` once, if you don't want to wait for the schedule.
- **Optional secrets:** `TMDB_API_KEY`, `NTFY_URL`, `DISCORD_WEBHOOK_URL`.
- **The week of proxy traffic,** and any release names it gets wrong.
- **Release-name export** for `pnpm corpus:import <file>`.

# Handoff

Where the build stands, for the next session. Read CLAUDE.md, docs/SPEC.md and docs/DECISIONS.md first, as always; this file only says what is done and what is next. `docs/LAUNCH.md` lists everything open before the public launch. Update both at the end of every session.

Last updated 2026-10-19, end of session 7.

## Done

- All 12 build steps are built. Session 7 decisions S7.1 to S7.3 are applied, with spec text and DECISIONS.md entries.
- **S7.1, Sonarr-assisted numbering in the proxy** (`packages/proxy/src/assist.ts`).
  - The series is the one with the work's own TVDB ID, or else the single title-and-year match. Movies are never assisted.
  - A work with no prequel takes its own numbers in the first season, only when that is clearly the same work. A sequel takes Sonarr's absolute numbers, only when every prequel's count is known.
  - Assisted results are counted on the status page and offered as `data/works` overrides in the issue block.
  - The proxy serves `/export.json` and `/export.txt` for the corpus.
  - Fall 2026 estimate: 24 of 99 works lack a TVDB projection; 0 match by TVDB ID, 3 are ambiguous by title, 21 depend on the user's Sonarr having the show (`packages/proxy/scripts/assist-estimate.ts`).
- **S7.2, npm publishing.**
  - `@courmap/core`, `@courmap/parser` and `@courmap/client` are at 0.1.0.
  - `npm.yml` packs (`scripts/pack-npm.mjs`), verifies the tarballs in a clean project (`scripts/verify-npm.ts`: Node, strict types, browser bundle) and publishes with provenance on `client-v*` tags.
  - Dry run because `NPM_TOKEN` is missing.
- **S7.3, scheduled runs.**
  - The first scheduled scan never ran, and neither did any other scheduled run.
  - Crons are now off busy minutes, and a Worker watchdog (Cron Triggers) dispatches missed runs once `GITHUB_DISPATCH_TOKEN` is set as a Worker secret.
- **Bots fix:** a tier A update that adds a bounds warning is now a tier C conflict. PR #1 (merged by Xwolv) had lowered two works from 12 to 11 against their TVDB projections.
- **Part B:** `pnpm corpus:from-proxy` imports a proxy's export as unverified cases. CONTRIBUTING.md documents the loop.
- **Part C:** `docs/LAUNCH.md`.
- **Live since this session:** the docs site at courmap.pages.dev, and the Worker at `courmap.danrovito.workers.dev`. It has no data yet; data.courmap.com does not exist.

## Next

1. **Check the scheduled runs** (2026-10-20):
   - bots scan at 07:23 UTC;
   - seed at 06:17 (its "Check the PR token" step);
   - release at 09:13 (it will skip: `data-2026.43` exists on another commit);
   - weekly bots at 10:47.
   - If none fires, the cause is on GitHub's side or in org settings (the token used could not read org Actions policy); the Worker watchdog is the fallback once its token exists.
   - If the scan runs, confirm it updates issues #13 to #29 instead of duplicating them, and read its "could not label" or "could not pin" lines.
2. **R2:** the secrets exist, so the next release (`data-2026.44`, 2026-10-27) uploads the shards. data.courmap.com needs the domain (LAUNCH.md items 1 to 5). If Xwolv wants live data sooner, add a manual "sync R2 from an existing tag" option to `release.yml` (it must check out the tag, since `main` has moved), or use an `r2.dev` URL.
3. **When `NPM_TOKEN` exists:** push `client-v0.1.0` and check `npm view @courmap/client`.
4. **Proxy week exports:** run `pnpm corpus:from-proxy export.json`, then verify the cases with Xwolv.

## Known gaps and notes

- PR #1 put chitose-kun-wa-ramune-bin-no-naka-part-2 and dark-machine-the-animation at 11 episodes against TVDB projections of 12; Xwolv decides which is right.
- The deployed try-it box and Worker have no data until R2 and a public URL exist.
- Not built: the seed and Anime-Lists differs as separate bots, the monthly heartbeat, an episode-level translation diff comment on PRs, and closing open ranges in tier A.

## What Xwolv needs to provide

See `docs/LAUNCH.md`. In short:

- **Domain:** buy courmap.com, then set up the custom domains and the CORS rule on R2.
- **GHCR:** make the package public (still private at 17:40 UTC).
- **npm:** the `@courmap` org and `NPM_TOKEN`.
- **Watchdog:** `GITHUB_DISPATCH_TOKEN` as a Worker secret.
- **Proxy week:** exports from the status page.
- **Screenshots:** the six for the Sonarr guide.
- **Bot PRs:** decide the open ones and the two disputed counts.
- **Optional:** rename the `workers.dev` subdomain.

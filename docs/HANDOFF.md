# Handoff

Where the build stands, for the next session. Read CLAUDE.md, docs/SPEC.md and docs/DECISIONS.md first, as always; this file only says what is done and what is next. `docs/LAUNCH.md` lists everything open before the public launch. Update both at the end of every session.

Last updated 2026-10-19, after the maintenance session that followed session 8.

## Done

- All 12 build steps are built. Session 8 decisions S8.1 to S8.4 are in DECISIONS.md.
- **S8.1, the real domain.**
  - Everything points at courmap.com (docs), data.courmap.com (R2) and api.courmap.com (Worker); the old hosts are gone from every public file.
  - `wrangler.toml` turns `workers_dev` and `preview_urls` off and declares the custom domain.
  - `GITHUB_DISPATCH_TOKEN` stays a dashboard secret: `worker.yml` fails if a deploy loses it, and `pnpm check:tokens` fails CI on anything shaped like a GitHub token.
  - The Worker now answers HEAD.
- **S8.2, live data.** `release.yml` has a manual `tag` input (`r2-tag` job). data-2026.43 is on R2.
  - data.courmap.com serves it with open CORS.
  - The try-it box on courmap.com resolves names.
  - api.courmap.com/v1/resolve answers.
- **S8.3, bots.**
  - The first scheduled scan fired 7h22 late and stopped at issue #13 (`SEED_PR_TOKEN` cannot edit issues), while reporting success.
  - Issues now use the workflow's own token, and the scan step has `pipefail`.
- **S8.4, npm.**
  - `@courmap/core`, `parser` and `client` 0.1.0 are published with provenance and verified from the registry (Node, types, browser bundle).
  - `npm.yml` is ready for trusted publishing (npm 11.6.2, `NPM_TRUSTED_PUBLISHING` repository variable, token fallback, idempotent reruns, a post-publish registry check).
- **GHCR:** `ghcr.io/courmap/proxy` is public; an anonymous pull works.
- **Maintenance session (same day, 18:45 UTC):**
  - No scheduled run had happened yet, and no proxy exports were attached, so there was nothing to import.
  - Reviewing the 10 bot sequel PRs found two ways assisted numbering could import a wrong episode once those prequel links land:
    - a sequel that Sonarr keeps as its own series was offset by the prequel counts;
    - an airing prequel's growing count was summed.
  - Both are fixed with tests: the series must hold the chain's first work, and every prequel must have finished.
  - Applying all 10 links to a copy of the data changed none of 32 sample resolutions.
  - Fall 2026 TVDB coverage is 61 of 85 series (71.8%; TV 57 of 76). That is unchanged from session 7, because no data merged since. The tracker issue #28 is stale (12:48 UTC), because the 14:52 scan crashed before rewriting it.

## Next

1. **Check the 2026-10-20 schedules.**
   - The bots scan at 07:23 UTC: it should update issues #13 to #29 with the built-in token. Check the job summary and for "could not label" or "could not pin" lines.
   - Seed at 06:17, release at 09:13 (it computes data version 2026.43 again, finds that tag on another commit, warns and skips; data-2026.44 and its automatic R2 sync come on 2026-10-27), weekly bots at 10:47.
   - The watchdog triggers at 06:47, 07:53 and 09:43. Its result is only in the Cloudflare Worker logs; ask Xwolv, or add a small status record (for example a KV entry or a GitHub job summary) if it should be checkable from here.
2. **Trusted publishing:** once Xwolv has configured all three packages and set `NPM_TRUSTED_PUBLISHING`, the next `client-v*` tag proves it. Then tell Xwolv `NPM_TOKEN` can be deleted (LAUNCH.md item 11).
3. **Proxy week exports:** run `pnpm corpus:from-proxy export.json`, then verify the cases with Xwolv (LAUNCH.md item 16).
4. **After proxy week:** tag `proxy-v0.1.0` (LAUNCH.md item 12).

## Known gaps and notes

- chitose-kun-wa-ramune-bin-no-naka-part-2 and dark-machine-the-animation (11 vs 12 episodes) stay as tier C issues (Xwolv, session 8). The bounds guard files them on the next scan.
- 61 sequel PRs wait behind `--max-prs 10`; they arrive 10 per run as earlier ones are merged or closed.
- Not built: the seed and Anime-Lists differs as separate bots, the monthly heartbeat, an episode-level translation diff comment on PRs, and closing open ranges in tier A.

## What Xwolv needs to provide

See `docs/LAUNCH.md`. In short:

- **npm trusted publishing:** configure all three packages, then set the `NPM_TRUSTED_PUBLISHING` variable.
- **Proxy week:** exports from the status page.
- **Screenshots:** the six for the Sonarr guide.
- **Bot PRs and issues:** decide the 11 open PRs and 15 issues.
- **Testers:** find people for the fresh-eyes test.

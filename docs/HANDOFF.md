# Handoff

Where the build stands, for the next session. Read CLAUDE.md, docs/SPEC.md and docs/DECISIONS.md first, as always; this file only says what is done and what is next. `docs/LAUNCH.md` lists everything open before the public launch. Update both at the end of every session.

Last updated 2026-10-20, after the first-real-traffic session.

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

- **Bot PR review applied (same day, decided by Xwolv):**
  - #2 (minus the Koori line), #3 to #9, #11 and #12 merged as merge commits.
  - Merging them changed none of the 32 sample resolutions.
  - #10 closed and recorded in the new `data/rejected.yaml` (schema, `pnpm validate`, read by the classifier).
  - The airing tracker treats a 1 on an airing TV season as a placeholder.
  - A dry-run scan afterwards proposed neither #10's link nor a 1-episode Koori count.
- **Docs polish (same day):**
  - The Sonarr quick start was rewritten for first-time self-hosters.
  - The Prowlarr advice was wrong in three places (the guide, the quick start and the proxy README); all now say to tag what Sonarr should still get directly. Prowlarr's app tags only include, and it re-adds indexers deleted from Sonarr.
  - The home page has a title and an explanation under its table; logo alt text and concept links are in place.
- **Newznab (usenet) support in the proxy, issue #30** (code, tests, docs and DECISIONS.md done; Xwolv's own-Sonarr check pending):
  - `INDEXER_<NAME>_TYPE=torznab|newznab` (YAML `type:`); unset means learned from the feed's first results. Caps carry no protocol marker, so they pass through unchanged apart from the TV search.
  - The one real difference between the protocols is the attribute namespace Sonarr reads the `tvdbid` from (`newznab:attr` against `torznab:attr`). Confirmed on a real Sonarr 4.0.20: the old image's usenet results had `tvdbId` 0, the new image's 405920.
  - `packages/proxy/src/feed.ts` (was `torznab.ts`) holds the protocol-aware feed handling; `test/newznab.test.ts` has 19 tests including a mixed setup.
  - Docs: quick start (Torrent and Usenet tabs), guide, proxy README. LAUNCH.md item 20 is partly done.
  - Found on the way: the docs' "Spy x Family - 30" rewrite example was wrong (ambiguous in the data); it is now "- 17".
- **Duplicate-indexer guidance (Refs #30):** the docs used to tell users to set the Courmap copy to Categories 5070 and drop Prowlarr's copy, which removed regular TV searches for indexers that carry both.
  - Source and a real Prowlarr, Sonarr and proxy run (DECISIONS.md, "Duplicate-indexer guidance"): Prowlarr's Sonarr app has separate Sync Categories and Anime Sync Categories, which Full Sync overwrites on every sync; Sonarr searches standard series in Categories and anime series in Anime Categories.
  - New recommendation in the quick start (step 4), guide and proxy README: clear Anime Sync Categories in Prowlarr (Full Sync, no tags); Courmap copy with Categories empty, Anime Categories 5070, Indexer Priority 10; the tag method only for anime-only indexers like Nyaa, and both together when you have both kinds.
  - Why priority 10: Prowlarr expands the TV category to include anime, so its copy still returns anime releases in RSS, and at equal priority Sonarr grabbed the unrewritten one.
  - The screenshot for Prowlarr's Sonarr app (LAUNCH.md item 17) should show Show Advanced on and Anime Sync Categories cleared.
- **First real proxy traffic (2026-10-20, Refs #30).** Xwolv's export (two usenet indexers, about 550 items, 17 rewritten) led to:
  - **Secrets:** a Redactor masks every secret in logs, errors, the status page and the exports (`packages/proxy/src/redact.ts`); tests fail on any leak and were shown to fail without it. I could not reproduce a plain-text key in the startup log from the proxy's own code; a YAML config error that quotes the key's line was one real route.
  - **Upstream budget:** failure reasons (api-limit, auth, indexer-error, http, bad-response, timeout, network) and per-day request counts on the status page; a cache, an early stop and a cap (`UPSTREAM_CACHE_SECONDS`, `SEARCH_STOP_ON_MATCH`, `MAX_QUERIES_PER_SEARCH`). Measured with a real Sonarr: episode search 10 to 1 and 8 to 1 requests, anime season search 190 to 37. Retry-After on a 429 reaches Sonarr.
  - **Data:** the seed read the placeholder count 1 of an ongoing TV show as real and closed its TVDB mapping; 159 seed lines changed (count unknown, open-ended mapping), the engine and resolver accept an episode past an airing work's recorded count (`hasOpenRun`), and `resolve()` no longer throws on it. About 100 of the export's 201 unresolved items now resolve with a TVDB mapping.
  - **Parser:** glued hyphen episodes (Erai-raws), 第N话, season packs, `H.264`, LPCM, languages and streaming services.
  - **Corpus:** 35 to 62 verified; 7 unverified cases wait for Xwolv. His decisions on the open ones are in DECISIONS.md (title holder tie-break, TYBW continuous numbering through `bleach-tybw-absolute`, a recorded count is a floor for airing works); the same export now resolves 153 of its 201 unresolved items, 138 with a TVDB mapping.
  - **Docs:** Sonarr and Prowlarr behind a VPN container (gluetun), the API limit behavior.
  - Xwolv ticked #30's indexer-test box (both indexers test green on his Sonarr); the real-grab box stays open.

## Next

0. **Update the proxy.** Xwolv pulls the new `:edge` image (redaction, upstream limits, the data fixes) and looks at the status page: the Protocol column, the failure reasons, and the per-day request counts against his indexers' limits. An export a day later shows what else is unresolved.
1. **Newznab sign-off (issue #30).** Xwolv adds a Newznab indexer through the proxy in his own Sonarr (Settings, Indexers, Newznab, URL `http://<proxy>:9797/<name>`, categories 5070) and checks that it passes the test and that RSS and automatic searches return rewritten, correctly numbered results. When he confirms: tick the last two boxes in #30, mark LAUNCH.md item 20 done, and make that commit's message say `Closes #30` (until then every commit says `Refs #30`).
2. **Check the 2026-10-20 schedules.**
   - The bots scan at 07:23 UTC: it should update issues #13 to #29 with the built-in token. Check the job summary and for "could not label" or "could not pin" lines.
   - Seed at 06:17, release at 09:13 (it computes data version 2026.43 again, finds that tag on another commit, warns and skips; data-2026.44 and its automatic R2 sync come on 2026-10-27), weekly bots at 10:47.
   - The watchdog triggers at 06:47, 07:53 and 09:43. Its result is only in the Cloudflare Worker logs; ask Xwolv, or add a small status record (for example a KV entry or a GitHub job summary) if it should be checkable from here.
3. **Trusted publishing:** once Xwolv has configured all three packages and set `NPM_TRUSTED_PUBLISHING`, the next `client-v*` tag proves it. Then tell Xwolv `NPM_TOKEN` can be deleted (LAUNCH.md item 11).
4. **Proxy week exports:** run `pnpm corpus:from-proxy export.json`, then verify the cases with Xwolv (LAUNCH.md item 16).
5. **After proxy week:** tag `proxy-v0.1.0` (LAUNCH.md item 12).

## Known gaps and notes

- chitose-kun-wa-ramune-bin-no-naka-part-2 and dark-machine-the-animation (11 vs 12 episodes) stay as tier C issues (Xwolv, session 8). The bounds guard files them on the next scan.
- 61 sequel PRs wait behind `--max-prs 10`; they arrive 10 per run as earlier ones are merged or closed.
- Not built: the seed and Anime-Lists differs as separate bots, the monthly heartbeat, an episode-level translation diff comment on PRs, and closing open ranges in tier A.

## What Xwolv needs to provide

See `docs/LAUNCH.md`. In short:

- **npm trusted publishing:** configure all three packages, then set the `NPM_TRUSTED_PUBLISHING` variable.
- **Newznab check:** the last #30 box only his Sonarr can tick (a real grab imports correctly).
- **Confirm the 7 unverified corpus cases** (tests/releases.yaml, `verified: false`; the proposed answers are in each note): Cheng Ye Xiao He 13, Aikatsu! 1, Mao 24, three Bleach: Thousand-Year Blood War releases (S01E49 twice, absolute 35), and That's Enough, Dad (missing from the dataset, stays ambiguous until a later pin).
- **Proxy week:** exports from the status page.
- **Screenshots:** the six for the Sonarr guide.
- **Bot PRs and issues:** decide the 11 open PRs and 15 issues.
- **Testers:** find people for the fresh-eyes test.

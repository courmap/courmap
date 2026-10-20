# Launch checklist

Everything still open before the public launch post (r/sonarr, r/selfhosted, anime self-hosting Discords). Each item says who does it and how to check it is done. Claude Code updates this file at the end of every session; Xwolv ticks items off by saying so in the session prompt.

Last updated 2026-10-20, first-real-traffic session. Status: **not ready.** 10 of 20 items are done and 5 are partly done; what is left is mostly real-world use (proxy week, corpus, screenshots, testers).

Legend: [x] done, [ ] open, [~] partly done.

## Hosting and domains

1. [x] **Buy courmap.com** (Cloudflare Registrar). Who: Xwolv. Done by session 8.
   Verify: `dig +short NS courmap.com` names Cloudflare nameservers.
2. [x] **R2 bucket and its four secrets** (`R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`). Who: Xwolv. Done 2026-10-19.
   Verify: `gh secret list` shows all four.
3. [x] **First shard sync to R2.** Who: Claude Code. Done 2026-10-19: `release.yml` run by hand with `tag=data-2026.43` rebuilt the shards from the published dump, matched its meta.json byte for byte and uploaded 52,205 files, meta.json last. From now on the weekly release syncs automatically.
   Verify: `curl -s https://data.courmap.com/v1/meta.json | jq .data_version` prints the latest release's version.
4. [x] **CORS on the R2 bucket.** Who: Xwolv. Done by session 8.
   Verify: `curl -sI -H 'Origin: https://courmap.com' https://data.courmap.com/v1/meta.json | grep -i access-control-allow-origin` prints `*` (checked 2026-10-19).
5. [x] **Custom domains.** Who: Xwolv in Cloudflare; Claude Code switched the config in session 8.
   - `courmap.com` and `www.courmap.com` on the Pages project, `data.courmap.com` on the R2 bucket, `api.courmap.com` on the Worker.
   - Every URL in code, docs, READMEs, package.json files and workflows now uses them (`packages/core/src/site.ts`); `courmap.pages.dev` and the `workers.dev` address are no longer mentioned anywhere public.
   - Verify: `https://courmap.com/try/` resolves a release name in the browser (checked 2026-10-19: `[SubsPlease] Spy x Family - 17` gives `spy-x-family-part-2` episode 5, from 8 small files on data.courmap.com); `curl https://api.courmap.com/v1/meta` answers.
6. [x] **Docs site deployed** to Cloudflare Pages at `courmap.com`. Who: automatic (`docs.yml`).
   Verify: `https://courmap.com/` is the Courmap site.
7. [x] **Worker deployed** at `https://api.courmap.com` only. Who: automatic (`worker.yml`).
   - `wrangler.toml` sets `workers_dev = false`, `preview_urls = false` and the custom domain as a route, so deploys never re-enable the old addresses (the `workers.dev` URL answers 404).
   - Verify: `curl -s 'https://api.courmap.com/v1/resolve?release=%5BSubsPlease%5D%20Sousou%20no%20Frieren%20-%2005%20(1080p)'` returns `"status":"ok"` with `sousou-no-frieren` episode 5 (checked 2026-10-19). After each deploy `worker.yml` compares the live Worker with the library (`check-deployed.ts`).
8. [~] **Schedule watchdog token.** Who: Xwolv set it; Claude Code checks.
   - `GITHUB_DISPATCH_TOKEN` is an encrypted Worker secret managed in the Cloudflare dashboard. It is never in `wrangler.toml` or any committed file (`pnpm check:tokens` fails CI on anything shaped like a GitHub token), deploys keep it, and `worker.yml` fails if a deploy ever loses it (it was present after the 2026-10-19 deploy).
   - Open: its first trigger is 2026-10-20 07:53 UTC.
   - Verify: the Worker's logs (Workers & Pages, courmap, Logs) show `watchdog ... already-ran` or `dispatched` for that trigger; if it dispatched, `gh run list --workflow bots.yml --event workflow_dispatch` shows the run.

## Packages

9. [x] **Proxy image** `ghcr.io/courmap/proxy:edge` built for amd64 and arm64 on every change. Who: automatic (`proxy.yml`).
10. [x] **GHCR package public.** Who: Xwolv. Done by session 8.
    Verify: `DOCKER_CONFIG=$(mktemp -d) docker pull ghcr.io/courmap/proxy:edge` works with no credentials (checked 2026-10-19).
11. [~] **npm.** Who: Claude Code published; Xwolv sets up trusted publishing.
    - Done 2026-10-19: `@courmap/core`, `@courmap/parser` and `@courmap/client` 0.1.0 are on npm with provenance (tag `client-v0.1.0`), and install from the registry in a clean project for Node, strict types and a browser bundle (`scripts/verify-npm.ts --registry 0.1.0`).
    - Open: trusted publishing (OIDC). On npmjs.com, for each of the three packages: Settings, Trusted publishing, GitHub Actions, organization `courmap`, repository `courmap`, workflow `npm.yml`. Then set the repository variable `NPM_TRUSTED_PUBLISHING` to `true` (`gh variable set NPM_TRUSTED_PUBLISHING --body true`). `npm.yml` is ready for it and keeps `NPM_TOKEN` as a fallback.
    - **Once Xwolv confirms trusted publishing is set up on all three packages, the `NPM_TOKEN` secret can be deleted** (after the next release publishes with "Published with trusted publishing (OIDC)" in the log).
    - Verify: `npm view @courmap/client version` prints the newest version, and the npm page shows the provenance badge.
12. [ ] **Proxy 0.1.0.** Who: Claude Code, after item 14. Tag `proxy-v0.1.0`.
    Verify: `docker pull ghcr.io/courmap/proxy:0.1.0` and `:latest`.
20. [~] **Usenet (Newznab) support in the proxy:** [#30](https://github.com/courmap/courmap/issues/30). Who: Claude Code built it; Xwolv verifies on his own Sonarr.
    - Built: `INDEXER_<NAME>_TYPE=newznab|torznab` (detected from the feed's first results when unset), Newznab attributes written in the right namespace, caps and errors passed through, a new `:edge` image, and docs (quick start tabs for Torznab and Newznab, guide, proxy README).
    - Tested against a fake Newznab feed (19 tests) and by hand with a real Sonarr 4.0.20 and a fake usenet indexer: the indexer test passes, interactive search and RSS sync work, Sonarr reads the TVDB ID and size. Not tested against a live usenet indexer.
    - Verified on Xwolv's own Sonarr (2026-10-20): both Courmap indexers (NZBgeek and AniFix) pass Sonarr's indexer test. #30's "passes Sonarr's indexer test" box is ticked.
    - Open (Xwolv): a real grab through the proxy imports correctly, which also covers RSS and automatic searches returning rewritten, correctly numbered results. Then Claude Code ticks the last box in #30 and closes it.
    - Verify: every box under "Done when" in #30 is ticked, and #30 is closed by the commit that records Xwolv's confirmation.

## Data and quality

13. [~] **Scheduled bots actually fire.** Who: Claude Code checks.
    - The 2026-10-19 07:30 scan fired 7h22 late (14:52 UTC, run 39272913674, actor xwolvos). It updated the 12 bot PRs, then stopped at issue #13 because `SEED_PR_TOKEN` cannot edit issues, and still reported success. Both are fixed: issues use the workflow's own token, and the scan step fails when the scan fails (decision S8.3).
    - Every push to `main`, including the last change to each workflow file, came from xwolvos, so schedules run as an account with access.
    - Crons now avoid busy minutes (scan 07:23 daily; seed 06:17, release 09:13, weekly bots 10:47 on Tuesdays), with the Worker watchdog 30 minutes behind each.
    - No scheduled run has happened since session 8 (checked 2026-10-19 18:45 UTC); the first slots under the new crons are on 2026-10-20.
    - Verify: `gh run list --workflow bots.yml --event schedule` lists runs on consecutive days that update issues #13 to #29 instead of duplicating them, and seed and release show a `schedule` run on Tuesday 2026-10-20.
14. [ ] **A week of real proxy traffic with no wrong imports.** Who: Xwolv, on the Unraid server, since 2026-10-19.
    - First export received 2026-10-20 (two usenet indexers, about 550 items, 17 rewritten, 201 unresolved). It found a secret-logging risk, the stale-count problem for airing shows, and parser gaps; all fixed or recorded (DECISIONS.md, "First real traffic"). Xwolv updates his proxy to the new `:edge` image to get them.
    Verify: Sonarr's history for the week shows no anime episode imported as the wrong episode; the status page's export is imported with `pnpm corpus:from-proxy` (item 16).
15. [~] **Bot PRs and issues reviewed.** Who: Xwolv decides; Claude Code applies.
    - First batch done 2026-10-19 (decided by Xwolv): #2 (without the Koori no Jouheki 2nd Season line), #3 to #9, #11 and #12 merged; #10 closed and recorded in `data/rejected.yaml`, which the bots read so it is never proposed again. No bot PR is open.
    - Still open: 15 bot issues (#13 to #27) and the two season trackers. The next scan (2026-10-20) will open the next 10 of about 50 waiting sequel PRs and a status update for Koori no Jouheki 2nd Season, now with its count left unknown (a 1 on an airing TV season is a placeholder).
    - chitose-kun-wa-ramune-bin-no-naka-part-2 and dark-machine-the-animation (11 vs 12 episodes) stay as tier C issues for now (Xwolv, session 8).
    - Verify: no bot PR or `mapping-conflict` issue older than a week without a decision.
16. [ ] **Corpus large enough to trust.** Who: Xwolv supplies names (proxy exports); Claude Code imports and verifies them with Xwolv.
    - Proposed launch bar: at least 200 verified cases, most of them real names from the proxy, with a 95% pass rate. The M2 milestone remains 1,000.
    - Today: 62 verified cases, all passing, plus 7 unverified whose proposed answers Xwolv confirms (35 before the first proxy export, 2026-10-20).
    - Verify: `pnpm corpus` reports at least 200 verified at 95% or more.
17. [ ] **Screenshots in the Sonarr guide.** Who: Xwolv takes them; Claude Code places them. Six placeholders are in `site/src/content/docs/sonarr.mdx`:
    - Prowlarr indexers with the ID visible.
    - Prowlarr's Sonarr app dialog with Show Advanced on and **Anime Sync Categories** cleared (quick start step 4A).
    - Sonarr's Add Torznab dialog.
    - The status page after a day.
    - The Unraid Add Container form.
    - The "Copy as GitHub issue" block.
    - Verify: `grep -c "Screenshot to add:" site/src/content/docs/sonarr.mdx` prints 0.
18. [ ] **Fresh-eyes test on all three front doors** (Sonarr users, developers, contributors). Who: Xwolv finds testers who have never seen the project; Claude Code fixes every place they stall.
    - Verify: each tester reaches a working result in under five minutes (proxy resolving releases, a first `translate` result, a first PR passing CI), and every stall became a docs fix.
19. [x] **Docs, README and snippets.** Who: Claude Code. Done in session 6; re-verified in session 8 after the domain switch and the npm release (no page points at the old hosts or calls the packages unpublished).
    - Polished 2026-10-19:
      - The Sonarr quick start now stands alone: API keys, Prowlarr indexer IDs, one path per indexer, category 5070, shared networks, Unraid and Compose tabs, and what success looks like.
      - The Prowlarr sync advice is corrected: app tags only include, so tag what Sonarr should still get directly.
      - The home page has a real tab title and explains why the example's numbers differ.
      - Logo images have meaningful alt text.
      - Key terms link to their concept pages on first use.
    - The build, snippets and all 2,825 internal links and anchors check out.
    - Jackett tested end to end (2026-10-19: Jackett, Sonarr 4.0.20, the proxy image): the quick start has a "Not using Prowlarr?" section, and the guide and proxy README point to it.
    - Every page of the docs plan exists, and every snippet runs in CI (`pnpm snippets`).
    - The README badges read the `badges` branch.

## Also done

- [x] The first data release, `data-2026.43`, is published, marked latest and verified (session 6).
- [x] SEED_PR_TOKEN works for bot PRs (CI ran on all 12). Fine-grained tokens expire: Xwolv renews it before its expiry date. Who: Xwolv.
- [x] Assisted numbering and the corpus loop from proxy exports (session 7).
- [x] `pnpm check:tokens` in CI: no GitHub token can be committed (session 8).
- [x] Assisted numbering cannot import a wrong episode through a bot prequel link (maintenance session after session 8).
- [x] Duplicate-indexer guidance that keeps regular TV working (2026-10-19): for indexers with regular TV and anime, Prowlarr's copy keeps regular TV (Anime Sync Categories cleared, Full Sync, no tags) and the Courmap copy takes anime (Categories empty, Anime Categories 5070, Indexer Priority 10); the tag method is for anime-only indexers like Nyaa. Checked with real Prowlarr, Sonarr 4.0.20 and the proxy in Docker; not with a live torrent or usenet indexer (quick start step 4, decision in DECISIONS.md).

## Also done, 2026-10-20

- [x] No secret in any log line, page, export or error message; tests fail if one appears.
- [x] Fewer requests to usenet indexers (cache, early stop, a cap), with the reason for every upstream failure and per-day request counts on the status page; the API limit behavior is documented.
- [x] Airing shows with a placeholder or lagging episode count resolve and rewrite (seed, engine and resolver), and the parser reads Erai-raws, Chinese and season-pack names.
- [x] Docs for Sonarr and Prowlarr behind a VPN container.

## Launch post

When every item above is done: Xwolv posts. Claude Code can draft the post (what Courmap is, the try-it link, the proxy compose block, the docs) on request.

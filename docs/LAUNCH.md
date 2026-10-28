# Launch checklist

Everything still open before the public launch post (r/sonarr, r/selfhosted, anime self-hosting Discords). Each item says who does it and how to check it is done. Claude Code updates this file at the end of every session; Xwolv ticks items off by saying so in the session prompt.

Last updated 2026-10-28, at the start of the proxy week (item 14, running 2026-10-28 to 2026-11-04 on data 2026.44.1). Status: **not ready.** 17 of 20 items are done and one is partly done (14, in progress). The three open items (12, 14, 18) are all real-world use: the proxy week and its 0.1.0 tag, and fresh-eyes testers.

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
8. [x] **Schedule watchdog token.** Who: Xwolv set it; Claude Code checks. Done: Xwolv confirmed green `watchdog-report` runs since 2026-10-20 (checked 2026-10-27: all 11 runs in the list succeeded, the first on 2026-10-20 and the latest `watchdog scan: dispatched` on 2026-10-27).
   - `GITHUB_DISPATCH_TOKEN` is an encrypted Worker secret managed in the Cloudflare dashboard. It is never in `wrangler.toml` or any committed file (`pnpm check:tokens` fails CI on anything shaped like a GitHub token), deploys keep it, and `worker.yml` fails if a deploy ever loses it (it was present after the 2026-10-19 deploy).
   - Verify: `gh run list --workflow watchdog-report.yml` shows runs named `watchdog scan: dispatched` or `watchdog seed: already-ran`, all green.

## Packages

9. [x] **Proxy image** `ghcr.io/courmap/proxy:edge` built for amd64 and arm64 on every change. Who: automatic (`proxy.yml`).
10. [x] **GHCR package public.** Who: Xwolv. Done by session 8.
    Verify: `DOCKER_CONFIG=$(mktemp -d) docker pull ghcr.io/courmap/proxy:edge` works with no credentials (checked 2026-10-19).
11. [x] **npm.** Who: Claude Code published; Xwolv set up trusted publishing. Done: Xwolv confirmed trusted publishing is set up on all three packages.
    - Done 2026-10-19: `@courmap/core`, `@courmap/parser` and `@courmap/client` 0.1.0 are on npm with provenance (tag `client-v0.1.0`), and install from the registry in a clean project for Node, strict types and a browser bundle (`scripts/verify-npm.ts --registry 0.1.0`).
    - Trusted publishing (OIDC) is on for `@courmap/core`, `@courmap/parser` and `@courmap/client` (npmjs.com, GitHub Actions, organization `courmap`, repository `courmap`, workflow `npm.yml`), and the repository variable `NPM_TRUSTED_PUBLISHING` is `true`. The `client-v0.1.1` release (2026-10-26) published with "Published with trusted publishing (OIDC)" in its log.
    - **The `NPM_TOKEN` secret can now be deleted** (Xwolv does that). `npm.yml` keeps reading it as a fallback, so nothing else needs to change.
    - Verify: `npm view @courmap/client version` prints the newest version, and the npm page shows the provenance badge.
12. [ ] **Proxy 0.1.0.** Who: Claude Code, after item 14. Tag `proxy-v0.1.0`.
    Verify: `docker pull ghcr.io/courmap/proxy:0.1.0` and `:latest`.
20. [x] **Usenet (Newznab) support in the proxy:** [#30](https://github.com/courmap/courmap/issues/30). Who: Claude Code built it; Xwolv verifies on his own Sonarr.
    - Built: `INDEXER_<NAME>_TYPE=newznab|torznab` (detected from the feed's first results when unset), Newznab attributes written in the right namespace, caps and errors passed through, a new `:edge` image, and docs (quick start tabs for Torznab and Newznab, guide, proxy README).
    - Tested against a fake Newznab feed (19 tests) and by hand with a real Sonarr 4.0.20 and a fake usenet indexer: the indexer test passes, interactive search and RSS sync work, Sonarr reads the TVDB ID and size. Not tested against a live usenet indexer.
    - Verified on Xwolv's own Sonarr (2026-10-20): both Courmap indexers (NZBgeek and AniFix) pass Sonarr's indexer test. #30's "passes Sonarr's indexer test" box is ticked.
    - Verified on Xwolv's own Sonarr (2026-10-20): a real grab imported correctly, SPY x FAMILY S02E07 (absolute 32) from NZBgeek through the proxy, imported as S02E07. Every box in #30 is ticked and the issue is closed by the commit that records it.
    - Verify: #30 is closed.

## Data and quality

13. [x] **Scheduled bots actually fire.** Who: Claude Code checks.
    - The 2026-10-19 07:30 scan fired 7h22 late (14:52 UTC, run 39272913674, actor xwolvos). It updated the 12 bot PRs, then stopped at issue #13 because `SEED_PR_TOKEN` cannot edit issues, and still reported success. Both are fixed: issues use the workflow's own token, and the scan step fails when the scan fails (decision S8.3).
    - Every push to `main`, including the last change to each workflow file, came from xwolvos, so schedules run as an account with access.
    - Crons now avoid busy minutes (scan 07:23 daily; seed 06:17, release 09:13, weekly bots 10:47 on Tuesdays), with the Worker watchdog 30 minutes behind each.
    - Checked 2026-10-25: the daily scan ran on 2026-10-22, 23, 24 and 25 (the 2026-10-21 run failed and nothing has failed since); the scheduled seed and release both ran on Tuesday 2026-10-20. The seed schedule failed on a stale commit (a gap diagnostic the seed fix da02a50 addressed) and a dispatch on da02a50 verified instead; the next seed schedule is 2026-10-27.
    - Verify: `gh run list --workflow bots.yml --event schedule` lists runs on consecutive days that update issues #13 to #29 instead of duplicating them.
14. [~] **A week of real proxy traffic with no wrong imports.** Who: Xwolv, on the Unraid server. Started 2026-10-28, ends 2026-11-04: Xwolv's proxy runs the latest `:edge` image against his real Sonarr, on data 2026.44.1 (the 2026-10-28 revision release, which carries the fixes from #155, #156 and #158).
    - Earlier exports (first received 2026-10-20: two usenet indexers, about 550 items, 17 rewritten, 201 unresolved) led to fixes but do not count towards the week. It found a secret-logging risk, the stale-count problem for airing shows, and parser gaps; all fixed or recorded (DECISIONS.md, "First real traffic"). Xwolv updates his proxy to the new `:edge` image to get them.
    Verify: Sonarr's history for the week shows no anime episode imported as the wrong episode; the status page's export is imported with `pnpm corpus:from-proxy` (item 16).
15. [x] **Bot PRs and issues reviewed.** Who: Xwolv decides; Claude Code applies. Done, on Xwolv's decision (2026-10-27).
    - First batch done 2026-10-19 (decided by Xwolv): #2 (without the Koori no Jouheki 2nd Season line), #3 to #9, #11 and #12 merged; #10 closed and recorded in `data/rejected.yaml`, which the bots read so it is never proposed again. No bot PR is open.
    - Resolved 2026-10-25 (on Xwolv's instruction): the 11 open PRs merged (#110 airing updates, #111 to #120 sequels), and 28 issues closed, 11 by rejection (reasons in `data/rejected.yaml`), 16 by data fixes in manual files with the provider's pages as sources (Girls und Panzer as the 2026 TV series, Steel Ball Run stages, Osomatsu's missing finale, the MHA 19th special, Kaguya's special number, the Shibou Yuugi film, Virgin Punk's nonexistent show, the Watashi ga Koibito TV special, the two second-cour splits, Cyberpunk Edgerunners 2, and the Dragon Ball Super and Gundam SEED prequels, plus four that were already right), and #23 because no provider has an entry. Details in HANDOFF.md and DECISIONS.md.
    - Left open, not launch blockers: #77 (Kingdom's 14th TMDB and TVDB episode, "Zoku-hen", has no air date; the sequel is the seed's `kingdom-zoku-hen`, mapped from episode 14 when it airs), #13 (Sazae-san needs a season-by-season TMDB mapping) and #59 (Oshiri Dandy has no TMDB entry). They stay open as ordinary data issues waiting on outside sources (Xwolv, 2026-10-27).
    - chitose-kun-wa-ramune-bin-no-naka-part-2 and dark-machine-the-animation (11 vs 12 episodes) stay as tier C issues for now (Xwolv, session 8).
    - Verify: no bot PR or `mapping-conflict` issue older than a week without a decision.
16. [x] **Corpus large enough to trust.** Who: Xwolv supplies names (proxy exports); Claude Code imports and verifies them with Xwolv. Done (Xwolv, 2026-10-28): the bar of 200 verified real names at 95% was 450 at 100%.
    - Proposed launch bar: at least 200 verified cases, most of them real names from the proxy, with a 95% pass rate. The M2 milestone remains 1,000.
    - Today: **199 verified, all passing; 394 unverified** imported from the 2026-10-25 and 2026-10-26 exports (the second pass of 2026-10-26 verified 49 more: Black Lagoon, Lulutto Lilly, Umayuru, aliases). The unverified cases are a watch list: any case expected ambiguous or unmatched that starts resolving fails CI and names itself. Was 93 before that export, 81 before the Spy x Family and second-export imports, 35 before the first proxy export (2026-10-20).
    - Updated 2026-10-28 (issue #154): **450 verified, all passing; 640 unverified.** Of the 2026-10-28 export of Xwolv's proxy (500 names), none resolved before the fixes and 225 do after; 251 new cases were verified, 33 of them as ambiguous with a reason. The bar is met by count, but most of the new cases are variants of a few shows (Dandadan, Danganronpa 3, Wandance), so for the "trust" part new names from other shows count for more than more of these. Xwolv decides when to tick it.
    - Updated 2026-10-28 (port of #157): **484 verified, all passing; 611 unverified.** The 29 new verified cases are Black Lagoon (22) and Dance in the Vampire Bund (7); SKET Dance season 2 (7 more) went from verified ambiguous to verified ok, checked on TheTVDB; the cases come from other shows, but the corpus is still concentrated in a few shows (Dandadan, Danganronpa 3, Wandance, Black Lagoon), so names from other shows still count for more.
    - On record (Xwolv, 2026-10-28): the first 251 new verified cases are concentrated in three shows, Dandadan, Danganronpa 3 and Wandance, and the skew is expected for a first export. The weekly proxy exports will broaden it; new names from other shows count for more than more of these. The Cat's Eye cases (5 verified) rest on the remake-by-posting-date rule, with the first sighting as the posting date (DECISIONS.md, "A remake by posting date").
    - Verify: `pnpm corpus` reports at least 200 verified at 95% or more.
17. [x] **Screenshots in the Sonarr guide.** Who: Xwolv takes them; Claude Code places them. Done (Xwolv, 2026-10-28): taken from the live install, secrets masked. Six placeholders are in `site/src/content/docs/sonarr.mdx` (the full Sonarr guide, under "Set up"; the quickstart has none):
    - Prowlarr indexers with the ID visible.
    - Prowlarr's Sonarr app dialog with Show Advanced on and **Anime Sync Categories** cleared (Sonarr quickstart step 3A).
    - Sonarr's Add Torznab dialog.
    - The status page after a day.
    - The Unraid Add Container form.
    - The "Copy as GitHub issue" block.
    - Verify: `grep -c "Screenshot to add:" site/src/content/docs/sonarr.mdx` prints 0.
18. [ ] **Fresh-eyes test on all four front doors** (Sonarr users, developers, data users, contributors). Who: Xwolv finds testers who have never seen the project; Claude Code fixes every place they stall.
    - Verify: each tester reaches a working result in under five minutes: the proxy resolving releases (Sonarr quickstart), a first `translate` result (Library quickstart), a first `curl` result from `api.courmap.com` (Use the data), and a first PR passing CI (Fix a mapping). Every stall became a docs fix.
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
- [x] Security advisories fixed 2026-10-25: vitest 4.1.12 (GHSA-xp26-3454-mjgp), postcss-selector-parser 7.1.7 through astro-expressive-code 0.44.3 (GHSA-rj75-hqrm-r3gf) and fast-uri 3.1.9 (GHSA-w74x-v6f9-j3xg). The Dependabot security job had failed because it could not resolve past vitest 4.1.11.
- [x] Duplicate-indexer guidance that keeps regular TV working (2026-10-19): for indexers with regular TV and anime, Prowlarr's copy keeps regular TV (Anime Sync Categories cleared, Full Sync, no tags) and the Courmap copy takes anime (Categories empty, Anime Categories 5070, Indexer Priority 10); the tag method is for anime-only indexers like Nyaa. Checked with real Prowlarr, Sonarr 4.0.20 and the proxy in Docker; not with a live torrent or usenet indexer (quick start step 3, decision in DECISIONS.md).

## Also done, 2026-10-27

- [x] Docs overhaul (2026-10-27, branch `docs/overhaul`, not yet merged): new sidebar, homepage, Sonarr quickstart, glossary, trimmed README; see DECISIONS.md, "Docs overhaul".
- [x] Docs overhaul follow-up (2026-10-27, same branch): shorter Sonarr quickstart, "Use the data" page for the HTTP API, static files and dumps, four-card homepage; see DECISIONS.md.
- [ ] After the docs overhaul merges: cut `proxy-v0.1.0` (Xwolv), then change the quickstart, full guide and READMEs from `:edge` to the versioned tag. Verify: `grep -rn "proxy:edge" README.md site/src packages/proxy/README.md` prints nothing.

## Also done, 2026-10-20

- [x] TMDB projection checker live (2026-10-20): TMDB_API_KEY is a repo secret. The first weekly run checked 2688 works (513 TMDB shows) and found 60 mismatches; it opened 15 issues (#61 to #75, the per-run cap), the other 45 follow on later runs. Many are TMDB lag, not data errors: "season 2 is not on TMDB" for new seasons and "mapped to episode 12, TMDB lists 1" for shows TMDB has just started; a person triages them. Nothing from TMDB was written to data/ or any commit (the run made none).
- [x] No open pull requests (2026-10-20): bot PRs #47 to #57 (ten sequel relations and two airing updates, checked before merging: validate, corpus and a with/without compile comparison showed only prequel and count changes) and the vitest 4 bump (#60, tested on current main) were merged on Xwolv's approval.
- [x] Bot PRs no longer conflict (2026-10-20): relations, airing and TMDB split proposals are one file per work under data/seeds/; the six split-cour PRs (#81 to #86) are merged; the upstream Anime-Lists draft lists fourteen cours (Xwolv reviews and submits it).
- [x] TMDB checker follow-ups (2026-10-20): Bonobono (TV 2016) is TMDB 66751; TMDB being behind on specials is no finding; split cours become tier B PRs (data/seeds/tmdb-splits.jsonl). Open for Xwolv: review and submit docs/upstream/anime-lists-tmdb-split-cours.md to Anime-Lists.
- [x] The TMDB checker's first real findings fixed (2026-10-20): eight cours that TMDB keeps in season 1 got a TMDB override, Bonobono (TV 2016) lost a TMDB mapping that pointed at the wrong show, and Konosuba 3 Bonus Stage is TMDB being incomplete (DECISIONS.md). Open for Xwolv: whether to add the 2016 Bonobono TMDB show ID (it is from TMDB itself, not a seed dataset), and to tell Anime-Lists about the merged-cour pattern.
- [x] TMDB checker noise rule and self-closing issues (2026-10-20): TMDB lag on an airing or upcoming work gets no issue until six weeks after the premiere; issues the checker opened close themselves when a later run finds no mismatch worth one. Issues #61 to #75 were triaged by that rule (see DECISIONS.md). Open: whatever the checker still flags is real work for a person.
- [x] Weekly digest posts to Discord (DISCORD_WEBHOOK_URL is set; NTFY_URL is not). A long digest is now split into several messages and posted without link previews.
- [x] TMDB's attribution line ("This product uses the TMDB API but is not endorsed or certified by TMDB.") is in ATTRIBUTION.md, the licensing page and the docs site footer on every page.

- [x] No secret in any log line, page, export or error message; tests fail if one appears.
- [x] Fewer requests to usenet indexers (cache, early stop, a cap), with the reason for every upstream failure and per-day request counts on the status page; the API limit behavior is documented.
- [x] Airing shows with a placeholder or lagging episode count resolve and rewrite (seed, engine and resolver), and the parser reads Erai-raws, Chinese and season-pack names.
- [x] Docs for Sonarr and Prowlarr behind a VPN container.

- [x] Repository set up as an open-source project (2026-10-20): description, homepage and topics; ruleset "Protect main" (no deletion or force pushes, pull request and the `validate` check required, repository admins may bypass); secret scanning with push protection, private vulnerability reporting, Dependabot alerts, security fixes and monthly version updates; SECURITY.md, CODE_OF_CONDUCT.md, CODEOWNERS, issue and PR templates.

## Before the launch post, repository settings

- [ ] **Remove the ruleset bypass.** The rulesets "Protect main" and "No force pushes or deletion on main" let the repository admin role (only xwolvos today) bypass them, which the history rewrite and the merges needed. At launch, delete the bypass actor from both so main is protected for everyone. Who: Xwolv. Verify: `gh api repos/courmap/courmap/rulesets/<id> --jq .bypass_actors` is empty for both.

## Launch post

When every item above is done: Xwolv posts. Claude Code can draft the post (what Courmap is, the try-it link, the proxy compose block, the docs) on request.

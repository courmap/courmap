# Launch checklist

Everything still open before the public launch post (r/sonarr, r/selfhosted, anime self-hosting Discords). Each item says who does it and how to check it is done. Claude Code updates this file at the end of every session; Xwolv ticks items off by saying so in the session prompt.

Last updated 2026-10-19, session 7. Status: **not ready.** 4 of 19 items are done and 2 are partly done.

Legend: [x] done, [ ] open, [~] partly done.

## Hosting and domains

1. [ ] **Buy courmap.com** (Cloudflare Registrar). Who: Xwolv.
   Verify: `dig +short NS courmap.com` names Cloudflare nameservers.
2. [x] **R2 bucket and its four secrets** (`R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`). Who: Xwolv. Done 2026-10-19.
   Verify: `gh secret list` shows all four.
3. [ ] **First shard sync to R2.** Who: automatic, then Claude Code checks it.
   - The `r2` job runs only when `publish` creates a new release. `data-2026.43` already exists, so the first sync comes with `data-2026.44` (Tuesday 2026-10-27, 09:13 UTC), unless Xwolv wants it sooner (Claude Code can add a manual "sync R2 from an existing tag" option).
   - Verify: the release run's `r2` job logs "Uploaded 52205 file(s) ... meta.json last", and the bucket lists `v1/meta.json`.
4. [ ] **CORS on the R2 bucket**: allow `GET` and `HEAD` from any origin. Who: Xwolv (R2, the bucket, Settings, CORS policy: `[{"AllowedOrigins":["*"],"AllowedMethods":["GET","HEAD"]}]`).
   Verify: `curl -sI -H 'Origin: https://courmap.pages.dev' https://data.courmap.com/v1/meta.json | grep -i access-control-allow-origin`.
5. [ ] **Custom domains**, after item 1. Who: Xwolv in Cloudflare, then Claude Code switches the config.
   - `data.courmap.com` on the R2 bucket (R2, the bucket, Settings, Custom Domains).
   - `courmap.com` on the `courmap` Pages project (Workers & Pages, courmap, Custom domains).
   - `api.courmap.com` on the `courmap` Worker (Workers & Pages, courmap, Settings, Domains & Routes).
   - Then Claude Code sets `COURMAP_URLS.docs` back to `courmap.com` in `packages/core/src/site.ts` and checks `worker/wrangler.toml` and the site's `SITE_URL`.
   - Verify: `curl -s https://data.courmap.com/v1/meta.json` returns the current `data_version`; `https://courmap.com/try/` resolves a release name in the browser; `curl https://api.courmap.com/v1/meta` answers.
   - Until then, an R2 public `r2.dev` URL could stand in for `data.courmap.com` (one value: `DATA_URL` in `worker/wrangler.toml` plus `PUBLIC_COURMAP_DATA_URL` for the site). This is Xwolv's choice.
6. [x] **Docs site deployed** to Cloudflare Pages. Who: automatic (`docs.yml`, with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`). Done 2026-10-19.
   Verify: `https://courmap.pages.dev/` is the Courmap site. The try-it box works there only once item 3 and either item 5 or an `r2.dev` URL are done.
7. [~] **Worker deployed.** Who: automatic (`worker.yml`). Deployed 2026-10-19 at `https://courmap.danrovito.workers.dev`; it has no data until the shards are live (item 3).
   - Open: the `workers.dev` subdomain shows the Cloudflare account name. Xwolv can rename it under Workers & Pages, Subdomain.
   - Verify: `curl https://<subdomain>.workers.dev/v1/meta` returns the `data_version`. `worker.yml` then runs `check-deployed.ts`, which must report every answer identical to the library.
8. [ ] **Schedule watchdog token.** Who: Xwolv. Create a fine-grained token with Actions: write on `courmap/courmap`, then run `cd worker && npx wrangler@4.151.2 secret put GITHUB_DISPATCH_TOKEN`.
   Verify: on the next missed schedule, the Worker's logs (Workers & Pages, courmap, Logs) show `watchdog ... dispatched`, and `gh run list --workflow bots.yml` shows the run.

## Packages

9. [x] **Proxy image** `ghcr.io/courmap/proxy:edge` built for amd64 and arm64 on every change. Who: automatic (`proxy.yml`).
10. [ ] **Make the GHCR package public** and link it to the repository. Who: Xwolv (the org's Packages, `proxy`, Package settings, Change visibility).
    Verify: `docker logout ghcr.io && docker pull ghcr.io/courmap/proxy:edge` works without logging in.
    As of 2026-10-19 17:40 UTC the package is still private.
11. [ ] **npm.** Who: Xwolv for the org and token, then Claude Code or Xwolv pushes the tag.
    - Create the `@courmap` org on npmjs.com.
    - Add `NPM_TOKEN` (an automation or granular token that can publish to `@courmap`).
    - Push the tag `client-v0.1.0`.
    - Verify: `npm view @courmap/client version` prints `0.1.0`, and the npm page shows a provenance badge. The dry run passes today (`npm.yml`).
12. [ ] **Proxy 0.1.0.** Who: Claude Code, after item 14. Tag `proxy-v0.1.0`.
    Verify: `docker pull ghcr.io/courmap/proxy:0.1.0` and `:latest`.

## Data and quality

13. [~] **Scheduled bots actually fire.** Who: Claude Code checks; Xwolv adds the watchdog token (item 8).
    - The first scheduled scan (2026-10-19 07:30 UTC) never ran.
    - Crons now avoid busy minutes: the scan at 07:23 daily, seed at 06:17 and release at 09:13 on Tuesdays, the weekly bots at 10:47 on Tuesdays.
    - Verify: `gh run list --workflow bots.yml --event schedule` lists runs on consecutive days, and seed and release show a `schedule` run on Tuesday.
14. [ ] **A week of real proxy traffic with no wrong imports.** Who: Xwolv, on the Unraid server, since 2026-10-19.
    Verify: Sonarr's history for the week shows no anime episode imported as the wrong episode; the status page's export is imported with `pnpm corpus:from-proxy` (item 16).
15. [ ] **Bot PRs and issues reviewed.** Who: Xwolv.
    - PR #1 (tier A) is merged.
    - It lowered chitose-kun-wa-ramune-bin-no-naka-part-2 and dark-machine-the-animation from 12 to 11 episodes, against TVDB projections of 12. Xwolv should decide which count is right; the classifier now sends such cases to tier C.
    - Verify: no bot PR or `mapping-conflict` issue older than a week without a decision.
16. [ ] **Corpus large enough to trust.** Who: Xwolv supplies names (proxy exports); Claude Code imports and verifies them with Xwolv.
    - Proposed launch bar: at least 200 verified cases, most of them real names from the proxy, with a 95% pass rate. The M2 milestone remains 1,000.
    - Today: 35 verified cases, all passing.
    - Verify: `pnpm corpus` reports at least 200 verified at 95% or more.
17. [ ] **Screenshots in the Sonarr guide.** Who: Xwolv takes them; Claude Code places them. Six placeholders are in `site/src/content/docs/sonarr.mdx`:
    - Prowlarr indexers with the ID visible.
    - Prowlarr's Sonarr app sync settings.
    - Sonarr's Add Torznab dialog.
    - The status page after a day.
    - The Unraid Add Container form.
    - The "Copy as GitHub issue" block.
    - Verify: `grep -c "Screenshot to add" site/src/content/docs/sonarr.mdx` prints 0.
18. [ ] **Fresh-eyes test on all three front doors** (Sonarr users, developers, contributors). Who: Xwolv finds testers who have never seen the project; Claude Code fixes every place they stall.
    - Verify: each tester reaches a working result in under five minutes (proxy resolving releases, a first `translate` result, a first PR passing CI), and every stall became a docs fix.
19. [x] **Docs, README and snippets.** Who: Claude Code. Done in session 6.
    - Every page of the docs plan exists, and every snippet runs in CI (`pnpm snippets`).
    - The README badges read the `badges` branch.
    - Re-verify after items 5 and 11, since some pages still say "planned" or point at courmap.pages.dev.

## Also done

- [x] The first data release, `data-2026.43`, is published, marked latest and verified (session 6).
- [x] SEED_PR_TOKEN works for bot PRs (CI ran on all 12). Fine-grained tokens expire: Xwolv renews it before its expiry date. Who: Xwolv.
- [x] Assisted numbering and the corpus loop from proxy exports (session 7).

## Launch post

When every item above is done: Xwolv posts. Claude Code can draft the post (what Courmap is, the try-it link, the proxy compose block, the docs) on request.

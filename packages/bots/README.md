# @courmap/bots

Detectors, classifier, PR and issue writer, Season tracker and weekly digest (build step 9 in docs/SPEC.md). This is the only package allowed to call the AniList API, and the TMDB API is used only by its CI projection checker; responses never enter `data/` or the dumps.

```sh
pnpm bots scan                 # AniList season scanner and airing tracker, then the classifier; prints what it would do
pnpm bots scan --apply         # also opens or updates PRs, issues and the Season tracker (never merges)
pnpm bots scan --save-media m.json / --media m.json   # cache AniList responses for offline reruns
pnpm bots tmdb                 # projection checker (needs TMDB_API_KEY)
pnpm bots digest [--apply]     # weekly digest; --apply sends it to NTFY_URL and DISCORD_WEBHOOK_URL when set
```

What the bots write: `data/seeds/airing/<work>.json` (tier A count bumps and finished flips), `data/seeds/relations/<work>.json` (tier B sequels from AniList PREQUEL and SEQUEL relations) and `data/seeds/tmdb-splits/<work>.json` (tier B TMDB split cours), one file per work so that bot PRs never conflict, all `origin: bot`. Manual files in `data/works/` always win and are never edited by a bot; a disagreement with one is a tier C issue.

Tiers: A (`auto`) one PR with all agreeing airing updates; B (`needs-review`) one PR per sequel, and airing updates that change an existing absolute sequence; C (`mapping-conflict` or `good first mapping`) issues with the source data attached. Runs from `.github/workflows/bots.yml`: the scan daily, the projection checker and digest weekly.

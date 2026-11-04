# Launch posts

Drafts for the public launch, written as Xwolv, first person. Numbers are from the repo on 2026-11-04 (data release 2026.45.1); refresh them before posting:

- Works: 32,822. Sequences: 779.
- Provider references in the data: AniDB 14,693, AniList 20,844, MAL 30,850, Kitsu 20,804, TVDB 7,473 shows, TMDB 7,059 shows (plus 1,324 TMDB movies), IMDb 1,608.
- Resolver corpus: 800 verified release names, all passing (1,036 more imported and not counted).
- Proxy 0.1.0 is released: `ghcr.io/courmap/proxy:latest`, amd64 and arm64.

## Before posting

- [ ] **Community Applications.** The Unraid template is submitted and auto-approved. Xwolv: confirm it is listed (search for "Courmap" in the Unraid Apps tab) before posting. If it is not there yet, change the Unraid line in the Reddit post back to "add it by hand, the quickstart shows how".
- [ ] **Links work.** https://courmap.com/, https://courmap.com/getting-started/sonarr/, https://status.courmap.com (shows green), https://github.com/courmap/courmap, https://courmap.com/proxy-reports/, and `docker pull ghcr.io/courmap/proxy:latest`.
- [ ] **Numbers refreshed.** Re-read the list above against the latest data release (`curl -sL https://github.com/courmap/courmap/releases/latest/download/meta.json`) and `pnpm corpus`, and update the posts to match.
- [ ] **The example.** The posts use `[SubsPlease] Jigokuraku 2nd Season - 05 (1080p)`. Confirm the series title Sonarr shows for TVDB 402474 on your install (the posts say "Hell's Paradise") and fix the rewrite line if it differs. Run it once through https://courmap.com/try/ to see the answer is still season 2, episode 5.
- [ ] **Each subreddit's rules and flair.** Read r/selfhosted's and r/sonarr's current self-promotion and flair rules (they change, and some subs limit how often you can post your own project); pick the right flair; check the Discord servers' rules before posting there. Do not post to all places at the same minute; be around to answer for the first few hours.

## The example used in all three posts

A real name from an indexer feed (it is a verified case in `tests/releases.yaml`, which came from proxy exports):

- **Release name:** `[SubsPlease] Jigokuraku 2nd Season - 05 (1080p)`
- **Why Sonarr misses it on its own:** TheTVDB has one series for this show with seasons 1 and 2, so there is no series called "Jigokuraku 2nd Season" for Sonarr to match the name to (the "2nd Season" is part of the title the group used, not something Sonarr reads as a season number), and the release is left unmatched.
- **Courmap's answer:** the work is `jigokuraku-2nd-season`, which is TVDB season 2, episode 5 (absolute episode 18; TMDB keeps both cours in season 1, so it is episode 18 there).
- **Exact rewrite:** `[SubsPlease] Jigokuraku 2nd Season - 05 (1080p)` becomes `Hell's Paradise S02E05 (1080p) [SubsPlease]` with the `tvdbid` attribute set, which Sonarr matches to season 2, episode 5.

The same shape works for "Sono Bisque Doll wa Koi wo Suru Season 2 - 05" (season 2, episode 5) if a second example is wanted.

Where the screenshot goes: `site/src/assets/sonarr/07-sonarr-interactive-search.png`. It shows Sonarr's Interactive Search for Dragon Ball Super: Beerus S01E03, with the results from the Courmap-fronted usenet indexer listed under the numbering Sonarr asked for. It is not the Jigokuraku example, so caption it as "Interactive Search on my Sonarr with the proxy in front of a usenet indexer". Put it after the example in the Reddit post (as an image or the first gallery image); attach it to the first Discord message; Hacker News has no images, so link the quickstart instead.

## r/selfhosted and r/sonarr

One post. Use the first title on r/sonarr and the second on r/selfhosted.

Titles:

- r/sonarr: `I made a free proxy so Sonarr can place anime releases like "Jigokuraku 2nd Season - 05"`
- r/selfhosted: `Courmap: a small self-hosted proxy and open dataset for anime episode numbering in Sonarr`

Body:

> Anime is the one thing Sonarr keeps getting wrong for me. Here is the example that made me build this. A fansub group posts `[SubsPlease] Jigokuraku 2nd Season - 05 (1080p)`. TheTVDB has one series for the show with a season 1 and a season 2, so Sonarr has no series called "Jigokuraku 2nd Season" to match that name to, and the release sits unmatched or gets rejected until I fix it by hand.
>
> Courmap is a proxy that sits between Prowlarr (or your indexers) and Sonarr. When a release comes back from a search, it works out which show and which episode the name means and rewrites it into the numbering Sonarr understands. That release becomes `Hell's Paradise S02E05 (1080p) [SubsPlease]`, with the TVDB ID set, and Sonarr imports it as season 2, episode 5. It also does the reverse: when Sonarr searches for S02E05, it asks the indexer for the names the fansub groups actually use.
>
> [Screenshot: Sonarr's Interactive Search with the proxy in front of a usenet indexer. Attach `07-sonarr-interactive-search.png` here, captioned as such.]
>
> What to know before you try it:
>
> - **Setup is about 5 minutes.** One container, then for anime you add a second copy of the indexer that points at the proxy, next to the one Prowlarr already syncs. The Prowlarr copy keeps regular TV; the Courmap copy takes the anime categories. The quickstart walks through it for Unraid and Compose: https://courmap.com/getting-started/sonarr/
> - **When it is not sure, it does nothing.** If a release could be two different shows or episodes, it passes through untouched. A wrong guess costs more than a miss, so it prefers the miss.
> - **Nothing is sent anywhere.** It talks to your indexers (or Prowlarr), your Sonarr, and GitHub once a day to download the data release. Release names it cannot resolve stay on your machine. The status page at port 9797 shows what it rewrote and what it passed through.
> - **The data behind it is open.** 32,822 works across AniDB, AniList, MAL, Kitsu, TVDB, TMDB and IMDb IDs, checked by a test set of 800 real release names that has to keep passing. Code is Apache-2.0, data is ODbL.
> - **Unraid:** it is available in Community Applications. Search for Courmap.
> - **Free and open source.** No account, no paid tier. I run it on my own server. I used it against my real Sonarr for a week before releasing it and saw no wrong imports, but that is one library and one person.
>
> What would help most: if it gets a name wrong or cannot place one, tell me. The status page has a "Copy as GitHub issue" block with the names it could not resolve (no API keys in it), and a GitHub issue with that block is all I need. Every report becomes a test case, so the same name does not break twice. https://courmap.com/proxy-reports/
>
> Links:
>
> - Docs: https://courmap.com/
> - Sonarr quickstart: https://courmap.com/getting-started/sonarr/
> - Status page: https://status.courmap.com
> - GitHub: https://github.com/courmap/courmap
> - Image: `ghcr.io/courmap/proxy:latest`

## Discord: Servarr and anime servers

Four to six lines. Post it in the right channel for the server (for example a self-promotion or show-and-tell channel; check each server's rules first).

> I built a free, open source proxy that fixes anime numbering in Sonarr. A fansub release like `[SubsPlease] Jigokuraku 2nd Season - 05 (1080p)` has no series in TVDB to match; the proxy rewrites it to `Hell's Paradise S02E05 (1080p) [SubsPlease]` and translates Sonarr's searches back into names indexers know.
> If it is unsure it passes the release through untouched, and nothing leaves your machine except calls to your own indexers, Sonarr and a daily data download from GitHub.
> 5 minute setup (Prowlarr, Compose, and in Unraid Community Applications, search "Courmap"): https://courmap.com/getting-started/sonarr/
> Docs https://courmap.com, status https://status.courmap.com, code https://github.com/courmap/courmap
> If it gets a name wrong, I would like to hear about it: the proxy's status page has a "Copy as GitHub issue" button for exactly that.
> [Attach `07-sonarr-interactive-search.png` to this message.]

## Show HN

Title (keep exactly):

`Show HN: Courmap, open data for anime episode numbering across AniDB, AniList, TVDB and TMDB`

Link: https://github.com/courmap/courmap (put the docs link in the first comment).

First comment (the post text):

> Hi HN. Anime episode numbering is a mess that every media tool solves again on its own. The same episode is "episode 17" to a fansub group, "season 1, episode 17" on TVDB and TMDB, "episode 5 of part 2" on AniList, and a different count again on AniDB and MAL. A release can also be named for a season the databases do not have: a group posts "Jigokuraku 2nd Season - 05" while TVDB has one series with two seasons. Tools like Sonarr, Plex and Jellyfin need to map between all of these, and the maps are scattered across spreadsheets, forum threads and per-tool hacks.
>
> Courmap is an attempt at one open, versioned map. It builds on Anime-Lists and anime-offline-database, which do the hard work of cross-referencing IDs, and adds episode ranges between schemes, release-name resolution, and a verification loop. It is not TheXEM: TheXEM maps scene numbering to TVDB for Sonarr, while Courmap maps every provider (AniDB, AniList, MAL, Kitsu, TVDB, TMDB, IMDb and absolute numbering) to one canonical work, resolves release names, and publishes everything as open data and a library. The Sonarr proxy uses Sonarr's own scene numbering (TheXEM's, where Sonarr uses it) for the series that have it, so the two work together rather than compete.
>
> What exists today:
>
> - **The dataset.** 32,822 works and 779 sequences, with cross-references between AniDB, AniList, MAL, Kitsu, TVDB, TMDB and IMDb, and episode ranges between them. It is built from the two public seed datasets above plus hand-written YAML overrides. A release is published weekly as a SQLite dump and as static JSON shards. Data is ODbL 1.0, code is Apache-2.0. I deliberately do not redistribute AniDB titles; AniDB IDs appear only as facts.
> - **A library.** `@courmap/client` on npm (TypeScript, Node and browser). It translates an episode from one scheme to another and resolves a release name like `[SubsPlease] Jigokuraku 2nd Season - 05` to its work and episode. It runs offline against the SQLite dump or remotely against the static shards, and both go through the same translation engine, so results are identical.
> - **An HTTP API.** `api.courmap.com` with lookup, translate, resolve and search, limited to 60 requests a minute per client. Heavier use should go to the library or the dumps, which need no server.
> - **A Sonarr proxy.** The first real consumer: a container that rewrites anime release names in indexer results into the numbering Sonarr expects. It is the main reason the resolver exists.
>
> How it stays correct is the part I care about most. Seed data is wrong in many small ways, so:
>
> - Bots scan AniList for new seasons and airing changes and open pull requests or issues. They never merge; a person does.
> - A weekly CI check compares our TMDB mappings with TMDB's data and opens an issue when they disagree. No TMDB API responses are stored anywhere in the data or in a release. Some mappings in `data/works` are sourced from TMDB's public season pages (each file lists its source URL), and the check reads TMDB through its API only in CI.
> - A corpus of real release names, 800 verified so far and all passing, runs on every change. New names come from people's proxies: an unresolved name is exported, becomes a test case, and then a fix. A case where the answer is honestly "ambiguous" is a valid verified case, and a change that makes an ambiguous release resolve fails CI.
> - Every non-obvious mapping carries source URLs, and `pnpm validate` checks schemas, overlaps, bounds and round trips.
>
> Limits, so you do not have to find them: this is version 0.1. Coverage is best for TV anime and thinner for old shows and long runners (several issues on the repo are exactly that). The Sonarr proxy is Sonarr only. The corpus is skewed towards a few popular shows so far, so 800 passing cases is evidence, not proof.
>
> Docs and a try-it box that runs the resolver in your browser: https://courmap.com/ . Status: https://status.courmap.com . I would like to hear about mappings that are wrong, and about other tools that would want this data in a different shape.

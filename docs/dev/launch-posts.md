# Launch posts

Drafts for the public launch, written as Xwolv, first person. Numbers are from the repo on 2026-11-04 (data release 2026.45.1); refresh them before posting:

- Works: 32,822. Sequences: 779.
- Provider references in the data: AniDB 14,693, AniList 20,844, MAL 30,850, Kitsu 20,804, TVDB 7,473 shows, TMDB 7,059 shows (plus 1,324 TMDB movies), IMDb 1,608.
- Resolver corpus: 800 verified release names, all passing (1,036 more imported and not counted).
- Proxy 0.1.0 is released: `ghcr.io/courmap/proxy:latest`, amd64 and arm64.

Check before posting: the Unraid line (see below), and that https://status.courmap.com and the quickstart link work.

Where the screenshot goes: `site/src/assets/sonarr/07-sonarr-interactive-search.png` (Sonarr's Interactive Search showing a rewritten release). On Reddit, attach it as the post's image or put it as the first image of a gallery; on Discord, attach it to the first message; on Hacker News there is no image, so link to the docs page that shows it (https://courmap.com/getting-started/sonarr/).

## r/selfhosted and r/sonarr

One post. Use the first title on r/sonarr and the second on r/selfhosted.

Titles:

- r/sonarr: `I made a free proxy that lets Sonarr place fansub releases like "Dandadan - 17"`
- r/selfhosted: `Courmap: a small self-hosted proxy and open dataset for anime episode numbering in Sonarr`

Body:

> Anime is the one thing Sonarr keeps getting wrong for me. Here is the example that made me build this. A fansub group posts `[ASW] Dandadan - 17`. Sonarr looks for Dandadan, finds a show with a season 1 of 12 episodes and a season 2, and has no idea what "17" means. Fansubs count straight through a show, while TVDB and TMDB split it into seasons. So the release is rejected, or imported as the wrong episode, or sits in the queue until I fix it by hand.
>
> Courmap is a proxy that sits between Prowlarr (or your indexers) and Sonarr. When a release comes back from a search, it works out which show and which episode the name means and rewrites it into the numbering Sonarr understands. For that name it answers season 2, episode 5, because that is where absolute episode 17 of Dandadan is. It also does the reverse: when Sonarr searches for S02E05, it asks the indexer for the names the fansub groups actually use.
>
> [Screenshot: Sonarr's Interactive Search showing the rewritten release. Attach `07-sonarr-interactive-search.png` here.]
>
> What to know before you try it:
>
> - **Setup is about 5 minutes.** One container, then you point a Torznab or Newznab indexer at it instead of the original. The quickstart has Unraid and Compose versions: https://courmap.com/getting-started/sonarr/
> - **When it is not sure, it does nothing.** If a release could be two different shows or episodes, it passes through untouched. A wrong guess costs more than a miss, so it prefers the miss.
> - **Nothing is sent anywhere.** It talks to your indexers (or Prowlarr), your Sonarr, and GitHub once a day to download the data release. Release names it cannot resolve stay on your machine. The status page at port 9797 shows what it rewrote and what it passed through.
> - **The data behind it is open.** 32,822 works across AniDB, AniList, MAL, Kitsu, TVDB, TMDB and IMDb IDs, checked by a test set of 800 real release names that has to keep passing. Code is Apache-2.0, data is ODbL.
> - **Unraid:** the container works on Unraid today and the quickstart shows how to add it by hand. I have not submitted the Community Applications template yet, so you will not find it in the app search for now. I will update this post when it is there.
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

> I built a free, open source proxy that fixes anime numbering in Sonarr. Fansubs post "Dandadan - 17"; Sonarr wants S02E05. The proxy sits between Prowlarr and Sonarr and rewrites the release name, and translates Sonarr's searches back into names indexers know.
> If it is unsure it passes the release through untouched, and nothing leaves your machine except calls to your own indexers, Sonarr and a daily data download from GitHub.
> 5 minute setup for Unraid or Compose: https://courmap.com/getting-started/sonarr/
> Docs https://courmap.com, status https://status.courmap.com, code https://github.com/courmap/courmap
> If it gets a name wrong, I would like to hear about it: the proxy's status page has a "Copy as GitHub issue" button for exactly that.
> [Attach `07-sonarr-interactive-search.png` to this message.]

## Show HN

Title (keep exactly):

`Show HN: Courmap, open data for anime episode numbering across AniDB, AniList, TVDB and TMDB`

Link: https://github.com/courmap/courmap (put the docs link in the first comment).

First comment (the post text):

> Hi HN. Anime episode numbering is a mess that every media tool solves again on its own. The same show is "episode 17" to a fansub group, "season 2, episode 5" on TVDB and TMDB, "episode 5 of part 2" on AniList, and a different count again on AniDB and MAL. Tools like Sonarr, Plex and Jellyfin need to map between these, and the maps are scattered across spreadsheets, forum threads and per-tool hacks.
>
> Courmap is an attempt at one open, versioned map. What exists today:
>
> - **The dataset.** 32,822 works and 779 sequences, with cross-references between AniDB, AniList, MAL, Kitsu, TVDB, TMDB and IMDb, and episode ranges between them. It is built from public seed datasets (cedya77's anime-offline-database and Anime-Lists) plus hand-written YAML overrides. A release is published weekly as a SQLite dump and as static JSON shards. Data is ODbL 1.0, code is Apache-2.0. I deliberately do not redistribute AniDB titles; AniDB IDs appear only as facts.
> - **A library.** `@courmap/client` on npm (TypeScript, Node and browser). It translates an episode from one scheme to another and resolves a release name like `[ASW] Dandadan - 17` to its work and episode. It runs offline against the SQLite dump or remotely against the static shards, and both go through the same translation engine, so results are identical.
> - **An HTTP API.** `api.courmap.com` with lookup, translate, resolve and search, limited to 60 requests a minute per client. Heavier use should go to the library or the dumps, which need no server.
> - **A Sonarr proxy.** The first real consumer: a container that rewrites anime release names in indexer results into the numbering Sonarr expects. It is the main reason the resolver exists.
>
> How it stays correct is the part I care about most. Seed data is wrong in many small ways, so:
>
> - Bots scan AniList for new seasons and airing changes and open pull requests or issues. They never merge; a person does.
> - A weekly check compares our TMDB mappings with TMDB's season pages and opens an issue when they disagree. Nothing from TMDB is stored in the data, only IDs and offsets that come from Anime-Lists.
> - A corpus of real release names, 800 verified so far and all passing, runs on every change. New names come from people's proxies: an unresolved name is exported, becomes a test case, and then a fix. A case where the answer is honestly "ambiguous" is a valid verified case, and a change that makes an ambiguous release resolve fails CI.
> - Every non-obvious mapping carries source URLs, and `pnpm validate` checks schemas, overlaps, bounds and round trips.
>
> Limits, so you do not have to find them: this is version 0.1. Coverage is best for TV anime and thinner for old shows and long runners (several issues on the repo are exactly that). The Sonarr proxy is Sonarr only. The corpus is skewed towards a few popular shows so far, so 800 passing cases is evidence, not proof.
>
> Docs and a try-it box that runs the resolver in your browser: https://courmap.com/ . Status: https://status.courmap.com . I would like to hear about mappings that are wrong, and about other tools that would want this data in a different shape.

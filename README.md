![Courmap: anime episode numbering, mapped across every provider.](assets/banner.png)

[![CI](https://github.com/courmap/courmap/actions/workflows/validate.yml/badge.svg)](https://github.com/courmap/courmap/actions/workflows/validate.yml)
[![data](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fcourmap%2Fcourmap%2Fbadges%2Fdata.json)](https://github.com/courmap/courmap/releases/latest)
[![coverage](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fcourmap%2Fcourmap%2Fbadges%2Fcoverage.json)](https://courmap.com/coverage/)
[![resolver corpus](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fcourmap%2Fcourmap%2Fbadges%2Fcorpus.json)](tests/releases.yaml)

**Courmap translates an anime episode between AniDB, AniList, MAL, Kitsu, TVDB, TMDB, IMDb and absolute (fansub) numbering, and resolves release names to the right show and episode, as open data and a library with no server to run.**

The same release, counted every way:

| Source | Episode |
| --- | --- |
| Fansub release `[SubsPlease] Spy x Family - 17 (1080p)` | 17 |
| AniDB, AniList, MAL, Kitsu | Part 2, episode 5 |
| TVDB, TMDB | S01E17 |

Fansub groups count straight through the show. AniDB, AniList, MAL and Kitsu split it into two cours (about 12 episodes each) that restart at 1, and TVDB and TMDB keep one season. [Try it in your browser](https://courmap.com/try/).

## Pick your path

### Sonarr and self-hosted users

The Courmap proxy sits between Prowlarr and Sonarr and rewrites anime releases into the numbering Sonarr understands; anything it is unsure about passes through untouched.

```yaml
services:
  courmap-proxy:
    image: ghcr.io/courmap/proxy:edge
    ports:
      - "9797:9797"
    volumes:
      - ./courmap/data:/data
    environment:
      SONARR_URL: http://sonarr:8989
      SONARR_API_KEY: your-sonarr-api-key
      INDEXER_NYAA_URL: http://prowlarr:9696/1/api
```

`INDEXER_NYAA_URL` makes the proxy serve that Prowlarr feed at `/nyaa` (the `1` is the indexer's ID in Prowlarr). Then add `http://courmap-proxy:9797/nyaa` to Sonarr as a Torznab indexer (Newznab for usenet) with your Prowlarr API key. [Sonarr quickstart](https://courmap.com/getting-started/sonarr/); Unraid, VPN containers, usenet limits and troubleshooting are in the [full guide](https://courmap.com/sonarr/).

### Developers

```ts
import { createOfflineClient } from '@courmap/client';

const courmap = createOfflineClient('courmap.sqlite'); // the dump from the latest data release
const t = await courmap.translate('anilist:142838', 5, ['tvdb_show', 'absolute']);
console.log(t.results.tvdb_show); // { id: '405920', season: 1, episode: 17 }
const r = await courmap.resolve('[SubsPlease] Sousou no Frieren - 12 (1080p)');
console.log(r.status, r.match?.work, r.match?.episode); // ok sousou-no-frieren 12
courmap.close();
```

Works fully offline over the weekly SQLite dump, or fetches small static files on demand, in Node, browsers and Workers. [Library quickstart](https://courmap.com/getting-started/library/).

### Contributors

Fix a wrong mapping once, for everyone: add a short YAML file that overrides only what is wrong.

```yaml
# data/works/kusuriya-no-hitorigoto-2nd-season.yaml
id: kusuriya-no-hitorigoto-2nd-season
projections:
  tmdb_show:
    - { season: 1, episodes: 1-24, start: 25 }
```

```sh
pnpm install
pnpm validate
```

[Fix a mapping](https://courmap.com/getting-started/contributing/), and the [full contributing guide](https://courmap.com/contributing/).

## How it works

Every provider maps to one canonical **work** (usually one cour, film or OVA), never to each other, so any translation is two hops. About 33,000 works are seeded weekly from [anime-offline-database](https://github.com/cedya77/anime-offline-database) (IDs, titles, synonyms) and [Anime-Lists](https://github.com/Anime-Lists/anime-lists) (TVDB and TMDB offsets); hand-written YAML files in [`data/`](data/) correct and extend them. CI checks every mapping (every episode must translate to every provider and back) and compiles it all into a SQLite dump and static JSON files. Bots watch each anime season and open pull requests and issues; a person only reviews where sources disagree.

Courmap never guesses silently: an unsure answer is `ambiguous`, with its candidates. How it differs from TheXEM, Anime-Lists and anime-offline-database is in the [FAQ](https://courmap.com/faq/).

Documentation: [courmap.com](https://courmap.com). Design: [docs/SPEC.md](docs/SPEC.md).

## License and attribution

Code: Apache-2.0 ([LICENSE](LICENSE)). Data in `data/` and every dump: ODbL 1.0 + DbCL 1.0 ([DATA_LICENSE](DATA_LICENSE)). Courmap builds on anime-offline-database (cedya77, continuing manami-project) and Anime-Lists; see [ATTRIBUTION.md](ATTRIBUTION.md). Courmap never calls the AniDB API and never redistributes AniDB titles.

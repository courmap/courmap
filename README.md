![Courmap](assets/banner.png)

[![CI](https://github.com/courmap/courmap/actions/workflows/validate.yml/badge.svg)](https://github.com/courmap/courmap/actions/workflows/validate.yml)
[![data](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fcourmap%2Fcourmap%2Fbadges%2Fdata.json)](https://github.com/courmap/courmap/releases/latest)
[![coverage](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fcourmap%2Fcourmap%2Fbadges%2Fcoverage.json)](https://courmap.com/coverage/)
[![resolver corpus](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fcourmap%2Fcourmap%2Fbadges%2Fcorpus.json)](tests/releases.yaml)

**Courmap translates an anime episode between AniDB, AniList, MAL, Kitsu, TVDB, TMDB, IMDb and absolute (fansub) numbering, and resolves release names to the right show and episode, as open data and a library with no server to run.**

One release, every numbering (from data release `data-2026.43`):

| `[SubsPlease] Spy x Family - 17 (1080p)` | ID | Episode |
| --- | --- | --- |
| AniDB | 17061 | 5 |
| AniList | 142838 | 5 |
| MAL | 50602 | 5 |
| Kitsu | 45619 | 5 |
| TVDB | 405920 | S01E17 |
| TMDB | 120089 | S01E17 |
| Absolute | `spy-x-family-absolute` | 17 |

The fansub group's episode 17 is the fifth episode of the second cour, which AniDB, AniList, MAL and Kitsu list as its own entry and TVDB and TMDB keep in season 1. [Try it in your browser](https://courmap.com/try/).

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

Then add `http://courmap-proxy:9797/nyaa` to Sonarr as a Torznab indexer. [Sonarr guide](https://courmap.com/sonarr/), including Unraid.

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

[Contributing guide](https://courmap.com/getting-started/contributing/).

## How it works

Every provider maps to one canonical **work** (usually one cour, film or OVA), never to each other, so any translation is two hops. About 33,000 works are seeded weekly from [anime-offline-database](https://github.com/cedya77/anime-offline-database) (IDs, titles, synonyms) and [Anime-Lists](https://github.com/Anime-Lists/anime-lists) (TVDB and TMDB offsets); hand-written YAML files in [`data/`](data/) correct and extend them. CI checks every mapping (every episode must translate to every provider and back) and compiles it all into a SQLite dump and static JSON files. Bots watch each anime season and open pull requests and issues; a person only reviews where sources disagree.

- **Not TheXEM:** TheXEM maps scene numbering to TVDB for Sonarr. Courmap maps all providers and absolute numbering to one hub, resolves release names, and publishes open data and a library; the proxy uses Sonarr's TheXEM scene numbering where it exists.
- **Built on Anime-Lists and anime-offline-database:** Courmap joins them, adds corrections, absolute sequences and release-name resolution, and checks the result.
- **Never guesses silently:** an unsure answer is `ambiguous`, with its candidates.

Documentation: [courmap.com](https://courmap.com). Design: [docs/SPEC.md](docs/SPEC.md).

## License and attribution

Code: Apache-2.0 ([LICENSE](LICENSE)). Data in `data/` and every dump: ODbL 1.0 + DbCL 1.0 ([DATA_LICENSE](DATA_LICENSE)). Courmap builds on anime-offline-database (cedya77, continuing manami-project) and Anime-Lists; see [ATTRIBUTION.md](ATTRIBUTION.md). Courmap never calls the AniDB API and never redistributes AniDB titles.

# @courmap/client

Translate an anime episode between AniDB, AniList, MAL, Kitsu, TVDB, TMDB, IMDb and absolute (fansub) numbering, and resolve release names to the right show and episode. Fully offline over the weekly SQLite dump, or on demand over small static files, in Node, browsers and Workers.

```sh
npm install @courmap/client
```

```ts
import { createOfflineClient } from '@courmap/client';

// courmap-<version>.sqlite.gz from https://github.com/courmap/courmap/releases/latest, unpacked
const courmap = createOfflineClient('courmap.sqlite');

const t = await courmap.translate('anilist:142838', 5, ['tvdb_show', 'absolute']);
console.log(t.results.tvdb_show); // { id: '405920', season: 1, episode: 17 }

const r = await courmap.resolve('[SubsPlease] Spy x Family - 17 (1080p)');
console.log(r.status, r.match?.work, r.match?.episode); // ok spy-x-family-part-2 5

courmap.close();
```

In a browser or a Worker, use the remote mode, which has no Node-only code:

```ts
import { createRemoteClient } from '@courmap/client/remote';

const courmap = createRemoteClient(); // https://data.courmap.com/v1/ by default
```

Documentation: [courmap.pages.dev](https://courmap.pages.dev/getting-started/library/). Code: Apache-2.0. The data is ODbL 1.0 + DbCL 1.0; see the [repository](https://github.com/courmap/courmap).

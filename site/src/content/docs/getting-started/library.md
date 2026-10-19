---
title: For developers
description: Translate and resolve anime episodes in your own tool with @courmap/client.
sidebar:
  order: 2
---

`@courmap/client` answers three questions: which work is this ID, what is this episode in every other numbering, and which work and episode is this release name. It runs locally, either over the weekly SQLite dump (fully offline) or over static files fetched on demand.

## Install

```sh
npm install @courmap/client
```

## Offline: download the dump once

Download `courmap-<version>.sqlite.gz` from the [latest data release](https://github.com/courmap/courmap/releases/latest), check it against `SHA256SUMS`, unpack it, and open it:

```ts
import { createOfflineClient } from '@courmap/client';

const courmap = createOfflineClient('courmap.sqlite');

// Which work is AniList 142838?
const work = await courmap.lookup('anilist:142838');
console.log(work.id, work.titles.romaji); // spy-x-family-part-2 Spy x Family Part 2

// Episode 5 of it, in other numberings.
const t = await courmap.translate('anilist:142838', 5, ['anidb', 'tvdb_show', 'absolute']);
console.log(t.results.tvdb_show); // { id: '405920', season: 1, episode: 17 }
console.log(t.results.absolute); // { sequence: 'spy-x-family-absolute', episode: 17 }

// A release name to a work and episode.
const r = await courmap.resolve('[SubsPlease] Spy x Family - 17 (1080p)');
console.log(r.status, r.match?.work, r.match?.episode); // ok spy-x-family-part-2 5

courmap.close();
```

No call above touches the network. PVRs and other tools that resolve many names should use this mode.

## Remote: fetch what you need

```ts
import { createRemoteClient } from '@courmap/client';

const courmap = createRemoteClient(); // https://data.courmap.com/v1/ by default
const t = await courmap.translate('anilist:154587', 12, ['tvdb_show']);
console.log(t.work.id, t.results.tvdb_show); // sousou-no-frieren { id: '424536', season: 1, episode: 12 }
```

The remote client fetches only the files a call needs and caches them by data version. In the browser, import from `@courmap/client/remote`, which has no Node-only code. The [library guide](/reference/library/) compares the two modes; the [API reference](/reference/library/api/) lists every call.

---
title: Library quickstart
description: Translate and resolve anime episodes in your own tool with @courmap/client, in a browser or in Node.
sidebar:
  order: 3
---

`@courmap/client` answers three questions: which [work](/concepts/works/) is this ID, what is this episode in every other numbering, and which work and episode is this [release name](/concepts/release-names/). It runs locally and gives the same answers in both of its modes. The remote client needs nothing but a network connection, so start there.

## Install

```sh
npm install @courmap/client
```

## Remote: nothing to download

```ts
import { createRemoteClient } from '@courmap/client';

const courmap = createRemoteClient(); // https://data.courmap.com/v1/ by default

// Episode 12 of AniList 154587, in TVDB's numbering.
const t = await courmap.translate('anilist:154587', 12, ['tvdb_show']);
console.log(t.work.id, t.results.tvdb_show); // sousou-no-frieren { id: '424536', season: 1, episode: 12 }

// A release name to a work and episode.
const r = await courmap.resolve('[SubsPlease] Spy x Family - 17 (1080p)');
console.log(r.status, r.match?.work, r.match?.episode); // ok spy-x-family-part-2 5
```

The remote client fetches only the small files a call needs and caches them by data version. In a browser, import from `@courmap/client/remote`, which has no Node-only code.

## Offline: download the dump once

Offline mode reads the weekly SQLite dump, so no call touches the network. Use it for PVRs and any tool that resolves many names. Download and unpack the dump of the [latest data release](https://github.com/courmap/courmap/releases/latest). Its file name carries the version, so ask `meta.json` for the address (this uses `curl` and `jq`):

```sh
url=$(curl -sL https://github.com/courmap/courmap/releases/latest/download/meta.json | jq -r .dumps.sqlite.url)
curl -sL "$url" | gunzip > courmap.sqlite
```

[Library: remote vs offline](/guides/library/#offline-mode) shows how to check the download against `SHA256SUMS`. Then open it:

```ts
import { createOfflineClient } from '@courmap/client';

const courmap = createOfflineClient('courmap.sqlite'); // the file you unpacked

// Which work is AniList 142838?
const work = await courmap.lookup('anilist:142838');
console.log(work.id, work.titles.romaji); // spy-x-family-part-2 Spy x Family Part 2

// Episode 5 of it, in other numberings.
const t = await courmap.translate('anilist:142838', 5, ['anidb', 'tvdb_show', 'absolute']);
console.log(t.results.tvdb_show); // { id: '405920', season: 1, episode: 17 }
console.log(t.results.absolute); // { sequence: 'spy-x-family-absolute', episode: 17 }

courmap.close();
```

## Valid targets

The third argument of `translate` is a list of these names (the `Target` type):

| Target | You get |
| --- | --- |
| `anidb`, `anilist`, `mal`, `kitsu` | The provider's ID and the episode number in its own numbering. |
| `tvdb_show`, `tmdb_show` | The show's ID, a season and an episode. |
| `tmdb_movie`, `imdb` | The ID only; these have no episode numbering. |
| `absolute` | The absolute sequence's id and the episode in it, as fansubs number it. |

A target the work has no mapping for comes back under `unmapped`, not as an error. The [library guide](/guides/library/) lists every call and error, and the [API reference](/reference/library/api/) has the full types.

# @courmap/parser

A release-name tokenizer for anime: group, title, season, part, episode or range, version, year, resolution, source, codec, audio and flags, from names like `[SubsPlease] Sousou no Frieren - 12 (1080p) [ABCD1234].mkv`.

```ts
import { parseRelease } from '@courmap/parser';

const p = parseRelease('[SubsPlease] Sousou no Frieren - 12 (1080p)');
console.log(p.group, p.title, p.episode, p.resolution); // SubsPlease Sousou no Frieren 12 1080p
```

Used by [@courmap/client](https://www.npmjs.com/package/@courmap/client) to resolve release names. Code: Apache-2.0. Repository: [github.com/courmap/courmap](https://github.com/courmap/courmap).

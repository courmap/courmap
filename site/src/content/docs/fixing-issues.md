---
title: Fixing open issues
description: What each bot-opened issue means, how to check it, and the fix that closes it.
---

The Courmap bots open an issue whenever two sources disagree and a person should decide. This page explains each kind, how to check the facts yourself, and what a good fix looks like. You do not need to know the whole project: most fixes are one small file. Every open issue is on the [issues page](https://github.com/courmap/courmap/issues); the ones labeled `good first mapping` are the easiest places to start.

## What is a "work id"?

Every show (or cour, or film) in Courmap has one permanent name called its **work id**. It is the lowercase, hyphenated version of its romaji title, for example `shibou-yuugi-de-meshi-wo-kuu`. **The issue already tells you:** it is the text after the colon in the issue's title, and the word in brackets in its first line.

> **TMDB projection mismatch: shibou-yuugi-de-meshi-wo-kuu**
> **Shibou Yuugi de Meshi wo Kuu. (`shibou-yuugi-de-meshi-wo-kuu`)** ...

The work id is also the name of the file you create: for that issue, `data/works/shibou-yuugi-de-meshi-wo-kuu.yaml`, and the first line inside it is `id: shibou-yuugi-de-meshi-wo-kuu`. `data/works/` is a folder in the repository (open the repository on GitHub, then the `data` folder, then `works`). If a file with that name is already there, edit it instead of creating a new one. If the issue is about a different work than the one it is titled with (as in the example below), use that other work's id: find it by searching the repository for the show's title.

## The short version

1. **Pick an issue** and read its "Source data" block: it shows what the provider says and what we have.
2. **Check the facts** on the provider's own page (links below) before changing anything.
3. **Write the smallest fix**: usually one new file named after the work id (see above), such as `data/works/shibou-yuugi-de-meshi-wo-kuu.yaml`, or one entry in `data/rejected.yaml`. See [Contributing mappings](/contributing/) for the file format.
4. **Run `pnpm validate`**, then open a pull request that says what you checked ("Closes #NN"). CI runs the same checks and the resolver corpus.

Not sure? Comment on the issue with what you found. A short note that says "AniList says X, TMDB says Y" is already a contribution.

## What "Source data" is

It is the facts the bot used, so you can check them. Its content depends on the kind of issue:

- **Count conflict, several prequels, projection short:** two blocks, `anilist` (what AniList says) and `ours` (what our data says). The issue is the difference between them.
- **TMDB projection mismatch:** only the TMDB show: its ID (`tmdb_show`) and its page (`url`). The comparison is in the sentence above it, for example "season 1 has 12 episodes on TMDB, but all our works map only up to 11".

## A worked example: issue #90

The issue says: "season 1 has 12 episodes on TMDB, but all our works map only up to 11", for the show `shibou-yuugi-de-meshi-wo-kuu`. So TMDB has one episode more than we map.

1. **Look at our data.** The show is `shibou-yuugi-de-meshi-wo-kuu` (11 episodes, TMDB show 263330, season 1, episodes 1-11). Searching the data for the same TVDB show turns up a second work, `shibou-yuugi-de-meshi-wo-kuu-44-cloudy-beach`, a one-episode movie with no TMDB mapping at all. 11 + 1 = 12, so it may be TMDB's episode 12.
2. **Check TMDB.** Open `https://www.themoviedb.org/tv/263330/season/1` and read episode 12: its title and air date. If it is "44: Cloudy Beach" (or clearly that special), the guess is right. If it is something else, stop here: comment on the issue with what you found, and do not change data.
3. **Make the file.** In your copy of the repository, create `data/works/shibou-yuugi-de-meshi-wo-kuu-44-cloudy-beach.yaml` (the file name is the work's id):

```yaml
id: shibou-yuugi-de-meshi-wo-kuu-44-cloudy-beach
ids:
  tmdb_show: 263330
projections:
  tmdb_show:
    - { season: 1, episodes: 1, start: 12 }
sources:
  - https://www.themoviedb.org/tv/263330/season/1
```

   It says: this work's one episode is TMDB season 1, episode 12. Nothing else about the work changes; the rest still comes from the seed data.
4. **Check it.** Run `pnpm install` once, then `pnpm validate`. It must end with "OK".
5. **Open the pull request** from your fork with a description such as "TMDB season 1 episode 12 is the Cloudy Beach special (checked on TMDB): maps it. Closes #90". CI runs the same checks. The next weekly checker run then finds no mismatch.

## The rules for evidence

- **A provider ID must be real.** Use IDs from the seed data, or an ID you checked yourself on the provider's own page (for example the TMDB show page) and name in the file's `sources:`. Never guess an ID.
- **Look at the provider, not at memory.** AniList, MyAnimeList, TMDB and TVDB pages are the source of truth for their own numbering.
- **Do not copy provider data into the repo.** An ID, a season number and an episode offset are fine. Pasting TMDB or AniList descriptions, title lists or API responses is not.
- **AniDB is off limits.** Do not call the AniDB API or copy AniDB titles.
- **Manual files win.** A file in `data/works/` always overrides the seed and the bot files, key by key, so a small override is safe.

## Reading an issue

Issue titles say what kind it is. The labels say who it is for: `mapping-conflict` needs a decision, `good first mapping` needs a lookup, `season-tracker` is a dashboard and needs nothing.

### Needs TVDB/TMDB mapping (`good first mapping`)

A show premiered more than four weeks ago and has no TVDB or TMDB ID. Find the show on [TheTVDB](https://thetvdb.com) and [TMDB](https://www.themoviedb.org), then add the IDs and a season mapping:

```yaml
id: example-show
ids:
  tvdb_show: 12345
  tmdb_show: 67890
projections:
  tvdb_show:
    - { season: 1, episodes: 1-12 }
  tmdb_show:
    - { season: 1, episodes: 1-12 }
sources:
  - https://www.themoviedb.org/tv/67890
```

If the show has several cours, check how each provider numbers them first (see the TMDB case below).

### Count conflict

AniList and our data disagree about the number of episodes or about whether a show is still airing. Check the AniList page and the work in our data (`data/seeds/works-*.jsonl`, or the [try-it box](/try/)), then decide which is right:

- **Our count is stale** (a show finished or was extended): set `episodes` and `status` in a small `data/works/<id>.yaml`. If the show's projections are open-ended (`1-`), close them with the real range.
- **AniList's entry is only one season of a longer series.** Long-running Chinese series are often split by season on AniList while our work counts the whole run. AniList's smaller number is then not a correction. Reject the update so the bots stop proposing it, and say why:

```yaml
# data/rejected.yaml
rejected:
  - kind: airing
    work: example-long-runner
    reason: AniList's entry is one season of the series; this work counts the whole run.
    decided_by: your-github-name
    date: 2026-10-21
    link: https://github.com/courmap/courmap/issues/16
    origin: manual
```

- **Both counts are plausible and nothing else settles it** (a lower count while a show airs): say so on the issue and leave it. An airing show's count is only a lower bound anyway.

### Several prequels

AniList names more than one prequel for a work, but a work has one. Usually one is a recap or compilation of the other. Pick the real predecessor and reject the other relation:

```yaml
  - kind: relation
    work: the-film
    prequel: the-recap-compilation
    reason: The compilation only retells the series, which is the real prequel.
    decided_by: your-github-name
    date: 2026-10-21
    origin: manual
```

The next bot run then proposes a pull request for the remaining prequel.

### Projection short of the count

AniList lists more episodes than our mapping covers (for example 13 against a mapping that stops at 2). Extend the mapping in a `data/works/` file so every episode has a place, or, if the provider really stops there, mark the block `coverage: partial`. Often the data was already fixed by a newer seed and the issue is stale: say so on the issue.

### TMDB projection mismatch

The weekly check compares our TMDB season mapping with TMDB's season list and opens an issue when they differ. TMDB often arranges seasons differently from TVDB, so the fix is usually to follow TMDB. Open the show's TMDB page and compare the season list with the issue:

| What TMDB shows | What it means | The fix |
| --- | --- | --- |
| One season holding both cours, no season 2 | TMDB keeps the cours together; we mapped the sequel to a season 2 that does not exist | Map the sequel to season 1, starting after the first cour: `{ season: 1, episodes: 1-12, start: 13 }`. The bots now propose this themselves as a pull request when the counts add up exactly. |
| More episodes than we map (for example 24 against our 12) | The second cour or a special is missing from our mapping, or TMDB counts differently | Map the missing part, or if TMDB counts segments (a 13-episode show listed as 30), copy the split TVDB uses |
| "TMDB has no TV show" | The TMDB ID in the seed data is not a TV show (often a movie ID) | Do not guess a new ID. Find the right TMDB page, check it by hand, and put it in the file with the link in `sources:` |
| Fewer episodes than we map on a show that is still airing | TMDB is behind; nothing is wrong | Nothing. The checker already ignores this for six weeks after the premiere |
| A specials count that is lower on TMDB | TMDB's specials list is usually incomplete | Nothing; the checker no longer reports it |

**How to see what TMDB says, without an account or a key.** The issue links the TMDB show. Open its seasons page, `https://www.themoviedb.org/tv/<id>/seasons` (the `<id>` is the `tmdb_show` number in the issue), and note for each season its episode count and first air date. If a season you expected is missing, TMDB has merged it into an earlier one: add up the earlier seasons' counts and compare them with our works' episode counts for the same show. That is all the checker compares, so what you read there is the evidence for your fix. Put the TMDB page in the file's `sources:`.

For AniList you can run `pnpm bots anilist-show <work-id>` from a checkout of the repository (it needs no key and asks AniList politely, in batches) to see its entry next to ours: status, episode count, start date and its prequel and sequel entries. Or just open the AniList page the issue links.

If you would rather not check by hand, comment on the issue and say so. A maintainer can run the **tmdb-inspect** workflow, which prints the show's name, status, every season with its episode count and air date, and the shows a title search finds, in the run log (the TMDB key is a repository secret, so only maintainers can run it).

The bots close their own TMDB issues on a later run once the mismatch is gone, so you do not need to close those by hand.

### Season tracker

A pinned dashboard of the season's shows and their state. It is generated; nothing to do.

## Bot pull requests

The bots also open pull requests, each with a small file under `data/seeds/` (`relations/`, `airing/` or `tmdb-splits/`, one file per work). Review one by reading its description: it says what changes and why. Check the claim on the provider's page, look at the CI result, and approve or comment. To reject a proposal for good, close it and add an entry to `data/rejected.yaml` with the reason; the bots never propose it again. Bot pull requests are merged by a maintainer.

## When you are done

- A merged fix reaches users in the next data release (a revision such as `2026.43.7` when the data changed within a week).
- Open issues the fix resolves are closed by the pull request ("Closes #NN"), or by the checker for TMDB ones.
- Thank you. Corrections here fix numbering for every Sonarr user and library that uses Courmap.

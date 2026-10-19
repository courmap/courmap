---
title: How automation works
description: What the bots watch, the three tiers, and what each label asks of a reviewer.
---

Bots keep the data current. They detect changes, write the data, and open a pull request or an issue; a person only steps in where sources disagree or a sequel's numbering needs judgment. While the bots are new they run in dry-run mode: they open pull requests and issues but never merge anything themselves.

## What they watch

| Bot | When | Watches |
| --- | --- | --- |
| Season scanner | Daily | AniList's current and next season: IDs, format, status, episode counts and prequel or sequel relations. About ten batched requests a day, no titles. |
| Airing tracker | Daily | AniList's status and episode count for every work Courmap lists as airing. |
| Seed job | Weekly (Tuesday) | New releases of anime-offline-database and Anime-Lists, as one pull request. |
| Projection checker | Weekly | TMDB season episode counts against Courmap's TMDB mappings. Nothing it reads is stored. |

## The three tiers

| Tier | Label | When | What you do |
| --- | --- | --- | --- |
| A | `auto` | Counts agree across sources: an airing work's count grows, a show finishes with the count Courmap expects. | Nothing. These merge once tier A is switched on; until then, a glance and merge. |
| B | `needs-review` | AniList names a sequel's prequel, or an update changes an existing absolute sequence. | Check the diff in the pull request body (which prequel and which absolute numbers change) and approve or edit. About a minute. |
| C | `mapping-conflict` or `good first mapping` | Sources disagree, a count shrinks, a manual file is involved, a change would renumber a finished work, or a new show still has no TVDB or TMDB mapping four weeks after it premiered. | Real judgment, as an issue with every source's data attached. `good first mapping` issues are a good place to start contributing. |

Bots never edit files in `data/works/`: their data lives in `data/seeds/airing.jsonl` and `data/seeds/relations.jsonl`, and any hand-written file wins over it key by key.

## Where to look

- A pinned **Season tracker** issue per anime season lists every show and its state: mapped, auto-update, awaiting review, conflict, waiting for seed, or upcoming. The bots rewrite it on every run.
- A **weekly digest** sums up the week: what merged, what needs review, what conflicts are open.
- A bot that fails twice in a row opens a `bot-failure` issue about itself.

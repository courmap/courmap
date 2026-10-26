---
title: How automation works
description: What the bots watch, the three tiers, and what each label asks of a reviewer.
---

Bots keep the data current. They detect changes, write the data, and open a pull request or an issue; a person only steps in where sources disagree or a sequel's numbering needs judgment. While the bots are new they run in dry-run mode: they open pull requests and issues but never merge anything themselves.

## What they watch

| Bot | When | Watches |
| --- | --- | --- |
| Season scanner | Daily | AniList's current and next season: IDs, format, status, episode counts and prequel or sequel relations. About ten batched requests a day, no titles. |
| Airing tracker | Daily | AniList's status and episode count for every [work](/concepts/works/) Courmap lists as airing. |
| Seed job | Weekly (Tuesday) | New releases of anime-offline-database and Anime-Lists, as one pull request. |
| Projection checker | Weekly | TMDB season episode counts against Courmap's TMDB mappings. Nothing it reads is stored. |

## The three tiers

| Tier | Label | When | What you do |
| --- | --- | --- | --- |
| A | `auto` | Counts agree across sources: an airing work's count grows, a show finishes with the count Courmap expects. | Nothing. These merge once tier A is switched on; until then, a glance and merge. |
| B | `needs-review` | AniList names a sequel's prequel, an update changes an existing [absolute sequence](/concepts/absolute-sequences/), or TMDB lists episodes we do not map and one other work of the show fills the gap exactly. | Check the diff in the pull request body (which prequel and which absolute numbers change, or which work the TMDB episodes belong to) and approve or edit. About a minute. |
| C | `mapping-conflict` or `good first mapping` | Sources disagree, a count shrinks, a manual file is involved, a change would renumber a finished work, or a new show still has no TVDB or TMDB mapping four weeks after it premiered. | Real judgment, as an issue with every source's data attached. `good first mapping` issues are a good place to start contributing. |

Bots never edit files in `data/works/`: their data lives in one small file per work under `data/seeds/airing/`, `data/seeds/relations/` and `data/seeds/tmdb-splits/`, and any hand-written file wins over it key by key.

## Rejected proposals stay rejected

Closing a bot pull request is not enough on its own: the next scan would see the same AniList data and open it again. When a maintainer rejects a proposal, they close the pull request and add an entry to `data/rejected.yaml` with the reason and a link to it:

```yaml
rejected:
  - kind: relation            # or airing
    work: wushen-zhuzai-da-wei-pian
    prequel: wushen-zhuzai
    reason: Both works have been airing side by side since 2022, so the order is doubtful.
    decided_by: Xwolv
    date: 2026-10-19
    link: https://github.com/courmap/courmap/pull/10
    origin: manual
```

The bots read this file before proposing anything and never propose a matching change again; the Season tracker shows the reason instead. A `relation` entry blocks that one prequel link. An `airing` entry blocks every status or count update for the work, or, with `episodes` or `status`, only updates to exactly those values, so a later, different count still comes through. `pnpm validate` checks the file against its schema and that every work it names exists. To undo a rejection, delete the entry.

The airing tracker also never writes a count of 1 for an airing TV season: AniList shows 1 when it does not know the count yet, so the bots treat it as unknown. A real count already in the data stays; otherwise the work starts airing with its count unknown.

## Where to look

- A pinned **Season tracker** issue per anime season lists every show and its state: mapped, auto-update, awaiting review, conflict, waiting for seed, or upcoming. The bots rewrite it on every run.
- A **weekly digest** sums up the week: what merged, what needs review, what conflicts are open.
- A bot that fails twice in a row opens a `bot-failure` issue about itself.

# Courmap proxy for Sonarr

A Torznab and Newznab proxy that sits between Sonarr and your indexers, for torrents and usenet alike (Prowlarr, Jackett, or any Torznab or Newznab feed). It resolves every anime release name with Courmap and rewrites it into numbering Sonarr understands, so split cours, absolute fansub numbering and long-runners import as the right TVDB episode.

```
Sonarr  ->  Courmap proxy (/nyaa, /animetosho, /geek, ...)  ->  indexer feeds (torrent or usenet)
```

What it does with each result:

- **Resolved:** the title becomes `<your Sonarr series title> S01E17 <original quality and tags> [Group]`, and the `tvdbid` attribute is set. `[SubsPlease] Spy x Family - 17 (1080p)` becomes `Spy x Family S01E17 (1080p) [SubsPlease]`, using the title from your own Sonarr. Everything else in a result (download link, NZB or torrent enclosure, size, seeders, grabs, dates) reaches Sonarr unchanged.
- **Batches:** a batch that is exactly one TVDB season becomes a season pack (`S01`). A range inside one season becomes `S01E05-E08`. A batch spanning seasons passes through unchanged.
- **Ambiguous or unmatched:** the release passes through unchanged, so Sonarr behaves exactly as it does without the proxy. The name is logged locally and shown on the status page.
- **Resolved, but Courmap has no TVDB numbering yet** (often new shows and shorts): the proxy may number it from your own Sonarr. The work must match exactly one of your series by title (or by its TVDB ID); a first season keeps its own numbers, a sequel uses Sonarr's absolute numbers when that series also holds its prequels. Anything less certain passes through. These show as "assisted" on the status page, and the "copy as GitHub issue" block turns each one into a mapping others can use.
- **Searches:** Sonarr's searches by TVDB ID, season and episode, or by absolute number, are translated into what anime indexers understand: the work's own title plus its episode number, and the franchise title plus the absolute number when fansubs number it that way.

Nothing is sent anywhere except to your own indexers (or Prowlarr), your own Sonarr and GitHub (for the weekly data release). Unresolved names stay on your machine.

## Run it with Docker Compose

```yaml
services:
  courmap-proxy:
    image: ghcr.io/courmap/proxy:edge
    container_name: courmap-proxy
    restart: unless-stopped
    ports:
      - "9797:9797"            # status page at http://<host>:9797/
    volumes:
      - ./courmap/data:/data    # downloaded dumps and the unresolved log
      - ./courmap/config:/config
    environment:
      SONARR_URL: http://sonarr:8989
      SONARR_API_KEY: your-sonarr-api-key
      # One line per Prowlarr indexer you want to proxy: INDEXER_<NAME>_URL.
      # The proxy serves it at http://courmap-proxy:9797/<name>.
      INDEXER_NYAA_URL: http://prowlarr:9696/1/api
      INDEXER_ANIMETOSHO_URL: http://prowlarr:9696/2/api
      # A usenet indexer is the same, with its type set to newznab (see "Usenet" below).
      INDEXER_GEEK_URL: http://prowlarr:9696/3/api
      INDEXER_GEEK_TYPE: newznab
      # Data updates come from the latest GitHub data release. To pin a local dump instead:
      # COURMAP_DUMP: /data/courmap.sqlite
```

Put it on the same Docker network as Sonarr and Prowlarr. (No Prowlarr? Any Torznab feed works. With Jackett, use the indexer's "Copy Torznab Feed" address plus `api`, for example `http://jackett:9117/api/v2.0/indexers/nyaasi/results/torznab/api`, and the Jackett API key in Sonarr. Sonarr's built-in Nyaa indexer reads RSS, not Torznab, so it cannot go through the proxy.) Then:

1. **In Prowlarr**, note each anime indexer's number: its Torznab feed is `http://prowlarr:9696/<number>/api`. Then stop Prowlarr syncing those indexers to Sonarr, or Sonarr sees every result twice, once without the proxy. Prowlarr's app tags only include indexers (and it re-adds indexers deleted from Sonarr by hand), so give a tag such as `sonarr` to every indexer Sonarr should still get directly, add that tag to the Sonarr app under Settings > Apps with Sync Level "Full Sync", and click "Sync App Indexers": Prowlarr removes the untagged anime indexers from Sonarr.
2. **In Sonarr**, go to Settings > Indexers and add a Torznab indexer for each proxied torrent feed (a Newznab indexer for each usenet one, see below):
   - URL: `http://courmap-proxy:9797/nyaa`
   - API Path: `/api`
   - API Key: your Prowlarr API key (the proxy passes it on)
   - Categories and Anime Categories: your anime categories, usually `5070`
   - Optional: turn on "Anime Standard Format Search"; the proxy translates both kinds of search.
3. Open `http://<host>:9797/` to check that the data version and the Sonarr series count show up.

### Usenet (Newznab) indexers

Usenet works like torrents, with three differences:

- **Say it is usenet.** Set `INDEXER_<NAME>_TYPE=newznab` next to the indexer's `INDEXER_<NAME>_URL`. Torrent indexers can say `torznab`. When it is left out the proxy learns the protocol from the feed's first results, which is fine for most setups; setting it is safer on a feed that may be empty at first. The status page shows what each indexer is, and flags a type that disagrees with its feed.
- **In Sonarr, add a Newznab indexer.** Settings > Indexers > **+** > **Newznab** (Custom). URL `http://courmap-proxy:9797/<name>`, API Path `/api`, **API Key** the usenet indexer's own key (or Prowlarr's, if the feed comes from Prowlarr; the proxy passes it on), and **5070** (TV/Anime) in **Anime Categories** and **Categories**. Pick the type that matches the indexer: Sonarr reads the two protocols' results differently, so a mismatch returns nothing useful (its log hints at it, for example "did you intend to add a Torznab indexer?").
- **Downloads do not go through the proxy.** NZB links point straight at your indexer, as before.

Without a Prowlarr in the middle, point the URL at the indexer itself, for example `INDEXER_GEEK_URL=https://api.nzbgeek.info/api` (the indexer's API address).

## Configuration

Environment variables win over the optional YAML file at `/config/courmap-proxy.yaml` (see `courmap-proxy.example.yaml`).

| Variable | Default | Meaning |
| --- | --- | --- |
| `SONARR_URL`, `SONARR_API_KEY` | none | Your Sonarr. Without them every release passes through unchanged. |
| `INDEXER_<NAME>_URL` | none | An upstream Torznab or Newznab feed, served at `/<name>` (underscores become hyphens, lowercase). |
| `INDEXER_<NAME>_TYPE` | detected | `torznab` (torrents) or `newznab` (usenet). When unset, learned from the feed's first results. |
| `INDEXER_<NAME>_APIKEY` | none | The upstream key, if you would rather not use the one Sonarr sends. |
| `COURMAP_DUMP` | none | A fixed local dump. The proxy then never downloads data. |
| `COURMAP_META_URL` | `https://github.com/courmap/courmap/releases/latest/download/meta.json` | Where the current data version and dump are announced: the latest GitHub data release. |
| `REFRESH_HOURS` | `24` | How often `meta.json` is checked. A dump is downloaded only when the data version changes, and its SHA-256 is checked before it replaces the old one. |
| `SONARR_REFRESH_MINUTES` | `60` | How often the series list is reloaded. |
| `PORT` | `9797` | Listening port. |
| `DATA_DIR` | `/data` | Dumps, `current.json` and `unresolved.jsonl`. |
| `TIMEOUT_SECONDS` | `60` | Upstream request timeout. |

## Unraid

1. Open the **Docker** tab and choose **Add Container**, with the template set to none.
2. Fill in:
   - **Name:** `courmap-proxy`
   - **Repository:** `ghcr.io/courmap/proxy:edge`
   - **Network Type:** the same custom network as Sonarr and Prowlarr (for example `proxynet`), so the container names resolve. On plain `bridge`, use the Unraid server's IP and the published ports in the URLs instead.
   - **Extra Parameters:** `--user 99:100`, so files belong to `nobody:users` like your other appdata.
3. Use **Add another Path, Port, Variable, Label or Device** for each of:
   - **Port:** container `9797`, host `9797`.
   - **Path:** container `/data`, host `/mnt/user/appdata/courmap-proxy/data`.
   - **Path:** container `/config`, host `/mnt/user/appdata/courmap-proxy/config`.
   - **Variables:** `SONARR_URL` (for example `http://sonarr:8989`), `SONARR_API_KEY` (Sonarr > Settings > General), and one `INDEXER_<NAME>_URL` per indexer (for example `INDEXER_NYAA_URL` = `http://prowlarr:9696/1/api`). For a usenet indexer add `INDEXER_<NAME>_TYPE` = `newznab` (for example `INDEXER_GEEK_URL` and `INDEXER_GEEK_TYPE`).
4. **Apply.** Open the WebUI at `http://<unraid-ip>:9797/` and check that the page shows a data version and your series count.
5. If the status page says the data folder is not writable, run `chown -R 99:100 /mnt/user/appdata/courmap-proxy` from the Unraid terminal.
6. Add the indexers in Sonarr as described above, using `http://courmap-proxy:9797/<name>`. Remove or disable the same indexers' direct Prowlarr entries in Sonarr.

## Status page

`http://<host>:9797/` shows the data version, the last refresh and its error if any, the Sonarr connection, and per indexer: its protocol (torznab or newznab, as configured or detected), requests, searches (and how many were translated), items, how many were rewritten, and why the rest passed through. Below that is the list of unresolved release names, with a text block to paste into a GitHub issue if you want to help improve Courmap. `/status.json` has the same data; `/health` is for health checks.

## Development

```sh
pnpm vitest run packages/proxy                    # fake Prowlarr and Sonarr, end to end
node packages/proxy/scripts/bundle.mjs dev        # the single-file bundle the image runs
docker build -f packages/proxy/docker/Dockerfile -t courmap-proxy .
```

---
title: For Sonarr users
description: Get anime episodes imported correctly with the Courmap proxy, in about five minutes.
sidebar:
  order: 1
---

Sonarr numbers anime by TVDB, while fansub releases number by the anime's own episodes or by absolute (fansub) numbering. The Courmap proxy sits between Prowlarr and Sonarr and rewrites each release name it can resolve into the numbering Sonarr expects. Releases it is unsure about pass through untouched, so Sonarr never does worse than without it.

You need Docker, Sonarr v4 and Prowlarr.

## 1. Run the proxy

```yaml
services:
  courmap-proxy:
    image: ghcr.io/courmap/proxy:edge
    container_name: courmap-proxy
    restart: unless-stopped
    ports:
      - "9797:9797"
    volumes:
      - ./courmap/data:/data
    environment:
      SONARR_URL: http://sonarr:8989
      SONARR_API_KEY: your-sonarr-api-key
      INDEXER_NYAA_URL: http://prowlarr:9696/1/api
```

Put it on the same Docker network as Sonarr and Prowlarr, and use one `INDEXER_<NAME>_URL` per Prowlarr anime indexer (the number in the URL is the indexer's ID in Prowlarr).

## 2. Add it to Sonarr

In Sonarr, open **Settings**, then **Indexers**, then **+**, choose **Torznab**, and fill in:

- **URL**: `http://courmap-proxy:9797/nyaa`
- **API Path**: `/api`
- **API Key**: your Prowlarr API key
- **Categories** and **Anime Categories**: `5070`

Then stop Prowlarr from also adding that indexer to Sonarr directly, or every result arrives twice.

## 3. Check it

Open `http://<your-host>:9797/`. The status page shows the data version, how many of your Sonarr series the proxy knows, and how many results it rewrote.

The [Sonarr guide](/sonarr/) covers every setting, Unraid, what the proxy rewrites and what it never touches, and troubleshooting.

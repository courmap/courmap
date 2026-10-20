# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem. Use GitHub's private reporting instead:
[Report a vulnerability](https://github.com/courmap/courmap/security/advisories/new).

Include what you found, how to reproduce it, and which package or service is affected (the proxy, the
client libraries, the data pipeline, or the Cloudflare Worker behind api.courmap.com). You should hear back within a
week.

## What is in scope

- The Courmap proxy (`packages/proxy`, the `ghcr.io/courmap/proxy` image), including anything that could
  expose a Sonarr or indexer API key.
- The npm packages under `@courmap`.
- The Worker in `worker/` and the release pipeline.

The data in `data/` is public by design. A wrong mapping is a normal issue, not a vulnerability.

## Supported versions

Only the latest release of each package, and the `:edge` proxy image built from `main`, get fixes.

# ghcr.io/courmap/proxy: the Courmap Sonarr Torznab and Newznab proxy (packages/proxy).
# Build from the repository root:
#   docker buildx build -f packages/proxy/docker/Dockerfile --platform linux/amd64,linux/arm64 .

# 1. Bundle the proxy and its workspace packages into one file (better-sqlite3 stays external).
FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS bundle
ARG VERSION=dev
WORKDIR /src
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY worker ./worker
RUN pnpm install --frozen-lockfile --ignore-scripts
RUN node packages/proxy/scripts/bundle.mjs "${VERSION}"

# 2. better-sqlite3 for the target platform (prebuilt when available, compiled otherwise).
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN npm init -y >/dev/null && npm install --omit=dev --no-audit --no-fund better-sqlite3@12.11.1

# 3. Runtime.
FROM node:22-bookworm-slim
LABEL org.opencontainers.image.source="https://github.com/courmap/courmap" \
      org.opencontainers.image.description="Courmap Sonarr Torznab and Newznab proxy: anime release names in the numbering Sonarr understands" \
      org.opencontainers.image.licenses="Apache-2.0"
ENV NODE_ENV=production PORT=9797 DATA_DIR=/data COURMAP_CONFIG=/config/courmap-proxy.yaml
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=bundle /src/packages/proxy/docker/proxy.mjs ./proxy.mjs
RUN mkdir -p /data /config && chown -R node:node /data /config
USER node
VOLUME ["/data", "/config"]
EXPOSE 9797
HEALTHCHECK --interval=60s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||9797)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "proxy.mjs"]

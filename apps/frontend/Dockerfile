# syntax=docker/dockerfile:1
# Build context: repository root (see docker-compose.yml).

FROM node:22-alpine AS build
RUN npm install -g pnpm@11.1.2
WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yam[l] ./
# The root prepare script builds the packages on install, before their sources are
# copied; the build step below builds them instead.
RUN npm pkg delete scripts.prepare
COPY packages/shared/package.json packages/shared/
COPY packages/engine/package.json packages/engine/
COPY packages/ui-tokens/package.json packages/ui-tokens/
COPY packages/api-client/package.json packages/api-client/
COPY apps/frontend/package.json apps/frontend/
RUN if [ -f pnpm-lock.yaml ]; then FROZEN=--frozen-lockfile; else FROZEN=--no-frozen-lockfile; fi \
 && pnpm install $FROZEN --filter "@waypoint/frontend..."
COPY packages/shared packages/shared
COPY packages/engine packages/engine
COPY packages/ui-tokens packages/ui-tokens
COPY packages/api-client packages/api-client
COPY apps/frontend apps/frontend
RUN pnpm --filter "@waypoint/frontend..." build

# Caddy serves the SPA and proxies /api to the Nest API on the same origin.
# Set SITE_ADDRESS to a domain in production for automatic HTTPS.
FROM caddy:2-alpine
COPY deploy/caddy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/frontend/dist /srv
EXPOSE 80 443

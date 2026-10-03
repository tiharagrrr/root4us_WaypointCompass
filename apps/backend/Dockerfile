# syntax=docker/dockerfile:1
# Build context: repository root (see docker-compose.yml).
# One image, three roles: api (default), worker, and the one-shot seed job.

FROM node:22-alpine AS base
RUN npm install -g pnpm@11.1.2
WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yam[l] ./
COPY packages/shared/package.json packages/shared/
COPY packages/engine/package.json packages/engine/
COPY apps/backend/package.json apps/backend/

FROM base AS build
RUN if [ -f pnpm-lock.yaml ]; then FROZEN=--frozen-lockfile; else FROZEN=--no-frozen-lockfile; fi \
 && pnpm install $FROZEN --filter "@waypoint/api..."
COPY packages/shared packages/shared
COPY packages/engine packages/engine
COPY apps/backend apps/backend
RUN pnpm --filter "@waypoint/api..." build

FROM base AS prod-deps
RUN if [ -f pnpm-lock.yaml ]; then FROZEN=--frozen-lockfile; else FROZEN=--no-frozen-lockfile; fi \
 && pnpm install $FROZEN --prod --filter "@waypoint/api..."

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=prod-deps --chown=node:node /repo /repo
COPY --from=build --chown=node:node /repo/packages/shared/dist packages/shared/dist
COPY --from=build --chown=node:node /repo/packages/engine/dist packages/engine/dist
COPY --from=build --chown=node:node /repo/apps/backend/dist apps/backend/dist
COPY --chown=node:node apps/backend/drizzle apps/backend/drizzle
# Shared challenge datasets used by the seed job (SEED_DATA_DIR).
COPY --chown=node:node data/seed data/seed
USER node
WORKDIR /repo/apps/backend
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3000/health/live || exit 1
CMD ["node", "dist/main.js"]

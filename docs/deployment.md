# Deployment

The same images run in these environments:

| Environment | Purpose | How |
| --- | --- | --- |
| Docker Compose | Judges, local work, fallback host | `docker compose up --build` at the repo root |
| Kubernetes (Oracle OKE free tier) | Public HTTPS URL for review, semifinal and finale | Manifests in `deploy/k8s`, images from GHCR |
| Railway | Live demo URL | One service per app, built from the same Dockerfiles ([below](#railway-live-demo)) |

## Docker Compose

```bash
cp .env.example .env         # optional; defaults are self-contained
docker compose up --build
```

| Service | Role | Host port |
| --- | --- | --- |
| `web` | Caddy: SPA + `/api` proxy | `8080` |
| `api` | NestJS REST API (`/api/v1`, docs at `/api/docs`) | `3000` |
| `worker` | BullMQ jobs | none |
| `seed` | One-shot: migrations + datasets, then exits | none |
| `postgres` | PostgreSQL 17 | `5432` |
| `redis` | Redis 7 | `6379` |
| `s3` / `s3-init` | Garage: S3 storage for POD, plus bucket and key creation | `9000`, admin API `9001` |
| `prometheus`, `loki`, `alloy`, `grafana` | `--profile observability` only | Grafana `3001` |

Reset everything, including the database: `docker compose down -v`.

### Hosting on a single VM (fallback)

1. Point a DNS name (or a free `sslip.io` hostname) at the VM.
2. In `.env`, set `SITE_ADDRESS=waypoint.example.com`, `APP_URL=https://waypoint.example.com`, a strong `BETTER_AUTH_SECRET`, strong DB/S3 passwords and fresh `GARAGE_RPC_SECRET` and `GARAGE_ADMIN_TOKEN` values.
3. Publish ports 80 and 443 for `web` (add `"443:443"` to its `ports`) and remove the host ports for `postgres`, `redis` and `s3` — the Garage admin API manages buckets and keys and must never be public.
4. `docker compose up -d --build`. Caddy obtains the TLS certificate automatically.

## Kubernetes (public URL)

See the team spec for the full design. In summary:

- **Workloads:** `web` (2 replicas), `api` (HPA on 70% CPU, 2 to 6 replicas), `worker` (KEDA on BullMQ queue length, 1 to 4), `redis`.
- **State lives outside the cluster:** Supabase Postgres (pooled URL for the app, direct URL for migrations) and Supabase Storage via its S3 API.
- **Ingress:** ingress-nginx + cert-manager (Let's Encrypt). HTTPS is required for the PWA service worker.
- **Images:** multi-arch (`amd64` + `arm64`, since OKE A1 nodes are ARM) built by GitHub Actions and pushed to GHCR.
- **Migrations and seed:** a Kubernetes `Job` that runs the same `seed` command as Compose before each rollout.
- **Supabase free tier pauses after a week of inactivity.** Keep a scheduled DB ping in the worker, or use Pro, for the whole review period.
- **Timebox:** if OKE setup takes more than half a day, fall back to Compose on one VM.

## Railway (live demo)

Project `rare-heart`, environment `production`: `@waypoint/frontend` (public URL),
`@waypoint/api` (no public domain), `Postgres`, `Redis`. The browser only ever talks to the
frontend's origin; Caddy proxies `/api` to the API over Railway's private network, so the API
needs no CORS and no public domain.

Each service's config comes from its own `railway.json`, which Railway only reads when the
service's **config-as-code path** is set to it (`apps/backend/railway.json`,
`apps/frontend/railway.json`). With that path unset the file is ignored and Railway falls back to
Railpack autodetect, which for this workspace starts `vite preview` on loopback — the edge then
answers `502` with `x-railway-fallback: true`.

| Service | Variable | Value |
| --- | --- | --- |
| `@waypoint/frontend` | `SITE_ADDRESS` | `:8080` (Caddy's listen address; never a bare domain, Railway terminates TLS) |
| `@waypoint/frontend` | `PORT` | `8080` |
| `@waypoint/frontend` | `API_UPSTREAM` | `waypointapi.railway.internal:8080` (the API's `RAILWAY_PRIVATE_DOMAIN` and its port) |
| `@waypoint/api` | `APP_URL` | `https://<frontend public domain>` — BetterAuth's `baseURL`, and `useSecureCookies` is derived from its scheme |
| `@waypoint/api` | `SEED_PASSWORD` | 10+ characters, or the seed skips every persona account |

The public domain carries its own **target port**, which must match Caddy's listen port. A domain
created while the service listened elsewhere keeps the old port and every request falls back to
`502` even though the container is healthy:

```bash
railway domain list --service <service-id> --json
railway domain update <domain> --port 8080 --service <service-id>
```

Pass service and project **IDs**, not names: `@waypoint/api` and `@waypoint/frontend` do not
resolve, and `railway environment edit --service-config` silently reports
`{"committed":false,"message":"No changes to apply"}` while changing nothing.

### Migrations and seed

`deploy.preDeployCommand` runs `node dist/db/migrate.js` before each release, so a fresh database
gets its schema on the next deploy. Without it the tables never exist and sign-in fails with
`relation "users" does not exist` surfaced as a `500` from `/api/auth/sign-in/email`.

The seed is a separate one-shot step — set `SEED_PASSWORD` first, then:

```bash
railway ssh --service <api-service-id> --environment production --project <project-id>
cd /repo/apps/backend && node dist/db/seed.js
```

Never run `db:reset` or `drizzle-kit push` against a deployed database.

### Not yet on Railway

There is no `worker` service, so the cutoff ticker, outbox relay and BullMQ jobs do not run. The
backend image already supports it: add a service from the same Dockerfile with
`startCommand: node dist/worker.js`.

## Environment variables

Every variable is documented in [`.env.example`](../.env.example), which Compose reads. Each app also has its own example for running it outside Compose: [`apps/backend/.env.example`](../apps/backend/.env.example) (loaded before the root `.env`, so its values win) and [`apps/frontend/.env.example`](../apps/frontend/.env.example) (Vite reads only this folder; `VITE_*` values are public and baked in at build time). The API validates its environment at boot ([`env.schema.ts`](../apps/backend/src/config/env.schema.ts)) and refuses to start with a clear message if anything is missing.

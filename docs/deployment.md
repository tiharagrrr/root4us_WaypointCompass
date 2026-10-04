# Deployment

The same images run in these environments:

| Environment | Purpose | How |
| --- | --- | --- |
| Docker Compose | Judges, local work, fallback host | `docker compose up --build` at the repo root |
| Railway | Public HTTPS URL (https://waypoint-root4us.up.railway.app) | One service per app, built from the same Dockerfiles ([below](#railway-live-demo)) |

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

## Kubernetes (designed, not built)

The original plan for the public URL. No manifests were written; the live demo runs on Railway instead ([decisions.md](decisions.md#13-railway-for-the-live-demo)). The design, for the record:

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

**`apps/backend/railway.json` and `apps/frontend/railway.json` are inert, and can no longer be
switched on.** Railway reads config-as-code only from the repo root or a per-service config path;
neither is set here, and the path can no longer be set at all — Railway now rejects it with
*"Config as Code (railway.json / railway.toml) is deprecated"*. Existing config-as-code files stop
being read entirely on **2026-12-01**. The live config is therefore whatever is set in the
dashboard, and the two `railway.json` files only document intent.

The replacement is Infrastructure as Code in [`.railway/railway.ts`](../.railway/railway.ts),
generated with `railway config pull` and applied with `railway config plan` / `railway config apply`
(both need `railway` installed at the repo root).

> **Never run `railway config migrate --apply` in this repo.** It merges the two inert `railway.json`
> files into `.railway/railway.ts` naming the services `backend` and `frontend` — which match
> nothing live — and omits `Postgres`, `Redis`, both volumes and the bucket. A whole-project apply
> deletes resources omitted from the file, so it would create two stray services and plan to destroy
> the databases. Use `railway config pull`, which imports live state with the real service names and
> renders variables as `preserve()`.

Where a service has no start command at all, Railway falls back to Railpack autodetect, which for
this workspace starts `vite preview` on loopback — the edge then answers `502` with
`x-railway-fallback: true`.

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

### The three database roles (once per environment, before the first migration)

`compass_owner`, `compass_app` and `compass_readonly` are **not** created by migrations — `rls.ts`
declares them with `pgRole(...).existing()`, and
[`deploy/db/roles.sql`](../deploy/db/roles.sql) creates them once per environment. Compose runs it
from `deploy/db/init/00-roles.sh` when the Postgres volume is first created, and CI runs it before
`db:migrate`. **Railway has no Postgres init hook**, and the API image has no `psql`, so the same
statements run from Node instead: [`bootstrap-roles.ts`](../apps/backend/src/db/bootstrap-roles.ts).

Until it is, the first migration fails on the first RLS policy and the whole migration rolls back
(Drizzle wraps the run in one transaction, so the database is left empty, not half-built):

```
[migrate] failed: role "compass_app" does not exist   -- code 42704
CREATE POLICY "order_lines_app_scope" ON "order_lines" ... TO "compass_app"
```

On Railway, set `DB_BOOTSTRAP_ROLES=true` on `@waypoint/api` and put the script first in the
pre-deploy command, so a fresh environment bootstraps itself with no manual step:

```
sh -c "node dist/db/bootstrap-roles.js && node dist/db/migrate.js && node dist/db/seed.js"
```

It reads the passwords from `COMPASS_OWNER_PASSWORD`, `COMPASS_APP_PASSWORD` and
`COMPASS_READONLY_PASSWORD`, and connects through `ADMIN_URL` if set, otherwise `DIRECT_URL`.
Creating a role needs `CREATEROLE`, which `compass_owner` does not have — on Railway `DIRECT_URL`
is the `postgres` superuser, so it works as-is; elsewhere point `ADMIN_URL` at an admin connection.

It is idempotent (an existing role keeps its grants and only has its password reset), so it is safe
on every deploy. **It is off unless `DB_BOOTSTRAP_ROLES` is set**, because the migration role has no
`CREATEROLE` on a managed Postgres such as Supabase, where the roles are created by an admin
instead.

For that case, or to bootstrap by hand, run the SQL directly — note the Railway database is named
`railway`, not `waypoint`:

```bash
railway connect Postgres --tunnel-only   # prints a local host and port, holds open

# in a second terminal, against the tunnel
psql "postgres://postgres:$POSTGRES_PASSWORD@127.0.0.1:<tunnel-port>/railway" -v ON_ERROR_STOP=1 \
  -v db=railway \
  -v owner_password="$COMPASS_OWNER_PASSWORD" \
  -v app_password="$COMPASS_APP_PASSWORD" \
  -v readonly_password="$COMPASS_READONLY_PASSWORD" \
  -f deploy/db/roles.sql
```

Locally: `pnpm --filter api db:bootstrap-roles` (Compose already does it for you).

> **`DATABASE_URL` and `DIRECT_URL` currently both point at the `postgres` superuser.** The design is
> `DATABASE_URL` as `compass_app` (filtered by row-level security) and `DIRECT_URL` as
> `compass_owner` (migrations and seed, bypasses RLS). A superuser bypasses RLS, so while the API
> connects as `postgres` every row-level scope guarantee is silently off and out-of-scope rows are
> readable. Repoint both variables once the roles exist.

### Migrations and seed

The API service's **pre-deploy command** runs `node dist/db/migrate.js`, so a fresh database gets its
schema on the next deploy. Without it the tables never exist and sign-in fails with
`relation "users" does not exist`, surfaced as a `500` from `/api/auth/sign-in/email`. The
deployment still reports healthy, because `/health/live` touches no table.

> **A redeploy does not run the pre-deploy command.** Pre-deploy executes *between build and
> deploy*, and a redeploy reuses the existing build, so the whole stage is skipped — the deployment
> goes `Starting Container` → `Nest application successfully started` in a few seconds with no
> pre-deploy container and no `[migrate]` line in the logs. Migrations only run on a deployment that
> actually builds: **Deploy latest commit** in the dashboard, a merge to `main`, or `railway up`
> (which uploads your working tree, so avoid it with uncommitted changes).

Because the pre-deploy command is also skipped when config changes land without a rebuild, the
reliable way to migrate an already-running database is over SSH. Both steps run in the image, whose
`WORKDIR` is `/repo/apps/backend`:

```bash
# IDs for project rare-heart / environment production
PROJECT=285d28c0-15ac-41e1-bf85-75377d760026
ENVIRONMENT=production
API=55df4295-585b-4f3f-804d-1edb60661f0f

railway ssh --project $PROJECT --environment $ENVIRONMENT --service $API "node dist/db/migrate.js"
railway ssh --project $PROJECT --environment $ENVIRONMENT --service $API "node dist/db/seed.js"
```

Expect `[migrate] database is up to date`. Migrating alone leaves **empty tables** — sign-in keeps
failing until the seed runs, so always run both. Set `SEED_PASSWORD` (10+ characters) first or the
seed skips every persona account. The seed is idempotent, so re-running it is safe.

Re-running the migration is the simplest check: it is safe to repeat and prints
`[migrate] database is up to date` when the schema is already present.

`Postgres` has **no TCP proxy**, so the database is not reachable from a laptop, and `railway run`
does not help — it injects the environment variables but runs the command locally, where
`postgres.railway.internal` does not resolve. Use `railway ssh`, or create a TCP proxy temporarily.

Never run `db:reset` or `drizzle-kit push` against a deployed database.

### Not yet on Railway

There is no `worker` service, so the cutoff ticker, outbox relay and BullMQ jobs do not run. The
backend image already supports it: add a service from the same Dockerfile with
`startCommand: node dist/worker.js`.

## Environment variables

Every variable is documented in [`.env.example`](../.env.example), which Compose reads. Each app also has its own example for running it outside Compose: [`apps/backend/.env.example`](../apps/backend/.env.example) (loaded before the root `.env`, so its values win) and [`apps/frontend/.env.example`](../apps/frontend/.env.example) (Vite reads only this folder; `VITE_*` values are public and baked in at build time). The API validates its environment at boot ([`env.schema.ts`](../apps/backend/src/config/env.schema.ts)) and refuses to start with a clear message if anything is missing.

# Deployment

The same images run in two environments:

| Environment | Purpose | How |
| --- | --- | --- |
| Docker Compose | Judges, local work, fallback host | `docker compose up --build` at the repo root |
| Kubernetes (Oracle OKE free tier) | Public HTTPS URL for review, semifinal and finale | Manifests in `deploy/k8s`, images from GHCR |

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
| `minio` / `minio-init` | S3 storage for POD + bucket creation | `9000`, console `9001` |
| `prometheus`, `loki`, `alloy`, `grafana` | `--profile observability` only | Grafana `3001` |

Reset everything, including the database: `docker compose down -v`.

### Hosting on a single VM (fallback)

1. Point a DNS name (or a free `sslip.io` hostname) at the VM.
2. In `.env`, set `SITE_ADDRESS=waypoint.example.com`, `APP_URL=https://waypoint.example.com`, a strong `BETTER_AUTH_SECRET` and strong DB/S3 passwords.
3. Publish ports 80 and 443 for `web` (add `"443:443"` to its `ports`) and remove the host ports for `postgres`, `redis` and `minio`.
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

## Environment variables

Every variable is documented in [`.env.example`](../.env.example). The API validates its environment at boot ([`env.schema.ts`](../apps/backend/src/config/env.schema.ts)) and refuses to start with a clear message if anything is missing.

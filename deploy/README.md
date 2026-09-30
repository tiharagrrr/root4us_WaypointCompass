# Deployment assets

| Path | Purpose |
| --- | --- |
| `caddy/Caddyfile` | Web entrypoint baked into the `web` image: serves the SPA, proxies `/api` to the API, automatic HTTPS when `SITE_ADDRESS` is a domain. |
| `db/` | `roles.sql` creates the three database roles; Compose runs it through `db/init/00-roles.sh` when the Postgres volume is first created, and CI runs it before `db:migrate`. |
| `observability/` | Prometheus scrape config, Grafana Alloy log shipping, Grafana datasources. Used by `docker compose --profile observability up`. |
| `k8s/` | Kubernetes manifests (base + overlays) for the public deployment. See [docs/deployment.md](../docs/deployment.md). |

The Compose file stays at the repository root, as the Hackathon brief requires.

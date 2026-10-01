# Waypoint: delivery planning for Waypoint Group

> Tech-Triathlon 2026 · _TeamName_SolutionName_

Waypoint connects **ordering, planning, loading, delivery and receipt** for Waypoint Group's three brands (Fresh, Style, Tech): 120 outlets, 60 vehicles and two depots (Peliyagoda, Kandy). One responsive web app serves four roles: **Dispatcher, Loader, Driver and Store manager**. The driver and loader flows work offline and sync when signal returns.

| | |
| --- | --- |
| **Live URL** | _https://…_ |
| **Demo video** | _YouTube (unlisted) link_ |
| **Designathon prototype** | _Figma link_ |
| **Docs** | [Architecture](docs/architecture.md) · [Data model](docs/data-model.md) · [AI tool disclosure](docs/ai-tool-disclosure.md) · [Deployment](docs/deployment.md) |

---

## Quick start (judges)

Requirements: Docker with Compose v2.

```bash
git clone <repo-url> && cd <repo>
cp .env.example .env      # optional: defaults work as-is
docker compose up --build
```

Once the `seed` job has finished and `api` is healthy:

| What | URL |
| --- | --- |
| Web app (all four roles) | http://localhost:8080 |
| API docs (Swagger) | http://localhost:3000/api/docs |
| API health | http://localhost:8080/api/health |
| Object storage health (Garage) | http://localhost:9001/health |

`docker compose up` starts PostgreSQL, Redis and Garage (S3 storage for proof of delivery), then runs migrations and seeds the shared datasets plus a demo delivery day. After that it starts the API, the worker and the web app. Reset to a fresh install with `docker compose down -v`.

## Seeded accounts

| Role | Username | Password | Scope |
| --- | --- | --- | --- |
| Dispatcher | `dispatcher` | `Waypoint@2026` | Peliyagoda (all depots) |
| Loader | `loader` | `Waypoint@2026` | Peliyagoda dock |
| Driver | `driver` | `Waypoint@2026` | _VEHxxx_ |
| Store manager | `storemanager` | `Waypoint@2026` | _OUTxxx (Waypoint Fresh, …)_ |

Credentials come from the `SEED_*` variables in `.env`.

## Judge walkthrough

> Seeded demo day: _YYYY-MM-DD_ at Peliyagoda, where demand exceeds capacity (_n_ orders, _m_ vehicles in the workshop). Set `DEMO_CLOCK` to test the 4 PM cutoff at any time of day.

1. **Store manager** (phone or desktop): sign in as `storemanager`, place an order before the cutoff and see it confirmed. _…_
2. **Dispatcher** (desktop): sign in as `dispatcher`, close the cutoff, run allocation, review deferred orders and their reasons, then publish the plan. _…_
3. **Loader** (phone width): sign in as `loader`, open the vehicle's load list (reverse stop order), flag a damaged item, and release the vehicle. _…_
4. **Driver** (phone width): sign in as `driver`, start the trip, go offline (DevTools → Network → Offline), record deliveries and proof of delivery, then go back online and watch the queue sync. _…_
5. **Dispatcher**: see live progress, the synced events (device time vs. sync time), and the outlet deferral history. _…_
6. **Store manager**: see the ETA and deferral notice, confirm receipt, and report an issue. _…_
7. **Order timeline**: open any order to see every step with who, when, device and reason. _…_

## Departures from the Designathon submission

| Screen / flow | Designed (Day 5) | Built | Why |
| --- | --- | --- | --- |
| _…_ | | | |

---

## Development

### Prerequisites

- Node.js 22 (`nvm use`), pnpm 11 (`corepack enable` or `npm i -g pnpm@11`)
- Docker (for PostgreSQL, Redis and Garage object storage)

### First-time setup

```bash
pnpm install
cp .env.example .env      # Compose + shared defaults; per-app overrides:
                          # apps/backend/.env.example, apps/frontend/.env.example
pnpm infra:up             # postgres, redis, Garage (S3) in Docker
pnpm db:generate          # only after schema changes: writes apps/backend/drizzle/*.sql
pnpm db:migrate
pnpm db:seed
pnpm dev                  # shared (watch) + API :3000 + web :5173
```

The web dev server proxies `/api` to the API, so both run on one origin, as they do behind Caddy in Docker.

### Common scripts (repo root)

| Script | Does |
| --- | --- |
| `pnpm dev` | Shared package in watch mode, API with hot reload, Vite dev server |
| `pnpm build` / `lint` / `typecheck` / `test` | Runs across all workspaces |
| `pnpm db:generate` | Generate a migration from `apps/backend/src/db/schema/<module>.ts`; name it with `pnpm --filter api db:generate --name=<module>_<change>` |
| `pnpm db:migrate` / `db:seed` / `db:studio` | Apply migrations, load datasets, open Drizzle Studio |
| `pnpm infra:up` | Start only the backing services in Docker |
| `pnpm stack:up` / `stack:down` / `stack:reset` | Full Compose stack; reset also wipes volumes |

### Repository layout

```
apps/
  backend/        NestJS REST API + BullMQ worker (Drizzle ORM, PostgreSQL)
  frontend/       React PWA: dispatcher, loader, driver and store manager views
packages/
  shared/         Domain types, constraint validator, trip-time rules, Zod schemas
data/seed/        Shared challenge datasets (outlets, vehicles, calendar, ...)
datathon/         Datathon notebooks, models and submissions (data git-ignored)
deploy/           Caddyfile, database roles, observability configs, Kubernetes manifests
docs/             Architecture, data model, AI disclosure, ADRs, spec, brief
specs/            One spec per module with acceptance criteria, plus API, data, engine and screen references
.claude/          Shared Claude Code settings, hooks, commands and skills (CLAUDE.md at the root)
docker-compose.yml
.env.example      Compose and shared defaults (each app also has its own .env.example)
```

### Git workflow

- Tasks are tracked in [Linear](https://linear.app/root4us/project/waypoint-compass-hackathon-build-2a91249f70e7) (`ROO-<n>`); see [docs/linear.md](docs/linear.md).
- `main` is always deployable and protected. Work on short-lived branches that carry the Linear issue ID: `feat/roo-19-ordering-submit`, `fix/…`, `docs/…`, `chore/…`. Put `Closes ROO-19` in the PR body so the issue closes on merge.
- Use [Conventional Commits](https://www.conventionalcommits.org/) with the module as scope, e.g. `feat(ordering): submit order before cutoff`, `fix(execution): driver offline badge`, `docs: update walkthrough`.
- Coding agents (Claude Code and others) follow [CLAUDE.md](CLAUDE.md) and the module specs in [specs/](specs/README.md). Start feature work with `/implement <module> <AC ids>` in a worktree per branch, and log AI-assisted work in [docs/ai-log.md](docs/ai-log.md).
- Open a PR into `main`. CI must pass (lint, typecheck, tests, build, and a `docker compose up` smoke test), with one review.
- Commit the lockfile (`pnpm-lock.yaml`) and every generated migration. Never commit `.env` or Datathon data.
- **Code freeze:** Sun 4 Oct 2026, 8 PM (Asia/Colombo). Code pushed after 11:59 PM is not judged.

## Deadlines (Asia/Colombo)

| Phase | Due |
| --- | --- |
| Designathon | Tue 29 Sep 2026, 11:59 PM |
| Hackathon | Sun 4 Oct 2026, 11:59 PM |
| Datathon | Fri 9 Oct 2026, 11:59 PM |

All competition data is synthetic and used only for this competition.

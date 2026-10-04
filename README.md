# Waypoint Compass: delivery planning for Waypoint Group

> Tech-Triathlon 2026 · root4us_waypointcompass

Waypoint Compass connects **ordering, planning, loading, delivery and receipt** for Waypoint Group's three brands (Fresh, Style, Tech): 120 outlets, 60 vehicles and two depots (Peliyagoda, Kandy). One responsive web app serves five roles: **Admin, Dispatcher, Loader, Driver and Store manager**. The driver and loader flows work offline and sync when signal returns.

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
# Copy the dataset CSVs (outlets, vehicles, calendar, district_travel, service_allowance,
# traffic_speed, road_conditions, deliveries_train, task2b_peak_day_*) into data/seed.
# They are confidential, so the repository does not carry them; the seed reads them from there.
docker compose up --build
```

Once the `seed` job has finished and `api` is healthy:

| What | URL |
| --- | --- |
| Web app (all five roles) | http://localhost:8080 |
| API docs (Swagger) | http://localhost:3000/api/docs |
| API health | http://localhost:8080/api/health |
| Object storage health (Garage) | http://localhost:9001/health |

`docker compose up` starts PostgreSQL, Redis and Garage (S3 storage for proof of delivery), then runs migrations and seeds the shared datasets plus a demo delivery day. After that it starts the API, the worker and the web app. Reset to a fresh install with `docker compose down -v`.

## Seeded accounts

| Role | Person | Sign in with | Scope |
| --- | --- | --- | --- |
| Admin | Rusiru Withanage | `rusiru.w@waypoint.lk` / `Waypoint@2026` | Every depot |
| Dispatcher | Tihara Egodage | `tihara.e@waypoint.lk` / `Waypoint@2026` | Every depot (Peliyagoda by default) |
| Store manager | Nimesha Periyapperuma | `nimesha.p@waypoint.lk` / `Waypoint@2026` | OUT014 |
| Loader | Harini De Mel | `harini.d@waypoint.lk` / `Waypoint@2026`; dock PIN `2468` | Peliyagoda |
| Driver | Aniqa Razick | phone `+94776041932`, code from the demo inbox | REF-07 |
| Driver | Dinushi Rathnayake | phone `+94775550107`, code from the demo inbox | DRY-31 |

The password is `SEED_PASSWORD` in `.env` (at least 10 characters; without it the seed skips the
accounts). Every persona also has a username (`rusiru.w`, `tihara.e`, `nimesha.p`, `harini.d`,
`aniqa.r`, `dinushi.r`) that works on the sign-in form in place of the email.

### Signing in

The start page at `/` offers the three ways in:

- **Email or username and password** (`/sign-in`): admin, dispatcher, store manager, and any
  persona in a pinch.
- **Driver** (`/sign-in/driver`): phone number, then the 6-digit code. With `DEMO_MODE=true` the
  SMS is not sent; read the code at http://localhost:8080/demo/inbox (the worker must be running).
- **Loader** (`/sign-in/dock`): depot and 4-digit PIN, only on a registered dock tablet. A fresh
  browser is not one yet: sign in on it once with an email (Harini's or the admin's), then as admin
  open Settings › Dock tablets, find the row marked "This device" and choose "Use as dock tablet"
  for Peliyagoda. From then on the PIN works there and "Switch user" returns to the keypad.

Testing on a phone over your network: open the app by the machine's address (for example
`http://192.168.1.20:8080`) and set `APP_URL` to that address, or add it to `TRUSTED_ORIGINS`, or
sign-in is refused as a wrong origin. Under `pnpm dev` the Vite origin `http://localhost:5173` is
trusted automatically.

## Judge walkthrough

> Seeded demo day D: the day after the demo clock's date, at Peliyagoda, from scenario S1 (the seed prints D, its order count and the fleet it checks them against). Every S1 order is CONFIRMED on D; outlets skipped on the run before wait as DEFERRED with a deferral on D−1; the S1 workshop vehicles are out; Fresh Kadawatha has a draft dry order for D+1. Kandy has an ordinary day on D (its orders from the last day of the delivery history, whole fleet in service), and both depots have 14 closed operating days of history before D−1. Set `DEMO_CLOCK` to test the 4 PM cutoff at any time of day, and run `pnpm db:reset-demo` (or POST /demo/reset as admin in demo mode) to start the day again.

1. **Store manager** (phone or desktop): sign in as `nimesha.p@waypoint.lk`. **New order** opens the outlet's dry and chilled orders for the next run; add items and submit before the 4 PM cutoff. **Orders** shows the order's progress, and **Timeline** on its card shows who did what and when. **History** lists past orders, each with Reorder and its timeline.
2. **Dispatcher** (desktop): sign in as `tihara.e@waypoint.lk`. **Order queue** lists the day's orders (mark one urgent, or cancel one with a reason). **Plan** opens the demo day: close the cutoff, run the allocation, review the deferred orders and their reasons, fix or override what the checks flag, then confirm and publish.
3. **Loader** (phone width): sign in with PIN `2468` on the dock tablet (or as `harini.d@waypoint.lk` on any browser), open the vehicle's load list (reverse stop order), flag a damaged item, and release the vehicle.
4. **Driver** (phone width): at `/sign-in/driver` enter `+94776041932` and the code from `/demo/inbox`, start the trip, go offline (DevTools → Network → Offline), record deliveries and proof of delivery, then go back online and watch the queue sync.
5. **Dispatcher**: **Dashboard** and **Tracking** show live progress, projected arrivals and late risk; a trip opens its stops with planned, projected and actual times. **Deferrals** holds the outlet deferral history with repeat skips, **Issues** what stores reported, and the end-of-day summary closes the day.
6. **Store manager**: **Orders** shows the ETA of an order that is on a trip, and a deferred order opens its notice with the reason. **Receipts** lists deliveries to confirm; confirm one line by line against the driver's proof, or report an issue and follow its thread.
7. **Order timeline**: **Timeline** on any order (the store's Orders and Receipts, the dispatcher's Order queue) lists every step with who, when, device and reason; a delivery recorded offline keeps its device time and is marked Synced late.

Not built yet, shown as placeholders: Item catalog (M9), Past orders (04), Plan ahead (12, 13), Forecast (22) and the admin's Outlets, Depots and Vehicles (A3 to A5). Sync conflicts are reported to the phone but have no dispatcher screen (19c).

## Departures from the Designathon submission

Every deliberate difference from the Figma frames is logged, screen by screen, with the reason, in [docs/departures.md](docs/departures.md).

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
pnpm db:seed              # reads the dataset CSVs from data/seed (git-ignored; copy them in first)
pnpm dev                  # shared (watch) + API :3000 + web :5173
pnpm --filter api dev:worker   # second terminal: the worker (cutoff ticker, outbox relay, jobs)
```

The web dev server proxies `/api` to the API, so both run on one origin, as they do behind Caddy in Docker.

### Common scripts (repo root)

| Script | Does |
| --- | --- |
| `pnpm dev` | Shared package in watch mode, API with hot reload, Vite dev server (start the worker separately with `pnpm --filter api dev:worker`) |
| `pnpm build` / `lint` / `typecheck` / `test` | Runs across all workspaces |
| `pnpm db:generate` | Generate a migration from `apps/backend/src/db/schema/<module>.ts`; name it with `pnpm --filter api db:generate --name=<module>_<change>` |
| `pnpm db:migrate` / `db:seed` / `db:studio` | Apply migrations, load datasets, the item catalog, 14 days of history and the demo day, open Drizzle Studio |
| `pnpm db:reset-demo` | Rebuild D−1 to D+1 of the demo day on your local database (`DEMO_DAY=YYYY-MM-DD` pins D) |
| `pnpm db:fresh` | Local only: drop every table, migrate, seed from `data/seed`, then `db:verify`. Use it after dropping new dataset files in, or when the database holds leftovers from test runs |
| `pnpm db:verify` | Read-only: which dataset files are present, how many rows each table holds, users by role, the depots. Exits 1 when the reference data is missing |
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

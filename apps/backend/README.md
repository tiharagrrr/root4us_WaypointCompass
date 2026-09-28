# @waypoint/backend

NestJS REST API and BullMQ worker for Waypoint. See [docs/architecture.md](../../docs/architecture.md).

| Entry | Command | What |
| --- | --- | --- |
| `src/main.ts` | `pnpm dev` / `node dist/main.js` | REST API on `:3000`, routes under `/api/v1`, Swagger at `/api/docs`, `/health`, `/metrics` |
| `src/worker.ts` | `pnpm dev:worker` / `node dist/worker.js` | Background jobs (allocation, notifications, outbox) |
| `src/database/migrate.ts` | `pnpm db:migrate` | Applies `drizzle/` migrations + `src/database/sql/*.sql` |
| `src/database/seed.ts` | `pnpm db:seed` | Loads `data/seed/*.csv` (idempotent) |

Schema: `src/database/schema.ts`. After editing it, run `pnpm db:generate` and commit `drizzle/`.

Tests: `pnpm test` (unit). `pnpm test:e2e` needs Postgres and Redis running (`pnpm infra:up` from the repo root).

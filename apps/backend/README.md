# @waypoint/api

NestJS REST API and BullMQ worker for Waypoint. See [docs/architecture.md](../../docs/architecture.md). The package is named `@waypoint/api`, so `pnpm --filter api ...` targets this folder.

| Entry               | Command                                       | What                                                                                       |
| ------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `src/main.ts`       | `pnpm dev` / `node dist/main.js`              | REST API on `:3000`, routes under `/api/v1`, Swagger at `/api/docs`, `/health`, `/metrics` |
| `src/worker.ts`     | `pnpm dev:worker` / `node dist/worker.js`     | Background jobs (allocation, notifications, outbox)                                        |
| `src/db/migrate.ts` | `pnpm db:migrate` / `node dist/db/migrate.js` | Applies the SQL migrations in `drizzle/` as `compass_owner` (`DIRECT_URL`)                 |
| `src/db/seed.ts`    | `pnpm db:seed` / `node dist/db/seed.js`       | Loads the reference CSVs from `SEED_DATA_DIR` (idempotent)                                 |

Schema: one file per module in `src/db/schema/`, plus `src/db/columns.ts` (column helpers) and `src/db/rls.ts` (roles and policies). See [docs/data-model.md](../../docs/data-model.md) for the ER diagram, the rules and the migration workflow.

| Command                                                  | When                                                                             |
| -------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `pnpm --filter api db:generate --name=<module>_<change>` | After editing a schema file; writes `drizzle/YYYYMMDDHHMM_<module>_<change>.sql` |
| `pnpm --filter api db:custom --name=<module>_<change>`   | SQL Drizzle can't declare (triggers, functions, grants); fill the empty file     |
| `pnpm --filter api db:migrate`                           | After pulling or generating a migration                                          |
| `pnpm --filter api db:check`                             | Catches colliding snapshots                                                      |
| `pnpm --filter api db:reset`                             | Local only: drops, migrates, seeds (refuses any host but localhost)              |

Tests: `pnpm test` (unit). The database suite in `src/db/__tests__` runs when `TEST_DIRECT_URL` (compass_owner) and `TEST_DATABASE_URL` (compass_app) point at a migrated database; otherwise it is skipped. `pnpm test:e2e` needs Postgres and Redis running (`pnpm infra:up` from the repo root).

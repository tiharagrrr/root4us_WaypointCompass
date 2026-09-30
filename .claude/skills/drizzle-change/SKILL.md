---
name: drizzle-change
description: Make any database schema change in apps/backend with Drizzle (add or change a table, column,
  index, enum, check or relation, add a row-level security (RLS) policy, write a migration, generated
  or custom SQL for triggers and grants, or update the seed). Use whenever src/db/schema, drizzle/ or
  the seed changes.
---

# Change the schema

## Before you start
- Read specs/<module>/spec.md (its Model section) and the Step 1 conventions below.
- A module edits only its own apps/backend/src/db/schema/<module>.ts. enums.ts, relations.ts,
  ../columns.ts and ../rls.ts belong to the platform owner (Nimesha), who reviews any change there.
- The schema froze Wed 30 Sep 12:00. After that, changes are additive only: new nullable columns,
  new tables, new indexes. No renames or type changes before 4 Oct (they need add, backfill and
  drop across two migrations).
- `docker compose up -d postgres`, then `git pull && pnpm --filter api db:migrate`, so you build on
  main's migrations.

## Conventions
- Tables snake_case plural; columns keep the camelCase TypeScript keys (raw SQL quotes them).
- Dataset rows keep natural text keys; everything else is `pk()` (UUIDv7). Rows created offline
  carry a `clientUuid` with a unique index.
- Helpers from columns.ts: `instant()` (timestamptz), `businessDate()` (Asia/Colombo date),
  `minutes()` (clock time), `measure()` (kg, m³, km, litres, minutes), `version()` on aggregates
  more than one person edits, `createdAt()`, `updatedAt()`. Units and LKR are `integer`.
- No hard deletes: business rows move to CANCELLED. `*ById` columns are plain ids, with a foreign
  key only where a screen joins them.
- Name constraints like the existing files (`<table>_<what>_idx`, `_uq`, `_chk`, `_fk`). Row
  types come from `$inferSelect` and `$inferInsert`.

## Steps
1. Schema. Edit the module's file. Put checks, indexes and uniques in the table extras. A new
   enum or enum value goes in enums.ts; update the matching constant array in packages/shared (a
   type test compares it with `enumValues`) and, for a status, its machine in
   packages/shared/src/machines. A new table is exported from schema/index.ts and gets a
   `relations()` entry in relations.ts if a service reads it with `with`.
2. RLS. A table whose rows belong to one outlet or order (like orders, order_lines, deferrals,
   receipts, issues) gets two `pgPolicy` entries: `<table>_app_scope` for all to `appRole`, with
   `using` and `withCheck` from rls.ts (`orderVisible`, `viaVisibleOrder` for child rows,
   `issueVisible`), and `<table>_readonly` for select to `readonlyRole` using `` sql`true` ``. A new
   predicate goes in rls.ts. The generated migration enables RLS on the table.
3. Generate. `pnpm --filter api db:generate --name=<module>_<change>`. The migration lands in
   apps/backend/drizzle/ as `YYYYMMDDHHMM_<module>_<change>.sql` with its snapshot. When drizzle-kit
   asks rename or new, answer carefully. Read the SQL: no DROP, no type change.
4. Custom SQL. Triggers, functions and grants: `pnpm --filter api db:custom --name=<module>_<change>`,
   then fill the empty file by hand. `drizzle/*_platform_integrity.sql` is the model. Grants follow the three
   roles in deploy/db/roles.sql: `compass_owner` migrates and seeds, `compass_app` reads and writes
   (INSERT and SELECT only on audit_events), `compass_readonly` selects, but never auth tables,
   idempotency keys or sensitive users columns.
5. Migrate. `pnpm --filter api db:migrate`, then run db:generate again: it must write nothing
   (CI runs `git diff --exit-code apps/backend/drizzle`). `pnpm --filter api db:check` catches colliding
   snapshots.
6. Seed. If the change needs reference or demo data, update apps/backend/src/db/seed.ts. It stays
   idempotent: `pnpm --filter api db:seed` twice gives the same rows (upsert on the natural key or a
   unique index). It runs as compass_owner, which bypasses RLS. Dataset columns come from
   specs/data/datasets.md. CI seeds a fresh database, so a migration that breaks the seed fails.
7. Docs. Update the erDiagram in docs/data-model.md when a table or relationship changes, the
   Model section of specs/<module>/spec.md, and the "Maps to" column in specs/data/datasets.md when
   a dataset column moves.
8. Tests. Use createTestApp() and seedMinimal() from apps/backend/test.
   - Each new check or unique: the database refuses the bad row.
   - Each policy: with the module's ScopePolicy removed in a test module, a store manager still sees
     only her outlet's rows, and a transaction with no actor stamped sees none.
   - `pnpm check` (lint, typecheck, module boundaries, scripts/check-table-writes.ts, tests).
9. PR. At most one migration, named on the template's Migration line. If main gained a migration
   first: rebase, delete your own SQL file, snapshot and journal entry, re-run db:generate so yours
   sorts after it, then db:migrate.

## Checklist
- [ ] Only my module's schema file changed, or the owner reviewed the shared files
- [ ] After the freeze: additive only, no rename, no type change
- [ ] One migration, `<module>_<change>`, SQL read line by line
- [ ] db:generate writes nothing after db:migrate; db:check clean
- [ ] Policies and an RLS test on any per-outlet or per-order table
- [ ] packages/shared enum arrays match `enumValues`
- [ ] Fresh db:migrate plus db:seed passes, and the seed runs twice cleanly
- [ ] docs/data-model.md and the module spec updated
- [ ] pnpm check green

## Never
- Edit a migration that reached main, or hand-edit apps/backend/drizzle/meta (dropping your own unmerged
  migration during a rebase is the one exception).
- Run drizzle-kit push or db:reset against anything but your local database. The agent settings
  deny both; a person runs a local reset by hand.
- Open, list, grep or paste files in data/seed/. Use specs/data/datasets.md.
- Create a database role in a migration (rls.ts uses `pgRole(...).existing()`), or change a
  database by hand.
- Put JavaScript values in policy SQL, or use a session-level SET instead of `set_config(..., true)`.
- Hard-delete business rows, or write to a table another module owns.

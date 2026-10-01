# Waypoint Compass

Delivery planning for Waypoint Group (Tech Triathlon 2026, team root4us): one NestJS API and worker,
one React PWA, one pure-TypeScript planning engine. Five roles: admin, dispatcher, store manager,
loader, driver.

Before changing a module, read `specs/<module>/spec.md`. Before changing an endpoint, read
`specs/api-conventions.md`. Before changing a screen, find its Figma node in `specs/frontend/screens.md`.
How specs, acceptance criteria and statuses work: `specs/README.md`.

## Layout
- `apps/backend`: NestJS HTTP API (main.ts) and worker (worker.ts); modules in src/modules/<name>.
  The package is @waypoint/api, so `pnpm --filter api` targets it
- `apps/frontend`: React PWA; one folder per module in src/features (`pnpm --filter frontend`)
- `packages/engine`: planning rules and allocator; `packages/shared`: enums, state machines,
  permission matrix; `packages/api-client`: generated from openapi.json; `packages/ui-tokens`
- `specs/`: one spec per module plus the conventions; `docs/`: architecture, data model, AI log

Where a script below does not exist yet, run the closest one (`pnpm lint && pnpm typecheck &&
pnpm test`) and report which.

## Commands
- `pnpm i`: install (Node 22; pnpm version pinned in package.json)
- `docker compose up -d postgres redis minio mailpit`: local services
- `pnpm dev`: api on 3000, worker, web on 5173 (MSW mocks every endpoint not listed in live.ts)
- `pnpm --filter api db:generate --name=<module>_<change>` then `db:migrate`: after editing src/db/schema/<module>.ts
- `pnpm --filter api db:seed`: idempotent seed; `pnpm db:reset-demo` rebuilds the demo day
- `pnpm api:gen`: regenerate openapi.json and packages/api-client after any controller or DTO change
- `pnpm --filter engine test`: engine tests (fast); run after any rule change
- `pnpm check`: lint, typecheck, module boundaries, tests. It must pass before you say you are done.

## Architecture rules
1. Modules live in apps/backend/src/modules/<name> and import each other only through index.ts.
2. A module writes only its own tables. Order status moves through OrderLifecycleService;
   trip and stop status through TripLifecycleService.
3. Controllers do HTTP only: no database access, no business rules.
4. Every state change is a command-service method with @Transactional() that calls audit.record()
   and outbox.add().
5. Every query applies the module's ScopePolicy. Out of scope is 404; a missing permission is 403.
6. Responses use the envelope with _links; errors are DomainError subclasses rendered as problem+json.
7. Time comes from ClockService.now() (API) or useServerClock() (web). Never new Date() in business
   logic. Business dates are Asia/Colombo.
8. Planning rules live only in packages/engine. Never re-implement a rule; call the validator.
9. Screens get data only from generated hooks in @compass/api-client and show an action only when
   the resource carries the matching _links entry.
10. Driver and loader writes go through the offline outbox, never straight to the API.

## Conventions
- TypeScript strict; no `any` (use `unknown` and zod); named exports; kebab-case file names.
- IDs are UUIDv7; records created offline carry a client-generated clientUuid.
- Log with this.log.info({ event: '<module>.<entity>.<verb>', ...ids }, 'message'). No personal data.
- Tests sit in __tests__ next to the code. Every engine rule has a passing and a failing fixture.
- Each acceptance criterion is one test named after it: it('AC-ORD-02 a late order rolls to the next run').
- Conventional Commits with the module as scope: feat(ordering): submit order before cutoff
- Branches carry the Linear issue: `<type>/roo-<n>-<short>`; the PR body says `Closes ROO-<n>`
  (docs/linear.md). One git worktree per branch; at most one migration per PR, and no limit on its size.
- UI uses Compass tokens and text styles from packages/ui-tokens; no hex values.

## Workflow
Spec, plan, build, verify, PR. `/implement <module> <AC ids>` plans against the spec and waits for an
OK, then writes failing tests first. `/check` before saying done, `/api-sync` after a contract change,
`/fidelity <frame>` for screens. Project skills cover the repeatable work (rest-endpoint,
drizzle-change, react-screen, ...); use `grill` when a spec or plan is unclear, `debug` when a test
fails for a reason you don't understand, `ship-pr` to open the PR and `handoff` when you stop mid-task.

## Never
- Edit generated code (packages/api-client/src/gen, apps/backend/drizzle/meta) or an applied migration.
- Run drizzle-kit push or db:reset against anything but your local database.
- Open, paste or upload files in data/seed/. Use specs/data/datasets.md; the competition terms
  forbid sharing the datasets.
- Read .env files. Use .env.example and the config schema.
- Bypass AuditService, a ScopePolicy or the engine validator to make a test pass; skip or delete a
  failing test.
- Add a dependency without saying why in the PR.
- Commit to or push main directly.
- Mention the Challenge Booklet or AI assistance in a commit message or a PR, including
  Co-Authored-By and "Generated with" lines. AI use is disclosed separately, later.

## Done means
The spec's acceptance criteria pass, pnpm check is green, the screen matches its Figma frame in its
loading, empty, error and offline states, and the spec file is updated.

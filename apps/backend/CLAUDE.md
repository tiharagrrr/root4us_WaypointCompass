# apps/backend

NestJS 11 on Express. main.ts serves HTTP; worker.ts runs BullMQ processors, the outbox relay,
the one-minute ticker and the simulator. Both load AppModule.

## Adding a use case (see the rest-endpoint skill)
1. Command: a method in modules/<m>/services/<m>.service.ts with @Transactional(): load within the
   scope, assertTransition, write, audit.record, outbox.add, one log line.
2. Query: a method in <m>.queries.ts that goes through CrudQueryService and the module's
   ResourceSpec, always applies this.scope.where(actor), and pages by offset (tables) or cursor (feeds).
3. Controller: thin. @RequirePermission, @Actor(), @IfMatch() on versioned writes, @UseIdempotency()
   on creates and non-repeatable actions; return this.links.one() or this.links.page().
4. Run pnpm api:gen and commit openapi.json.

A new module starts from the nest-module skill; a schema change follows the drizzle-change skill;
every state change follows the audit-and-events skill.

## Test helpers (apps/backend/test)
- createTestApp() boots the app on a throwaway schema; seedMinimal() loads 2 depots, 6 outlets, 6 vehicles.
- as(role, scope?) returns a supertest agent signed in with that role and scope.
- freezeClock('2026-10-01T15:59:00+05:30') sets ClockService for the test.
- expectProblem(res, 'PLAN_RULE_VIOLATION') checks a problem+json response.

## Gotchas
- Import tables from src/db/schema and inject the database with @Inject(DB); never create a Pool in a module.
- bodyParser: false is required by BetterAuth; webhooks use the raw parser mounted in main.ts.
- An update filtered on version that returns no row means someone else changed it: throw VersionMismatchError (412).
- Every request already runs in a transaction stamped for row-level security. A query that returns
  nothing unexpectedly may be a policy doing its job; check the stamped role before the where clause.
- Job processors restore context with runInJobContext(job, () => ...).

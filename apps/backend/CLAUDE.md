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

## The kernel (src/core)

- `core/http/decorators.ts`: @RequirePermission, @AnyRole, @AllowAnonymous, @Actor(), @IfMatch(),
  @UseIdempotency(), @ApiResource, @ApiPaginated, @ApiProblems. `core/http/api.dto.ts`: ListQueryDto,
  IncludeQueryDto and the envelope DTOs. `core/http/links.ts`: LinkBuilder.
- `core/persistence`: ResourceSpec with enumFilter/textFilter/dateFilter/instantFilter/numberFilter,
  CrudQueryService, SimpleCrudCommands, SkipTransaction.
- `core/errors/domain-errors.ts`: every DomainError. `core/clock`: ClockService. `config/app-config.ts`:
  AppConfig (typed config groups).
- `core/context`: RequestContext (correlation id, actor, addNotice for meta.notices), JobContextRunner.
- `core/scheduling`: @OnTick('<module>.<what>') runs a method once a minute in the worker.

## Test helpers (apps/backend/test)

- createTestApp({ controllers?, providers? }) boots AppModule the way main.ts does; describeWithDb skips
  a suite unless TEST_DATABASE_URL and TEST_DIRECT_URL point at a migrated database (locally, the
  Compose Postgres on 55432 and Redis on 56379 with TEST_REDIS_URL); ownerDatabase() writes fixtures.
- signedInAs(app, db, { role, depotId? }) creates a user and returns its session cookie; fixtures.ts
  has depots, outlets and devices with a random suffix.
- freezeClock(app, '2026-10-01T15:59:00+05:30') stops ClockService (reset() after).
- expectProblem(res, 'PLAN_RULE_VIOLATION') checks a problem+json response.

## Gotchas

- Import tables from src/db/schema and inject the database with @Inject(DB); never create a Pool in a module.
- Reach the current transaction with `private readonly txHost: TransactionHost<StampedDrizzleAdapter>`
  and `this.txHost.tx`. Spell the generic out: a type alias would inject `Object`.
- bodyParser: false is required by BetterAuth; webhooks use the raw parser mounted in app.setup.ts.
- An update filtered on version that returns no row means someone else changed it: throw VersionMismatchError (412).
- Every request already runs in a transaction stamped for row-level security, and so does every job
  and tick (stamped as the system). A query that returns nothing unexpectedly may be a policy doing
  its job; check the stamped role before the where clause.
- Job processors restore context with this.jobs.runInJobContext(job, () => ...) (JobContextRunner);
  put `_ctx: jobContextOf(cls)` on the job data when you enqueue it.
- Scheduled work is an @OnTick method that uses the `now` it is given; never a cron of its own, so
  demo time travel triggers it.
- The worker loads AppModule. Register a BullMQ processor in src/worker/worker.module.ts, not in
  your module, or the API process would run it too.

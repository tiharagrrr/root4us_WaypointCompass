---
name: nest-module
description: Create a new NestJS module in apps/backend/src/modules, or add its first use case, with
  Waypoint's module anatomy, AppModule registration, boundaries entry, schema stub and spec file.
  Use whenever a new folder under apps/backend/src/modules is needed or a module's allowed imports change.
---

# Add a module

## Before you start
- Find the module's depends-on line in specs/<module>/spec.md (the modules it may import) and its
  Events section (emits, consumes). If they are missing, agree them with the owner before writing code.
- Read specs/<module>/spec.md if it exists, and apps/backend/CLAUDE.md.

## Steps
1. Folder. Create apps/backend/src/modules/<module>/ with kebab-case files, copying the shape of
   modules/ordering:
   - <module>.module.ts: providers, controllers, exports.
   - index.ts: the public surface only: the Nest module class, the query service, any exported
     lifecycle service, and event payload types.
   - <module>.constants.ts: queue names, event names, setting keys.
   - controllers/ and dto/ (class-validator request DTOs, Swagger response DTOs).
   - services/: <entities>.service.ts for commands, <entity>.queries.ts for reads, and
     <entity>-lifecycle.service.ts only if other modules must move a status this module owns.
   - policies/: <entity>.scope.ts (ScopePolicy) and <entity>.links.ts (LinkBuilder).
   - domain/: pure functions; now comes in as a parameter.
   - jobs/<name>.processor.ts: BullMQ processors, run by the worker.
   - events/<module>.events.ts: typed payloads with v: 1.
   - __tests__/.
2. Register. Import the module class in apps/backend/src/app.module.ts. main.ts and worker.ts both load
   AppModule.
3. Boundaries. The depends-on line of specs/<module>/spec.md is the allowed-imports table:
   scripts/check-module-deps.ts reads it and checks every cross-module import (index.ts only, allowed
   modules only, nothing from core/, every folder registered in AppModule). Change depends-on in the
   same PR as the import. Run pnpm --filter api check:boundaries.
4. Schema. If the module owns tables, create apps/backend/src/db/schema/<module>.ts headed
   `// apps/backend/src/db/schema/<module>.ts · owner: <module>`, build columns with the helpers in
   ../columns (pk, createdAt, updatedAt, instant), and export it from schema/index.ts. Tables,
   migrations and policies follow the drizzle-change skill.
5. Spec. If specs/<module>/spec.md is missing, create it with the same frontmatter and sections as
   the other module specs (status: draft) and copy depends-on from the boundaries row.
6. First use case. Follow "Adding a use case" in apps/backend/CLAUDE.md and the rest-endpoint skill: a
   @Transactional() command that loads within scope, calls assertTransition, writes, calls
   audit.record() and outbox.add() (audit-and-events skill) and logs one event.
7. Logger. One PinoLogger per class through @InjectPinoLogger(<Class>.name); domain events at info
   with an event key named <module>.<entity>.<past-tense verb>.
8. Jobs. A processor restores context with runInJobContext(job, () => ...) and calls a command
   service. It holds no business logic.
9. Errors. Throw the DomainError subclasses from core/errors (NotFoundError, ValidationError,
   StateConflictError, VersionMismatchError and the rest); never build problem JSON.
10. Tests. __tests__/<resource>.e2e.spec.ts with createTestApp(), seedMinimal() and as(role, scope?);
    name each test after its AC id.
11. Check. pnpm check, and pnpm api:gen once a controller exists.

## Checklist
- [ ] Other modules import only from index.ts
- [ ] index.ts exports no internals, repositories or schema tables
- [ ] Module registered in AppModule
- [ ] depends-on in the spec matches the imports; pnpm check:boundaries green
- [ ] Schema file exported from schema/index.ts (if the module owns tables)
- [ ] specs/<module>/spec.md exists with status and depends-on filled in
- [ ] pnpm check green

## Never
- Import another module's files except its index.ts, or import any module from core/.
- Write another module's tables. Order status moves only through OrderLifecycleService; trip and
  stop status only through TripLifecycleService.
- Use forwardRef or a circular import; a cycle means an event is missing.
- Call another module for a side effect an outbox event could carry. Call directly only when you
  need the result inside your own transaction.
- Write from a *.read-model.ts file; read models are read-only Drizzle queries.
- Create a Pool or read process.env in a module. Inject the database with @Inject(DB) and read
  config through AppConfig.

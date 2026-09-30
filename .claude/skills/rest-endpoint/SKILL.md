---
name: rest-endpoint
description: Add or change a REST endpoint in apps/backend following Waypoint's Level 3 conventions
  (envelope, _links, problem+json, scope, audit, OpenAPI). Use whenever a controller route, DTO or
  response shape changes.
---

# Add a REST endpoint

## Before you start
- Read specs/<module>/spec.md and find the acceptance criteria this endpoint serves.
- Read specs/api-conventions.md sections 1 to 5.
- If the frontend needs the contract before the logic exists, land it first with the contract-first
  skill (controller, DTOs and Swagger returning 501).

## Steps
1. Route. Plural kebab-case nouns; state changes are POST /<resource>/{id}/<verb>; natural keys stay
   natural (/depots/PLG/plans/2026-10-02).
2. DTOs in dto/: request classes with class-validator and @ApiProperty examples; response DTOs
   mirror the API fields, never Drizzle row types. Instants as ISO strings, business dates as YYYY-MM-DD.
3. Service.
   - Reads go in <m>.queries.ts through CrudQueryService and the module's ResourceSpec: always
     this.scope.where(actor); offset paging for tables, cursor paging for feeds.
   - Writes go in <m>.service.ts: @Transactional(), assertTransition, rules, write filtered on
     version (orders, plans, trips, stops and vehicles are versioned), audit.record (with a reason
     code if the action needs one), outbox.add, one log line. The audit-and-events skill has the
     details.
4. Links. Update policies/<m>.links.ts: add an action link only when the state machine allows it,
   the actor has the permission, the row is in scope and the time rules allow it. Reuse the same
   can*() helper the service uses.
5. Controller. Thin: @RequirePermission('<resource>:<action>'), @Actor(), @IfMatch() on versioned
   writes (428 when missing, 412 when stale), @UseIdempotency() on creates and non-repeatable
   actions, @ApiResource(Dto) or @ApiPaginated(Dto), @ApiProblems(...); return links.one() or
   links.page(). 200 for reads and actions, 201 with Location for creates, 204 for deleting drafts.
6. Errors. Throw DomainError subclasses only; never build problem JSON by hand.
7. Tests in __tests__/<resource>.e2e.spec.ts: the happy path; each refused role (403); each
   out-of-scope actor (404); a stale If-Match (412) and a missing one (428); an invalid body (400
   with field errors); _links present and absent in the right states. Name each test after its
   criterion (it('AC-ORD-01 submit before the cutoff')).
8. Contract. pnpm api:gen (or /api-sync), commit openapi.json, and check the diff shows only what you meant.
9. Spec. Tick the acceptance criteria in specs/<module>/spec.md and list the endpoint there.

## Checklist
- [ ] No db or schema import in the controller
- [ ] Scope applied in every query
- [ ] Audit row and outbox event in the same transaction as the write
- [ ] _links tested in two states
- [ ] openapi.json regenerated and its diff reviewed
- [ ] pnpm check green

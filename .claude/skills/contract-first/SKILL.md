---
name: contract-first
description: Land an endpoint's contract before its logic (controller, DTOs and Swagger returning
  501, openapi.json, generated hooks and MSW mocks) so screens can be built in parallel. Use when a
  screen needs an endpoint that does not exist yet, for the "every module's contract in OpenAPI"
  gate, or when asked for a stub or mock API.
---

# Contract first

The OpenAPI contract merges before the implementation; the web app runs on generated MSW mocks until
the real endpoint lands.

## Before you start
- Read the module spec's Endpoints table, the criteria each endpoint serves, and
  specs/api-conventions.md sections 1 to 5.
- Find the screens that call it in specs/frontend/screens.md, so the response carries what they show
  and every _links entry they need for their buttons.

## Steps
1. Controller with the final route and decorators: @RequirePermission, @Actor(), @IfMatch() and
   @UseIdempotency() where the conventions need them, @ApiResource(Dto) or @ApiPaginated(Dto),
   @ApiProblems(...). The handler throws Nest's NotImplementedException (501); no service code yet.
2. Request and response DTOs complete, with @ApiProperty examples realistic enough for mocks
   (demo-week dates, names the Build Spec uses). The response DTO lists every action link the
   resource can carry.
3. Document the problem responses the criteria name (400, 403, 404, 409, 412).
4. `pnpm api:gen` (or /api-sync). Commit openapi.json; the diff should show only the new operations.
5. Leave the path out of apps/frontend/src/mocks/live.ts, so MSW keeps serving it.
6. One test per endpoint: the route exists, a refused role gets 403, an allowed role gets 501.
7. PR titled `feat(<module>): <resource> contract` holding only the contract. The logic PR (the
   rest-endpoint skill) removes the 501 and adds the path to live.ts.

## Checklist
- [ ] Every endpoint of this slice in the spec's table is in openapi.json
- [ ] Response DTOs carry _links and realistic examples
- [ ] Guard test per endpoint; no business logic in the PR

## Never
- Hand-write fetch calls or mocks in apps/frontend to get around a missing contract.
- Change a merged contract in a breaking way without flagging it; /api-sync lists breaking changes.

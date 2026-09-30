---
name: debug
description: Find the root cause of a failing test, an error or unexpected behaviour before changing
  code. Use when a test fails for a reason you don't understand, an endpoint returns an unexpected
  403, 404, 409, 412 or 500, a query returns nothing, a job doesn't run, the engine gives different
  results run to run, a screen shows mock data, or the offline queue doesn't drain.
---

# Debug to the root cause

## Steps
1. Reproduce. Get one command you can re-run in seconds: a single test
   (`pnpm --filter api test -- -t 'AC-ORD-02'`), one request, one engine fixture. Read the whole error
   and stack, not only the first line.
2. Localise. Find the last point where the data is right and the first where it is wrong. Assert or
   log there; don't guess.
3. Check the usual suspects below before anything exotic.
4. Hypothesis. Write one sentence, "X happens because Y", and run the smallest experiment that could
   prove it wrong.
5. Fix the cause in the right layer: a rule in the engine, a transition in the lifecycle service, a
   filter in the ScopePolicy, an action in the LinkBuilder. Add a regression test named after its
   criterion, or `bug: <one line>` if no criterion covers it (then add one with the spec-author skill).
6. Re-run the command, then `pnpm check`. Remove temporary logs.
7. Report the symptom, root cause, fix, and the test that now guards it.

## Usual suspects in this stack
- Empty result or 404 for a row that exists: the ScopePolicy doing its job, or row-level security
  for the stamped role. Check the actor's scope and the stamped role before the where clause.
- 403: the permission in @RequirePermission against the matrix in packages/shared.
- 412: a stale If-Match; the update filtered on version matched no row.
- CUTOFF_PASSED or window errors at odd times: the clock not frozen (freezeClock), or a timezone
  slip. Business dates are Asia/Colombo; instants are stored in UTC.
- Audit row or outbox event missing: the write ran outside @Transactional() or in another
  TransactionHost.
- Job does nothing: the worker isn't running, the queue name differs from <module>.constants.ts, or
  the processor lost its context (runInJobContext).
- Engine output differs between runs: an unsorted collection, Date.now, Math.random, or `<=` on
  floats instead of lte().
- Screen shows fake data: the path is missing from apps/frontend/src/mocks/live.ts so MSW still answers,
  or the client is stale (`pnpm api:gen`).
- Button missing: the resource has no _links entry in that state. Fix the LinkBuilder, not the
  component.
- Offline queue stuck: an outbox item hit a conflict or a 4xx. Check the Dexie outbox and the /sync
  response for that clientUuid.

## Never
- Change a test's expectation, skip it or add a retry to make it pass, unless you have shown the
  test itself is wrong and said so.
- Patch a symptom in the controller or component when the cause is in the service, policy or engine.
- Open data/seed/ or .env to debug; use fixtures and .env.example.

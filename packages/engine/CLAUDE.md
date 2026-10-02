# packages/engine

Pure TypeScript. No Nest, no database, no I/O, no Date.now, no Math.random.
The same input gives the same output, byte for byte.

It imports only two pure entry points of @waypoint/shared, never its root: @waypoint/shared/domain
(brands, dock types, ...) and @waypoint/shared/business-time (day of week, HH:MM labels). Do not
copy that code here. Build shared first (`pnpm --filter @waypoint/shared build`); CI and `pnpm dev`
already do.

## Purity is an allowlist
src/__tests__/purity-check.ts lists the only bare imports (zod and those two entry points) and the
only globals (Error, JSON, Map, Math without random, Number, Object, Set, String) the engine may use. Anything
else fails purity.spec.ts with file:line:col and the name, and so does a name the checker cannot
resolve. To use something new, add it to the list with a reason; do not work around the test.

## Input errors
A problem with the input throws EngineInputError, which carries `code`, `field`, `value` and a
message naming all three ("plan.trips[1].orderIds[0] \"ord-9\" is not in input.orders
[UNKNOWN_ORDER]"). A rule violation is returned, never thrown. validate() checks input.date first,
whatever the plan holds; the engine relies on shared's dowOf refusing impossible dates, and
errors.spec.ts pins that so a weaker shared fails an engine test.

## Layout
- time/      trip minutes (the time model) and the arrival schedule
- rules/     one file per rule: export const CAP_WEIGHT: Rule = { code, severity, check(ctx) }
- validate.ts runs every rule over a plan or a proposed edit
- manual/    the helpers for building a plan by hand: applyEdits, fits, optionsForTrip, vehicleOptions,
             suggestFixes, and the EditOp union (specs/engine/rules.md, "Manual plan helpers")
- allocate/  pre-screen, rank, group, pack, sequence, repair, validate (specs/engine/rules.md section 5)
- explain.ts turns violations and unplanned orders into sentences
- fixtures/  small hand-built instances, including the 101, 112 and 213-minute worked examples

The rule reference, with codes, checks, messages and reasons, is specs/engine/rules.md.

## Rules
- Sort every collection by a stable key before iterating: orders by priority descending, then
  earliest window close, then order ref; everything else by id.
- Compare numbers with lte(a, b) (1e-6 tolerance), never <= on floats.
- A new rule needs a passing and a failing fixture, an entry in rules/index.ts and one in
  specs/engine/rules.md (use the engine-rule skill).
- validate(allocate(x)) must never contain a hard violation; the property test checks it.
- Bump ENGINE_VERSION whenever output can change; every EngineRun records it.
- Fixtures are hand-built from specs/data/datasets.md. The golden S1 test reads SEED_DATA_DIR in CI
  only; never open data/seed/ to build or debug a fixture.

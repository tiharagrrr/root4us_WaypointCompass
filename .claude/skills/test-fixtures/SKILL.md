---
name: test-fixtures
description: Build hand-made test data without the confidential datasets (engine fixtures, API seed
  builders, frozen clocks, MSW examples). Use when a test needs outlets, vehicles, items, orders,
  trips, travel times or a demo-day scenario, or whenever you are tempted to look in data/seed/.
---

# Build test fixtures by hand

The competition terms forbid sharing the datasets, and sending rows to an AI service arguably counts.
Tests never read data/seed/; they use small hand-built fixtures that follow the column rules in
specs/data/datasets.md.

## Steps
1. Start from the smallest world the criterion needs: seedMinimal() (2 depots, 6 outlets, 6 vehicles)
   in API tests, an inline object in engine tests. Add only the rows the criterion talks about.
2. Take column names, types, units and allowed values from specs/data/datasets.md. Make IDs and names
   plainly synthetic (OUT-T01, VEH-T01, "Test Outlet North") unless the criterion names a Build Spec
   example such as Fresh Kadawatha or Peliyagoda.
3. Make time explicit: freezeClock('2026-10-01T15:59:00+05:30') in API tests; pass `now` into domain
   helpers and the engine.
4. Engine fixtures go in packages/engine/fixtures/rules/<CODE>.pass.json and <CODE>.fail.json, as
   small as the rule allows, with a "why" field saying what makes each pass or fail. The booklet's
   101, 112 and 213-minute examples are already fixtures; reuse them.
5. Pick boundary values on purpose: exactly at capacity and one unit over, 15:59:59 and 16:00:00, the
   first and last minute of a window.
6. When a second test needs the same shape, move it into a builder with overrides
   (buildOrder({ tempClass: 'CHILLED' })) in the module's __tests__/builders.ts or
   packages/engine/fixtures/builders.ts.
7. Keep it deterministic: fixed UUIDv7 strings, sorted arrays, faker only with a fixed seed.

## Checklist
- [ ] Nothing read from data/seed/ or copied from a CSV
- [ ] Every value fits specs/data/datasets.md (type, unit, range)
- [ ] Clock frozen or passed in
- [ ] The smallest fixture that proves the criterion

## Never
- Open, grep, cat or summarise files in data/seed/, even to "check a column".
- Paste real outlet, vehicle or order rows into a test, a prompt or a PR.
- Use the S1 data anywhere but the CI golden test, which reads SEED_DATA_DIR.

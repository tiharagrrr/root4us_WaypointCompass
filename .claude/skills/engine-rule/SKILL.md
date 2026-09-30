---
name: engine-rule
description: Add or change a planning rule in packages/engine (capacity, temperature, access,
  windows, budgets, fuel, availability, or a soft rule). Use for any change to what makes a plan
  valid or to how violations are reported.
---

# Add or change an engine rule

A rule is pure: check(ctx: RuleContext) => Violation[]. ctx holds the trip or plan under test,
vehicles, outlets, travel and allowance tables and params. It never reads the clock or the network.

## Before you start
- Read packages/engine/CLAUDE.md and the rule's row in specs/engine/rules.md.
- Build inputs from specs/data/datasets.md (the test-fixtures skill); never from data/seed/.

## Steps
1. Write packages/engine/src/rules/<code>.ts:

   export const CAP_VOLUME: Rule = {
     code: 'CAP_VOLUME', severity: 'HARD', scope: 'trip',
     check: ({ trip, vehicle }) => lte(trip.volumeM3, vehicle.volumeCapM3) ? [] : [violation('CAP_VOLUME', {
       tripKey: trip.key, actual: round(trip.volumeM3, 2), limit: vehicle.volumeCapM3,
       message: `Over volume by ${round(trip.volumeM3 - vehicle.volumeCapM3, 2)} m³`,
     })],
   };

2. Register it in rules/index.ts.
3. If the allocator can defer an order because of it, map it in rules/reason-map.ts.
4. Add fixtures/rules/<code>.pass.json and <code>.fail.json and a test that loads both.
5. If it changes allocation, make allocate/ check it before placing an order, not only afterwards.
6. pnpm --filter engine test: unit, fixtures, the booklet examples, the property test.
7. Bump ENGINE_VERSION and update specs/engine/rules.md (code, severity, check, message, reason).
8. If the plan editor shows it, read the message on screens 07, 10 and 11.

## Checklist
- [ ] Pass and fail fixtures, both loaded by a test
- [ ] Registered in rules/index.ts; reason-map entry if it can defer an order
- [ ] Floats compared with lte(); collections sorted before iterating
- [ ] ENGINE_VERSION bumped; specs/engine/rules.md row updated
- [ ] pnpm --filter engine test green

## Never
- Duplicate the rule in the API or the web app; both import validate().
- Use Date.now, Math.random, or iterate an unsorted map.
- Loosen a fixture's expected output to make a changed rule pass without saying why in the PR.

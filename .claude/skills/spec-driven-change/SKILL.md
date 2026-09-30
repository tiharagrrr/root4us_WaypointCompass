---
name: spec-driven-change
description: Implement feature work from a module spec (specs/<module>/spec.md) test first. Restate
  the acceptance criteria, plan, write one failing test per criterion, build, verify, update the
  spec's status. Use for any feature work, any fix to specified behaviour, and whenever /implement runs.
---

# Spec-driven change

Every change goes spec, plan, build, verify, PR. The spec is the contract, and it changes in the same
PR as the code, so the next session starts from the truth.

## Before you start
- Read CLAUDE.md, the nested CLAUDE.md of each app you will touch, specs/README.md and
  specs/<module>/spec.md (frontmatter: owner, status, screens, depends-on).
- For each module in depends-on, read only what you call: its index.ts surface and its events.
- Check where you are: `git status` and the branch. Work on a `<type>/roo-<n>-<short>` branch in its
  own worktree (`git worktree add ../compass-<branch> <branch>`). On main, stop and propose one.
- Spec status `draft` means the owner has not confirmed the criteria: say so in the plan and list the
  gaps (or run the grill skill first). `done` means shipped: ask before changing its behaviour.

## Steps
1. Restate. Quote each criterion you will implement (ID and title) and say in one line what it means
   in code: endpoint, service method, event, screen. Flag anything missing (a value, a code, a
   permission) or contradicting another spec or specs/api-conventions.md. Never fill a gap by
   guessing: ask, or add it to the spec's Open questions.
2. Plan. List the files to create or change (by the module anatomy in the nest-module skill), the
   skill each part follows (rest-endpoint, drizzle-change, audit-and-events, engine-rule,
   react-screen, offline-action, contract-first), the migration (none, or one), new dependencies
   (none, or why), and for each criterion its test file and test name. Stop and wait for an OK.
3. Red. Write the tests first, one per criterion, named after it:
   `it('AC-ORD-01 submit before the cutoff', ...)`. Use the helpers in apps/backend/test (createTestApp,
   seedMinimal, as(role), freezeClock, expectProblem) and hand-built fixtures (test-fixtures skill).
   Run them and check each fails for the right reason: missing behaviour, not a typo or broken setup.
4. Green. Make the smallest change that passes. Keep the architecture rules: thin controllers, scope
   on every query, audit and outbox in the same transaction, ClockService for time, the engine for
   planning rules, the outbox for driver and loader writes.
5. Verify. `pnpm check` (or /check). Contract changed: /api-sync. Screen changed: /fidelity <frame>.
   Run the criterion's scenario once more by reading its Given/When/Then against the test: every
   Then line needs an assertion (status, body fields, _links, audit row, outbox event, absence).
6. Update the spec. Tick the criteria that pass in the checklist under "Acceptance criteria", set
   `status` (in-progress while some remain, done when all pass), list new endpoints and events in
   their tables, move answered open questions into the criteria, and add a Changelog line
   (`- YYYY-MM-DD AC-ORD-01..03 implemented; <what changed>`).
7. Report. A table of criterion → test → status (pass, fail, or not done and why), the files changed,
   anything unsure or left open, and a draft row for docs/ai-log.md.

## Checklist
- [ ] Every implemented criterion has exactly one test named after it, and it passes
- [ ] Every Then line of each criterion is asserted, including what must not exist
- [ ] No criterion changed to fit the code; any change to a criterion was agreed and logged
- [ ] Spec status, checklist, tables and changelog updated in the same change
- [ ] pnpm check green

## Never
- Start building before the plan has an OK.
- Weaken, skip or delete a test, or edit a criterion, to make the build pass.
- Implement criteria that were not asked for; list them as follow-ups instead.
- Read data/seed/ to understand the data; use specs/data/datasets.md.

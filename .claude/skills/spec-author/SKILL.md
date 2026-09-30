---
name: spec-author
description: Write or extend a module spec in specs/<module>/spec.md with Given/When/Then acceptance
  criteria that carry exact values, plus its endpoints, events and open questions. Use when drafting
  criteria from the Build Spec, a Figma frame, a Linear issue or a conversation, when adding a
  criterion for a bug, or when a new module needs its spec.
---

# Write or extend a spec

## Before you start
- Read specs/README.md (template, AC prefixes, statuses) and the module's spec if it exists.
- Gather the sources: the Linear issue and the Build Spec section it links, the frames in
  specs/frontend/screens.md, specs/api-conventions.md, and the specs of modules this one calls or
  is called by.

## Steps
1. Frontmatter: module, owner, `status: draft` (only the owner moves it to ready), screens,
   depends-on (from the module boundaries).
2. Sections in the template's order. Endpoints table: Method | Path | Permission | Notes, paths
   without /api/v1.
3. Criteria. One behaviour each, with the next free ID; never renumber or reuse an ID (retire one by
   marking it withdrawn). A title of three to seven words.
   - Given: the actor with role and scope, the data that exists, the demo clock time (Asia/Colombo).
   - When: one action.
   - Then: status code, key body fields, _links present and absent, problem code and field for
     errors, audit row, outbox event, notification, and what must not exist or change.
4. Cover each behaviour: the happy path, each refused role (403), out of scope (404), invalid input
   (400 with the field), wrong state (409 with the code), stale version (412), boundary times, and
   offline replay when the actor is a driver or loader.
5. Every value comes from a source. When the sources are silent, write the criterion with what is
   known and add an open question that names who decides.
6. Add a checklist line for each new criterion under "Acceptance criteria" and a Changelog line.

## Checklist
- [ ] Each criterion is checkable by one automated test with no human judgement
- [ ] Exact times, codes and names; no "should", "appropriate" or "quickly"
- [ ] IDs unique and in order; none reused
- [ ] Every open question has an owner

## Never
- Invent business rules, codes or numbers to fill a gap.
- Copy dataset rows or real IDs from data/seed/; use the names the Build Spec uses.
- Change a criterion that is already implemented without saying so in the Changelog and the PR.

---
description: Implement acceptance criteria from a module spec, test first
argument-hint: <module> [AC ids]
---
Read specs/$0/spec.md and CLAUDE.md, then use the spec-driven-change skill.
If specs/$0/spec.md does not exist, stop and list the folders in specs/.

0. Check the branch and worktree (`git status`). If you are on main or on another issue's branch,
   propose a `<type>/roo-<n>-<short>` branch and worktree (ask for the Linear number) and go on
   with the plan; build nothing until you are on the right branch.
1. List the acceptance criteria you will implement ($ARGUMENTS; all open criteria in the spec if
   only a module is given), what each means in code, and the files you expect to touch. Flag gaps
   and contradictions in the spec.
2. Wait for my OK on the plan.
3. Write failing tests first, one per criterion, named after it. Show that each fails for the
   right reason.
4. Implement until they pass, following the rest-endpoint, drizzle-change, audit-and-events,
   react-screen or offline-action skill as the plan says.
5. Run pnpm check. Update the spec (checklist, status, changelog). Reply with criterion → test →
   status, the files changed, and anything unsure.

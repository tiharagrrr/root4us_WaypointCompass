---
name: ship-pr
description: Get a branch ready for review and open the pull request. Self-review the diff, update
  the spec, fill the PR template, push, and create the PR linked to its Linear issue. Use when the
  work is done, when asked to open or prepare a PR, or before requesting review.
---

# Ship a PR

## Steps
1. Migrations. `git diff --stat main...HEAD -- apps/backend/drizzle`. At most one migration? If not,
   propose a split before going on. There is no limit on the PR's size.
2. Self-review the diff as the reviewer will: the architecture rules and Never list in CLAUDE.md, no
   debug logs or commented-out code, no `any`, no hex colours, no new Date() in business logic, no
   dataset content, no secrets. Fix what you find. /code-review gives a deeper pass.
3. Checks. `pnpm check` green. Contract changed: /api-sync done and its diff reviewed. Screen
   changed: /fidelity done at the frame's size.
4. Spec. specs/<module>/spec.md has its criteria ticked, status set, tables and Changelog updated.
5. Commit. Conventional Commit with the module scope, `feat(ordering): submit order before cutoff`,
   and `ROO-<n>` in the body.
6. Push. The branch name carries the issue (`<type>/roo-<n>-<short>`). Pushing asks for approval.
7. Open the PR with `gh pr create`, filling .github/pull_request_template.md: `Closes ROO-<n>`, What,
   the criteria checklist, and Checks (migration name or none, screens checked).
8. Reply with the PR URL and what the reviewer should look at first.

## Never
- Push to main, force-push, or merge.
- Tick a check that wasn't run, or say a criterion passes without its test.
- Write the person's own review notes for them.
- Mention the Challenge Booklet or AI assistance in a commit message or the PR, including
  Co-Authored-By and "Generated with" lines. AI use is disclosed separately, later.

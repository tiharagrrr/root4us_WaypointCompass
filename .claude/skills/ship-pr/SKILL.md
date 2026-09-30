---
name: ship-pr
description: Get a branch ready for review and open the pull request. Self-review the diff, update
  the spec and docs/ai-log.md, fill the PR template, push, and create the PR linked to its Linear
  issue. Use when the work is done, when asked to open or prepare a PR, or before requesting review.
---

# Ship a PR

## Steps
1. Size. `git diff --stat main...HEAD`. Under about 400 changed lines excluding generated files
   (openapi.json, packages/api-client/src/gen, drizzle/meta), and at most one migration? If not,
   propose a split (contract, schema, logic, screen) before going on.
2. Self-review the diff as the reviewer will: the architecture rules and Never list in CLAUDE.md, no
   debug logs or commented-out code, no `any`, no hex colours, no new Date() in business logic, no
   dataset content, no secrets. Fix what you find. /code-review gives a deeper pass.
3. Checks. `pnpm check` green. Contract changed: /api-sync done and its diff reviewed. Screen
   changed: /fidelity done at the frame's size.
4. Spec. specs/<module>/spec.md has its criteria ticked, status set, tables and Changelog updated.
5. AI log. Add one row to docs/ai-log.md: date, person, tool and model, task, where it was used.
   Leave "Human review and changes" for the person unless they told you what they changed.
6. Commit. Conventional Commit with the module scope, `feat(ordering): submit order before cutoff`,
   and `ROO-<n>` in the body.
7. Push. The branch name carries the issue (`<type>/roo-<n>-<short>`). Pushing asks for approval.
8. Open the PR with `gh pr create`, filling .github/pull_request_template.md: `Closes ROO-<n>`, What,
   the criteria checklist, Checks (migration name or none, screens checked), and AI assistance (tool
   and model, what the agent did). Leave "What I changed or rejected" for the person.
9. Reply with the PR URL and what the reviewer should look at first.

## Never
- Push to main, force-push, or merge.
- Tick a check that wasn't run, or say a criterion passes without its test.
- Write the person's own review notes for them.

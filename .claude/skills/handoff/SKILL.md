---
name: handoff
description: Write a handoff note so another session or teammate can continue this work without
  rediscovering it. Use when stopping mid-task, when the context is getting long, before switching
  branches, or when the user says "hand off", "save progress" or "wrap up".
---

# Hand off

Write `.claude/handoff/<branch>.md` (git-ignored; one file per branch, replacing the last one), then
show it.

## Contents
- Goal: the Linear issue (ROO-<n>), the module, and the criteria in scope.
- State of each criterion: done (its test name), in progress (what is left), or not started.
- Branch, worktree path, last commit, uncommitted files, and whether they build.
- Decisions made in this session and why, including anything agreed with the person that is not in
  the spec yet (and where it belongs).
- Commands that matter: how to run the failing test, which services must be up.
- Failing tests or errors with their first error line, and the current hypothesis.
- Next steps in order, each small enough for one sitting.
- Open questions and who answers each.

## Then
- If a decision changes the spec, update specs/<module>/spec.md too (Open questions, Changelog). The
  handoff note is not the source of truth.
- If the person wants it shared, post the same text as a comment on the Linear issue.

## Never
- Put secrets, .env values or dataset rows in the note.

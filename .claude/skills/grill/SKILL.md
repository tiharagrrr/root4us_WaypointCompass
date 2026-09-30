---
name: grill
description: Interview the person relentlessly about a plan, spec, design or set of acceptance
  criteria, one question at a time, until every decision is explicit; then write the answers back
  into the spec. Use when the user says "grill me", "poke holes", "stress-test this" or "what am I
  missing", before implementing a draft spec, or when a plan still has open questions.
---

# Grill

Reach a shared understanding before code exists. You ask and recommend; the person decides.

## Before you start
- Read the spec (specs/<module>/spec.md), the specs it depends on, specs/api-conventions.md and any
  code that already exists for it. Look up whatever the code or specs already answer instead of
  asking it.

## Steps
1. Build a question tree: every unresolved decision, grouped by the branches below, ordered so the
   decisions that block the most others come first.
2. Ask one question per message: the question, why it matters (what breaks, or which criterion
   depends on it), your recommended answer with its reason, and two or three concrete alternatives.
3. Walk a branch to the bottom before moving on: when an answer opens new questions, ask those next.
4. Push back when an answer conflicts with the spec, another module's contract, CLAUDE.md, the Build
   Spec or an earlier answer. Name the conflict and ask which wins.
5. Keep a running decision log (question → answer) and show it every five questions or so.
6. Stop when no open decision remains or the person says stop. Summarise the decisions and propose
   the edits: new or changed Given/When/Then criteria (spec-author skill), resolved open questions,
   and the questions still open with who decides them.
7. Apply the edits to the spec only after an OK, with a Changelog line.

## Branches to walk
- Actors and scope: which of the five roles may do it; which rows each sees (404) versus may not act
  on (403); depot, outlet and vehicle scope.
- State: the transition in the state machine, what happens in every other state (409), concurrent
  edits (If-Match, 412), retries (Idempotency-Key, clientUuid).
- Time: the 16:00 cutoff, the Fresh window 03:30 to 08:00, business dates in Asia/Colombo, the demo
  clock, and exactly what happens at the boundary second.
- Data: required fields, limits, units, rounding, empty and zero cases, duplicates.
- Rules: which engine rule decides it, HARD or SOFT, its message and deferral reason.
- Side effects: audit action and reason code, outbox event and payload, notifications and who gets
  them, realtime updates.
- Offline (driver and loader): what the device shows before sync, conflict resolution.
- Screens: which frame, which _links drive which buttons, loading, empty, error and offline states.
- Failure: provider down, job retry, partial success, and what the person on screen sees.
- Ownership: which module owns the table or the decision, and which event crosses the boundary.

## Never
- Ask several questions in one message, or ask what the code or spec already answers.
- Decide for the person: recommend, then wait.
- Edit the spec before the person confirms the summary.

# Specs

A spec file is the contract for one module: what it must do, written as Given/When/Then acceptance
criteria that turn directly into tests, plus the tables, endpoints and events it owns. People and
agents read the same files. A spec changes in the same PR as the code, so the next session starts
from the truth.

Every file here was first generated from the Build Spec on Wed 30 Sep 2026. From then on, this
folder is the source of truth; the Build Spec is history.

## Files

| Path | What it holds |
| --- | --- |
| [api-conventions.md](api-conventions.md) | REST conventions: URLs, envelope and `_links`, problem+json, paging, If-Match and idempotency, the CRUD layer, orval |
| [data/datasets.md](data/datasets.md) | The booklet's column dictionary, mapped to tables. Columns only, no rows |
| [engine/rules.md](engine/rules.md) | The time model, the 18 planning rules with fixtures, the allocator, deferral reasons |
| [frontend/screens.md](frontend/screens.md) | The 75 Figma frames: node, viewport, route, endpoints, module, owner |
| `<module>/spec.md` | One per API module (table below) |

| Module | AC prefix | Owner | Spec |
| --- | --- | --- | --- |
| identity (with settings and demo clock) | `AC-IDN` | Nimesha | [identity/spec.md](identity/spec.md) |
| audit | `AC-AUD` | Nimesha | [audit/spec.md](audit/spec.md) |
| master-data | `AC-MD` | Harini | [master-data/spec.md](master-data/spec.md) |
| ordering | `AC-ORD` | Harini | [ordering/spec.md](ordering/spec.md) |
| fleet | `AC-FLT` | Tihara | [fleet/spec.md](fleet/spec.md) |
| planning | `AC-PLN` | Tihara | [planning/spec.md](planning/spec.md) |
| forecasting | `AC-FC` | Tihara | [forecasting/spec.md](forecasting/spec.md) |
| loading | `AC-LOD` | Harini | [loading/spec.md](loading/spec.md) |
| execution (with tracking and ETA) | `AC-EXE` | Aniqa | [execution/spec.md](execution/spec.md) |
| sync | `AC-SYN` | Aniqa | [sync/spec.md](sync/spec.md) |
| receipt (with issues) | `AC-RCP` | Harini | [receipt/spec.md](receipt/spec.md) |
| alerts | `AC-ALR` | Harini | [alerts/spec.md](alerts/spec.md) |
| notifications | `AC-NTF` | Nimesha | [notifications/spec.md](notifications/spec.md) |
| webhooks | `AC-WHK` | Nimesha | [webhooks/spec.md](webhooks/spec.md) |
| realtime | `AC-RT` | Nimesha | [realtime/spec.md](realtime/spec.md) |
| simulation | `AC-SIM` | Aniqa | [simulation/spec.md](simulation/spec.md) |

The engine's rules have codes (CAP_WEIGHT, ...) instead of AC IDs; each has a pass and a fail
fixture. Screens take their criteria from the module that serves them.

## Status

The `status` line in each spec's frontmatter:

| Status | Means |
| --- | --- |
| `draft` | Criteria are being written; the owner has not confirmed them. An agent may implement them only after the owner OKs the plan, and says in the plan that the spec is a draft. |
| `ready` | The owner confirmed the criteria. Build against them as written. |
| `in-progress` | Some criteria have passing tests; the checklist shows which. |
| `done` | Every criterion has a passing test on main. |

## Format

```
---
module: ordering
owner: Harini
status: draft          # draft | ready | in-progress | done
screens: [M1, M1a, M1b, M2, M3, M8, "03", "04"]
depends-on: [identity, master-data]
---

# Ordering
## Purpose
## Scope            In and Out, naming the module that owns each Out item
## Model            tables owned (apps/backend/src/db/schema/<module>.ts), key columns, invariants
## Endpoints        | Method | Path | Permission | Notes |, paths without /api/v1
## Services and helpers
## Events           Emits and Consumes, with payload fields
## Log events
## Permissions
## Acceptance criteria
## Non-functional
## Open questions
## Changelog
```

## Acceptance criteria

- One behaviour per criterion, in a `gherkin` block, with an ID `AC-<PREFIX>-<NN>` and a short title.
  IDs are never renumbered or reused; a dropped criterion is marked withdrawn.
- Exact values: demo-clock times in Asia/Colombo, status codes, problem codes and fields, `_links`
  present and absent, audit action names, outbox event names, and what must not exist afterwards.
- Each criterion is one test named after it, so a failing test points straight back to the line:
  `it('AC-ORD-02 a late order rolls to the next run', ...)`.
- A checklist under the Acceptance criteria heading tracks which criteria have a passing test.
  Tick a line in the same PR as its test.
- When a source doesn't give a value, the criterion says what is known and the gap goes under Open
  questions with the person who decides. Never fill a gap by guessing.

```gherkin
AC-ORD-01  Submit before the cutoff
  Given a store manager for Fresh Kadawatha with a draft dry order for Fri 2 Oct holding 3 lines
    And the demo clock reads Thu 1 Oct 15:59:00 Asia/Colombo
  When she submits the order
  Then the response is 200 with status SUBMITTED, afterCutoff false and deliveryDate 2026-10-02
    And the order's _links include edit and cancel
    And exactly one audit row ordering.order.submitted and one outbox event order.submitted exist
```

## Workflow

1. **Spec.** The owner writes or updates the criteria. An agent may draft them (the spec-author
   skill) or interview the owner about gaps (the grill skill); the owner edits and owns them.
2. **Plan.** `/implement <module> <AC ids>` makes the agent propose a plan and stop; the owner
   approves or corrects it.
3. **Build.** Failing tests first, one per criterion, then the code, in the branch's own worktree.
4. **Verify.** `pnpm check`; screens also get `/fidelity <frame>`.
5. **PR.** The spec's checklist, status and Changelog change in the same PR (the ship-pr skill).

## Changing a spec

- Add a Changelog line with the date and what changed: `- 2026-10-01 AC-ORD-07 added (templates)`.
- Changing a criterion that already has a passing test is a behaviour change: say so in the PR and
  tell the owners of modules that depend on it (the `depends-on` lines that name this module).
- Contract changes (endpoints, events, payloads) also go through `/api-sync` and the event catalog
  in packages/shared.

# AI tool disclosure

> Required by the Tech-Triathlon 2026 brief. This page summarises [ai-log.md](ai-log.md), which has one row per AI-assisted task with the person, the tool and model, the files it touched and the review.

## Tools used

| Tool | Models | Used by | Used for |
| --- | --- | --- | --- |
| Claude Code (Anthropic), a coding agent in the terminal and editor | Claude Opus 5 and 5.5, Claude Sonnet 5.5, Claude Fable 5.1 | Nimesha, Tihara, Harini | Planning against a module spec, writing tests and code, running the checks, comparing built screens with their Figma frames |
| Claude (claude.ai) | | Nimesha | Drafting the Build Spec from the brief, the design files and the team's stack spec |

No other AI tool is recorded in the log.

## Where AI was used

Most of the code in this repository was written with Claude Code, working from specs the team owns. By area, from the log:

| Area | What the AI produced |
| --- | --- |
| Repository and tooling | Monorepo scaffolding, Compose stack, Dockerfiles, CI workflow, the agent kit (`CLAUDE.md`, `.claude/` hooks, commands and skills), first drafts of every module spec |
| API kernel | Request pipeline (guards, transaction stamping, envelope, problem+json), idempotency, paging, the clock, the outbox relay and event bus |
| Database | Drizzle schema merged from the team's Supabase draft, migrations, row-level security, the seed and demo day (written from the column dictionary, without opening the dataset files) |
| Backend modules | Identity, audit timeline, ordering, master data, fleet, planning, loading, execution and live map, sync, receipt and issues, alerts, notifications, realtime, inbound webhooks, simulation |
| Planning engine | The 18 rules with pass and fail fixtures, the validator, the allocator, the manual-edit helpers |
| Web app | Design tokens from the Figma variables, the generated API client, the five role shells, and the admin, store, dispatcher, loader and driver screens from their Figma frames |
| Documentation | This `docs/` folder, the README and the specs, drafted by AI and edited by the team |

## What people decided

The agents did not choose what to build or how the rules read. The log records, task by task, where a person made the call:

- **Scope, ownership and daily gates.** The team reviewed the Build Spec on Wed 30 Sep and confirmed module owners, the gates and the design departures.
- **Stack and architecture.** Decided by the team before the build began ([adr/0002](adr/0002-stack-and-architecture.md), from the team spec of 25 Sep).
- **Planning rules.** Open questions in the engine spec were settled with the team lead before any rule was written: whether a reefer may carry ambient goods, the Tech value limit, what the fuel ledger excludes.
- **Module decisions.** Each agent session planned against the spec and stopped for approval before building. Examples from the log: eight decisions on sign-in and permissions, four on the identity API, how a dock's "remove" backorders only the affected quantity, one issue per discrepant receipt line, the 48-hour limit on reopening an issue, the Style weekly delivery day.
- **Defaults an agent had to guess** are marked as open in the module's spec for its owner to confirm, not presented as settled (for example the 14-day ordering horizon and the allocator's reefer preference threshold).

## How output was checked

- **Spec first.** Work starts from `specs/<module>/spec.md`. The agent restates the acceptance criteria, proposes a plan and waits for a person's OK.
- **Tests first.** Each acceptance criterion is one test named after it, written and shown failing before the code. In several tasks the tests were also checked against deliberate bugs to prove they can fail.
- **Automated gates.** `pnpm check` (lint, typecheck, module boundaries, tests) must pass, and CI repeats it with an OpenAPI drift check and a `docker compose up` smoke test.
- **Screens.** Built screens were compared with their Figma frames at the frame's size; intended differences are listed in [departures.md](departures.md).
- **Pull requests.** All work reached `main` through pull requests against a protected branch.
- **Rules the agents work under.** `CLAUDE.md` forbids bypassing the audit service, a scope policy or the engine validator to make a test pass, and forbids skipping or deleting a failing test.

**What is not done.** The last column of [ai-log.md](ai-log.md) is the owner's line-by-line review of each task. For most rows it still reads "To fill after review" or "Not reviewed yet": the automated checks above ran, but the owner's written review did not happen before the deadline.

## Dataset guardrail

The competition terms forbid sharing the datasets, so no AI tool saw them. The files are git-ignored and are not in this repository. A hook (`.claude/hooks/protect-data.mjs`) and deny rules in `.claude/settings.json` block every agent read, search or copy in the dataset folders, and prompt before any `.env` file is touched. Agents worked from the column dictionary in [`specs/data/datasets.md`](../specs/data/datasets.md) (columns only, no rows) and from hand-made test fixtures.

## AI inside the product

Ordering, planning, loading, delivery and receipt use no AI model: the allocation engine is deterministic rule code. One optional feature calls a language model, the simulator's scenario director, which chooses the demo disruptions. It is a stretch goal, disabled by default (`LLM_PROVIDER=disabled`), and has a scripted, keyless stand-in.

## Datathon

This repository holds the Hackathon submission and no Datathon modelling work. The Datathon rules prohibit pre-trained models (except for synthetic data generation or pre-processing), proprietary API-based modelling or pre-processing, and low-code or automated end-to-end modelling tools; AI use on the Datathon is disclosed with that submission.

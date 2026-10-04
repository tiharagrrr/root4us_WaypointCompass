# Documentation

| Document | What it covers |
| --- | --- |
| [architecture.md](architecture.md) | **Required.** Architecture diagram, components, module boundaries, the request lifecycle, realtime, webhook and offline sync paths |
| [data-model.md](data-model.md) | **Required.** ER diagram, tables by module, state machines, database roles and row-level security, audit rules |
| [decisions.md](decisions.md) | The decisions that shape the system, with what was turned down and what each costs |
| [events.md](events.md) | Domain events: how the outbox delivers them, who produces and who consumes |
| [ai-tool-disclosure.md](ai-tool-disclosure.md) | **Required.** Where AI was used, what people decided, how output was checked, and the dataset guardrail |
| [ai-log.md](ai-log.md) | One row per AI-assisted task; the disclosure summarises it |
| [deployment.md](deployment.md) | Compose for judges, the Railway live demo, environment variables |
| [linear.md](linear.md) | Task tracking in Linear and how branches and PRs link to issues |
| [departures.md](departures.md) | Where a built screen deliberately differs from its Figma frame, and why |
| [adr/](adr/) | The longer decision records behind decisions.md (stack, local object storage) |
| [spec/](spec/) | Team spec: scope, stack evaluation, 10-day plan |
| `Challenge Booklet.pdf` | The official Tech-Triathlon 2026 brief |

Diagrams are written in [Mermaid](https://mermaid.js.org/) so they render on GitHub and stay in sync with the code through review.

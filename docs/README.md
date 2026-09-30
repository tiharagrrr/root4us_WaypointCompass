# Documentation

| Document | What it covers |
| --- | --- |
| [architecture.md](architecture.md) | **Required.** Architecture diagram, components, backend modules, request and offline sync flows |
| [data-model.md](data-model.md) | **Required.** ER diagram, tables by module, order state machine, audit rules |
| [ai-tool-disclosure.md](ai-tool-disclosure.md) | **Required.** Which work was AI-assisted, which was not, and how the tools were used |
| [ai-log.md](ai-log.md) | One row per AI-assisted task, added in the same PR; the disclosure summarises it |
| [deployment.md](deployment.md) | Compose for judges, public deployment, environment variables |
| [linear.md](linear.md) | Task tracking in Linear and how branches and PRs link to issues |
| [adr/](adr/) | Architecture decision records (why REST, why a PWA, why a modular monolith, ...) |
| [spec/](spec/) | Team spec: scope, stack evaluation, 10-day plan |
| `Challenge Booklet.pdf` | The official Tech-Triathlon 2026 brief |

Diagrams are written in [Mermaid](https://mermaid.js.org/) so they render on GitHub and stay in sync with the code through review.

# 2. Stack and architecture

Date: 2026-09-28 · Status: accepted (from the team spec, 25 Sep 2026)

## Context
We have 10 days to build all four roles, and judges test the driver and loader flows on phone-sized browsers. Offline operation is scored at 10% and the allocation engine at 20%.

## Decisions
- **One responsive React PWA** for all four roles. No Flutter for the Hackathon: it would mean a second codebase, second auth and second offline layer for an optional deliverable.
- **REST + OpenAPI** (`/api/v1`, Swagger at `/api/docs`, generated TS client). No GraphQL/Relay: the setup cost is high and offline mutation queues are awkward.
- **Modular monolith** (NestJS) with **in-process domain events**, a Postgres **transactional outbox**, and **BullMQ** on Redis for async jobs. No microservices, no Kafka.
- **PostgreSQL via Drizzle ORM.** Lightweight, SQL-first migrations that are applied from the compiled app, so no CLI is needed in the runtime image. Supabase is used as plain managed Postgres + S3 storage in production only.
- **Better Auth** self-hosted in the API with cookie sessions on one origin (Caddy), and RBAC as role + scope.
- **Deterministic allocation engine** with a shared constraint validator in `packages/shared`. No agentic AI in the core flow.
- **Maps are display-only** (Leaflet + OSM). Planning maths uses the supplied `district_travel.csv` and `service_allowance.csv` so our numbers match the rules judges check.

## Consequences
- `docker compose up` stays self-contained, with no external keys.
- The same validator checks UI edits, engine output and the Datathon Task 2B file.
- Real-time updates use SSE backed by Redis pub/sub, so they work across API replicas.

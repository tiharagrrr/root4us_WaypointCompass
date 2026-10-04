# Decisions

The decisions that shape the system, one short entry each: what we chose, what we turned down and what it costs. The longer records are in [adr/](adr/); a module's own decisions are in the "Decided while building" section of its spec in [`specs/`](../specs/README.md).

| # | Decision | Record |
| --- | --- | --- |
| 1 | Keep architecture decision records | [adr/0001](adr/0001-record-architecture-decisions.md) |
| 2 | Stack: one React PWA, REST + OpenAPI, a NestJS modular monolith, PostgreSQL with Drizzle | [adr/0002](adr/0002-stack-and-architecture.md) |
| 3 | Local object storage runs on Garage | [adr/0003](adr/0003-local-object-storage.md) |
| 4 | Planning rules live in one pure package | below |
| 5 | Audit row and outbox event in the same transaction as every change | below |
| 6 | Permissions are role + scope, checked in the app and again in the database | below |
| 7 | Responses carry `_links`; screens show only the actions the server offers | below |
| 8 | Offline writes are an append-only outbox replayed through one endpoint | below |
| 9 | Realtime is SSE over Redis pub/sub, with replay from the outbox | below |
| 10 | One clock, so the demo can travel in time | below |
| 11 | Outside services sit behind ports with a keyless default | below |
| 12 | Specs with acceptance criteria are the contract, and each criterion is one test | below |
| 13 | The live demo runs on Railway | below |

## 4. Planning rules live in one pure package

**Context.** The same rules have to hold when the allocator builds a plan, when a dispatcher drags an order to another trip, and when the Datathon's Task 2B plan is checked. Two copies of a rule would drift.

**Decision.** `packages/engine` holds the 18 rules, the validator, the allocator and the manual-edit helpers. It is pure TypeScript with no I/O and no clock; an allowlist test fails the build if it imports anything else. The API, the worker and the planning wizard in the browser all call it, and nothing else re-implements a rule.

**Consequences.** The allocator is deterministic: the same input gives byte-identical output. Each rule has a passing and a failing fixture. Engine parameters that are also API settings have to agree, and one default (`reeferCarriesAmbient`) is still an open question in the planning spec.

## 5. Audit and outbox in the same transaction

**Context.** The brief asks who did what and when, and four roles have to see each other's changes without polling.

**Decision.** Every state change is one `@Transactional()` service method that writes the change, an `audit_events` row and an `outbox_events` row together. The audit table is append-only (a trigger blocks update, delete and truncate for every role) and hash-chained. The worker relays outbox rows to in-process consumers and to Redis.

**Rejected.** Publishing events straight to Redis from the request (an event could be sent for a change that then rolled back, or lost after one that committed); Kafka or a separate event store (too much to run for one team in a week).

**Consequences.** Delivery is at least once, so consumers dedupe on the event id. A failed audit write rolls the change back.

## 6. Role + scope, enforced twice

**Decision.** A role says what someone may do; a scope (depot, outlet or vehicle) says which rows. The permission matrix is one table in `packages/shared`. Guards check it per route, every query applies its module's `ScopePolicy`, and PostgreSQL row-level security filters the same rows again from the actor stamped into each transaction. Out of scope answers 404, a missing permission 403. The API connects as a role that cannot change the schema or edit the audit trail.

**Consequences.** A forgotten `where` clause returns nothing instead of leaking another store's orders. A query that returns nothing unexpectedly may be a policy doing its job, which costs some debugging time.

## 7. Server-driven actions

**Decision.** Every resource carries `_links` for the actions this actor may take in its current state, built from the same state machines the services enforce. A screen shows a button only when its link is present, and reads data only through hooks generated from `openapi.json`.

**Consequences.** The rule for "can this be cancelled now?" exists once, on the server. Changing a controller or DTO means regenerating the client (`pnpm api:gen`), and CI fails on a stale contract.

## 8. Offline as an append-only outbox

**Context.** Drivers lose signal for hours, and offline operation is scored.

**Decision.** Driver and loader writes never call the API directly. Each action updates IndexedDB and appends a record with a client-generated `clientUuid` and the device's time; the queue replays in order through `POST /sync`. The server accepts each `clientUuid` once, through the same handlers as the online paths. Plan data is server-wins, stop events are append-only, and a record the server's state contradicts is reported back to the device as a conflict rather than applied or silently dropped.

**Rejected.** A native app (a second codebase, auth and offline layer); last-write-wins merging (it would silently overwrite a dispatcher's reassignment).

**Consequences.** A delivery recorded offline keeps its device time and is marked "Synced late" on the timeline. The dispatcher's conflict screen (19c), where the device's or the server's version is kept, is not built.

## 9. SSE over Redis pub/sub

**Decision.** Each client holds one `GET /streams/me` stream. Events come from the outbox through Redis, so any API instance can serve any client, and a reconnecting browser replays what it missed by `Last-Event-ID`.

**Rejected.** WebSockets (nothing here needs the client to push over the socket, and SSE reconnects by itself over plain HTTP); polling.

## 10. One clock

**Decision.** Business time comes only from `ClockService.now()` on the server and `useServerClock()` in the web app, in Asia/Colombo. Scheduled work is an `@OnTick` method run by the worker's one-minute ticker with the `now` it is given, never its own cron.

**Consequences.** An admin can move the demo clock past the 4 PM cutoff and the cutoff job, reminders and screens all follow. `new Date()` in business logic is a review failure.

## 11. Providers behind ports

**Decision.** Email, SMS and the language model sit behind interfaces in `core/providers`. An environment variable picks the adapter (Resend; Notify.lk, Text.lk or Twilio; Anthropic or any OpenAI-compatible server). The default is a demo inbox that sends nothing and shows messages at `/demo/inbox`, and the language model is disabled.

**Consequences.** `docker compose up` needs no external keys, and tests never reach the internet. The only language-model feature, the simulator's scenario director, is a stretch goal that stays off unless `LLM_PROVIDER` is set; no model takes part in ordering, planning, loading, delivery or receipt.

## 12. Specs are the contract

**Decision.** Each module has `specs/<module>/spec.md` with Given/When/Then acceptance criteria. Each criterion is one test named after it (`AC-ORD-02 ...`), written failing first. The spec changes in the same PR as the code, and its checklist shows what is built.

**Consequences.** A reader can tell what is and is not done from the spec's checklist without running anything. The checklists are honest about gaps: forecasting and outbound webhooks are specified and not built.

## 13. Railway for the live demo

**Context.** The plan was Kubernetes on Oracle's free tier with Supabase for Postgres and storage, timeboxed to half a day, with Compose on one VM as the fallback.

**Decision.** The live demo runs on Railway: the frontend (Caddy) is the only public service and proxies `/api` to the API over the private network, beside managed Postgres and Redis. The same Dockerfiles build the Compose stack and the Railway services.

**Consequences.** No Kubernetes manifests were written. Deployment settings live in the Railway dashboard, not in the repository ([deployment.md](deployment.md)).

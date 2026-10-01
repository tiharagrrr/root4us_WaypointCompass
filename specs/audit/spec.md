---
module: audit
owner: Nimesha
status: draft          # draft | ready | in-progress | done
screens: [M8, "04", "23"]
depends-on: [core]
---

# Audit

## Purpose
Every state change writes a hash-chained audit row in the same transaction as the change, so nothing
happens without a record and nobody can quietly edit one. The audit module owns that trail and serves it
back as the audit feed, a CSV export, merged entity timelines and a chain check.

Logs tell engineers what went wrong and expire after 7 days; the audit trail tells the business who changed
what and never expires.

## Scope
In:
- `AuditService.record()`, which every module's command services call.
- The `audit_events` table, its append-only triggers and grants, and the hash chain.
- The reason-required rule for the decisions listed under Model.
- The audit feed and CSV export (`AuditQueries`), timelines merged across modules (`TimelineService`), and
  chain verification (`ChainVerifier`, the `audit.verify-chain` job, `POST /audit/chain/verify`).
- The `audit_chain_ok` metric and the daily head hash in object storage.

Out:
- Which actions each module records, and its before and after snapshots (`toAuditSnapshot` mappers): the
  module that owns the change.
- The critical alert raised on a chain break: alerts (consumes `audit.chain.broken`).
- Outlet deferral history on M7 and 23, with repeat skips highlighted: planning (`GET /deferrals`).
- The deferral reason list: planning (`deferral_reasons`), edited through the A6 API in
  `specs/identity/spec.md`.
- The Grafana alert on a chain break: observability (`deploy/grafana/`).
- Identity events such as sign-ins: identity decides what to record; this module stores it.

### Screens
| Frame | Node | Route | Data | Actions and states |
| --- | --- | --- | --- | --- |
| M8 Order history | 185:11842 | /store/history | GET /orders, POST /orders/{id}/reorder, /timelines/order/{id} | Reorder, open the timeline |
| 04 Past orders | 488:8916 | /dispatch/past-orders | GET /orders, timelines | Search, open the timeline |
| 23 Deferrals | 185:18890 | /dispatch/deferrals | GET /deferrals, timelines | The deferral log with reasons and responses |

The order timeline is the dispute screen and one of the demo video's key moments. The audit feed
(`GET /audit-events`) has no Figma frame of its own.

## Model
Schema file: `apps/backend/src/db/schema/audit.ts` (owner audit). Triggers and grants live in the hand-written
migration `apps/backend/drizzle/*_platform_integrity.sql` (created with `db:custom`), because Drizzle can't
declare a trigger.

| Column | Type | Notes |
| --- | --- | --- |
| id | uuid (UUIDv7) | Primary key |
| seq | bigserial, not null, unique | Chain order |
| actorId, actorRole, actorName | text | actorName can be the name typed on a shared dock tablet |
| deviceId | text | From x-device-id |
| source | audit_source, not null | WEB, PWA, OFFLINE_SYNC, ENGINE, SYSTEM, SIMULATION, WEBHOOK |
| action | text, not null | `<module>.<entity>.<verb>`, for example ordering.order.submitted |
| entityType, entityId | text, not null | Points at any entity by (type, id), with no foreign key |
| before, after | jsonb | Audited fields only |
| reasonCode, reasonNote | text | Required for the decisions below |
| occurredAt | timestamptz, not null | Device or business time |
| recordedAt | timestamptz, not null | Real server time, set by the app so the hash can be recomputed |
| correlationId | text | Ties the row to its request, jobs and notifications |
| clientUuid | uuid | Offline events |
| prevHash | text, not null | The previous row's hash, or GENESIS_HASH |
| hash | text, not null, unique | sha256(prevHash + canonicalJson(row without prevHash)), RFC 8785 canonical JSON |

Indexes: `audit_entity_idx` (entityType, entityId, seq), `audit_action_idx` (action, recordedAt),
`audit_actor_idx` (actorId, recordedAt).

Invariants:
- Same transaction. `record()` joins the use case's transaction; if it fails, the change rolls back. It
  throws when no transaction is active.
- Append-only. Triggers raise `audit_events is append-only (% blocked)` on UPDATE and DELETE (per row) and
  on TRUNCATE (per statement). `compass_app` holds INSERT and SELECT only (UPDATE and DELETE revoked);
  `compass_readonly` may SELECT.
- Tamper-evident. Each row stores prevHash and hash. One writer at a time: `record()` takes
  `pg_advisory_xact_lock(4747)` before reading the last hash.
- Two clocks. occurredAt is device or business time (`clock.now()` unless given), recordedAt is
  `clock.realNow()`. Offline events synced late are flagged, never reordered.
- Idempotent. A replay with the same clientUuid never adds a second row.

Actions the API rejects without a reason (`REASON_REQUIRED`):

| Action | Who | Reason required |
| --- | --- | --- |
| order.cancelled | Store manager, dispatcher | Store: a note; dispatcher: a code |
| deferral.confirmed | Dispatcher | A deferral reason code (the engine's pre-filled) and a note the store sees |
| deferral.repeat_skip_overridden | Dispatcher | An override note |
| plan.revised, any edit after publish | Dispatcher | Code and note |
| plan.soft_rule_overridden | Dispatcher | Code and note |
| trip.reassigned, trip.resequenced, stop.deferred | Dispatcher | Code |
| load.flag_raised | Loader | Missing, damaged, wrong temperature or over capacity |
| load.flag_decided (remove) | Dispatcher | Code |
| stop.failed, stop.partial | Driver | Outcome and note |
| trip.cant_run | Driver | Breakdown, cooling, unwell or other |
| issue.reported | Store manager | Issue type |
| user.role_changed, user.scope_changed | Admin | Code |
| sync.conflict_resolved | Dispatcher | Code |

Every role's actions are audited, not only these: order drafts and submissions, cutoff closes, each engine
run (version, parameters, input hash, served and deferred counts), publishes, line checks and releases with
the reefer temperature, downloads, arrivals, deliveries and proof of delivery, syncs, sign-ins, failed
sign-ins, seed runs and demo resets.

## Endpoints
| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| GET | /audit-events | audit:read | Cursor pages; filters by date, action, actor, role, entity, depot |
| GET | /audit-events/export.csv | audit:export | Streamed CSV of the same filter |
| GET | /timelines/{entityType}/{id} | read on that entity | Order, trip, stop or outlet history, merged across modules |
| POST | /audit/chain/verify | audit:export | Runs the chain check now |

Feed paging: cursor pages, limit default 50 and max 200, `meta.page { limit, nextCursor, hasMore }`, no
total. A cursor is base64url JSON of the last row's sort value and id; a tampered cursor answers 400.
Filters accept only the fields the resource spec lists; any other answers 400 naming the field.

Example: `GET /audit-events?filter[action]=planning.plan.published&filter[recordedAt][gte]=2026-10-01T00:00:00%2B05:30&limit=50`.

The order timeline, `GET /timelines/order/{id}`, merges the order, its stops, trip, deferrals, load lines
and receipt by occurredAt, with who, role, device and reason, and a Synced late badge when recordedAt
trails occurredAt by more than 5 minutes.

## Services and helpers
- `AuditService.record(input)`: checks `txHost.isTransactionActive()` (throws
  `audit.record() must run inside a transaction`); throws `ValidationError([{ field: 'reasonCode', code:
  'required', message: 'A reason is required' }])` for a `REASON_REQUIRED` action with no reasonCode;
  takes `pg_advisory_xact_lock(4747)`; reads the last hash by seq; builds the row from the input and CLS
  (actor, deviceId, source defaulting to WEB, correlationId); hashes it and inserts it. Input fields:
  action, entity `[type, id]`, before, after, reasonCode, reasonNote, occurredAt, clientUuid, source,
  actorName.
- `AuditQueries`: the feed and the CSV export, read in batches of 1,000.
- `TimelineService`: merges an order's own rows with its stops, trip, deferrals, load lines and receipt.
- `ChainVerifier`: streams rows by seq, stops at the first mismatch, sets `audit_chain_ok`, raises an
  alert, and writes `audit-heads/<date>.json` to object storage.
- Job: `audit.verify-chain`, daily at 02:00 in the worker, and on demand from `POST /audit/chain/verify`.
- Helpers: `canonicalJson` (RFC 8785), `sha256`, `GENESIS_HASH`.
- Cost: the advisory lock serialises audited transactions. At Waypoint's volume that costs milliseconds,
  but anything holding it (an engine run writing trips) must use bulk inserts and finish fast.
- `AuditService` and `OutboxService` use the same `TransactionHost`, so a missing `@Transactional()` fails
  in the first test rather than in the demo.

## Events
Emits:

| Event | Consumed by |
| --- | --- |
| audit.chain.verified | alerts |
| audit.chain.broken | alerts (a break raises a critical alert) |

The doc gives no payload fields; the matching log lines carry the last seq and the duration.

Consumes: none.

## Log events
- `audit.chain.verified` (last seq, duration)
- `audit.chain.broken`, at error level

Metric: `audit_chain_ok` (gauge), 1 after a clean verification and 0 after a break. Grafana alerts on any
audit chain break.

## Permissions
| Permission | admin | dispatcher | store_manager | loader | driver |
| --- | --- | --- | --- | --- | --- |
| audit:read | yes | yes | yes | — | — |
| audit:export | yes | yes | — | — | — |

Timelines need read on the entity, and the entity must be in the caller's scope (404 otherwise):

| Timeline | Permission | Roles that hold it |
| --- | --- | --- |
| order | order:read | admin, dispatcher, store_manager, loader |
| trip | trip:read | admin, dispatcher, loader, driver |
| stop | stop:read | dispatcher, store_manager, driver |
| outlet | masterData:read | all five |

## Acceptance criteria
Times are Asia/Colombo. "Real time" means `ClockService.realNow()`; "the demo clock" means
`ClockService.now()`. AC-AUD-01 to 03 carry the IDs the Build Spec gave them.

- [ ] AC-AUD-01 Audit rows can't be changed
- [ ] AC-AUD-02 Chain check finds a tampered row
- [ ] AC-AUD-03 Order timeline merges four modules
- [ ] AC-AUD-04 Nightly check records the head hash
- [ ] AC-AUD-05 Audit row rolls back with its change
- [ ] AC-AUD-06 A missing reason is refused
- [ ] AC-AUD-07 Rows carry actor, device and clocks
- [ ] AC-AUD-08 Concurrent writers keep one chain
- [ ] AC-AUD-09 A replay adds no second row
- [ ] AC-AUD-10 The app role can't alter rows
- [ ] AC-AUD-11 record() needs a transaction
- [ ] AC-AUD-12 First row chains from genesis
- [ ] AC-AUD-13 Feed filters by action and time
- [ ] AC-AUD-14 Cursor pages never repeat rows
- [ ] AC-AUD-15 Feed rejects bad cursors and filters
- [ ] AC-AUD-16 Feed caps a page at 200
- [ ] AC-AUD-17 Field roles can't read the feed
- [ ] AC-AUD-18 Store managers can't export or verify
- [ ] AC-AUD-19 Dispatcher exports the feed as CSV
- [ ] AC-AUD-20 Out-of-scope timeline is not found
- [ ] AC-AUD-21 Drivers can't read order timelines
- [ ] AC-AUD-22 Drivers read their own trip timeline

```gherkin
AC-AUD-01  Audit rows can't be changed
  Given audit_events holds 20 rows written by AuditService with a valid chain
  When the owner role compass_owner runs UPDATE audit_events SET "reasonNote" = 'x' WHERE seq = 7,
       DELETE FROM audit_events WHERE seq = 7, and TRUNCATE audit_events
  Then they fail with "audit_events is append-only (UPDATE blocked)", "audit_events is append-only (DELETE blocked)"
       and "audit_events is append-only (TRUNCATE blocked)"
    And the table still holds 20 rows with every hash unchanged

AC-AUD-02  Chain check finds a tampered row
  Given audit_events holds 20 rows with a valid chain
    And, in test setup only, the trigger was disabled, the reasonNote of the row with seq 7 changed, and the trigger re-enabled
  When admin Rusiru Withanage posts /audit/chain/verify
  Then the verifier stops at seq 7 as the first mismatch
    And audit_chain_ok is 0
    And exactly one outbox event audit.chain.broken exists, which alerts turns into a critical alert
    And the log has audit.chain.broken at error level

AC-AUD-03  Order timeline merges four modules
  Given order WF-0171 for Fresh Kadawatha has audit rows from ordering (submitted, occurredAt 2026-10-01T14:02:11+05:30),
        loading (a load-line check), execution (stop delivered, occurredAt 2026-10-02T04:22:00+05:30, recordedAt
        2026-10-02T04:31:00+05:30 after an offline sync) and receipt (receipt confirmed)
    And the loading row's recordedAt trails its occurredAt by exactly 5 minutes
  When Nimesha Periyapperuma (store manager, Fresh Kadawatha) requests GET /timelines/order/{id}
  Then the response is 200 with the entries of all four modules in occurredAt order
    And each entry shows who, role, device and reason
    And the delivered entry is marked Synced late, because recordedAt trails occurredAt by 9 minutes
    And the loading entry is not marked Synced late, because it trails by exactly 5 minutes

AC-AUD-04  Nightly check records the head hash
  Given audit_events holds 20 rows with a valid chain
  When the audit.verify-chain job runs at 02:00
  Then audit_chain_ok is 1
    And exactly one outbox event audit.chain.verified exists
    And the log has audit.chain.verified with last seq 20 and the duration
    And audit-heads/<date>.json in object storage holds the hash of the row with seq 20

AC-AUD-05  Audit row rolls back with its change
  Given a use case that changes a row, calls audit.record() and then outbox.add() inside one @Transactional() method
  When outbox.add() fails in a test double after the audit row was inserted
  Then the domain change, the audit row and the outbox event all roll back
    And none of the three exists afterwards

AC-AUD-06  A missing reason is refused
  Given dispatcher Tihara Egodage and a Peliyagoda trip for 2026-10-02
  When she reassigns the trip with no reasonCode
  Then the response is 400 VALIDATION_FAILED with errors [{ field: "reasonCode", code: "required", message: "A reason is required" }]
    And no audit row, no outbox event and no change to the trip exists

AC-AUD-07  Rows carry actor, device and clocks
  Given the demo clock is frozen at 2026-10-01T15:55:00+05:30 while real time is 2026-09-30T11:00:00+05:30
    And Tihara Egodage sends a request with x-correlation-id C1 and x-device-id D1
    And her use case passes a reasonCode and a reasonNote
  When the use case records its audit row
  Then the row has actorId set to her id, actorRole dispatcher, actorName "Tihara Egodage", deviceId D1, source WEB and correlationId C1
    And it carries the reasonCode and reasonNote
    And occurredAt is 2026-10-01T15:55:00+05:30 and recordedAt is the real time
    And seq is one more than the previous row's and prevHash equals the previous row's hash
    And hash equals sha256(prevHash + canonicalJson(the row without prevHash))

AC-AUD-08  Concurrent writers keep one chain
  Given two transactions that each record an audit row at the same moment
  When both commit
  Then the two rows have consecutive seq values
    And the later row's prevHash equals the earlier row's hash
    And POST /audit/chain/verify finds no mismatch

AC-AUD-09  A replay adds no second row
  Given a driver's stop event synced with clientUuid U1 has written its audit row with source OFFLINE_SYNC
  When the same sync batch is replayed with U1
  Then audit_events still holds exactly one row with clientUuid U1

AC-AUD-10  The app role can't alter rows
  Given audit_events holds 20 rows with a valid chain
  When the API's role compass_app runs UPDATE audit_events SET "reasonNote" = 'x' WHERE seq = 7, and DELETE FROM audit_events WHERE seq = 7
  Then both fail with a permission error, because compass_app holds INSERT and SELECT only
    And the table still holds 20 rows with every hash unchanged

AC-AUD-11  record() needs a transaction
  Given a service method without @Transactional() running outside the request's transaction
  When it calls audit.record()
  Then it throws "audit.record() must run inside a transaction"
    And no audit row is written

AC-AUD-12  First row chains from genesis
  Given audit_events is empty
  When the first audit row is recorded
  Then its prevHash is GENESIS_HASH
    And its hash equals sha256(GENESIS_HASH + canonicalJson(the row without prevHash))

AC-AUD-13  Feed filters by action and time
  Given audit_events holds rows recorded before and after 2026-10-01T00:00:00+05:30, some with action planning.plan.published
  When Tihara Egodage requests GET /audit-events?filter[action]=planning.plan.published&filter[recordedAt][gte]=2026-10-01T00:00:00%2B05:30&limit=50
  Then the response is 200 and data holds only planning.plan.published rows recorded at or after that instant
    And meta.page holds limit 50, hasMore and nextCursor, and no total

AC-AUD-14  Cursor pages never repeat rows
  Given audit_events holds 120 rows
  When Tihara Egodage follows nextCursor from GET /audit-events?limit=50 to the last page while new rows are being written
  Then no row appears on two pages and none of the 120 goes missing
    And the last page has hasMore false and nextCursor null

AC-AUD-15  Feed rejects bad cursors and filters
  Given Tihara Egodage is signed in
  When she requests GET /audit-events with a tampered cursor, or with filter[pinHash]=x
  Then each answers 400 VALIDATION_FAILED as application/problem+json
    And the filter error names the field pinHash

AC-AUD-16  Feed caps a page at 200
  Given audit_events holds 300 rows
  When Tihara Egodage requests GET /audit-events?limit=500
  Then data holds at most 200 rows and meta.page.limit is 200

AC-AUD-17  Field roles can't read the feed
  Given Harini De Mel (loader) and Aniqa Razick (driver) are signed in
  When each requests GET /audit-events
  Then each answers 403 FORBIDDEN as application/problem+json

AC-AUD-18  Store managers can't export or verify
  Given Nimesha Periyapperuma (store manager) is signed in
  When she requests GET /audit-events/export.csv, or posts /audit/chain/verify
  Then each answers 403 FORBIDDEN
    And no verification runs and audit_chain_ok is unchanged

AC-AUD-19  Dispatcher exports the feed as CSV
  Given the rows and filter from AC-AUD-13
  When Tihara Egodage requests GET /audit-events/export.csv with the same filter
  Then the response streams text/csv with one line per matching row
    And the export reads rows in batches of 1,000

AC-AUD-20  Out-of-scope timeline is not found
  Given order WF-0171 for Fresh Kadawatha
    And a store manager for another outlet is signed in
  When she requests GET /timelines/order/{id} for WF-0171
  Then the response is 404 NOT_FOUND

AC-AUD-21  Drivers can't read order timelines
  Given order WF-0171 for Fresh Kadawatha on Aniqa Razick's REF-07 trip
  When Aniqa Razick (driver, without order:read) requests GET /timelines/order/{id}
  Then the response is 403 FORBIDDEN

AC-AUD-22  Drivers read their own trip timeline
  Given Aniqa Razick's REF-07 trip for 2026-10-02
  When she requests GET /timelines/trip/{id}
  Then the response is 200 with the trip's entries in occurredAt order
```

## Non-functional
- The audit trail never expires; application logs expire after 7 days.
- `record()` adds milliseconds per audited transaction; lock holders must bulk insert and finish fast.
- The CSV export streams in batches of 1,000 rows, so memory stays flat for any filter.
- `compass_readonly` (Grafana and reporting) can SELECT audit_events.
- A demo reset hard-deletes seed-sourced rows for D−1 to D+1, but never audit rows, and is itself audited.
- M8, 04 and 23 are desktop screens at 1440 × 960.

## Open questions
- AC-AUD-09: audit_events.clientUuid has no unique index in the schema. How is "a replay never adds a second row" enforced? Decides: Nimesha with Aniqa.
- AC-AUD-06: REASON_REQUIRED uses short names (trip.reassigned) while actions are `<module>.<entity>.<verb>` (ordering.order.submitted). Which strings does the set hold? Decides: Nimesha.
- audit_events has no depotId column. How do the depot filter and a dispatcher's depot scope work on GET /audit-events? Decides: Nimesha.
- The scope of GET /audit-events for a store manager, who holds audit:read, is not specified. Decides: Nimesha.
- AC-AUD-13, 14: the feed's default sort (seq, or recordedAt descending) is not given. Decides: Nimesha.
- AC-AUD-02, 03: the response shape of POST /audit/chain/verify and the field that carries Synced late on a timeline entry are not specified. Decides: Nimesha.
- AC-AUD-12: the value of GENESIS_HASH is not specified. Decides: Nimesha.
- AC-AUD-22: which rows the trip, stop and outlet timelines merge; the doc spells this out only for orders. Decides: Nimesha.
- The boundaries table lets audit import only core, yet TimelineService needs an order's stops, trip, deferrals, load lines and receipt ids. Read model, exported query services, or audit rows only? Decides: Nimesha.
- AC-AUD-04: does the 02:00 job follow the demo clock or the wall clock, and is `<date>` in audit-heads/<date>.json the business date? Decides: Nimesha.
- No Figma frame is named for the audit feed (GET /audit-events). Which screen hosts it? Decides: Nimesha.
- Payload fields for audit.chain.verified and audit.chain.broken are not given. Decides: Nimesha with Harini (alerts).

## Changelog
- 2026-09-30 created from the Build Spec
- 2026-10-01 AuditService.record() landed with ROO-27, minimally: the transaction check, REASON_REQUIRED for
  user.role_changed and user.scope_changed only (matched on the action without its module), advisory lock 4747,
  GENESIS_HASH, canonicalJson and the sha256 chain. The rest of the reason table, clientUuid idempotency, the feed,
  the export, timelines and the chain verifier are still open (ROO-23). No AC-AUD criterion is ticked yet

---
module: planning
owner: Tihara
status: in-progress          # draft | ready | in-progress | done
screens: ["05", "06", "07", "08", "09", "10", "11", "12", "13", "14", "15", "16", "17", "18", "23"]
depends-on: [audit, master-data, ordering, fleet, engine]   # core is implied; engine is packages/engine
---

# Planning

## Purpose
Planning turns the day's confirmed orders into trips the dispatcher can check, adjust and publish,
with a reason for every order that waits. It wraps the engine in plans, trips, stops and deferrals,
with a publish lock and numbered revisions after publishing.

## Scope
In:
- One plan per depot and date, created as a draft on first access.
- Engine runs (Auto-suggest and repair), the plan context the web editor validates against, vehicle
  and order options, validate, manual edits, suggest fixes.
- Unplanned orders and deferral decisions (defer, plan on a trip, swap), store responses to a
  deferral, and reversing a deferral.
- Publish preview, publish with the plan lock, revisions after publish, trip reassign, re-sequence
  and cancel, deferring a stop mid-route, closing the day.
- Plan-ahead reservations (12, 13).
- Trip and stop status for every module, through the exported `TripLifecycleService`.
- Endpoints for screens other people build: 19a, 19b and 20 (Aniqa), 19c and 21 (Aniqa), M4 and M7
  (Harini).

Out:
- The 18 rules, the time model, the allocator, `explain()` and the reason map: `packages/engine`,
  specified in `specs/engine/rules.md`.
- Vehicles, vehicle status and the fuel ledger: fleet.
- Forecasts, expected demand and weekly capacity: forecasting.
- Order status, cutoff and totals: ordering, through `OrderLifecycleService`.
- Load lists, flags and release: loading. Stop events, ETAs, tracking and the end-of-day summary
  (`GET /plans/{id}/end-of-day`): execution. Sync conflicts: sync.
- Alerts (including the repair suggestion): alerts. Messages: notifications. SSE: realtime.
- Comment threads on deferrals (`/deferrals/{id}/comments`): the platform comments controller (Step 6).

## Model
Schema file: `apps/backend/src/db/schema/planning.ts` (owner Tihara). Business dates are `YYYY-MM-DD`
strings in Asia/Colombo; instants are `timestamptz`.

| Table | Key columns | Invariants |
| --- | --- | --- |
| `plans` | `id`, `depotId`, `date`, `status` (DRAFT, PUBLISHED, CLOSED), `revision`, `cutoffClosedAt`, `createdById`, `publishedAt`, `publishedById`, `closedAt`, `closedById`, `version` | Unique `(depotId, date)`. `revision` is 0 until publish, 1 at first publish, +1 per published change. Unique `(id, depotId)` is the target of the trips' composite key |
| `plan_revisions` | `planId`, `revision`, `reasonCode` (required), `note`, `changes` (the `EditOp[]`), `affectedTripIds`, `affectedOutletIds`, `createdById` | Unique `(planId, revision)` |
| `engine_runs` | `planId`, `mode` (AUTO_SUGGEST, REPAIR), `status` (RUNNING, SUCCEEDED, FAILED), `engineVersion`, `params`, `inputHash`, `servedCount`, `deferredCount`, `stats`, `error`, `triggeredById`, `startedAt`, `finishedAt` | `inputHash` is the sha256 of the canonical engine input; `stats` holds limiting resources, utilisation and budget use |
| `trips` | `planId`, `depotId`, `vehicleId`, `driverId`, `tripNo`, `brand`, `districtId`, `tempClass`, `status`, `isReserved`, `locked`, `waveId`, `plannedDepartAt`, `plannedReturnAt`, `budgetMinutes`, `plannedKm`, `plannedFuelL`, `loadWeightKg`, `loadVolumeM3`, `releasedAt`, `releasedById`, `releaseTempC`, `downloadedAt`, `startedAt`, `completedAt`, `cantRunReason` (BREAKDOWN, COOLING, UNWELL, OTHER; projected from execution's CANT_RUN event), `cancelReason`, `version` | `(planId, depotId)` references plans and `(vehicleId, depotId)` references vehicles, so a vehicle serves only its home depot. `tripNo` is 1 or 2, null once cancelled (which frees the slot); unique `(planId, vehicleId, tripNo)` caps a vehicle at two trips a day. `locked` marks trips built or edited by hand. `isReserved` marks a plan-ahead reservation with no stops |
| `stops` | `tripId`, `orderId`, `outletId`, `depotId`, `brand`, `districtId`, `seq`, `status`, `plannedArrivalAt`, `plannedTravelMin` (the leg into this stop), `plannedServiceMin`, `predictedServiceMin` (service-time model, informational), `windowOpenMin`, `windowCloseMin`, `etaAt`, `etaUpdatedAt`, `lateRiskProb` (0 to 1), `arrivedAt`, `arrivedLat`, `arrivedLng`, `completedAt`, `outcome`, `unitsDelivered` (>= 0), `receiverName`, `exceptionNote`, `cancelledReason`, `version` | Composite keys to trips and outlets on `(depotId, brand, districtId)`: one brand and one district per trip. Unique `(tripId, seq)`; `seq` is null once cancelled; re-sequencing writes negative values first, then the final ones, in one transaction. The window columns snapshot the effective window |
| `deferral_reasons` | `code` (key), `label`, `description`, `fromEngine`, `active`, `sortOrder` | Seeded from the engine's `DEFERRAL_REASONS` (`packages/engine/src/rules/reason-map.ts`), so every code an engine run writes exists; `description` is the store wording M4 shows, null for a manual reason. A re-seed keeps an admin's label and description. Engine reasons (`fromEngine`) cannot be deleted on A6. Codes and store wording: `specs/engine/rules.md` |
| `deferrals` | `orderId`, `planId`, `engineRunId`, `status`, `source` (ENGINE, PLANNING, LOAD_CHECK, TRACKING), `reasonCode`, `choice`, `bindingRule`, `reasonDetail`, `note`, `fromDate`, `toDate`, `priorityScore`, `repeatSkip`, `overrideNote`, `partial`, `decidedById`, `decidedAt`, `storeResponse`, `storeNote`, `storeRespondedById`, `storeRespondedAt`, `reversedAt`, `reversedReason` | `reasonCode` references `deferral_reasons`. `note` is shown to the store. `overrideNote` is required to confirm a repeat skip. `choice` (UNAVOIDABLE or PRIORITY_CHOICE) and `bindingRule` (the rule that blocked the last candidate vehicle) are real columns, null for a manual deferral; `reasonDetail` holds `tried[]`, the numbers and `displacedBy`. A swap (16) is recorded in the audit trail as `planning.order.swapped`, not on the deferral. At most one live (PROPOSED or CONFIRMED) whole-order deferral per order and plan (`deferrals_live_uq`, partial unique index); partial deferrals from the dock are exempt, one per removed line. `swappedForOrderId` is unused and is dropped once the schema freeze allows drops Row-level security: a row is visible only when its order is (`viaVisibleOrder`) |

Other invariants:
- Whole orders on one trip each: `orders.activeStopId` is unique (owned by ordering).
- `plans`, `trips` and `stops` carry `version`; writes need `If-Match` (Step 4).
- No hard deletes: trips, stops and deferrals move to CANCELLED.

State machines (`packages/shared/src/machines/`):

| Machine | Main path | Branches |
| --- | --- | --- |
| Plan | DRAFT → PUBLISHED → CLOSED | Revisions while PUBLISHED raise `revision`; publishing opens only after the previous operating day's 16:00 cutoff |
| Trip | RESERVED → PLANNED → LOADING → RELEASED → IN_PROGRESS → COMPLETED | CANCELLED before start, with `tripNo` cleared. Reassign keeps the trip and changes vehicle or driver; a released trip moved to another vehicle goes back to LOADING |
| Stop | PENDING → ARRIVED → DELIVERED, PARTIAL or FAILED | PENDING → CANCELLED when deferred mid-route or moved to another trip |
| Deferral | PROPOSED → CONFIRMED | PROPOSED → CANCELLED (planned after all, or swapped); CONFIRMED → REVERSED (19c). Store response AWAITING → ACKNOWLEDGED or PRIORITY_REQUESTED |

## Endpoints
Paths omit `/api/v1`. Plan writes (engine run, edit, publish, revise, close) need `If-Match` on the
plan and an `Idempotency-Key`; reassign and re-sequence need `If-Match` on the trip and an
`Idempotency-Key` (Step 4).

| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| GET | `/depots/{id}/plans/{date}` | `plan:read` | The day's plan, created as a draft on first access (05, 09) |
| GET | `/plans/{id}`, `/plans/{id}/trips`, `/trips/{id}` | `plan:read`, `trip:read` | |
| GET | `/plans/{id}/context` | `plan:read` | Everything the engine needs, so the web validates edits instantly |
| GET, POST | `/deferral-reasons` | `deferral:read`, `settings:manage` | A6 reason list (built in ROO-27, specified as AC-IDN-57 and 58); 201 with Location on create |
| GET, PATCH | `/deferral-reasons/{code}` | `deferral:read`, `settings:manage` | Engine reasons can be relabelled, never switched off (409 CONFLICT_STATE) |
| POST | `/plans/{id}/engine-runs` | `plan:build` | 05, 09: `{ mode, keepLocked }`; 202 with the run; progress over SSE |
| GET | `/plans/{id}/engine-runs/{runId}` | `plan:read` | Status, counts, limiting resources |
| GET | `/plans/{id}/vehicle-options` | `plan:build` | 06: vehicles with trips left, capacity, fuel left, or why unavailable |
| GET | `/plans/{id}/order-options?vehicleId=&tripNo=` | `plan:build` | 07: orders that fit, and dimmed ones with the reason |
| POST | `/plans/{id}/validate` | `plan:read` | 08, 11, 14: validates the plan or a proposed edit set without saving |
| POST | `/plans/{id}/edits` | `plan:build`; `plan:revise` after publish | Batch of ADD_TRIP, REMOVE_TRIP, ASSIGN_ORDER, UNASSIGN_ORDER, MOVE_ORDER, RESEQUENCE, SET_DRIVER, SET_WAVE (zod `EditOp` union from `packages/shared`); 422 `PLAN_RULE_VIOLATION` with violations; soft ones need an override note |
| POST | `/plans/{id}/suggest-fixes` | `plan:build` | 10, 11: for a violation, another vehicle, a swap, or deferring the lowest-priority order |
| GET | `/plans/{id}/unplanned` | `plan:read` | 15: orders without a trip, with reason, priority and repeat-skip flag |
| POST | `/plans/{id}/deferrals/decisions` | `deferral:decide` | 15, 16: `DEFER`, `PLAN_ON` a trip, or `SWAP` with another order, each with a reason |
| GET | `/plans/{id}/publish-preview` | `plan:publish` | 17, 18: blockers, who gets notified, when publishing opens |
| POST | `/plans/{id}/publish` | `plan:publish` | 409 `PLAN_LOCKED` with `opensAt` before it opens; creates revision 1 |
| GET | `/plans/{id}/revisions` | `plan:read` | Change history with reasons |
| POST | `/plans/{id}/close` | `plan:close` | 21: unfinished stops become deferrals; actual fuel recorded |
| GET, POST | `/depots/{id}/plans/{date}/reservations` | `plan:read`, `plan:build` | 12, 13: reserve vehicles against the forecast |
| GET | `/deferrals`, `/deferrals/{id}` | `deferral:read` | 23 for dispatchers, M4 and M7 for stores (scoped: a store sees only its outlet's CONFIRMED or REVERSED deferrals on a published or closed plan). Offset pages, newest first, e.g. `?filter[storeResponse]=AWAITING&limit=10` |
| POST | `/deferrals/{id}/response` | `deferral:respond` | M4: acknowledge, or request priority with a note |
| POST | `/deferrals/{id}/reverse` | `deferral:decide` | 19c: keep a delivery the device recorded |
| POST | `/trips/{id}/reassign` | `trip:reassign` | 20: new vehicle or driver, validated, with a reason |
| POST | `/trips/{id}/resequence` | `trip:resequence` | 19b: stop ids in their new order, with a reason |
| POST | `/trips/{id}/stops/{stopId}/defer` | `deferral:decide` | Defer one stop mid-route from 19a |
| POST | `/trips/{id}/cancel` | `plan:revise` | Before the trip starts |

Errors used: `PLAN_RULE_VIOLATION` (422, with `violations[]` and a `fixes` link), `PLAN_LOCKED`
(409: publishing before it opens, or editing a closed plan), `CONFLICT_STATE` (409),
`VERSION_MISMATCH` (412), `PRECONDITION_REQUIRED` (428), `VALIDATION_FAILED` (400), `FORBIDDEN`
(403), `NOT_FOUND` (404, also for out of scope).

## Services and helpers
Command services (`services/`, each method `@Transactional()`, audited, one outbox event, one log line):
- `PlansService`: `getOrCreate`, `applyEdits`, `publish`, `revise`, `close`.
- `EngineRunner`: builds the context, calls `allocate()`, bulk-persists trips, stops and proposed
  deferrals, records the engine version and input hash. It holds the audit advisory lock, so it uses
  bulk inserts and finishes fast.
- `DeferralService`: `decide`, `respond`, `reverse`, and `deferPartially` (ROO-33, exported in
  `index.ts`), which loading's `LoadFlagService` calls on a REMOVE decision. `deferPartially`
  dates the goods to the next run after the plan's date (ordering's `CutoffService.nextRun`: the
  next operating day, or a Style outlet's weekly delivery day), and writes one CONFIRMED deferral with `partial` true and `source` LOAD_CHECK — nobody is being
  asked, the goods are already off the vehicle — bumps the plan's `revision` in one statement and
  writes the matching `plan_revisions` row with the decision's reason code, so the dock's list and
  the driver's bundle both learn the plan moved. It refuses a reason code that is missing or
  inactive with 404. `decide`, `respond` and `reverse` land with planning's own API.
- `PublishPolicy`: the six publish preconditions and the opening time.
- `RevisionService`: the diff, affected trips and affected outlets of a change after publish.
- `ReassignService`, `ResequenceService`, `ReservationService`.

Queries: `PlanQueries` (always `scope.where(actor)`; deferrals use offset pages).

Engine wrappers: `PlanContextBuilder` (the `/context` payload, via `toEngineInput`),
`ValidationService` and `FixSuggester` over the engine, `fromEngineOutput` for trip, stop and
deferral inserts.

Lifecycle service (exported in `index.ts`): `TripLifecycleService` with `markLoading`,
`markReleased`, `markStarted`, `markArrived`, `markStopOutcome`, `markCompleted`, `cancel`, plus
`markDownloaded` and `markCantRun` (columns the driver's events set that move no status). Loading
and execution move trip and stop status only through it, with the same state-machine check and
audit as a command. Built so far (ROO-31): `markDownloaded`, `markStarted`, `markArrived`,
`markStopOutcome`, `markCompleted`, `markCantRun`; and (ROO-33, for the dock) `markLoading`
(PLANNED to LOADING on the first check), `markReleased` (LOADING to RELEASED, setting `releasedAt`,
`releasedById` and `releaseTempC`) and `markReloading` (RELEASED to LOADING, clearing those three,
for a released trip moved to another vehicle — AC-LOD-19). `cancel` lands with planning's own API.
Each writes one audit row, `planning.trip.status_changed` or `planning.stop.status_changed`, and
the caller emits the domain event.

Engine functions used (`packages/engine`, also run in the browser from `/context`):
`allocate()`, `validate()`, `vehicleOptions()`, `optionsForTrip()`, `applyEdits()`,
`suggestFixes()`, `explain()`, `explainUnplanned()`, `reserve(input, forecastGroups)`,
`ENGINE_VERSION`. Planning never re-implements a rule; the rules are listed in
`specs/engine/rules.md`.

Shared helpers (`packages/shared`): `publishOpensAt(date)`, `cutoffFor(depot, deliveryDate)`,
`nextOperatingDay(date)`, `isoWeekOf(date)`, the plan, trip, stop and deferral machines.

Cross-module calls inside the transaction: `OrderLifecycleService` (`markPlanned`, `markDeferred`,
`requeue`) from ordering; the day's queue is `OrderQueries.queueFor(depotId, date)`, CONFIRMED orders
plus DEFERRED ones an earlier plan moved to this date (a deferred order is never requeued to
CONFIRMED; AC-ORD-38, AC-ORD-39); `FuelLedgerService` from fleet (planned entries on publish, reversals on
revision, actuals at close).

Settings read: `planning.reeferCarriesAmbient` (true), `planning.enforceWindows` (true),
`planning.freshStartMin` (210), `planning.reloadMinutes` (30), `planning.repeatSkipLookbackRuns`
(1), `planning.techValueLimitLkr` (none by default; the Tech value rule is off until it is set),
`planning.priorityWeights`, and `ordering.cutoffMin`
(960) for the opening time.

Jobs: an engine run answers 202 and runs outside the request; the doc does not name its queue.

## Events
Every payload has `v: 1`, ids and the few fields consumers need, and routing
`{ depotId, outletIds, userIds }`. Consumers dedupe by event id (delivery is at least once).

Emits:

| Event | Payload fields given in the doc | Consumed by |
| --- | --- | --- |
| `plan.engine_run.completed`, `plan.engine_run.failed` | not given | realtime (09 progress strip) |
| `plan.published` | `revision`, `tripIds` (aggregate `plan`) | loading (builds lists), execution (readies driver trips), notifications (loaders, drivers, stores), realtime, webhooks |
| `plan.revised` | not given; routed only to affected outlets and people | loading (Plan updated banner), execution (changes feed, bundle refresh), notifications (affected people only), realtime, webhooks |
| `plan.closed` | not given | loading, execution, notifications, realtime, webhooks |
| `deferral.confirmed`, `deferral.store_responded`, `deferral.reversed` | not given | notifications (M4; dispatchers on a priority request), alerts (PRIORITY_REQUEST), realtime, webhooks (`deferral.confirmed`) |
| `trip.reassigned`, `trip.resequenced`, `trip.cancelled`, `stop.deferred` | not given | execution (driver's bundle and changes feed), loading (`trip.reassigned` refreshes the list), notifications, realtime |

Consumes:

| Event | From | Planning's reaction |
| --- | --- | --- |
| `order.cancelled` | ordering | Removes the order from a DRAFT plan |
| `order.priority_changed` | ordering | Re-ranks the order in a DRAFT plan |
| `order.cutoff_closed` | ordering | Day summary |
| `vehicle.status_changed` | fleet | Offers repair mode |
| `trip.cant_run` | execution | Offers repair mode |

Audit actions (all in the same transaction as the change):

| Action | Reason required | Name source |
| --- | --- | --- |
| `planning.engine.run_completed` | none; records version, parameters, input hash, served and deferred counts | log event name (Step 2 audits every run) |
| `planning.plan.edited` | none | derived from the naming convention |
| `planning.plan.published` | none | Step 4 audit filter example |
| `planning.plan.revised` | code and note | Step 2 reason table (`plan.revised`) |
| `planning.plan.soft_rule_overridden` | code and note | Step 2 reason table |
| `planning.plan.closed` | none | derived |
| `planning.deferral.confirmed` | deferral reason code (the engine's pre-filled) and a note the store sees | Step 2 reason table |
| `planning.deferral.repeat_skip_overridden` | override note | Step 2 reason table |
| `planning.deferral.store_responded`, `planning.deferral.reversed` | none named | derived |
| `planning.trip.reassigned`, `planning.trip.resequenced`, `planning.stop.deferred` | code | Step 2 reason table |
| `planning.trip.cancelled` | none named | derived |

## Log events
- `planning.engine.run_completed`: served, deferred, ms, input hash.
- `planning.plan.published`: revision, trips.
- `planning.plan.revised`: reason, affected counts.
- `planning.deferral.confirmed`: reason.

Ids only (planId, tripId, orderId); no personal data.

## Permissions
From the Step 2 matrix in `packages/shared/src/auth/permissions.ts`:

| Permission | Roles | Used by |
| --- | --- | --- |
| `plan:read` | admin, dispatcher | plan, trips, context, run status, validate, unplanned, revisions, reservations (GET) |
| `plan:build` | dispatcher | engine runs, vehicle and order options, edits before publish, suggest fixes, reservations (POST) |
| `plan:publish` | dispatcher | publish preview, publish |
| `plan:revise` | dispatcher | edits after publish, trip cancel (and vehicle status in fleet) |
| `plan:close` | dispatcher | close |
| `deferral:read` | dispatcher, store_manager | deferral list and detail |
| `deferral:decide` | dispatcher | decisions, reverse, stop defer |
| `deferral:respond` | store_manager | response |
| `trip:read` | admin, dispatcher, loader, driver | `GET /trips/{id}` |
| `trip:reassign`, `trip:resequence` | dispatcher | reassign, re-sequence |

Scopes: admin sees everything; a dispatcher sees `depotId = actor.depotId`, or every depot when none
is set (Tihara: all depots, Peliyagoda by default); a store manager sees deferrals of
`outletId = actor.outletId`; a loader sees trips of their depot for today and tomorrow; a driver sees
trips where `driverId = actor.id` in the last 7 days. A missing permission is 403; a row out of scope
is 404.

## Acceptance criteria
Times are Asia/Colombo. "The demo clock" is `ClockService.now()`. The demo day is PLG (Peliyagoda)
on 2026-10-02; its publishing opens at 2026-10-01T16:00:00+05:30. Fixture numbers are hand-built
(`seedMinimal()`, engine fixtures), never taken from the datasets.

```gherkin
AC-PLN-01  Engine run leaves no hard violation
  Given Tihara, a dispatcher, and the DRAFT plan for PLG on 2026-10-02, the seeded demo day where demand exceeds capacity
    And every order for that day is CONFIRMED and no trip is locked
  When she starts an engine run with mode AUTO_SUGGEST and it finishes
  Then the run's status is SUCCEEDED
    And POST /plans/{id}/validate on the saved plan returns no violation with severity HARD
    And every CONFIRMED order for the day is on exactly one trip or listed by GET /plans/{id}/unplanned, never both
    And every unplanned order is listed with a reasonCode from the engine's reason map, its priority and its repeatSkip flag
    And every unplanned order has a PROPOSED deferral with source ENGINE whose choice column is UNAVOIDABLE or PRIORITY_CHOICE and whose bindingRule is set, with displacedBy in reasonDetail for a choice

AC-PLN-02  Moving onto a full vehicle is refused
  Given the DRAFT plan for PLG on 2026-10-02 at version 7
    And moving a chilled order onto REF-07 trip 1 would bring that trip to 12.42 m³ against its 12.0 m³ volume cap
  When Tihara posts an edit list [MOVE_ORDER to tripKey "REF-07#1"] with If-Match W/"7"
  Then the response is 422 application/problem+json with code PLAN_RULE_VIOLATION
    And violations[0] is { rule CAP_VOLUME, severity HARD, tripKey "REF-07#1", actual 12.42, limit 12.0, message "Over volume by 0.42 m³" }
    And the problem's _links.fixes is POST /api/v1/plans/{id}/suggest-fixes
    And the plan is still at version 7, with no audit row and no outbox event from the request
    And POST /plans/{id}/suggest-fixes for that violation returns ranked candidates, each an edit list: another vehicle, a swap, or deferring the lowest-priority order

AC-PLN-03  Publishing before it opens is locked
  Given the DRAFT plan for PLG on 2026-10-02 with no publish blocker
    And the demo clock reads 2026-10-01T15:59:00+05:30
  When Tihara publishes it with a current If-Match
  Then the response is 409 PLAN_LOCKED with opensAt 2026-10-01T16:00:00+05:30
    And the plan stays DRAFT at revision 0 and no order changes status
    And GET /plans/{id}/publish-preview reports the same opensAt

AC-PLN-04  An undecided unplanned order blocks publishing
  Given the demo clock reads 2026-10-01T16:05:00+05:30
    And the DRAFT plan for PLG on 2026-10-02 has no hard violation and a driver on every trip
    And unplanned order WF-0171 still has a PROPOSED deferral with no decision
  When Tihara publishes the plan
  Then the response is 409 and the problem names order WF-0171
    And the plan stays DRAFT at revision 0, no order moves to PLANNED or DEFERRED, and no plan.published event exists
    And GET /plans/{id}/publish-preview lists WF-0171 as a blocker

AC-PLN-05  A repeat skip needs an override note
  Given unplanned order WF-0172 whose outlet was deferred on its previous run, so its PROPOSED deferral has repeatSkip true
  When Tihara posts a DEFER decision for it with a reasonCode and a note but no overrideNote
  Then the response is 400 VALIDATION_FAILED with an error on overrideNote
    And the deferral stays PROPOSED and no audit row is written
    And the same decision with an overrideNote returns 200, the deferral is CONFIRMED with that overrideNote, and audit rows planning.deferral.confirmed and planning.deferral.repeat_skip_overridden exist

AC-PLN-06  A breakdown after publishing becomes revision 2
  Given the plan for PLG on 2026-10-02 is PUBLISHED at revision 1
    And REF-07's trip 2 is PLANNED and not yet released
    And the demo clock reads 2026-10-02T04:40:00+05:30
  When Tihara sets REF-07 to BREAKDOWN with a reason, then applies the repair diff the engine offers with a reason code and a note
  Then vehicle.status_changed raised an OPEN alert for REF-07 on 01 and 19 whose fix link leads to the repair
    And the REPAIR run kept every released or in-progress trip fixed, took only REF-07's unreleased orders as input, and changed nothing until the diff was applied
    And the plan is at revision 2 with one plan_revisions row holding the edit list, the reason code, the note, affectedTripIds and affectedOutletIds
    And exactly one audit row planning.plan.revised and one outbox event plan.revised exist for the change
    And plan.revised notifications reach only the loaders, drivers and stores tied to affectedTripIds and affectedOutletIds; no other store or driver gets one

AC-PLN-07  A stale If-Match loses
  Given the DRAFT plan for PLG on 2026-10-02 at version 7, loaded by Tihara and by a second Peliyagoda dispatcher (ETag W/"7")
    And Tihara's edit list with If-Match W/"7" has moved the plan to version 8
  When the second dispatcher posts a different edit list with If-Match W/"7"
  Then the response is 412 VERSION_MISMATCH
    And the plan stays at version 8 with only Tihara's edit applied, and no audit row comes from the second request
    And an edit list sent with no If-Match gets 428 PRECONDITION_REQUIRED

AC-PLN-08  One plan per depot and date
  Given no plan exists for PLG on 2026-10-03
  When Tihara calls GET /depots/PLG/plans/2026-10-03 twice
  Then both responses are 200 with the same plan id, status DRAFT, revision 0 and ETag W/"1"
    And exactly one plans row exists for (PLG, 2026-10-03)

AC-PLN-09  An engine run records how it ran
  Given the DRAFT plan for PLG on 2026-10-02 at version 7
  When Tihara posts /plans/{id}/engine-runs with { mode: AUTO_SUGGEST, keepLocked: true }, If-Match W/"7" and an Idempotency-Key
  Then the response is 202 with the run in status RUNNING
    And exactly one plan.engine_run.completed event reaches 09 over SSE when it ends
    And GET /plans/{id}/engine-runs/{runId} returns SUCCEEDED with engineVersion equal to ENGINE_VERSION, inputHash, servedCount, deferredCount and stats naming the limiting resources
    And one audit row records the version, parameters, input hash and served and deferred counts, and one log line planning.engine.run_completed carries served, deferred, ms and the input hash
    And a second run on unchanged input records the same inputHash and produces the same trips and unplanned orders

AC-PLN-10  Hand-built trips survive Auto-suggest
  Given the DRAFT plan has a trip Tihara built by hand on DRY-31, so it is locked
  When she runs AUTO_SUGGEST with keepLocked true
  Then that trip keeps its vehicle, trip number and stops, and the engine plans the other orders around it
    And a run with keepLocked false (Rebuild everything) is the only way the engine may replace it

AC-PLN-11  A failed run changes nothing
  Given a DRAFT plan with known trips, stops and deferrals
  When an engine run fails
  Then the run's status is FAILED with error set and finishedAt stamped
    And exactly one plan.engine_run.failed event exists
    And the plan's trips, stops and deferrals are unchanged

AC-PLN-12  Validate never saves
  Given the DRAFT plan at version 7 and the web's copy of GET /plans/{id}/context
  When Tihara posts /plans/{id}/validate with an edit list that moves an order onto an over-full trip
  Then the response is 200 listing every violation, including the CAP_VOLUME one
    And the plan stays at version 7 with no audit row and no outbox event
    And the violations equal what validate() returns in the browser for the same context and edit list

AC-PLN-13  The wizard saves one edit list
  Given the DRAFT plan at version 8 and the 06 to 08 wizard holding REF-07 trip 2 with three orders that fit
  When Tihara presses Save on 08
  Then one POST /plans/{id}/edits carries ADD_TRIP and three ASSIGN_ORDER ops
    And the response is 200, the new trip has locked true and three stops, and the plan is at version 9
    And exactly one audit row planning.plan.edited exists for the edit list
    And an edit list holding an op the EditOp schema does not know gets 400 VALIDATION_FAILED and changes nothing

AC-PLN-14  A soft rule needs an override
  Given an edit list with no hard violation that leaves a stop with 10 minutes of window slack, so LATE_RISK (SOFT) is raised
  When Tihara posts it with a reason code and an override note
  Then the response is 200 and one audit row planning.plan.soft_rule_overridden carries the code and the note
    And the same edit list without the override note is refused, the problem lists LATE_RISK with severity SOFT, and the plan is unchanged

AC-PLN-15  The wizard shows why
  Given the DRAFT plan for PLG on 2026-10-02 where one reefer is in WORKSHOP and REF-07 already has two trips
  When Tihara opens 06 (GET /plans/{id}/vehicle-options) and then 07 for DRY-31 trip 1 (GET /plans/{id}/order-options?vehicleId=&tripNo=1)
  Then each vehicle shows its trips left, Fresh and Style-Tech minutes left, capacity and fuel left
    And the workshop reefer is unavailable with reason WORKSHOP, and REF-07 shows no trips left
    And orders that fit come first, orders that fit with a warning are marked, and blocked orders carry the same rule and message the engine's fits() gives

AC-PLN-16  Confirming a deferral
  Given unplanned order WF-0171 for Fresh Kadawatha with a PROPOSED deferral from the engine, reasonCode OVER_CAPACITY and repeatSkip false
  When Tihara posts a DEFER decision with the pre-filled reasonCode and a note for the store
  Then the deferral is CONFIRMED with the note, decidedById Tihara and decidedAt equal to the demo clock
    And exactly one audit row planning.deferral.confirmed with reasonCode OVER_CAPACITY exists, and a log line planning.deferral.confirmed carries the reason
    And no deferral.confirmed outbox event exists until the plan is published, when exactly one is written for it (decided 2026-10-03: the store hears about it at publish)
    And GET /deferrals/{id} as Nimesha shows "Every suitable vehicle was full for this run." and the note, not the engine's numbers
    And a DEFER decision without a reasonCode or without a note gets 400 VALIDATION_FAILED naming the missing field

AC-PLN-17  Planning an unplanned order on a trip
  Given unplanned order WF-0172 with a PROPOSED deferral, and DRY-31 trip 1 in the same brand and district with room for it
  When Tihara posts a PLAN_ON decision placing it on DRY-31 trip 1 with a reason
  Then WF-0172 is a stop on that trip, its deferral is CANCELLED, and GET /plans/{id}/unplanned no longer lists it
    And a PLAN_ON onto a trip where the order breaks a hard rule gets 422 PLAN_RULE_VIOLATION naming the rule, and nothing changes

AC-PLN-18  Swapping serves a repeat skip
  Given order A, a repeat skip with a PROPOSED deferral, and order B, a lower-priority order on a trip where A fits once B leaves
  When Tihara posts a SWAP decision on 16 serving A in place of B, with a reason for each
  Then A is a stop on that trip and A's deferral is CANCELLED
    And B is unplanned with a CONFIRMED deferral whose reasonCode is the one she chose
    And an audit row planning.order.swapped exists whose after is { deferredOrderId: B, addedOrderId: A, tripId }, with the reasons for A and B
    And an audit row planning.deferral.confirmed exists for B, and the plan has no hard violation

AC-PLN-19  Publishing commits the day
  Given the demo clock reads 2026-10-01T16:05:00+05:30
    And the DRAFT plan for PLG on 2026-10-02 at version 12 has no hard violation, a driver on every trip, a decision on every unplanned order, and one reserved trip that is still empty
  When Tihara publishes it with If-Match W/"12" and an Idempotency-Key
  Then the response is 200 with status PUBLISHED, revision 1, publishedAt 2026-10-01T16:05:00+05:30 and publishedById Tihara
    And one plan_revisions row with revision 1 exists
    And every order on a trip is PLANNED, and every order with a CONFIRMED deferral is DEFERRED with deliveryDate 2026-10-03 and deferredCount one higher, both through OrderLifecycleService
    And each trip has one PLANNED fuel ledger entry whose litres equal plannedKm divided by the vehicle's kmPerL
    And the empty reserved trip is released
    And exactly one audit row planning.plan.published and one outbox event plan.published with { v: 1, revision: 1, tripIds } exist, and a log line planning.plan.published carries the revision and trip count
    And the plan's _links no longer include publish
    And repeating the request with the same Idempotency-Key and body returns the stored 200 with Idempotent-Replayed: true and adds nothing

AC-PLN-20  Other blockers stop publishing
  Given the demo clock reads 2026-10-01T16:05:00+05:30
    And the DRAFT plan for PLG on 2026-10-02 has a trip with no driver and a trip with a CAP_WEIGHT violation
  When Tihara publishes the plan
  Then the response is 409 naming both blockers, and the plan stays DRAFT at revision 0
    And GET /plans/{id}/publish-preview lists both blockers, who would be notified, and that publishing is open

AC-PLN-21  A change after publishing is a revision
  Given the plan is PUBLISHED at revision 1 and version 13, and DRY-31 trips 1 and 2 are PLANNED
  When Tihara moves order WF-0172 from DRY-31 trip 1 to trip 2 with a reason code, a note and If-Match W/"13"
  Then the response is 200 with revision 2 and version 14
    And one plan_revisions row with revision 2 holds the edit list, the reason code, the note, both trips in affectedTripIds and WF-0172's outlet in affectedOutletIds
    And exactly one audit row planning.plan.revised and one outbox event plan.revised exist, and the log line planning.plan.revised carries the reason and affected counts
    And plan.revised notifications reach only the loaders, drivers and stores tied to those trips and that outlet
    And the fuel ledger gains reversal entries with negative litres for the two trips' earlier planned fuel
    And the same edit without a reason code gets 400 VALIDATION_FAILED on reasonCode ("A reason is required") and changes nothing

AC-PLN-22  Released trips take three changes only
  Given the plan is PUBLISHED and DRY-31 trip 1 is RELEASED
  When Tihara posts an edit list that moves an order off DRY-31 trip 1
  Then the response is 409 CONFLICT_STATE and nothing changes
    And re-sequencing its pending stops (AC-PLN-24), deferring a pending stop (AC-PLN-25) and reassigning it (AC-PLN-23) are each accepted

AC-PLN-23  Reassigning a released trip
  Given DRY-31 trip 1 is RELEASED at trip version 4 with Dinushi as its driver
  When Tihara reassigns it on 20 to another ACTIVE ambient truck at Peliyagoda with a reason code and If-Match W/"4"
  Then the move is validated, the trip keeps its id, takes the new vehicle and goes back to LOADING
    And exactly one audit row planning.trip.reassigned with the reason code and one outbox event trip.reassigned exist, and the plan's revision goes up by one
    And changing only the driver on the same vehicle leaves the trip RELEASED
    And moving a chilled trip onto an ambient truck gets 422 PLAN_RULE_VIOLATION with TEMP_REEFER, and a reassign without a reason code gets 400 VALIDATION_FAILED

AC-PLN-24  Re-sequencing the stops left
  Given DRY-31 trip 1 is IN_PROGRESS at trip version 6 with three PENDING stops at seq 2, 3 and 4
  When Tihara posts /trips/{id}/resequence on 19b with the three stop ids in a new order, a reason code and If-Match W/"6"
  Then the stops take the new seq values with no duplicate seq in the trip
    And exactly one audit row planning.trip.resequenced with the reason code and one outbox event trip.resequenced exist
    And an order that cannot meet a stop's window at the actual times gets 422 PLAN_RULE_VIOLATION with WINDOW_OUTLET and changes nothing

AC-PLN-25  Deferring a stop mid-route
  Given DRY-31 trip 1 is IN_PROGRESS with a PENDING stop for WF-0172
  When Tihara defers that stop from 19a with a reason code
  Then the stop is CANCELLED with seq null, WF-0172 has a CONFIRMED deferral with that reason, and the order is DEFERRED through OrderLifecycleService
    And exactly one audit row planning.stop.deferred with the reason code and one outbox event stop.deferred exist
    And deferring a stop that is already ARRIVED gets 409 CONFLICT_STATE

AC-PLN-26  Cancelling a trip before it starts
  Given the plan is PUBLISHED and DRY-31 trip 2 is PLANNED
  When Tihara cancels it with a reason (POST /trips/{id}/cancel)
  Then the trip is CANCELLED with tripNo null and cancelReason set, which frees DRY-31's second slot
    And one outbox event trip.cancelled exists and the plan's revision goes up by one
    And for an IN_PROGRESS trip there is no cancel link and POST /trips/{id}/cancel gets 409 CONFLICT_STATE

AC-PLN-27  The store requests priority
  Given Nimesha, store manager for Fresh Kadawatha, and a CONFIRMED deferral for WF-0171 with storeResponse AWAITING
  When she responds PRIORITY_REQUESTED on M4 with a note
  Then storeResponse is PRIORITY_REQUESTED with her note, storeRespondedById and storeRespondedAt set
    And one outbox event deferral.store_responded exists and a PRIORITY_REQUEST alert opens for Peliyagoda's dispatchers
    And the deferral no longer carries a respond link
    And responding ACKNOWLEDGED instead sets ACKNOWLEDGED and opens no alert

AC-PLN-28  Reversing a deferral keeps the delivery
  Given a CONFIRMED deferral whose stop the driver's phone recorded as DELIVERED while offline, now a 19c sync conflict
  When Tihara keeps the device's delivery, which posts /deferrals/{id}/reverse with a reason
  Then the deferral is REVERSED with reversedAt and reversedReason set
    And one outbox event deferral.reversed exists
    And reversing a PROPOSED deferral gets 409 CONFLICT_STATE

AC-PLN-29  Closing the day
  Given the plan for PLG on 2026-10-02 is PUBLISHED, every trip is COMPLETED or CANCELLED, and one stop was never served
  When Tihara closes the day on 21 with a current If-Match
  Then the plan is CLOSED with closedAt and closedById set
    And the unserved stop's order has a deferral with a reason
    And each COMPLETED trip has an ACTUAL fuel ledger entry
    And one outbox event plan.closed exists
    And any edit to the CLOSED plan gets 409 PLAN_LOCKED, and closing while a trip is IN_PROGRESS is refused with the plan left PUBLISHED

AC-PLN-30  Reserving vehicles ahead
  Given the demo clock reads 2026-10-01T10:00:00+05:30 and the forecast expects chilled Fresh demand for Gampaha on 2026-10-02
  When Tihara accepts the suggested reservations on 13 (POST /depots/PLG/plans/2026-10-02/reservations)
  Then each reservation is a trip with isReserved true, status RESERVED, a vehicle, a brand-district-class group and no stops, and 09 shows it
    And the reserved vehicle's trip slot and capacity count as used in GET /plans/{id}/vehicle-options
    And the suggestions came from reserve() with placeholder orders whose refs start with FC-
    And publishing the plan before 2026-10-01T16:00:00+05:30 gets 409 PLAN_LOCKED
    And the next AUTO_SUGGEST run after the cutoff fills the reserved trips first, each keeping its vehicle and group

AC-PLN-31  A draft follows order changes
  Given the DRAFT plan for PLG on 2026-10-02 with WF-0172 as a stop on DRY-31 trip 1
  When order.cancelled for WF-0172 is delivered to planning twice
  Then WF-0172 is on no trip and not in /unplanned, and the second delivery changes nothing
    And after order.priority_changed marks another unplanned order urgent, its priority in /unplanned is 8 higher

AC-PLN-32  Permissions and scope hold
  Given the plan for PLG on 2026-10-02 with its trips and deferrals
  When each actor below calls the API
  Then Nimesha (store manager) gets 403 FORBIDDEN on GET /plans/{id}, and Harini (loader) gets 403 on POST /plans/{id}/engine-runs
    And Rusiru (admin) gets 200 on GET /plans/{id} and 403 on POST /plans/{id}/publish
    And Aniqa (driver) gets 403 on POST /plans/{id}/deferrals/decisions, and 404 on GET /trips/{id} for a trip she does not drive
    And a dispatcher scoped to Kandy gets 404 NOT_FOUND on the PLG plan and its trips
    And Nimesha gets 404 on another outlet's deferral, and GET /deferrals returns only Fresh Kadawatha's deferrals, even with the deferral ScopePolicy removed in a test module

AC-PLN-33  Action links follow the rules
  Given the DRAFT plan for PLG on 2026-10-02 with no publish blocker
  When Tihara reads it at 2026-10-01T15:59:00+05:30 and again at 2026-10-01T16:00:00+05:30
  Then the first read has no publish link and the second has publish (POST, requires If-Match)
    And Rusiru (admin) reading it at 16:00:00 gets no publish link, and no reader gets one once it is PUBLISHED
    And an IN_PROGRESS trip carries reassign and resequence for Tihara, neither for Harini (loader), and no cancel link
    And a deferral with storeResponse AWAITING carries respond for Nimesha but not for Tihara

AC-PLN-34  Other modules move trips through the lifecycle
  Given DRY-31 trip 1 is PLANNED on a PUBLISHED plan
  When execution calls TripLifecycleService.markStarted for it
  Then the call fails with CONFLICT_STATE and the trip is unchanged
    And TripLifecycleService.markLoading moves it to LOADING with one audit row
    And scripts/check-table-writes.ts fails CI if loading or execution writes trips or stops directly
```

Checklist (tick in the PR that adds the passing test):
- [x] AC-PLN-01 Engine run leaves no hard violation
- [x] AC-PLN-02 Moving onto a full vehicle is refused
- [x] AC-PLN-03 Publishing before it opens is locked
- [x] AC-PLN-04 An undecided unplanned order blocks publishing
- [x] AC-PLN-05 A repeat skip needs an override note
- [ ] AC-PLN-06 A breakdown after publishing becomes revision 2
- [x] AC-PLN-07 A stale If-Match loses
- [x] AC-PLN-08 One plan per depot and date
- [x] AC-PLN-09 An engine run records how it ran
- [x] AC-PLN-10 Hand-built trips survive Auto-suggest
- [x] AC-PLN-11 A failed run changes nothing
- [x] AC-PLN-12 Validate never saves
- [x] AC-PLN-13 The wizard saves one edit list
- [x] AC-PLN-14 A soft rule needs an override
- [x] AC-PLN-15 The wizard shows why
- [x] AC-PLN-16 Confirming a deferral
- [x] AC-PLN-17 Planning an unplanned order on a trip
- [x] AC-PLN-18 Swapping serves a repeat skip
- [x] AC-PLN-19 Publishing commits the day
- [x] AC-PLN-20 Other blockers stop publishing
- [ ] AC-PLN-21 A change after publishing is a revision
- [ ] AC-PLN-22 Released trips take three changes only
- [ ] AC-PLN-23 Reassigning a released trip
- [ ] AC-PLN-24 Re-sequencing the stops left
- [ ] AC-PLN-25 Deferring a stop mid-route
- [ ] AC-PLN-26 Cancelling a trip before it starts
- [x] AC-PLN-27 The store requests priority
- [x] AC-PLN-28 Reversing a deferral keeps the delivery
- [ ] AC-PLN-29 Closing the day
- [ ] AC-PLN-30 Reserving vehicles ahead
- [ ] AC-PLN-31 A draft follows order changes
- [ ] AC-PLN-32 Permissions and scope hold
- [ ] AC-PLN-33 Action links follow the rules
- [ ] AC-PLN-34 Other modules move trips through the lifecycle

## Non-functional
- Engine speed: an S1-sized input allocates in under 500 ms in Node; `validate()` runs in under 50 ms
  in the browser; the allocator stays well under a second for about 150 orders and 30 vehicles.
- Determinism: the same input gives the same output, byte for byte. The improve loop stops after
  `improveIterations` (2,000) moves, never on a wall-clock limit. Every run records `ENGINE_VERSION`.
- One transaction per use case holds the write, its audit row and its outbox event. Engine runs use
  bulk inserts because they hold the audit chain's advisory lock.
- Metrics: `engine_run_seconds` (label `mode`) and `engine_deferrals_total` (label `reason`).
- Screens 05 to 18 and 23 at 1440 × 960 with loading, empty and error states. The judge-path screens
  (05 to 09, 15, 17, 18) are snapshotted in CI with the demo clock frozen.
- Row-level security on `deferrals` re-checks the store scope in Postgres.
- Logs carry ids only; no names, phone numbers or notes.

## Decided 2026-10-03
- Unplanned is derived: an order is unplanned when it is in the plan's queue and on no live stop.
  `deferrals` rows hold reasons and decisions only; an order taken off by hand has no row until the
  dispatcher decides, so `/unplanned` lists it with `reasonCode` null.
- `orders.activeStopId` is set at publish (`markPlanned`); in a DRAFT plan the stops are the truth.
- Publish blockers are shown before publishing: the plan carries `publish` only when it is open and
  nothing blocks it, and `publish-preview` lists each blocker as `{ kind, message, orderId?, orderNo?,
  tripId?, tripKey?, rule? }` (`kind` HARD_VIOLATION, NO_DRIVER, UNDECIDED_ORDER or NOT_DRAFT). A
  publish that races a new blocker answers 409 CONFLICT_STATE with the same `blockers`.
- A soft violation without an override note is 422 PLAN_RULE_VIOLATION listing the soft violations.
- A trip with no orders is cancelled (`tripNo` null) when a save leaves it empty, except a reserved
  trip, which publish cancels if it is still empty. Never a blocker.
- The store hears about a deferral at publish: a DEFER decision writes its audit row, and publish
  emits one `deferral.confirmed` per CONFIRMED deferral. AC-PLN-16 is amended with the decisions PR.
  A store manager sees only deferrals on PUBLISHED or CLOSED plans.
- Revision 1 (publish) carries `reasonCode` `PUBLISH`; `plan_revisions.reasonCode` is free text.
- A deferral's `toDate` is the next run after the plan's date (ordering's `CutoffService.nextRun`).
- The edit list body is `{ ops, reasonCode?, note?, overrideNote? }`. `ops` is the engine's `EditOp`
  union plus `SET_DRIVER` and `SET_WAVE`, parsed with zod in the service and described in OpenAPI as
  `oneOf` eight op schemas discriminated on `op`. Decisions are posted as a list,
  `{ decisions: [...] }`, so 15 confirms several at once.

## Open questions
- Dates: Steps 3, 4 and 7 call 2026-10-01 a Wednesday, but it is a Thursday (2026-09-30 is the
  Wednesday). This spec uses ISO dates only. Which date is the demo's cutoff day? Decides: Nimesha.
- Names the doc does not fix: audit actions marked derived above (Step 2's reason table also drops
  the module prefix), and link relations for engine runs, edits, close, decisions, reverse and stop
  defer. Decides: Nimesha with Tihara.
- Step 2's boundaries table lists planning's emits as `plan.*`, `deferral.*`, `trip.reassigned`,
  `trip.resequenced` and its only consumed event as `vehicle.status_changed`; the module tab adds
  `trip.cancelled`, `stop.deferred` and consumes `order.cancelled`, `order.priority_changed`,
  `order.cutoff_closed`, `trip.cant_run`. Align the table and this spec's depends-on line, which `scripts/check-module-deps.ts` reads.
  Decides: Nimesha.
- AC-PLN-06: `alertTypeEnum` has no breakdown type, yet `vehicle.status_changed` raises an alert with
  a repair suggestion. Which type? Decides: Harini (alerts) with Tihara.
- AC-PLN-06: how a REPAIR run returns its diff and how it is applied (persisted proposal, or an
  EditOp list posted to `/plans/{id}/edits`). Decides: Tihara.
- AC-PLN-22, 26: can a RELEASED trip be cancelled (Step 5 allows only re-sequence, stop defer and
  reassign; the trip machine and D8 allow cancel before start), and what happens to a cancelled
  trip's orders? Decides: Tihara with Aniqa.

## Changelog
- 2026-10-03 Deferral reads, the store's response and reverse are live (AC-PLN-27, AC-PLN-28). The
  `respond` link shows only while the deferral is CONFIRMED and AWAITING, its plan is published and the
  order is still DEFERRED. `/deferrals` filters by status, storeResponse, source, plan, order, dates and
  repeatSkip; there is no outletId filter, because a store is already scoped to its outlet
- 2026-10-03 Screens 05 to 09 (ROO-30) on the live API: the day's plan with its day strip and stepper, the
  orders on no trip, Add Trip and Auto-suggest from the plan's links, and the 06 → 07 → 08 wizard that
  runs the engine in the browser on `/context` and saves one edit list. `PlanVehicleOptionDto` gains
  `weeklyFuelQuotaL` for 06's fuel bar. Departures are in docs/departures.md
- 2026-10-03 The planning API (ROO-29): plan reads and the engine context, the wizard reads (vehicle
  and order options, validate, suggest fixes, unplanned), edits, deferral decisions, publish with
  publish-preview and revisions, and Auto-suggest engine runs finished by the worker. `PlanWriter`
  is the one writer of trips and stops; `PlanContextBuilder` builds the engine input (fairness from
  the queued orders' `deferredCount`, fuel from fleet's ledger). AC-PLN-01 to 05 and 07 to 20 pass;
  AC-PLN-16 is amended for the publish-time notice. Still to come: revisions after publish (ROO-42),
  trip reassign, re-sequence, stop defer and cancel, close, reservations, repair runs (ROO-56), the
  deferral reads and responses, and the event consumers (AC-PLN-31). `planning.reeferCarriesAmbient`
  now defaults to true and `planning.techValueLimitLkr` to none, as this spec says
- 2026-10-03 Contract (ROO-29): every endpoint 05 to 18 and the deferral endpoints for 23, M4 and M7
  answer 501 with their final route, permission, headers and DTOs; the web builds on the generated
  mocks. Close, reservations, reassign, re-sequence, stop defer and cancel come later
- 2026-10-03 ROO-74: `deferrals.choice` (enum `deferral_choice`) and `deferrals.bindingRule` added,
  and `deferrals_live_uq` keeps one live whole-order deferral per order and plan. Additive only
  (the freeze allows no drops before 4 Oct): `swappedForOrderId` stays, unused, until a follow-up
  drops it. `DEFERRAL_CHOICES` moved to `packages/shared` so the database enum and the engine share
  one list
- 2026-10-03 The plan's queue is `OrderQueries.queueFor`: CONFIRMED and DEFERRED orders for the
  depot and date. A deferred order waits as DEFERRED and goes straight to PLANNED (or is deferred
  again) when a later plan is published
- 2026-10-03 `deferral_reasons` is seeded from the engine's reason map; the old seed used codes the
  engine never emits (`REEFER_CAPACITY`, `VEHICLE_CAPACITY`, `MANUAL`), so an engine run's deferral
  would have failed its foreign key, and the store wording was never stored. A re-seed retires an
  engine code the engine no longer emits (inactive, `fromEngine` false). `deferPartially` now dates
  deferred goods to the next run instead of the next calendar day (a Saturday removal is due on
  Monday when Sunday does not operate), so planning imports ordering's `CutoffService`
- 2026-10-02 `TripLifecycleService` added for execution's driver events (ROO-31), with
  `markDownloaded` and `markCantRun` beyond the methods listed above; planning's own moves
  (`markLoading`, `markReleased`, `cancel`) are still to come
- 2026-09-30 created from the Build Spec
- 2026-09-30 Model: `plans.createdById`, `trips.cantRunReason`, stop travel, predicted service, arrival position and units delivered, with range checks (merged from the Supabase draft)
- 2026-10-01 GET, POST /deferral-reasons and GET, PATCH /deferral-reasons/{code} added by ROO-27 (Nimesha) in this module,
  which owns the table: `DeferralReasonsService`, audit `planning.deferral_reason.created|updated`, events
  `deferral_reason.created|updated`. Tihara owns them from here
- 2026-10-02 ROO-33 (Nimesha) added what the dock needs from this module, because only planning may
  write `trips`, `plans`, `plan_revisions` and `deferrals`: `TripLifecycleService.markLoading`,
  `markReleased` and `markReloading`, and `DeferralService.deferPartially`, both exported from
  `index.ts`. Tihara owns them from here; they are covered by AC-LOD-04, 12, 16 and 19 and have no
  planning test of their own yet

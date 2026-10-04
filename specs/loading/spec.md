---
module: loading
owner: Harini
status: in-progress    # draft | ready | in-progress | done
screens: [L2, L3, L3a, L3b, L3c, L4, L5, L2m-a, L2m-b, L3m, L3m-a, L4m, L5m, "01", "19"]
depends-on: [audit, planning, ordering]
---

# Loading

## Purpose
Loading turns each published trip into a checklist in last-stop-first order, lets loaders check
lines and flag problems on a shared dock tablet, gets the dispatcher's decision on every flag, and
releases a trip only when everything is resolved.

## Scope
In: load lists built and refreshed from published and revised plans; line checks and undo; flags
with raise, undo, the dispatcher's decision (REPLACE or REMOVE) and the re-check (the L3a to L3c
loop); the dispatcher's flag queue and the flag panel on 01 and 19; release checks and release
with the reefer temperature; offline checks, flags and re-checks through the outbox and POST /sync.

Out:
- Loader PIN sign-in, Switch user and the 20-minute idle sign-out on L1 and L1m: identity.
- Trip status and the release columns on trips (releasedAt, releasedById, releaseTempC): planning,
  through TripLifecycleService.
- Order status (LOADED) and backorders: ordering, through OrderLifecycleService.
- Partial deferrals and the plan revision a REMOVE causes: planning (DeferralService).
- POST /sync batching, savepoints and sync conflicts: sync.
- The LOADER_SHORTFALL alert: alerts. Push and in-app messages: notifications.
- Flag threads: the comments table and GET, POST /load-flags/{id}/comments belong to the shared
  comments controller (Step 6).
- Flag photos: POST /attachments/presign and /attachments/{id}/complete (execution).
- The driver's trip after release: execution.

Screens (tablet 1194 x 834 landscape, phone 390 x 844):

| Frame | Node | Route | Data | States |
| --- | --- | --- | --- | --- |
| L2 Loading list | 185:19377 | /dock/trips/:id | /depots/{id}/loading/trips, /trips/{id}/load-list, checks via outbox | Last stop first, Checked by name, Plan updated banner, offline banner |
| L3 Flag an item | 185:19537 | Dialog | Flag via outbox, photo attachment | Reason, quantity, note |
| L3a Item flagged | 549:2497 | State on L2 | Waiting for the decision over SSE | Undo until the dispatcher decides |
| L3b Dispatcher replied | 542:2659 | State on L2 | load.flag_decided over SSE, comments | Replace or remove, with the note |
| L3c Item re-checked | 542:2821 | State on L2 | Re-check via outbox | Flag resolved |
| L4 Release trip | 185:19748 | /dock/trips/:id/release | GET release-checks, POST /release | Reefer temperature for chilled trips; needs a connection |
| L5 Trip released | 185:19880 | State | — | On to the next trip in the wave |
| L2m-a Runs | 254:1306 | /dock | /depots/{id}/loading/runs | Trips by wave with progress and open flags |
| L2m-b, L3m, L3m-a, L4m, L5m | 254:1498, 254:1605, 549:3616, 254:1675, 254:1804 | Phone layouts of L2, L3, L3a, L4, L5 | Same as the tablet frame | Same as the tablet frame |
| Flag panel on 01 and 19 | 488:8577, 185:17224 | /dispatch, /dispatch/tracking | GET /load-flags?filter[status]=OPEN, decision | The dispatcher's flag queue |

## Model
Schema file apps/backend/src/db/schema/loading.ts.

LoadCheckLine (load_check_lines):

| Column | Notes |
| --- | --- |
| id | UUIDv7 |
| tripId | references trips.id |
| orderId, orderLineId | orderLineId references order_lines.id; null for an order with no lines |
| stopSeq | snapshot of the stop's seq, for last-stop-first order |
| status | load_line_status: PENDING, OK, FLAGGED, REPLACED, REMOVED (default PENDING) |
| qtyExpected, qtyLoaded | integers; qtyLoaded is null until checked |
| planRevision | the list version the line belongs to |
| checkedByUserId, checkedByName, deviceId, checkedAt | who checked (the typed name on a shared tablet), where, and the device time |
| clientUuid | unique; offline idempotency |

Index load_lines_trip_seq_idx on (tripId, stopSeq).

LoadFlag (load_flags):

| Column | Notes |
| --- | --- |
| id | UUIDv7 |
| tripId, loadLineId | reference trips.id and load_check_lines.id |
| reason | load_flag_reason: MISSING, DAMAGED, WRONG_TEMP, OVER_CAPACITY |
| qtyAffected, note | the quantity affected and the loader's note |
| status | load_flag_status: OPEN, AWAITING_RECHECK, RESOLVED (default OPEN) |
| decision, decisionNote, decidedById, decidedAt | load_flag_decision: REPLACE, REMOVE |
| raisedByName, raisedByUserId | raisedByName is required |
| clientUuid | unique; offline idempotency |
| raisedAt, resolvedAt | raisedAt defaults to now |

Index load_flags_trip_status_idx on (tripId, status).

LoadRelease (load_releases), added by ROO-33:

| Column | Notes |
| --- | --- |
| id | UUIDv7 |
| tripId | references trips.id, unique: one release per trip |
| checkedByName | the name typed on the dock tablet; required |
| releasedById, deviceId, releasedAt | who released it, from where, when |
| releaseTempC | null on an ambient trip, which needs no reading |
| planRevision | the revision the list was released against |
| clientUuid | unique; offline idempotency |

`trips` has no room for the typed Checked-by name or for a release's
`clientUuid`, and both were Open questions; this table answers them. It also
records which revision the dock released against, which is what makes
"released against a plan that has since moved" a visible fact rather than an
inference. A trip reassigned to another vehicle drops its row and must be
released again (AC-LOD-19).

LoadEventReceipt (load_event_receipts), added by ROO-33: eventId (the
outbox_events id, primary key, no foreign key because the relay may prune its
rows), type, handledAt. Delivery is at least once, and a redelivered
`plan.published` would change nothing but would still emit
`load.list_updated` and put the Plan updated banner on a tablet for a plan
that did not move; only the event id can tell a redelivery from a genuine
re-publish (AC-LOD-01). The same pattern as alerts' `alert_event_receipts`.

Invariants:
- Lines appear last stop first, so the first stop's goods go in last, nearest the door.
- A line is checked with the quantity loaded; loading less than expected requires a flag.
- Flag machine: OPEN → AWAITING_RECHECK → RESOLVED. OPEN → RESOLVED directly on REMOVE (partial
  deferral), or as undone when the raiser taps Undo before the dispatcher decides.
- REPLACE sends the loader back to re-pick and re-check (L3c); REMOVE defers that line or order,
  creates a backorder for the removed quantity and tells the store.
- A trip releases only when every line is OK, replaced or removed; no flag is open or awaiting a
  re-check; the list matches the latest plan revision; a driver is assigned; and a chilled trip has
  a reefer temperature at or below `loading.maxReleaseTempC` (default 5.0, edited on A6).
- On a shared tablet every check, flag and release carries a Checked by name.
- Offline replays apply once: clientUuid is unique on both tables.
- Loading writes only these two tables. Trip status moves through planning's TripLifecycleService
  and order status through ordering's OrderLifecycleService.
- Neither table has a version column; loader writes carry a clientUuid instead of If-Match (Step 4).

## Endpoints
| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| GET | /depots/{id}/loading/runs?date= | load:read | L2m-a: trips by wave with progress and open flags |
| GET | /depots/{id}/loading/loaders | load:read | L2's Checked by: the depot's dock loader names from A6 (`loading.dockLoaders`); 404 outside the depot scope |
| GET | /depots/{id}/loading/trips?date=&wave= | load:read | L2's trip list |
| GET | /trips/{id}/load-list | load:read | Lines grouped by stop, last stop first, with plan revision, flags and links |
| POST | /trips/{id}/load-list/checks | load:check | Batch of `{ lineId, qtyLoaded, checkedByName, clientUuid, checkedAt }`; 200 with a result per item; also arrives through sync |
| POST | /load-lines/{id}/undo | load:check | Undo a check before release |
| POST | /trips/{id}/load-flags | load:flag | L3: line, reason, quantity, note, optional photo, `clientUuid`; 201 with Location |
| POST | /load-flags/{id}/undo | load:flag | The raiser, before the dispatcher decides |
| GET | /load-flags?filter[status]=OPEN | load:read | The dispatcher's flag queue; offset pages |
| GET | /load-flags/{id} | load:read | One flag, with what can be done about it (its `self`) |
| GET | /load-lines/{id} | load:read | One line (its `self`) |
| POST | /load-flags/{id}/decision | load:decide | L3b: REPLACE or REMOVE with a note and reason code |
| POST | /load-flags/{id}/recheck | load:check | L3c: quantity and checker; resolves the flag |
| GET | /trips/{id}/release-checks | load:read | L4: each precondition with pass or fail |
| POST | /trips/{id}/release | load:release | L4: reefer temperature for chilled trips, checker name, `clientUuid`; online only |

Not owned here but used by the dock: POST /sync (sync; permission stop:record or load:check),
GET and POST /load-flags/{id}/comments (comments controller, Step 6), POST /attachments/presign
(execution), POST /api/auth/sign-in/pin (identity).

Links (the Step 4 affordance rule): a line carries check, flag and undo; a flag carries undo,
decide and recheck; a trip carries release. Each appears only when the state machine allows it, the
actor holds the permission, the row is in scope and the time rules allow it, using the same can*()
helpers as the services.

## Services and helpers
Module folder apps/backend/src/modules/loading.

- **LoadListBuilder** reacts to `plan.published`, `plan.revised` and `trip.reassigned`: it builds or
  refreshes each trip's lines, keeps checks on unchanged lines, marks removed ones, bumps
  `planRevision` and emits `load.list_updated`. It runs as an outbox listener in the worker and
  dedupes by event id (delivery is at least once).
- **LoadCheckService**: check, undo.
- **LoadFlagService**: raise, undo, decide, recheck. A REMOVE calls planning's `DeferralService`
  for a partial deferral and ordering's `OrderLifecycleService` for the backorder.
- **ReleaseService**: preconditions, temperature check, `TripLifecycleService.markReleased`,
  `OrderLifecycleService.markLoaded` for the trip's orders.
- **LoadingQueries**: runs, trips, load list, flag queue and release checks, each through the
  loading ScopePolicy.
- Domain helpers: `loadOrder(stops)` for last-stop-first order and
  `groupByStop(lines)` in `domain/load-order.ts`;
  `releaseChecks(trip, lines, flags, settings)` in
  **packages/shared/src/rules/release-checks.ts**, because the tablet calls it
  too — it is the one function L4's checklist, the 409 and the greyed-out
  Release button are all built from, and it cannot live in apps/backend if the
  web is to share it.
- index.ts exports what sync needs to apply loader events (sync may import loading).
- Offline (apps/frontend): the tablet caches the day's lists in Dexie (`loadLines: 'id, tripId,
  stopSeq, status'`). Checks, flags, flag undo and re-checks go through `outbox.enqueue(type,
  payload)` and the shared `POST /sync` endpoint. Release needs a connection, because it must
  confirm the latest plan revision.

| Sync event | Payload | From |
| --- | --- | --- |
| LOAD_LINE_CHECKED | lineId, qtyLoaded, checkedByName, clientUuid, checkedAt | L2 |
| LOAD_FLAG_RAISED | line, reason, quantity, note, photo clientUuid, clientUuid | L3 |
| LOAD_FLAG_UNDONE | the flag, clientUuid | L3a |
| LOAD_RECHECKED | the flag, quantity, checkedByName, clientUuid | L3c |
| LOAD_CHECK_UNDONE | the line, clientUuid | L2 (added by ROO-33; see Decided while building) |

## Events
Emits:

| Event | Consumed by | Payload |
| --- | --- | --- |
| load.list_updated | realtime (Plan updated banner on the tablet) | v: 1, tripId, planId, depotId, revision, lines, added, removed, keptChecks, reopened, reasonCode |
| load.flag_raised | alerts, notifications (dispatcher push), realtime | v: 1, flagId, tripId, loadLineId, orderId, outletId, reason, qtyAffected, plannedDepartAt (which alerts reads to decide whether a shortfall is critical) |
| load.line_checked, load.line_check_undone | realtime (another tablet on the same dock) | v: 1, tripId, loadLineId, orderId, outletId, status, qtyExpected, qtyLoaded, stopSeq |
| load.flag_decided, load.flag_resolved | realtime (L3b, L3c), notifications (store, when a REMOVE defers part of its order) | load.flag_decided: v: 1, flagId, tripId (the web invalidates ['load-list', tripId]), loadLineId, orderId, outletId, decision, reasonCode, deferralId, backorderId, revision. load.flag_resolved: v: 1, flagId, tripId, loadLineId, status, how (RECHECK, REMOVE or UNDONE), qtyLoaded |
| trip.released | execution, notifications (driver), realtime, webhooks | v: 1, tripId, planId, depotId, vehicleId, driverId, stops, orderIds, releaseTempC, releasedAt, firstStopAt |

Consumes: `plan.published` (data: revision, tripIds), `plan.revised`, `trip.reassigned`.

Audit actions (same transaction as the write):

| Action | When | Reason required | Name from |
| --- | --- | --- | --- |
| loading.list.built | a trip's list is built or refreshed | — | the doc's log name |
| loading.line.checked | a line is checked | — | proposed |
| loading.line.check_undone | a check is undone | — | proposed |
| loading.flag.raised | a flag is raised | reason: missing, damaged, wrong temperature or over capacity | the doc's log name |
| loading.flag.undone | the raiser undoes a flag | — | proposed |
| ordering.order.backordered | a REMOVE raises the backorder (ordering's row) | — | ROO-33 |
| planning.stop.deferred | a REMOVE records the partial deferral (planning's row) | the decision's reason code | ROO-33 |
| loading.flag.decided | the dispatcher decides | a reason code for REMOVE | the doc's log name |
| loading.flag.rechecked | the re-check resolves a flag | — | proposed |
| loading.trip.released | the trip is released, with the reefer temperature | — | the doc's log name |

## Log events
- `loading.list.built` (trip, lines, revision)
- `loading.flag.raised` (reason)
- `loading.flag.decided` (decision)
- `loading.trip.released` (temperature, minutes from first check to release)

Log user ids, never the typed Checked by names.

## Permissions
| Permission | Held by | Used for |
| --- | --- | --- |
| load:read | dispatcher, loader | runs, trips, load list, flag queue, release checks |
| load:check | loader | checks, check undo, re-checks, loader events on POST /sync |
| load:flag | loader | raising and undoing flags |
| load:decide | dispatcher | flag decisions |
| load:release | loader | release |

Admin, driver and store manager hold no load permission and get 403 on every loading endpoint.
Scope: a loader sees depotId = actor.depotId and trips for today and tomorrow; a dispatcher sees
depotId = actor.depotId, or all depots when none is set. Out of scope answers 404.

## Acceptance criteria
- [x] AC-LOD-01  Publishing builds last-stop-first lists
- [x] AC-LOD-02  The dock sees its own trips
- [x] AC-LOD-03  Roles without the permission are refused
- [x] AC-LOD-04  Checking lines
- [x] AC-LOD-05  A short check needs a flag
- [x] AC-LOD-06  A check can be undone until release
- [x] AC-LOD-07  Flag a missing item
- [x] AC-LOD-08  Flags and removals need reasons
- [x] AC-LOD-09  Undo a flag before the decision
- [x] AC-LOD-10  The dispatcher asks for a replacement
- [x] AC-LOD-11  The re-check resolves the flag
- [x] AC-LOD-12  Removing an item defers part of the order
- [x] AC-LOD-13  A revision keeps unchanged checks
- [x] AC-LOD-14  Release is refused while a check fails
- [x] AC-LOD-15  Chilled trips need a cold reefer
- [x] AC-LOD-16  Release the trip
- [x] AC-LOD-17  Release needs a connection (the API half; L4's offline state is ROO-52's)
- [x] AC-LOD-18  Offline loader events apply once, in order
- [x] AC-LOD-19  A moved released trip loads again
- [ ] AC-LOD-20  The dock picks who checked from the depot's roster
- [x] AC-LOD-21  Each item is signed by whoever checked it unless the tablet has a name

```gherkin
AC-LOD-01  Publishing builds last-stop-first lists
  Given the Peliyagoda plan for 2026-10-02 holds 24 trips
    And REF-07 trip 1 has 6 stops, with Fresh Kadawatha at seq 1
    And the demo clock reads 2026-10-01 16:42 Asia/Colombo
  When Tihara Egodage publishes the plan and the relay delivers plan.published
  Then each of the 24 trips has load_check_lines, one per order line, all PENDING, with qtyExpected
      from the order line, stopSeq copied from its stop and planRevision 1
    And GET /trips/{id}/load-list for REF-07 trip 1 returns six stop groups in the order 6, 5, 4,
      3, 2, 1, so Fresh Kadawatha's lines come last
    And in Harini De Mel's view each PENDING line carries check and flag links and no undo link
    And load.list_updated is emitted and loading.list.built is logged with trip, lines and
      revision for each trip
  When the relay delivers the same plan.published event again
  Then no load_check_lines row is added or changed and load.list_updated is not emitted again

AC-LOD-02  The dock sees its own trips
  Given Harini De Mel, loader, is signed in on a Peliyagoda dock tablet
    And the demo clock reads 2026-10-02 02:40 Asia/Colombo
  When she opens L2m-a with GET /depots/PLG/loading/runs?date=2026-10-02
  Then the response is 200 with the day's Peliyagoda trips grouped by wave, each with its lines
      checked against lines expected and its count of open flags
    And GET /depots/PLG/loading/trips?date=2026-10-02&wave=<a wave id> returns only that wave's trips
  When she requests GET /trips/{id}/load-list for a Kandy trip, or for a Peliyagoda trip dated
      2026-10-01
  Then each answers 404 NOT_FOUND
  When Tihara Egodage (dispatcher, all depots) requests REF-07 trip 1's load list
  Then the response is 200 and carries no check, flag, undo, recheck or release link

AC-LOD-03  Roles without the permission are refused
  Given the published Peliyagoda plan for 2026-10-02
  When Aniqa Razick (driver), Nimesha Periyapperuma (store manager) or Rusiru Withanage (admin)
      requests GET /trips/{id}/load-list for REF-07 trip 1
  Then each gets 403 FORBIDDEN
  When Tihara Egodage posts a check to /trips/{id}/load-list/checks or a release to
      /trips/{id}/release
  Then she gets 403 FORBIDDEN and nothing changes
  When Harini De Mel posts to /load-flags/{id}/decision
  Then she gets 403 FORBIDDEN and the flag is unchanged

AC-LOD-04  Checking lines
  Given REF-07 trip 1 is PLANNED with every line PENDING and Harini's tablet is online
  When she sends 3 checks, each { lineId, qtyLoaded equal to qtyExpected, checkedByName
      "Harini De Mel", clientUuid, checkedAt 2026-10-02T02:45:10+05:30 }
  Then the response is 200 with one result per clientUuid, all applied
    And the 3 lines are OK with qtyLoaded, checkedByName, checkedByUserId, deviceId and checkedAt
      stored
    And the trip is LOADING, moved through TripLifecycleService.markLoading
    And exactly 3 audit rows loading.line.checked exist, each with occurredAt equal to its checkedAt
    And each checked line carries an undo link and no check link

AC-LOD-05  A short check needs a flag
  Given a PENDING line for WF-0171 on REF-07 trip 1 with qtyExpected 12
  When Harini checks it with qtyLoaded 10 and raises no flag
  Then that item's result is rejected with a code
    And the line stays PENDING with qtyLoaded null
    And no audit row is written for it

AC-LOD-06  A check can be undone until release
  Given a line Harini checked OK on REF-07 trip 1, which is LOADING
  When she undoes it with POST /load-lines/{id}/undo
  Then the response is 200 and the line is PENDING with qtyLoaded null
    And exactly one audit row loading.line.check_undone exists
  Given REF-07 trip 1 has been RELEASED
  When she undoes a check on it
  Then the response is 409 CONFLICT_STATE, the line is unchanged, and no line on the trip carries
      an undo link

AC-LOD-07  Flag a missing item
  Given the PENDING WF-0171 line on REF-07 trip 1 with qtyExpected 12
    And the demo clock reads 2026-10-02 03:05 Asia/Colombo
  When Harini raises a flag { loadLineId, reason MISSING, qtyAffected 2, note "2 cases missing",
      raisedByName "Harini De Mel", clientUuid }
  Then the response is 201 with Location /load-flags/{id} and status OPEN
    And the line is FLAGGED
    And exactly one audit row loading.flag.raised with reason MISSING and one outbox event
      load.flag_raised exist
    And the depot's dispatchers get a push and an in-app notice "REF-07: 2 cases missing, Fresh
      Kadawatha."
    And GET /load-flags?filter[status]=OPEN as Tihara lists the flag, with meta.page.total 1
    And the flag carries undo in Harini's view and decide in Tihara's view, and Harini's view has
      no decide link

AC-LOD-08  Flags and removals need reasons
  Given the PENDING WF-0171 line on REF-07 trip 1
  When Harini raises a flag with no reason
  Then the response is 400 VALIDATION_FAILED on reason
    And no flag, audit row or load.flag_raised event exists
  Given an OPEN flag on that line
  When Tihara decides REMOVE with no reason code
  Then the response is 400 VALIDATION_FAILED on reasonCode with "A reason is required"
    And the flag, the line, the plan and the order are unchanged

AC-LOD-09  Undo a flag before the decision
  Given Harini's OPEN MISSING flag on the WF-0171 line
  When she undoes it with POST /load-flags/{id}/undo
  Then the response is 200 and the flag is RESOLVED as undone, with resolvedAt set and no decision
    And the line is no longer FLAGGED
    And exactly one audit row loading.flag.undone exists
  Given a flag Tihara has already decided
  When Harini undoes it
  Then the response is 409 CONFLICT_STATE and the flag carries no undo link

AC-LOD-10  The dispatcher asks for a replacement
  Given Harini's OPEN MISSING flag for 2 of 12 on the WF-0171 line
  When Tihara decides REPLACE with the note "Replace from stock"
  Then the response is 200 with decision REPLACE, status AWAITING_RECHECK, and decisionNote,
      decidedById and decidedAt set
    And exactly one audit row loading.flag.decided and one outbox event load.flag_decided carrying
      tripId exist
    And Harini's tablet shows L3b over SSE and she gets the in-app notice "Dispatcher: replace from
      stock."
    And the flag carries a recheck link in Harini's view and no undo or decide link
  When a second dispatcher then decides REMOVE on the same flag
  Then the response is 409 CONFLICT_STATE and nothing changes

AC-LOD-11  The re-check resolves the flag
  Given the AWAITING_RECHECK flag on the WF-0171 line after a REPLACE
  When Harini re-checks it with { qtyLoaded 12, checkedByName "Harini De Mel", clientUuid }
  Then the response is 200, the flag is RESOLVED with resolvedAt set, and the line is REPLACED with
      qtyLoaded 12
    And exactly one audit row loading.flag.rechecked and one outbox event load.flag_resolved exist
  Given an OPEN flag with no decision yet
  When Harini re-checks it
  Then the response is 409 CONFLICT_STATE and the flag stays OPEN

AC-LOD-12  Removing an item defers part of the order
  Given Harini's OPEN MISSING flag for 2 of 12 on the WF-0171 line
    And the Peliyagoda plan for 2026-10-02 is at revision 1
  When Tihara decides REMOVE with a reason code and a note
  Then the response is 200, the flag is RESOLVED with decision REMOVE and the line is REMOVED
    And planning holds a partial deferral for WF-0171 (partial true, source LOAD_CHECK) with that
      reason code
    And ordering holds a backorder whose parentOrderId is WF-0171's id, with source backorder, for
      the removed quantity of 2
    And the plan is at revision 2 and every line on REF-07 trip 1 carries planRevision 2
    And exactly one audit row loading.flag.decided with the reason code and one outbox event
      load.flag_decided exist
    And Nimesha Periyapperuma is notified that part of WF-0171 is deferred

AC-LOD-13  A revision keeps unchanged checks
  Given REF-07 trip 1 at planRevision 1, with the lines of stops 6 and 5 checked OK and the rest
      PENDING
  When a plan revision moves the order at stop 3 to another trip and plan.revised is delivered
  Then the lines of stops 6 and 5 keep status OK, qtyLoaded and checkedByName
    And the moved order's lines are marked removed and no longer count against release
    And every line on the trip carries planRevision 2 and load.list_updated is emitted for the trip
    And Harini's tablet shows the Plan updated banner with what changed, and she acknowledges it
      before she checks another line

AC-LOD-14  Release is refused while a check fails
  Given REF-07 trip 1 (CHILLED) is LOADING with Aniqa Razick assigned
    And every line is OK except one with an OPEN flag
  When Harini requests GET /trips/{id}/release-checks
  Then the response is 200 with a pass or fail for each release precondition, and the line check
      and the open-flag check fail
  When she releases the trip with a reefer temperature of 3.4 °C
  Then the response is 409 and the problem lists the failing checks
    And the trip stays LOADING, its orders keep their status, and no audit row
      loading.trip.released and no trip.released event exist
  Given another trip whose lines are all resolved but which has no driver
  When Harini releases it
  Then the response is 409 and the failing checks include the driver check

AC-LOD-15  Chilled trips need a cold reefer
  Given every other release precondition passes on REF-07 trip 1 (CHILLED)
    And loading.maxReleaseTempC is 5.0
  When Harini releases it with no reefer temperature, and again with 5.1 °C
  Then each attempt answers 409 with the temperature check failing and the trip stays LOADING
  When she releases it with 5.0 °C
  Then the response is 200, the trip is RELEASED and releaseTempC is 5.0

AC-LOD-16  Release the trip
  Given every line on REF-07 trip 1 is OK, REPLACED or REMOVED, no flag is OPEN or
      AWAITING_RECHECK, the list is at the plan's latest revision and Aniqa Razick is assigned
    And the demo clock reads 2026-10-02 03:20 Asia/Colombo
  When Harini releases it with a reefer temperature of 3.4 °C, checkedByName "Harini De Mel" and a
      clientUuid
  Then the response is 200 with status RELEASED, releasedAt 2026-10-02T03:20:00+05:30,
      releasedById Harini's user id and releaseTempC 3.4
    And every order on the trip is LOADED through OrderLifecycleService.markLoaded
    And exactly one audit row loading.trip.released and one outbox event trip.released exist
    And Aniqa gets a push and an SMS "REF-07 released: 6 stops, first at 04:10."
    And loading.trip.released is logged with the temperature and the minutes from first check to
      release
    And the trip carries no release link, and no line or flag on it carries a check, flag, undo or
      recheck link
    And L5 offers the next trip in the wave
  When the same release arrives again with the same clientUuid
  Then no second audit row loading.trip.released or trip.released event exists and releasedAt
      stays 2026-10-02T03:20:00+05:30

AC-LOD-17  Release needs a connection
  Given Harini's tablet is offline and REF-07 trip 1 passes every release check
  When she opens L4
  Then the offline banner shows, the release action shows its needs-a-connection state
    And nothing for the release is added to the outbox

AC-LOD-18  Offline loader events apply once, in order
  Given Harini's tablet recorded while offline: deviceSeq 1 LOAD_LINE_CHECKED for line A,
      deviceSeq 2 LOAD_FLAG_RAISED on line B, deviceSeq 3 LOAD_FLAG_UNDONE for that flag
  When it reconnects and POST /sync sends the three events in the order 3, 1, 2
  Then the response is 200 with applied for all three, applied in deviceSeq order
    And line A is OK, the flag is RESOLVED as undone and line B is no longer FLAGGED
    And each audit row's occurredAt is the occurredAt its event carried from the device
  When the same batch is sent again
  Then every result is duplicate, no audit row is added and no line or flag changes

AC-LOD-19  A moved released trip loads again
  Given REF-07 trip 1 is RELEASED
  When Tihara reassigns it to another vehicle and trip.reassigned is delivered
  Then the trip is LOADING again, LoadListBuilder refreshes its list and load.list_updated is
      emitted
    And the trip must pass its release checks and be released again

AC-LOD-20  The dock picks who checked from the depot's roster
  Given Rusiru lists Harini, Kasun and Nuwan as PLG's dock loaders in A6 (setting loading.dockLoaders, depot PLG)
  When the loader reads GET /depots/PLG/loading/loaders and types "nu" in Checked by
  Then the response lists the three names, and only Nuwan is offered
    And a name not on the list still saves as typed, the list stays usable offline from the tablet's copy,
      and a Kandy loader gets 404 for PLG

AC-LOD-21  Each item is signed by whoever checked it unless the tablet has a name
  Given no name is set for the tablet
  When Kasun ticks Fresh milk and Nuwan undoes Basmati rice, each typing their name when asked
  Then the two queued events carry Kasun and Nuwan, the tablet still has no name, and each checked line shows "by <name>"
    And a name saved with "Use this name for every item" signs later ticks without asking, until it is
      cleared by saving the header's Checked by field empty; raising a flag never changes the tablet's name
```

## Non-functional
- Tablet frames at 1194 x 834 landscape and phone frames at 390 x 844, with data-density="touch"
  and 44-pixel targets. Each screen has loading, empty, error and offline states and passes
  /fidelity at its frame size; Harini signs off fidelity.
- Every write except release goes to Dexie and the outbox first; screens read with useLiveQuery.
  Sync runs on the online event, on return to the foreground, after each tap while online and
  every 30 seconds while anything is pending; failures retry after 2, 5, 15, 30, then every 60
  seconds. POST /sync takes up to 100 items.
- Dock sign-in requests navigator.storage.persist(). The outbox is never dropped, and records queued
  by one loader are never sent under another loader's session.
- Every change writes its audit row and outbox event in the same transaction as the write.
- Realtime: loaders listen on depot:<id>:loading. load.flag_decided invalidates the load list; the
  Plan updated banner comes from load.list_updated.
- L2 to L4 are on the judge path; L3a to L3c are in the exceptions tier.

## Decided while building (ROO-33)

Every Open question that blocked the API was settled here, in code, with the
test that proves it. Harini and Tihara own the ones marked **to confirm**:
changing one is a behaviour change, not a bug fix.

- **A refused release is 409 `CONFLICT_STATE` with a `checks` member**, and
  `failedChecks` listing the ids that failed. The member carries *every*
  check, not only the failures, so L4 draws the same checklist from the
  refusal as from `GET /trips/{id}/release-checks` and never has to merge two
  shapes. Not 422: nothing about the request is wrong, the dock is simply not
  finished, and the same body succeeds two minutes later (AC-LOD-14).
- **A missing reefer reading is a failing check, not a 400.** AC-LOD-15 asks
  for 409 with the temperature check failing, and a loader who has not read
  the thermometer is in the same position as one with a line still to check.
- **A short check with no flag is rejected `SHORT_WITHOUT_FLAG`**, with a
  message naming what to do instead. A check says "all 12 are here"; fewer is
  a flag for the dispatcher, not a quietly smaller number (AC-LOD-05). The
  other per-item codes are `OVER_EXPECTED`, `LINE_NOT_FOUND`,
  `LINE_NOT_CHECKABLE` and `TRIP_CLOSED`.
- **Checks do emit outbox events** (`load.line_checked`,
  `load.line_check_undone`), which the doc's catalog does not name.
  Architecture rule 4 wants one per state change, and a tick that another
  tablet on the same dock cannot see is a worse answer than an extra event
  type. The audit actions are the proposed `loading.line.checked` and
  `loading.line.check_undone`.
- **Check undo is syncable**: `LOAD_CHECK_UNDONE` joins the four sync event
  types. Architecture rule 10 says every loader write goes through the
  outbox, and leaving undo out would have made it the one control on L2 that
  stops working when the dock's wifi does. Release stays online only, which
  is why no loader event type mentions it (AC-LOD-17).
- **A REMOVE backorders only the affected quantity.** The line goes REMOVED
  with `qtyLoaded = qtyExpected − qtyAffected`, so the 10 cases that are in
  the building still travel; planning holds a partial deferral and ordering a
  backorder for the 2 that did not. This is AC-LOD-12's "the removed quantity
  of 2" read literally. **To confirm** (Harini, Tihara): the alternative is
  that the whole line stays behind.
- **Decisions use the `deferral_reasons` table**, the same list 16 and 17
  draw on, and a code that is missing or inactive is a 404 on the reason
  rather than a deferral the store cannot be told about.
- **The release confirms the revision two ways.** The body takes an optional
  `planRevision`; when it is given and stale, the revision check fails, which
  is how the server knows the tablet has seen the latest plan. The lines' own
  revisions are checked regardless, so a tablet that sends nothing is still
  held to the current plan. The release's `clientUuid` lives in
  `load_releases`, so a replay is a 200 that changes nothing (AC-LOD-16).
- **The runs board gives trips with no wave a group of their own**, labelled
  "No wave" and placed last, rather than dropping them from the board or
  folding them into somebody else's run. Fresh trips leave at 03:30 and
  belong to no wave. **To confirm** (Harini): the label.
- **An undone flag returns its line to where it was**: PENDING when it had
  not been checked, OK when it had, which `qtyLoaded` already records, so no
  column keeps the status the line held before the flag (AC-LOD-09).
- **Only the loader who raised a flag may undo it** — the account, not the
  typed name, because a shared tablet signs in as itself. The undo link is
  absent for anyone else, and the endpoint answers 403.
- **The release link follows the trip machine, not the release checks.** It is
  present while the trip is LOADING and the viewer holds `load:release`, and
  gone once it is RELEASED (AC-LOD-16). Gating it on the checks passing would
  leave L4 with no button to press and nothing to explain; `releaseChecks` on
  the same resource is what the screen enables the button from.
- **`loading.maxReleaseTempC` is global, not per depot**: it is not declared
  `perDepot` in the settings registry, because the cold chain is a
  food-safety limit rather than a depot's preference.
- **The first check marks the trip LOADING**, through planning's
  `TripLifecycleService.markLoading`; a refused check does not (AC-LOD-04,
  AC-LOD-05).
- **A refresh resets a check whose quantity moved under it.** A line whose
  order, item and quantity are unchanged keeps its status, quantity and
  checker (AC-LOD-13); one whose `qtyExpected` changed goes back to PENDING,
  because a tick against 12 cases says nothing about 14. A line settled by a
  decided flag is never reset.
- **A re-release leaves an already-LOADED order alone.** `orderMachine` has no
  LOAD from LOADED, so a trip released, reassigned to another vehicle and
  released again would otherwise fail on an order the dock did nothing wrong
  with (AC-LOD-19). An order every line of which was removed is never marked
  LOADED at all.

## Decided while building (ROO-34)

The screens' half of the module. Each of these is a decision the frames did
not make for us; the visual ones are listed in docs/departures.md with the
frame they depart from.

- **The list is the server's and the ticks are the device's.** L2 renders the
  shape, the copy and every action from `GET /trips/{id}/load-list`, then
  overlays what Dexie holds, so a tick is on screen before the network is
  asked and stays there with no signal (architecture rule 10). The fetched
  list is mirrored into Dexie, except for a line or flag an unsent tap is
  holding: writing the server's older answer over one of those is what makes
  a tick blink off under a loader's hand.
- **One control per line, and the server decides whether it exists.** The tick
  box is the whole interaction: it checks a line that carries a `check` link
  and undoes a line that carries `undo`, both through the outbox. A released
  trip carries neither, so the list is read-only without the screen knowing
  anything about trip status (AC-LOD-06).
- **The Plan updated banner freezes the list.** AC-LOD-13 says she
  acknowledges it before she checks another line, so while it shows, every
  tick is disabled; Got it clears it and refetches. The banner comes from
  `load.list_updated` over SSE, and from `upToDate: false` on the list itself
  for a tablet that was asleep when the event went out.
- **The dock's name lives in Dexie, not in the session.** `useCheckedByName`
  keeps the typed name between taps and the first tick asks for it. The
  account says whose tablet it is; this says who looked in the crate.
- **A flag raised offline has no links, so L3a shows no Undo for it.** The
  undo endpoint needs the server's flag id, which does not exist until the
  tap syncs. The optimistic row is drawn in full and the Undo button appears
  with the server's answer.
- **L5 is a state of the release route, not a route of its own.** A trip whose
  status is RELEASED shows it, so reopening `/dock/trips/:id/release` after a
  release shows what happened rather than an empty checklist.
- **A refused release re-reads the checks.** `ApiProblem` keeps only the
  RFC 9457 members, so the 409's `checks` member does not survive the client;
  the screen refetches `GET /trips/{id}/release-checks` on a refusal instead,
  which is the same list by another name.

## Still open

- Dates: the doc's examples call 1 Oct 2026 a Wednesday, but 30 Sep is the
  Wednesday. These criteria use ISO dates without weekdays. (Nimesha)
- `trip.reassigned`'s payload does not say whether the *vehicle* changed.
  LoadListBuilder reads `vehicleChanged` when planning sends it, compares
  `vehicleId` with the trip's when it does not, and treats an unreadable
  reassign as a driver change — the safer reading, because it keeps a
  released trip released rather than sending a loaded vehicle back to the
  dock on a guess. Planning's spec should name the field. (Tihara)
- Flag photos (`photoClientUuid`) are accepted and ignored: the attachment
  endpoints are execution's and the link from a flag to its photo has no
  table. (Harini, Aniqa)

## Changelog
- 2026-10-04 Dock loader roster (ROO-78): `loading.dockLoaders` per-depot setting edited in A6, `GET
  /depots/{id}/loading/loaders`, and a type-to-filter Checked by (AC-LOD-20, test still to write). Checked by
  signs each item separately when the tablet has no name, and the tablet name can be cleared (AC-LOD-21)
- 2026-09-30 created from the Build Spec
- 2026-10-02 ROO-33: the module built against AC-LOD-01 to 19, each with a
  passing test. `load_releases` and `load_event_receipts` added to the Model;
  `GET /load-flags/{id}` and `GET /load-lines/{id}` added to the Endpoints;
  Open questions replaced by "Decided while building" and "Still open";
  status draft to in-progress (the screens L2 to L5 are ROO-52's)
- 2026-10-03 ROO-34: the loader screens L1 to L5, L3a to L3c and the phone
  variants, each wired to the generated hooks and the offline outbox. The
  dock half of AC-LOD-01, 02, 04, 06, 07, 08, 09, 10, 11, 13, 14, 15, 16 and
  17 now has a screen test of its own; see "Decided while building (ROO-34)"
  and docs/departures.md. Status stays in-progress: the dispatcher's flag
  queue and decision panel on 01 and 19 are still to build
- 2026-10-04 The dispatcher's side of L3b is a Decide the flag dialog on the alert card (01 and 19): Replace, or Remove with a deferral reason, and a note (ROO-52). The tablet's flags now reach the server because the sync engine is started by the dock and driver shells

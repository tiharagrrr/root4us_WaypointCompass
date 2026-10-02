---
module: execution
owner: Aniqa
status: in-progress    # draft | ready | in-progress | done
screens: [D1, D2, D3, D4, D5, D6, D7, D8, D9, D10, D11, D14, "19", "19a", "19b", "20", "21"]
depends-on: [audit, planning, ordering, master-data]
---

# Execution, tracking and ETA

## Purpose
Execution gives the driver a trip that works with no signal and records every stop as an append-only
event. Tracking turns pings and events into positions, ETAs, late-risk alerts and the "no signal since"
state on 19. The end-of-day summary (21) shows each trip's result before planning closes the day.

## Scope
In:
- The driver's trips (D1, D10, D11, D14) and the offline bundle (D1, D2, D9).
- Field events from D1 to D8: trip download, start, arrive, deliver, partial, fail, issue, can't run and
  complete. They arrive through `POST /sync` or the online shortcuts, and one handler applies both.
- Proof-of-delivery attachments: presign, complete and download.
- Location ingest: the latest position, the sampled trail and the signal watch.
- ETA and late risk per stop, and the store's ETA on M3.
- Tracking reads for 19 and 19a, and the end-of-day summary for 21.
- 19b Re-sequence stops and 20 Reassign trip. These are Aniqa's screens, but they call planning's
  endpoints.

Out:
- Trips and stops, their state machine and `TripLifecycleService`: planning.
- Reassign, re-sequence, stop defer, trip cancel and day close endpoints: planning.
- Order status moves through `OrderLifecycleService`: ordering.
- Batch replay, duplicates, conflicts and the changes feed: sync.
- Alert rows (LATE_RISK, VEHICLE_OFFLINE, DRIVER_CANT_RUN, FAILED_STOP): alerts.
- ETA-slip and proof-of-delivery messages, and the trip-released push: notifications.
- Receipts and issues: receipt.
- Fan-out of events and `vehicle.position` over SSE: realtime.
- Traccar position forwarding to `/webhooks/traccar`: webhooks.
- The `attachments` table: platform (`platform.ts`, owner Nimesha).
- The Dexie store and offline outbox in `apps/frontend/src/offline`: see `specs/sync/spec.md`.

## Model
Schema file: `apps/backend/src/db/schema/execution.ts` (owner execution).

| Table | Key columns | Invariants |
| --- | --- | --- |
| stop_events | id, clientUuid (unique, made on the phone), tripId, stopId, type (stop_event_type), occurredAt (device clock), receivedAt (server clock), deviceSeq, lateSync, deviceId, actorId, lat, lng, payload (jsonb: outcome, lines, receiver, note, attachment ids), appliedAt, supersededAt | Append-only: an event is never edited. Stop status is a projection of these rows. appliedAt is set when the projection is applied; supersededAt when a sync conflict is resolved against it. lateSync is true when receivedAt is more than 5 minutes after occurredAt. Index (tripId, occurredAt). |
| delivery_lines | id, stopId, orderLineId, qtyExpected (snapshot of the order line's qty), qtyDelivered, condition (ok, damaged, refused), note | Unique (stopId, orderLineId). qtyDelivered >= 0; qtyExpected, when set, >= 0. |
| vehicle_positions | vehicleId (primary key), tripId, lat, lng, speedKmh, heading, accuracyM, reeferTempC, source (pwa, simulator, flutter, traccar), recordedAt, receivedAt | One row per vehicle, the latest point only. A ping replaces it only when its recordedAt is newer. |
| position_pings | id (bigserial), vehicleId, tripId, deviceId, lat, lng, speedKmh, heading, accuracyM, reeferTempC, source, recordedAt, receivedAt | Unique (vehicleId, recordedAt), so replayed batches dedupe. lat between -90 and 90, lng between -180 and 180. Index (tripId, recordedAt). Kept 30 days. |

Attachment rows this module creates live in platform's `attachments` table: kind (POD_PHOTO, SIGNATURE,
EXCEPTION_PHOTO, CANT_RUN_PHOTO), ownerType (stop or trip), ownerId, storageKey (unique), contentType,
bytes, sha256, clientUuid (unique), capturedAt, uploadedAt (null until the object exists in storage).

Projections on planning's tables, written only through `TripLifecycleService`:
- trips: cantRunReason, from the CANT_RUN event (D8).
- stops: status, arrivedAt (device time), arrivedLat and arrivedLng (the ARRIVED event's position),
  unitsDelivered, completedAt, outcome (delivery_outcome), receiverName,
  exceptionNote, etaAt, etaUpdatedAt, lateRiskProb.
- trips: status, downloadedAt, startedAt, completedAt.

Enums used:
- stop_event_type: TRIP_DOWNLOADED, TRIP_STARTED, ARRIVED, DELIVERED, PARTIAL, FAILED, ISSUE_REPORTED,
  CANT_RUN, TRIP_COMPLETED.
- delivery_outcome: DELIVERED, PARTIAL, REFUSED, DAMAGED, OUTLET_CLOSED.

State machines (`packages/shared/src/machines/`):
- Trip: RELEASED → IN_PROGRESS → COMPLETED, moved by the driver. A released trip moved to another vehicle
  goes back to LOADING.
- Stop: PENDING → ARRIVED → DELIVERED, PARTIAL or FAILED, by driver events. PENDING → CANCELLED when a
  dispatcher defers it mid-route or moves it to another trip.
- Order: LOADED → IN_TRANSIT (DEPART); IN_TRANSIT → DELIVERED, PARTIAL or FAILED.

Field events:

| Field event | Payload | From |
| --- | --- | --- |
| `TRIP_DOWNLOADED` | bundle version | D1 |
| `TRIP_STARTED` | reefer temperature for chilled trips | D1 |
| `ARRIVED` | position | D3 |
| `DELIVERED` | lines, receiver name, signature or photo | D4 |
| `PARTIAL` | lines with shortages and a reason | D4 |
| `FAILED` | refused, outlet closed or damaged; note; optional photo | D5 |
| `ISSUE_REPORTED` | type and note | D5 |
| `CANT_RUN` | breakdown, cooling, unwell or other; note; photo | D8 |
| `TRIP_COMPLETED` | none | D7 |

Every event also carries clientUuid, deviceSeq, occurredAt (server-aligned device clock), the raw device
time and the stop or trip version the device saw (baseVersion).

## Endpoints
| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| GET | /me/trips?date= | trip:read | D1; D10 (last 7 days); D14 when empty |
| GET | /trips/{id}/offline-bundle | trip:read | Trip, stops, outlets with windows and access notes, lines, contacts. Versioned and hashed, about 50 KB |
| POST | /trips/{id}/downloaded | trip:read | Records the bundle version on the device (TRIP_DOWNLOADED). D2 retries on failure |
| POST | /trips/{id}/start | stop:record | Online shortcut for TRIP_STARTED; same handler as the synced event |
| POST | /trips/{id}/complete | stop:record | Online shortcut for TRIP_COMPLETED (D7) |
| POST | /trips/{id}/cant-run | stop:record | Online shortcut for CANT_RUN (D8) |
| POST | /stops/{id}/arrive | stop:record | Online shortcut for ARRIVED (D3) |
| POST | /stops/{id}/complete | stop:record | Online shortcut for DELIVERED or PARTIAL (D4) |
| POST | /stops/{id}/fail | stop:record | Online shortcut for FAILED (D5) |
| POST | /attachments/presign | the owner's write permission (stop:record for stops and trips) | `{ kind, contentType, bytes, sha256, clientUuid, owner }` → an upload URL valid for 10 minutes |
| POST | /attachments/{id}/complete | same | Confirms the object exists and sets uploadedAt |
| GET | /attachments/{id} | read on the owner (stop:read) | Redirects to a download URL valid for 5 minutes |
| POST | /telematics/pings | stop:record or a device token | Up to 200 pings → `{ accepted, duplicates, rejected }` |
| GET | /depots/{id}/tracking | tracking:read | 19: trips in progress with position, next stop, ETA, late risk, last signal |
| GET | /trips/{id}/tracking | tracking:read | 19a: planned, ETA and actual per stop, breadcrumb, events |
| GET | /orders/{id}/eta | tracking:read | M3: the store's ETA for today's delivery |
| GET | /plans/{id}/end-of-day | plan:read | 21: per-trip results before planning's close |

Driver writes carry a clientUuid and no If-Match or Idempotency-Key (Step 4). Pings dedupe on
(vehicleId, recordedAt).

Planning's endpoints behind Aniqa's screens (specified in `specs/planning/spec.md`):

| Method | Path | Permission | Screen |
| --- | --- | --- | --- |
| POST | /trips/{id}/resequence | trip:resequence | 19b: stop ids in their new order, with a reason. If-Match (trip) and Idempotency-Key |
| POST | /trips/{id}/reassign | trip:reassign | 20: new vehicle or driver, validated, with a reason. If-Match (trip) and Idempotency-Key |
| GET | /plans/{id}/vehicle-options | plan:build | 20: vehicles with trips left, capacity, fuel left, or why unavailable |
| POST | /trips/{id}/stops/{stopId}/defer | deferral:decide | 19a: defer one stop mid-route |
| POST | /plans/{id}/close | plan:close | 21: unfinished stops become deferrals; actual fuel recorded |

## Services and helpers
Commands and queries:
- `MyTripsQueries`: the driver's trips, scoped to `driverId = actor.id` over the last 7 days.
- `OfflineBundleService`: builds the bundle and its hash (mapper `toOfflineBundle`).
- `StopEventService.apply(event)`: checks the state machine and the event's base version, appends the
  StopEvent, projects it onto Stop and Trip through `TripLifecycleService` (`markStarted`, `markArrived`,
  `markStopOutcome`, `markCompleted`) and onto Order through `OrderLifecycleService`, writes delivery
  lines, audits with source `OFFLINE_SYNC` and the device time, and adds the outbox event. The online
  shortcuts and `POST /sync` (mapper `fromFieldEvent`) both call it.
- `EtaService`: recomputes the remaining stops' ETAs and late risk.
- `OfflineDetector`: the signal watch.
- `TrackingQueries`: 19, 19a and the store's ETA.
- `EndOfDayService`: the 21 summary.

Pure helpers (`now` comes in as a parameter):
- `projectStop(events)`: stop state from its events.
- `etaFor(stops, position, now, travel, traffic)`: the next stop uses road distance from the current
  position (straight-line km × 1.3) over the district's free-flow speed, scaled by the hour's speed index
  and the day's disruption index. Later stops add `interStopMin` scaled the same way, plus service
  allowances and any window wait.
- `lateRisk(slackMinutes)` = `1 / (1 + exp((slack − 10) / 5))`, on the minutes of slack before the
  window closes. 10 minutes of slack reads 0.5, the alert threshold.
- `isLateSync(occurredAt, receivedAt)`: true when the event arrived more than 5 minutes after it happened.

Ping pipeline (`POST /telematics/pings`):
1. Validate: at most 200 pings; the sender drives that vehicle's trip today (or the simulator is
   running); coordinates inside Sri Lanka's bounding box; accuracy within 200 m; recordedAt no more than
   2 minutes ahead and no older than 24 hours; the trip is IN_PROGRESS.
2. Dedupe on (vehicleId, recordedAt).
3. Upsert VehiclePosition when the ping is newer than the stored one.
4. Keep a ping in PositionPing when 30 seconds or 100 m have passed since the last one kept.
5. Publish `vehicle.position` to Redis, at most once per vehicle every 5 seconds.
6. At most once a minute per trip, recompute the remaining stops' ETAs and late risk; emit `eta.updated`
   when any stop moves by 5 minutes or more.
7. Signal watch: the one-minute ticker checks running trips. After 10 minutes with no ping or event, 19
   shows "no signal since"; after 30, `vehicle.offline` and a VEHICLE_OFFLINE alert. The next ping emits
   `vehicle.back_online`.

Jobs (worker, restoring context with `runInJobContext`): the one-minute ticker (signal watch, overdue
trips); the per-trip ETA recompute; a daily purge of position_pings older than 30 days.

Settings read: `tracking.offlineAlertMinutes` (30; 19 shows "no signal since" from 10),
`tracking.etaSlipNotifyMinutes` (15), `tracking.lateRiskThreshold` (0.5).

## Events
Emits (outbox, typed payload with `v: 1`, in the `DomainEvent` envelope: id, type, v, occurredAt,
correlationId, actor, aggregate, routing `{ depotId, outletIds, userIds }`, data):

| Event | When | Consumed by | Payload fields known |
| --- | --- | --- | --- |
| `trip.started` | TRIP_STARTED applied | realtime, ETA, alerts, notifications, webhooks | ids |
| `stop.arrived` | ARRIVED applied | realtime, ETA, alerts, notifications, webhooks | ids |
| `stop.completed` | DELIVERED applied | realtime, ETA, alerts, notifications (the store gets proof of delivery), webhooks, receipt | tripId |
| `stop.failed` | FAILED applied | realtime, ETA, alerts, notifications, webhooks | ids |
| `trip.completed` | TRIP_COMPLETED applied | realtime, ETA, alerts, notifications, webhooks | ids |
| `trip.cant_run` | CANT_RUN applied | alerts, notifications (dispatcher), planning (repair suggestion) | ids |
| `eta.updated` | a stop's ETA moves by 5 minutes or more | realtime, notifications (slip of 15 minutes or more), alerts (late risk) | tripId, orderId |
| `vehicle.offline` | 30 minutes with no ping or event on a running trip | alerts, realtime | ids |
| `vehicle.back_online` | the next ping after `vehicle.offline` | alerts, realtime | ids |

`vehicle.position` skips the outbox: the ping pipeline publishes it straight to Redis, at most once per
vehicle every 5 seconds. Its SSE id is `<vehicleId>:<recordedAt>`, and the web app patches the positions
cache directly.

Consumes:
- `trip.released`: the trip becomes available, the driver gets a push, and the app downloads the bundle.
- `plan.published`: execution readies the drivers' trips.
- `plan.revised`, `trip.reassigned`, `trip.resequenced`, `trip.cancelled`, `stop.deferred`: the changes
  feed and a push; the app downloads the bundle again.

## Log events
- `execution.stop.recorded`: type and late sync.
- `tracking.vehicle.offline`: minutes since the last signal.

Log lines carry ids only. Receiver names, phone numbers, signatures and photos never appear in logs.
Metric: `vehicles_offline` (gauge, label depot).

## Permissions
| Permission | Roles holding it | Used for |
| --- | --- | --- |
| `trip:read` | admin, dispatcher, loader, driver | /me/trips, the offline bundle, /downloaded |
| `stop:record` | driver | Trip and stop events, attachment presign and complete, pings |
| `stop:read` | dispatcher, driver, store_manager | GET /attachments/{id} on a stop |
| `tracking:read` | admin, dispatcher, store_manager | 19, 19a, /orders/{id}/eta |
| `plan:read` | admin, dispatcher | 21 end-of-day summary |
| `trip:resequence`, `trip:reassign` | dispatcher | 19b and 20 (planning's endpoints) |
| `deferral:decide` | dispatcher | Stop defer from 19a (planning's endpoint) |
| `plan:close` | dispatcher | Close from 21 (planning's endpoint) |
| `issue:create` | driver, store_manager | ISSUE_REPORTED from D5 |

Scope (`ScopePolicy`; out of scope is 404, a missing permission is 403):
- Driver: trips where `driverId = actor.id` in the last 7 days.
- Dispatcher: `depotId = actor.depotId`, or all depots when none is set.
- Loader: `depotId = actor.depotId`, trips for today and tomorrow.
- Store manager: `outletId = actor.outletId` for ETAs. Stores see only their own delivery's ETA, never
  the map.

## Acceptance criteria
- [x] AC-EXE-01 A driver lists only her trips
- [x] AC-EXE-02 Other drivers' and old trips are not found
- [x] AC-EXE-03 Field writes need stop:record
- [x] AC-EXE-04 The offline bundle is versioned and hashed
- [ ] AC-EXE-05 A failed download shows D2
- [x] AC-EXE-06 Start a released trip
- [x] AC-EXE-07 A trip starts only when released
- [x] AC-EXE-08 Arrive out of sequence
- [x] AC-EXE-09 Deliver in full
- [x] AC-EXE-10 Proof and notes are required
- [x] AC-EXE-11 Partial delivery
- [x] AC-EXE-12 Failed delivery
- [x] AC-EXE-13 A recorded outcome is never changed
- [x] AC-EXE-14 Can't run this trip
- [x] AC-EXE-15 Complete the trip
- [x] AC-EXE-16 Proof of delivery by presigned URL
- [ ] AC-EXE-17 Pings are counted and deduplicated
- [ ] AC-EXE-18 Invalid pings are rejected
- [ ] AC-EXE-19 Silence raises VEHICLE_OFFLINE until the next ping
- [ ] AC-EXE-20 ETA moves and the store's slip notice
- [ ] AC-EXE-21 Late risk crosses 0.5 at 10 minutes
- [ ] AC-EXE-22 A store sees her ETA, never the map
- [ ] AC-EXE-23 The dispatcher tracks running trips
- [ ] AC-EXE-24 Re-sequence stops
- [ ] AC-EXE-25 Reassign a trip the driver can't run
- [ ] AC-EXE-26 End of day waits for every trip

```gherkin
AC-EXE-01  A driver lists only her trips
  Given driver Aniqa Razick has REF-07 trips 1 and 2 on 2 Oct 2026, both RELEASED
    And driver Dinushi Rathnayake has DRY-31 trip 1 on the same date
    And Aniqa has no trip on 4 Oct 2026
    And the demo clock reads 2 Oct 2026 03:05:00 Asia/Colombo
  When Aniqa calls GET /me/trips?date=2026-10-02
  Then the response is 200 with exactly her two REF-07 trips
    And no DRY-31 trip is in the response
    And the same call with date=2026-10-04 returns 200 with an empty data array, which D1 shows as D14 No trip

AC-EXE-02  Other drivers' and old trips are not found
  Given Dinushi's DRY-31 trip 1 on 2 Oct 2026 is IN_PROGRESS
    And Aniqa drove a trip on 20 Sep 2026, more than 7 days before the demo clock's 2 Oct 2026 03:05:00
  When Aniqa calls GET /trips/{id}/offline-bundle for either trip, and POST /stops/{id}/arrive for a DRY-31 stop
  Then each response is 404 NOT_FOUND
    And no stop event, audit row or outbox event is created
    And D10, her trips for the last 7 days, does not list the 20 Sep trip

AC-EXE-03  Field writes need stop:record
  Given REF-07 trip 1 on 2 Oct 2026 is RELEASED
  When loader Harini De Mel calls POST /trips/{id}/start, and dispatcher Tihara Egodage calls POST /stops/{id}/arrive on its first stop
  Then each response is 403 FORBIDDEN
    And the trip stays RELEASED, the stop stays PENDING and no stop event exists

AC-EXE-04  The offline bundle is versioned and hashed
  Given REF-07 trip 1 on 2 Oct 2026 is RELEASED with 6 stops
    And the demo clock reads 2 Oct 2026 03:05:00
  When Aniqa's app calls GET /trips/{id}/offline-bundle
  Then the response is 200 with the trip, its 6 stops, each outlet with its delivery window, access notes and contact, and the order lines
    And the bundle carries a version and a hash, and a second call with nothing changed returns the same version and hash
    And POST /trips/{id}/downloaded with that version sets the trip's downloadedAt and appends one TRIP_DOWNLOADED stop event holding the version
    And D9 Dock and access shows the access notes and contact with the network off

AC-EXE-05  A failed download shows D2
  Given Aniqa's phone last downloaded REF-07 trip 1 at 03:05:00 and the trip was revised at 04:30:00
  When the app's GET /trips/{id}/offline-bundle fails at 04:31:00
  Then D1 shows D2 Download failed with Retry and the last successful download time, 03:05
    And the phone keeps the 03:05 bundle and makes no POST /trips/{id}/downloaded call

AC-EXE-06  Start a released trip
  Given REF-07 trip 1 on 2 Oct 2026 is a CHILLED trip, RELEASED, with its orders LOADED
    And the demo clock reads 2 Oct 2026 03:40:00
  When Aniqa starts the trip on D1 with a reefer temperature of 3.4 °C
  Then the trip is IN_PROGRESS with startedAt 03:40:00 device time
    And its orders move from LOADED to IN_TRANSIT
    And exactly one TRIP_STARTED stop event, one audit row execution.trip.started and one outbox event trip.started exist
    And D1 shows the "sharing location during this trip" indicator

AC-EXE-07  A trip starts only when released
  Given REF-07 trip 2 on 2 Oct 2026 is LOADING
  When Aniqa calls POST /trips/{id}/start
  Then the response is 409 CONFLICT_STATE and the trip stays LOADING
    And no TRIP_STARTED stop event, audit row or trip.started event exists

AC-EXE-08  Arrive out of sequence
  Given REF-07 trip 1 is IN_PROGRESS with PENDING stops at seq 2 and seq 3
  When Aniqa records ARRIVED at the seq 3 stop at 04:12:05 device time with her position
  Then the seq 3 stop is ARRIVED with arrivedAt 04:12:05, and the seq 2 stop stays PENDING
    And the out-of-sequence visit is logged
    And exactly one audit row execution.stop.arrived and one outbox event stop.arrived exist

AC-EXE-09  Deliver in full
  Given the Fresh Kadawatha stop on REF-07 trip 1 is ARRIVED and its order, holding 3 lines, is IN_TRANSIT
  When Aniqa records DELIVERED at 04:20:00 device time with the 3 lines in full, the receiver's name and a signature attachment clientUuid
  Then the stop is DELIVERED with completedAt 04:20:00 and the receiver's name
    And 3 delivery_lines rows exist, each with condition ok
    And the order is DELIVERED
    And exactly one audit row execution.stop.completed and one outbox event stop.completed, carrying the tripId, exist
    And one log line execution.stop.recorded carries the type and lateSync false, and no receiver name

AC-EXE-10  Proof and notes are required
  Given REF-07 trip 1 is IN_PROGRESS with three ARRIVED stops
  When Aniqa sends DELIVERED without a receiver name, PARTIAL without a signature or photo, and FAILED without a note
  Then each response is 400 VALIDATION_FAILED naming the missing field
    And the three stops stay ARRIVED and no stop event is appended

AC-EXE-11  Partial delivery
  Given an ARRIVED stop on REF-07 trip 1 whose order line expects 10 trays
  When Aniqa records PARTIAL with 8 trays delivered, the reason damaged, the note "2 trays crushed", the receiver's name and a photo
  Then the stop and its order are PARTIAL
    And the stop's delivery line holds qtyDelivered 8
    And exactly one audit row execution.stop.partial carries the outcome and the note
    And exactly one outbox event for the outcome exists (stop.completed with outcome PARTIAL; see Open questions)

AC-EXE-12  Failed delivery
  Given an ARRIVED stop on REF-07 trip 1 whose order is IN_TRANSIT
  When Aniqa records FAILED at 05:10:00 with outcome outlet closed and the note "Shutter down"
  Then the stop is FAILED with outcome OUTLET_CLOSED and the note, and its order is FAILED
    And exactly one audit row execution.stop.failed with the outcome and note, and one outbox event stop.failed, exist

AC-EXE-13  A recorded outcome is never changed
  Given the Fresh Kadawatha stop was recorded DELIVERED at 04:20:00
  When Aniqa sends FAILED for the same stop at 04:25:00
  Then the response is 409 CONFLICT_STATE
    And the stop stays DELIVERED, and its DELIVERED stop event is unchanged
    And no stop.failed outbox event and no execution.stop.failed audit row exist

AC-EXE-14  Can't run this trip
  Given REF-07 trip 2 on 2 Oct 2026 is RELEASED
    And the demo clock reads 2 Oct 2026 04:40:00
  When Aniqa sends CANT_RUN from D8 with reason breakdown, a note and a photo
  Then exactly one CANT_RUN stop event, one audit row execution.trip.cant_run with the reason, and one outbox event trip.cant_run exist
    And the alerts module holds one OPEN DRIVER_CANT_RUN alert with a repair suggestion
    And the trip keeps its vehicle and driver until a dispatcher reassigns it (AC-EXE-25)
    And the same request without a reason returns 400 VALIDATION_FAILED on reasonCode with "A reason is required"

AC-EXE-15  Complete the trip
  Given REF-07 trip 1 is IN_PROGRESS and every stop is DELIVERED, PARTIAL or FAILED
  When Aniqa sends TRIP_COMPLETED from D7 at 06:05:00 device time
  Then the trip is COMPLETED with completedAt 06:05:00
    And exactly one audit row execution.trip.completed and one outbox event trip.completed exist
    And the app stops watching location, and a REF-07 ping recorded at 06:06:00 for this trip is rejected

AC-EXE-16  Proof of delivery by presigned URL
  Given Aniqa's DELIVERED event at the Fresh Kadawatha stop was applied and names a signature by clientUuid
    And the demo clock reads 2 Oct 2026 04:21:00
  When the app calls POST /attachments/presign with kind SIGNATURE, contentType image/png, bytes, sha256, that clientUuid and the stop as owner
  Then the response carries an upload URL that expires at 04:31:00 and an attachment with uploadedAt null
    And a second presign with the same clientUuid returns the same attachment and adds no row
    And after the upload, POST /attachments/{id}/complete sets uploadedAt
    And GET /attachments/{id} answers 200 to store manager Nimesha Periyapperuma (Fresh Kadawatha) with a download URL that expires 5 minutes later (it was a 302; see Open questions)
    And GET /attachments/{id} answers 404 NOT_FOUND to a store manager of another outlet

AC-EXE-17  Pings are counted and deduplicated
  Given REF-07 trip 1 is IN_PROGRESS
    And Aniqa's phone queued 20 pings recorded from 04:08:00 to 04:12:05, 2 of them already stored
  When the phone calls POST /telematics/pings with the 20 pings
  Then the response is 200 with accepted 18, duplicates 2 and rejected 0
    And vehicle_positions for REF-07 holds the 04:12:05 ping, and a later batch holding a 04:10:00 ping does not replace it
    And position_pings keeps a ping only when 30 seconds or 100 m have passed since the last one kept
    And vehicle.position goes to Redis at most once every 5 seconds for REF-07, and no outbox row is written for it

AC-EXE-18  Invalid pings are rejected
  Given REF-07 trip 1 is IN_PROGRESS and REF-07 trip 2 is RELEASED
    And the demo clock reads 2 Oct 2026 04:12:00
  When Aniqa's phone sends one batch with a ping at lat 51.5 and lng -0.12, a ping with accuracyM 250, a ping recorded at 04:15:00, a ping recorded at 1 Oct 2026 04:00:00, and a ping for trip 2
  Then the response is 200 with accepted 0, duplicates 0 and rejected 5, and no row is written
    And a batch of 201 pings returns 413 PAYLOAD_TOO_LARGE and writes nothing
    And a REF-07 ping sent from Dinushi's phone is rejected, because she does not drive that vehicle today

AC-EXE-19  Silence raises VEHICLE_OFFLINE until the next ping
  Given REF-07 trip 1 is IN_PROGRESS and its last ping or event was at 04:30:00
  When the one-minute ticker runs at 05:01:00
  Then exactly one outbox event vehicle.offline and one OPEN VEHICLE_OFFLINE alert exist
    And one log line tracking.vehicle.offline carries 31 minutes since the last signal
    And the ticker run at 05:02:00 adds no second event or alert
    And a ping recorded at 05:05:00 emits exactly one vehicle.back_online, and the alert resolves

AC-EXE-20  ETA moves and the store's slip notice
  Given the Fresh Kadawatha stop on REF-07 trip 1 has a window closing at 06:00 and a stored ETA of 05:50
  When recomputes, each in a different minute, give 05:54, then 06:15, then 06:25
  Then the 05:54 recompute emits no eta.updated
    And the 06:15 and 06:25 recomputes each emit one eta.updated carrying the tripId and orderId
    And exactly one ETA-slip notification is queued for store manager Nimesha Periyapperuma, not one per recalculation
    And pings arriving 20 seconds apart cause at most one recompute of the trip in that minute

AC-EXE-21  Late risk crosses 0.5 at 10 minutes
  Given tracking.lateRiskThreshold is 0.5
    And a stop on REF-07 trip 1 has a window closing at 06:00 and a stored ETA of 05:45
  When a recompute gives that stop an ETA of 05:55, 5 minutes of slack
  Then stops.lateRiskProb is 0.731, which is lateRisk(5)
    And the alerts module holds one OPEN LATE_RISK alert with dedupeKey LATE_RISK:stop:<stopId>
    And a later recompute at risk 0.8 adds no second OPEN alert for that stop
    And lateRisk(10) returns 0.5, lateRisk(20) returns 0.119 and lateRisk(0) returns 0.881, to 3 decimals

AC-EXE-22  A store sees her ETA, never the map
  Given store manager Nimesha Periyapperuma for Fresh Kadawatha, whose order is on REF-07 trip 1, IN_PROGRESS
  When she calls GET /orders/{id}/eta
  Then the response is 200 with the stop's ETA and no vehicle position
    And the same call for another outlet's order returns 404 NOT_FOUND
    And GET /depots/PLG/tracking and GET /trips/{id}/tracking return 404 NOT_FOUND to her

AC-EXE-23  The dispatcher tracks running trips
  Given REF-07 trip 1 and DRY-31 trip 1 are IN_PROGRESS at Peliyagoda (PLG)
    And REF-07's last ping or event was at 04:30:00
    And the demo clock reads 2 Oct 2026 04:41:00
  When dispatcher Tihara Egodage calls GET /depots/PLG/tracking
  Then the response is 200 and each trip carries its position, next stop, ETA, late risk and last signal time
    And 19 shows REF-07 with "No signal since 04:30"
    And GET /trips/{id}/tracking for REF-07 trip 1 gives each stop's planned arrival, ETA and actual time, the breadcrumb and the trip's stop events
    And on 19a every event received more than 5 minutes after it happened shows Synced late
    And driver Aniqa gets 403 FORBIDDEN on both endpoints

AC-EXE-24  Re-sequence stops
  Given REF-07 trip 1 is IN_PROGRESS at version 4 with PENDING stops in the order A, B, C
    And the alerts module holds an OPEN LATE_RISK alert on stop C
  When Tihara calls POST /trips/{id}/resequence from 19b with If-Match W/"4", an Idempotency-Key, the stop ids C, A, B and a reason code
  Then the response is 200 with the stops in the order C, A, B and ETag W/"5"
    And exactly one audit row planning.trip.resequenced with the reason code and one outbox event trip.resequenced exist
    And the LATE_RISK alert resolves itself
    And Aniqa's next GET /sync/changes returns the change, and her next bundle has a new version and hash
    And a second dispatcher's request still carrying If-Match W/"4" returns 412 VERSION_MISMATCH
    And a request with no reason code returns 400 VALIDATION_FAILED on reasonCode

AC-EXE-25  Reassign a trip the driver can't run
  Given REF-07 trip 2 on 2 Oct 2026 is RELEASED at version 2 with an OPEN DRIVER_CANT_RUN alert
    And GET /trips/{id} as Tihara carries a reassign link and no resequence link
  When Tihara calls POST /trips/{id}/reassign from 20 with If-Match W/"2", an Idempotency-Key, another reefer from GET /plans/{id}/vehicle-options, that vehicle's driver and a reason code
  Then the response is 200 and the trip is LOADING on the new vehicle
    And exactly one audit row planning.trip.reassigned and one outbox event trip.reassigned exist
    And the DRIVER_CANT_RUN alert resolves itself
    And the trip leaves Aniqa's GET /me/trips, and her changes feed carries the reassignment
    And a vehicle that breaks a hard rule returns 422 PLAN_RULE_VIOLATION with the violations
    And the admin gets 403 FORBIDDEN and sees no reassign link

AC-EXE-26  End of day waits for every trip
  Given the Peliyagoda plan for 2 Oct 2026 has REF-07 trip 1 COMPLETED and DRY-31 trip 1 IN_PROGRESS with one PENDING stop
    And the demo clock reads 2 Oct 2026 20:00:00
  When Tihara calls GET /plans/{id}/end-of-day
  Then the response is 200 with a result per trip, and DRY-31 trip 1 shows as not finished
    And each unfinished stop is listed, since each needs a deferral reason before planning closes the day
    And 21 offers no close action, and POST /plans/{id}/close is refused, while a trip is neither COMPLETED nor CANCELLED
    And driver Aniqa gets 403 FORBIDDEN on GET /plans/{id}/end-of-day
```

## Non-functional
- Every driver screen after D1 works from Dexie with no signal, and every driver write goes through the
  offline outbox.
- The offline bundle is about 50 KB.
- Driver frames are 390 × 844 with touch density (44-pixel targets), in loading, empty, error and offline
  states. 19, 19a and 21 are 1440 × 960.
- The phone watches position only while the trip screen is open, sends every 30 seconds or 20 pings,
  stops at trip complete or sign-out, and shows "sharing location during this trip" on D1 and D3.
- ETA recompute runs at most once a minute per trip; `eta.updated` fires only for moves of 5 minutes or
  more; `vehicle.position` goes out at most once per vehicle every 5 seconds.
- The trail is kept 30 days; vehicle_positions holds only the latest point.
- Time comes from `ClockService.now()`; business dates are Asia/Colombo; helpers take `now` as a parameter.
- Every state change writes its audit row and outbox event in the same transaction as the change.
- 19's map uses MapLibre with cached OpenStreetMap tiles (cache-first, 7 days, 500 entries).

## Decisions (ROO-31)
The questions below that ROO-31 had to answer to build, answered. Each is in code and has a test;
say so in the spec if you change one.

- **CANT_RUN leaves the trip's status alone.** `tripMachine` has no CANT_RUN transition and AC-EXE-14
  says the trip keeps its vehicle and driver, so the event appends and projects `trips.cantRunReason`
  only. Allowed from RELEASED and IN_PROGRESS; anything else is 409. No change to packages/shared.
- **PARTIAL emits `stop.completed`** with `outcome: 'PARTIAL'`, and audits `execution.stop.partial`.
- **The bundle's version is the trip's version; its hash is sha256 over the canonical bundle JSON.**
  The phone compares the hash, because planning bumps the trip's version on a resequence or reassign
  but an edit to an outlet's access note or an order's lines does not touch the trip row at all. This
  is also why execution needs no handler for `plan.revised`, `trip.reassigned`, `trip.resequenced` or
  `stop.deferred`: the hash is derived on every read, so a revision shows up by itself.
- **TRIP_COMPLETED is refused with 409 while any stop is PENDING or ARRIVED**, naming how many; the
  dispatcher defers the stop from 19a instead. This is the decision most likely to want changing.
- **Scope and the list are separate.** Scope is `driverId = actor.id` over the last 7 business days
  and tomorrow, so a LOADING trip is found and answers 409 (AC-EXE-07) rather than 404; `/me/trips`
  lists RELEASED, IN_PROGRESS, COMPLETED and CANCELLED.
- **A store manager holds the stop scope for her own outlet**, which is how M5 opens a delivery's
  proof; every other outlet's stop is 404.
- **Attachments: 5 MB** (`ATTACHMENT_MAX_BYTES`), over it 413 PAYLOAD_TOO_LARGE; `/complete` with no
  object in the store is 409 and leaves `uploadedAt` null; an unreachable store is 503, never 409.
- **An out-of-sequence arrival logs `execution.stop.out_of_sequence`** (ids and seq only) and is
  otherwise a normal ARRIVED.
- **`reeferTempC`** is TRIP_STARTED's field, required on a CHILLED trip, and it lands in
  `trips.releaseTempC`.
- **Audit rows come in pairs.** Execution writes `execution.*` for the use case and planning's
  `TripLifecycleService` writes `planning.trip.status_changed` or `planning.stop.status_changed` for
  its own table, exactly as ordering already does for an order's status.

## Open questions
- The Build Spec's examples call 1 Oct 2026 a Wednesday and 2 Oct a Thursday; the calendar says Thursday
  and Friday. This spec writes dates without weekdays. (Nimesha)
- Audit action names: this spec uses `execution.` plus the event name (execution.stop.completed,
  execution.trip.cant_run) and planning.trip.resequenced, per `<module>.<entity>.<verb>`. Step 2's
  reason list names stop.failed and trip.cant_run. Confirm. (Nimesha)
- ~~Which status does a trip hold after CANT_RUN, and may CANT_RUN follow TRIP_STARTED?~~ Decided
  above: the status does not move, and CANT_RUN is allowed from RELEASED and IN_PROGRESS.
- TRIP_STARTED moves the trip's orders LOADED → IN_TRANSIT (DEPART); built that way. Confirm. (Aniqa,
  with Harini)
- ~~Which outbox event does PARTIAL emit? Is TRIP_COMPLETED allowed while stops are still PENDING?~~
  Both decided above.
- How execution writes planning's columns and platform's attachments rows, answered for ROO-31:
  `TripLifecycleService` gained `markDownloaded` and `markCantRun` beside the methods
  specs/planning/spec.md already lists, and core gained an `AttachmentsService` that owns
  `platform.attachments` plus a storage port. The tracking columns (stops.etaAt, etaUpdatedAt,
  lateRiskProb) still need methods of their own. (Tihara, Nimesha)
- ~~What is the bundle version?~~ Decided above. The path stays `/trips/{id}/offline-bundle`, not
  Step 4's `GET /drivers/me/trips/today`.
- Is a LATE_RISK alert raised at exactly 0.5 (10 minutes of slack)? What are the neutral values of the
  speed and disruption indexes in `etaFor`? (Aniqa)
- Store managers hold tracking:read; this spec answers 404 on depot and trip tracking by scope. Confirm
  404 rather than 403. (Aniqa) — settled for attachments: 404.
- Codes the doc does not give: `/complete` when the object is missing (409) and the upload size limit
  (5 MB) are decided above; an event naming a stop on another trip of the same driver is 404. Still
  open: `/close` with an unfinished trip, and which resource carries 21's close link. (Tihara)
- ~~The CANT_RUN reason codes, the TRIP_STARTED reefer field, and where an out-of-sequence visit is
  logged.~~ `cantRunReasonEnum` (BREAKDOWN, COOLING, UNWELL, OTHER), `reeferTempC`, and a log line;
  all decided above.
- **New:** AC-EXE-16 asked for a 302 from `GET /attachments/{id}`, but AC-IDN-60 requires every route
  a role may call to answer 2xx, and a route that writes its own response never answers at all under
  that criterion's harness. It is a 200 with the link instead; the file still comes from the store and
  the link still expires. Confirm the wording change. (Aniqa, with Nimesha for AC-IDN-60)
- **New:** nothing consumes a domain event yet — the outbox relay is ROO-24 — so `trip.released` and
  the revision events reach nobody. Execution needs no handler for the bundle (the hash is derived),
  but the driver's push does. (Nimesha)
- Does `/me/trips` list trips before release? D14 shows "the next planned trip, if any". (Aniqa)
- Does ISSUE_REPORTED from D5 create a receipt issue row, and through which call? (Harini)

## Changelog
- 2026-10-02 AC-EXE-01 to AC-EXE-04 and AC-EXE-06 to AC-EXE-16 built and passing (ROO-31): my trips,
  the offline bundle, `StopEventService`, the online shortcuts and proof of delivery. Ten decisions
  recorded above; AC-EXE-16 answers 200 with a link rather than 302
- 2026-09-30 created from the Build Spec
- 2026-09-30 Model: delivery lines keep `qtyExpected` and a `note`; the ARRIVED position, units delivered and the can't-run reason are projected onto stops and trips (merged from the Supabase draft)

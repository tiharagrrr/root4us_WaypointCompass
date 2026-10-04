---
module: sync
owner: Aniqa
status: in-progress    # draft | ready | in-progress | done
screens: [D6, D13, "19c"]
depends-on: [execution, loading]
---

# Sync

## Purpose
Sync replays whatever a driver's phone or a dock tablet recorded offline, exactly once and in the order
the device recorded it. Anything the server's state now contradicts becomes a sync conflict that a
dispatcher settles on 19c. The changes feed brings server-side changes back to the device.

## Scope
In:
- `POST /sync`: a batch of up to 100 field events from a driver or a loader, a result per event.
- Ordering by deviceSeq, a savepoint per event, idempotency by clientUuid, late-sync flagging.
- Conflict detection and the 19c resolution (KEEP_DEVICE or KEEP_SERVER, with a reason).
- `GET /sync/changes`: revisions, reassignments, cancelled stops and flag decisions for the device's trips.
- The pending count on D6 and the outbox check behind D13 Sign out.
- The client side of the protocol in `apps/frontend/src/offline` (Dexie store, outbox, sync engine), shared
  with the offline-action skill.

Out:
- What each driver event does to stops, trips and orders (`StopEventService.apply`): execution.
- What each loader event does to load lines and flags: loading.
- Reversing a deferral (`DeferralService.reverse`, `POST /deferrals/{id}/reverse`): planning.
- The SYNC_CONFLICT alert row: alerts.
- Push delivery of revisions and reassignments: notifications.
- SSE fan-out of `sync.*` events: realtime.
- The outbox table and relay: core (`OutboxService`).

## Model
Schema file: `apps/backend/src/db/schema/sync.ts` (owner sync).

| Table | Key columns | Invariants |
| --- | --- | --- |
| sync_batches | id, deviceId, userId, received, applied, duplicates, conflicts, rejected, receivedAt | One row per `POST /sync` call. Every event gets exactly one result, so received = applied + duplicates + conflicts + rejected. Index (deviceId, receivedAt). |
| sync_conflicts | id, kind (DELIVERED_AFTER_DEFERRAL, STOP_REASSIGNED, STOP_CANCELLED), tripId, stopId, stopEventId (unique), deviceRecord (jsonb: what the phone recorded, with device time), serverRecord (jsonb: what the server had, with who and when), status (OPEN, RESOLVED), resolution (KEEP_DEVICE, KEEP_SERVER), resolvedById, resolvedAt, note, createdAt | One conflict per stop event. OPEN rows have no resolution; RESOLVED rows have resolution, resolvedById and resolvedAt. Index (status, createdAt). |

Idempotency lives in the owners' tables: unique clientUuid on stop_events, load_check_lines, load_flags,
attachments and comments.

Client store (`apps/frontend/src/offline/db.ts`, Dexie database `compass`): trips, stops, orderLines,
outlets, loadLines, outbox (keyed by clientUuid; indexed by deviceSeq, status, tripId), attachments
(photos and signatures as Blobs), pings and syncState.

## Endpoints
| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| POST | /sync | stop:record or load:check | Up to 100 events; a result per event; also carries loader events. Header `x-sync-version: 1` |
| GET | /sync/changes?since= | field roles (driver, loader) | Server changes to the device's trips since a cursor: revisions, reassignments, cancelled stops, flag decisions |
| GET | /sync-conflicts?filter[status]=OPEN | alert:act | 19c list |
| POST | /sync-conflicts/{id}/resolve | alert:act | KEEP_DEVICE or KEEP_SERVER with a reason code |

`POST /sync` answers 200 with `results: [{ clientUuid, status: 'applied' | 'duplicate' | 'conflict' |
'rejected', code? }]`. It never fails as a whole because of one bad item; it answers 400 only when the
envelope itself is invalid, and 413 PAYLOAD_TOO_LARGE when the batch is over its limit. Sync events are a
discriminated union in `packages/shared`, parsed by a `ZodPipe`, with a hand-written `@ApiBody` schema.

`GET /sync/changes` is a cursor feed: limit default 50, max 200, `meta.page { limit, nextCursor, hasMore }`,
no total. A tampered cursor answers 400.

## Services and helpers
Server:
- `SyncService`: sorts a batch by deviceSeq, applies each event in its own savepoint so one bad event
  never blocks the rest, then records a SyncBatch. Driver events go to execution's
  `StopEventService.apply`; loader events go to loading's handlers. A replay hits the unique clientUuid
  and returns duplicate.
- Conflict rule: an event carries the stop or trip version the device saw. When the server's state makes
  the event impossible (a stop deferred, cancelled or moved while the phone was offline), the event is
  stored unapplied and becomes a sync conflict instead of applying.
- `ConflictService`: creates conflicts and resolves them. KEEP_DEVICE stands the delivery and reverses
  the deferral. KEEP_SERVER supersedes the event and tells the driver.
- `ChangesFeed`: pages the outbox for the device's trips.
- Helper (execution): `isLateSync(occurredAt, receivedAt)`, true when an event arrived more than 5 minutes
  after it happened. The device time is kept; late events are flagged, never reordered.

Client (`apps/frontend/src/offline`):
- `outbox.enqueue(type, payload)`: one Dexie transaction per tap. It adds the outbox row (clientUuid
  UUIDv7, deviceSeq, status pending, occurredAt from the server-aligned clock, the raw deviceTime,
  baseVersion) and applies the change optimistically, so screens update at once through `useLiveQuery`.
- Download: when a trip is released (push or SSE) or D1 opens, the app fetches the offline bundle,
  replaces that trip's data in one transaction and reports `/downloaded`.
- Triggers: the `online` event, return to the foreground, right after each tap while online, and every
  30 seconds while anything is pending. Background Sync is a bonus, not a dependency.
- Push: `POST /sync` with up to 100 items in deviceSeq order. Applied and duplicate items leave the
  outbox; conflicts stay marked and show on D6; rejected ones show their message.
- Backoff: network errors and 5xx retry after 2, 5, 15, 30, then every 60 seconds.
- Signed out: a 401 pauses sync and shows "Sign in to send 3 records". The outbox is never dropped and
  resumes after the same user signs back in.
- Attachments: photos and signatures wait in Dexie as Blobs. Once their event is applied, the app
  presigns, uploads and completes each one on its own retry loop.
- Pull: after every push and on reconnect, `GET /sync/changes?since=` brings revisions, reassignments and
  cancelled stops into Dexie; a change to the stop in progress shows a banner.
- Storage: driver and dock sign-in request `navigator.storage.persist()`. The service worker never caches
  API responses; Dexie is the data cache.
- Sign-out: D13 waits until the outbox is empty; there is no discard option.

## Events
Emits:

| Event | When | Consumed by |
| --- | --- | --- |
| `sync.batch_applied` | A batch has been processed | realtime, alerts |
| `sync.conflict_detected` | An event became a conflict | realtime, alerts (SYNC_CONFLICT alert for 19c) |
| `sync.conflict_resolved` | A dispatcher resolved a conflict | realtime, alerts (the alert resolves itself) |

Payloads use the `DomainEvent` envelope with `v: 1`; the doc lists no data fields for these events.

Consumes: none. `ChangesFeed` reads outbox rows for the device's trips: `plan.revised`,
`trip.reassigned`, `trip.resequenced`, `trip.cancelled`, `stop.deferred` and `load.flag_decided`.

## Log events
- `sync.batch.applied`: counts only.
- `sync.conflict.detected`: the kind.

Metrics: `sync_events_total` (counter, label result: applied, duplicate, conflict, rejected) and
`sync_lag_seconds` (histogram of server receive time minus device time).

## Permissions
| Permission | Roles holding it | Used for |
| --- | --- | --- |
| `stop:record` | driver | POST /sync with driver events |
| `load:check` | loader | POST /sync with loader events |
| field roles | driver, loader | GET /sync/changes |
| `alert:act` | dispatcher | GET /sync-conflicts, POST /sync-conflicts/{id}/resolve |
| `deferral:decide` | dispatcher | The deferral reversal behind KEEP_DEVICE (planning) |

Scope: a driver's device sees her own trips; a loader's sees the depot's trips for today and tomorrow; a
dispatcher sees conflicts for `depotId = actor.depotId`, or all depots when none is set. Out of scope is
404; a missing permission is 403.

## Acceptance criteria
- [x] AC-SYN-01 A batch applies in deviceSeq order
- [x] AC-SYN-02 A replayed batch changes nothing
- [x] AC-SYN-03 One bad event never blocks the rest
- [x] AC-SYN-04 A late event keeps its device time
- [x] AC-SYN-05 Batches over 100 are refused
- [ ] AC-SYN-06 A delivery after a deferral conflicts
- [ ] AC-SYN-07 Moved and cancelled stops conflict too
- [ ] AC-SYN-08 Keep device stands the delivery
- [ ] AC-SYN-09 Keep server supersedes the event
- [ ] AC-SYN-10 Resolving needs a reason and an open conflict
- [ ] AC-SYN-11 Only dispatchers in scope see conflicts
- [x] AC-SYN-12 The changes feed covers the device's trips
- [x] AC-SYN-13 Loader events ride the same endpoint
- [x] AC-SYN-14 A 401 pauses sync and loses nothing
- [x] AC-SYN-15 Sync retries back off

```gherkin
AC-SYN-01  A batch applies in deviceSeq order
  Given REF-07 trip 1 on 2 Oct 2026 is IN_PROGRESS and Aniqa Razick's phone went offline at 04:10:00 Asia/Colombo
    And her outbox holds ARRIVED then DELIVERED for three stops, deviceSeq 11 to 16, recorded from 04:12:05 to 04:48:00 device time
  When the phone calls POST /sync at 04:52:00 with the six events listed in the order 13, 11, 12, 16, 14, 15
  Then the response is 200 with one result per clientUuid, all applied
    And the events were applied in deviceSeq order, 11 to 16
    And the three stops and their orders are DELIVERED
    And each audit row has source OFFLINE_SYNC and occurredAt equal to the time the device recorded
    And one sync_batches row holds received 6, applied 6, duplicates 0, conflicts 0 and rejected 0
    And one outbox event sync.batch_applied and one log line sync.batch.applied, with counts only, exist

AC-SYN-02  A replayed batch changes nothing
  Given the batch in AC-SYN-01 was applied
  When the phone sends the same six events again
  Then the response is 200 with status duplicate for every clientUuid
    And no stop event, delivery line, audit row or outbox event is added, and no status changes
    And a second sync_batches row holds received 6 and duplicates 6
    And sync_events_total{result="duplicate"} rises by 6

AC-SYN-03  One bad event never blocks the rest
  Given REF-07 trip 1 is IN_PROGRESS with stops D and E PENDING
  When the phone sends, in one POST /sync, ARRIVED at stop D (deviceSeq 21), DELIVERED at stop D without a receiver name (22) and ARRIVED at stop E (23)
  Then the response is 200 with results applied, rejected with code VALIDATION_FAILED, and applied
    And event 22 leaves no stop event, and D6 shows its message
    And the sync_batches row holds applied 2 and rejected 1

AC-SYN-04  A late event keeps its device time
  Given Aniqa recorded DELIVERED at the Fresh Kadawatha stop at 04:20:00 device time while offline
  When the event reaches the server at 05:00:00
  Then the stop event keeps occurredAt 04:20:00, with receivedAt 05:00:00 and lateSync true
    And the order timeline (GET /timelines/order/{id}) shows the delivery at 04:20 with Synced late
    And events are ordered by occurredAt on the timeline, never by receivedAt
    And isLateSync returns false for an event received exactly 5 minutes after it happened

AC-SYN-05  Batches over 100 are refused
  Given Aniqa's phone holds 101 unsent events
  When it sends all 101 in one POST /sync
  Then the response is 413 PAYLOAD_TOO_LARGE and none of the events is applied
    And a body that is not a valid batch envelope returns 400 VALIDATION_FAILED

AC-SYN-06  A delivery after a deferral conflicts
  Given Aniqa's phone is offline from 04:30:00
    And at 04:40:00 dispatcher Tihara Egodage defers stop C of REF-07 trip 1 from 19a, so the stop is CANCELLED and its order DEFERRED
    And at 04:45:00 device time Aniqa records DELIVERED at stop C, carrying the stop version she last saw
  When the phone syncs at 05:10:00
  Then that event's result is conflict
    And one sync_conflicts row is OPEN with kind DELIVERED_AFTER_DEFERRAL, the device record with its device time, and the server record with who deferred the stop and when
    And the stop event is stored with appliedAt null, the stop stays CANCELLED and the order stays DEFERRED
    And one outbox event sync.conflict_detected and one log line sync.conflict.detected with the kind exist
    And the alerts module holds one OPEN SYNC_CONFLICT alert, and D6 keeps the record marked

AC-SYN-07  Moved and cancelled stops conflict too
  Given while Aniqa's phone was offline, stop D of REF-07 trip 1 moved to another trip and stop E was cancelled
  When her DELIVERED events for D and E sync
  Then both results are conflict, with kind STOP_REASSIGNED for D and STOP_CANCELLED for E
    And neither stop's status changes

AC-SYN-08  Keep device stands the delivery
  Given the OPEN conflict from AC-SYN-06 and its SYNC_CONFLICT alert
    And GET /sync-conflicts?filter[status]=OPEN as Tihara lists it with a resolve link
  When Tihara calls POST /sync-conflicts/{id}/resolve from 19c with KEEP_DEVICE and a reason code
  Then the response is 200 with status RESOLVED, resolution KEEP_DEVICE, resolvedById set to Tihara and resolvedAt set
    And the deferral is REVERSED, stop C is DELIVERED and its order is DELIVERED
    And the stop event now has appliedAt set
    And exactly one audit row sync.conflict.resolved with the reason code and one outbox event sync.conflict_resolved exist
    And the SYNC_CONFLICT alert resolves itself
    And the conflict carries no resolve link and no longer appears under filter[status]=OPEN

AC-SYN-09  Keep server supersedes the event
  Given an OPEN DELIVERED_AFTER_DEFERRAL conflict on stop C of REF-07 trip 1
  When Tihara resolves it from 19c with KEEP_SERVER and a reason code
  Then the response is 200 with status RESOLVED and resolution KEEP_SERVER
    And the stop event has supersededAt set, the stop stays CANCELLED and the order stays DEFERRED
    And the outbox event sync.conflict_resolved is routed to Aniqa, so her phone learns of it

AC-SYN-10  Resolving needs a reason and an open conflict
  Given one OPEN and one RESOLVED conflict on Peliyagoda trips
  When Tihara resolves the OPEN one without a reason code, and the RESOLVED one with KEEP_DEVICE and a reason code
  Then the first returns 400 VALIDATION_FAILED on reasonCode with "A reason is required", and the conflict stays OPEN
    And the second returns 409 CONFLICT_STATE and nothing changes

AC-SYN-11  Only dispatchers in scope see conflicts
  Given an OPEN conflict on a Peliyagoda (PLG) trip
  When store manager Nimesha Periyapperuma, driver Aniqa, the admin, and a dispatcher scoped to Kandy (KDY) call GET /sync-conflicts and POST /sync-conflicts/{id}/resolve
  Then Nimesha, Aniqa and the admin get 403 FORBIDDEN
    And the Kandy dispatcher's list holds no such row, and her resolve returns 404 NOT_FOUND
    And the conflict stays OPEN

AC-SYN-12  The changes feed covers the device's trips
  Given Aniqa's phone last pulled GET /sync/changes at 04:30:00 and holds cursor c1
    And since then Tihara re-sequenced REF-07 trip 1, deferred one of its stops, and reassigned Dinushi Rathnayake's DRY-31 trip 1
  When Aniqa's phone calls GET /sync/changes?since=c1
  Then the response is 200 with the re-sequence and the deferred stop for REF-07 trip 1
    And nothing about DRY-31 trip 1
    And meta.page carries nextCursor and hasMore
    And the same call with a tampered cursor returns 400 VALIDATION_FAILED

AC-SYN-13  Loader events ride the same endpoint
  Given loader Harini De Mel on the Peliyagoda dock tablet has three load-line checks and one flag in the outbox
  When the tablet calls POST /sync with the four events
  Then all four results are applied, recorded by loading with their clientUuids
    And sending them again returns duplicate for each and adds no row
    And dispatcher Tihara calling POST /sync gets 403 FORBIDDEN

AC-SYN-14  A 401 pauses sync and loses nothing
  Given Aniqa's phone is offline with 3 unsent events, and D6 shows "3 records waiting to send" and the last sync time
    And her session has expired
  When the phone reconnects and POST /sync returns 401 UNAUTHENTICATED
  Then sync pauses, the app shows "Sign in to send 3 records", and the outbox still holds all 3
    And after Aniqa signs back in, the 3 records sync and leave the outbox
    And D13 Sign out waits until the outbox is empty and offers no discard

AC-SYN-15  Sync retries back off
  Given Aniqa's phone has pending events and POST /sync answers 503 DEPENDENCY_UNAVAILABLE
  When the sync engine keeps retrying
  Then the waits between tries are 2, 5, 15 and 30 seconds, then 60 seconds each
    And the outbox keeps every pending event until one push succeeds
```

## Non-functional
- A batch holds at most 100 events and never fails as a whole because of one item.
- Each event applies in its own savepoint, in deviceSeq order per device.
- A replay with the same clientUuid never adds a second row anywhere, including the audit trail.
- The device time is kept; an event received more than 5 minutes late is flagged, never reordered.
- The sync protocol carries `x-sync-version: 1`, so a later Flutter client uses the same endpoints.
- `sync_events_total` and `sync_lag_seconds` show offline health on the Grafana board.
- The outbox survives sign-out attempts, 401s and restarts; storage is requested as persistent.

## Open questions
- KEEP_DEVICE needs stop CANCELLED → DELIVERED and order DEFERRED → DELIVERED, which the drawn state
  machines do not have. Which transitions are added? (Aniqa, with Tihara and Harini)
- Sync may import only core, execution and loading. How does KEEP_DEVICE reverse a planning deferral:
  through an export in execution, an event, or planning's `DeferralService`? (Aniqa, with Tihara)
- Does a stale baseVersion alone make a conflict, or only a state that makes the event impossible? (Aniqa)
- How does KEEP_SERVER tell the driver? This spec assumes the `sync.conflict_resolved` event is routed to
  her user id. (Aniqa)
- `GET /sync/changes` takes `since=`, while Step 4's cursor feeds take `cursor=`. Which name, and which
  permission backs "field roles"? (Aniqa)
- stop_events has no column for the raw deviceTime the client sends beside occurredAt. Store it in the
  payload? The doc also gives no data fields for the `sync.*` events. (Aniqa)

## Changelog
- 2026-10-04 changes feed and offline client (ROO-44, second slice): `GET /sync/changes?since=&limit=` built
  (`ChangesFeed`, `ChangesScope`, `changes-cursor.ts`): outbox rows of `plan.revised`, `trip.reassigned`,
  `trip.resequenced`, `trip.cancelled`, `stop.deferred` and `load.flag_decided` whose `tripId` (or `tripIds`)
  is a trip in the caller's scope (a driver's own; a loader's depot, today and tomorrow), oldest first, paged by
  a (time to the millisecond, id) cursor; a tampered cursor is 400 VALIDATION_FAILED on `since`; a role without
  `stop:record` or `load:check` is 403. `meta.page.nextCursor` is the position of the last change returned,
  whether or not more follow (null only when nothing is newer than `since`), so a caught-up device keeps a place
  to resume; the query parameter stays `since` as the criterion says. The PWA's sync engine is now started by the
  driver and dock shells (`useSyncEngine`: mount, `online`, foreground, every 30 s). A 401 no longer charges the
  rows a backoff (they would have waited 2 s after sign-in), stores `syncPaused` so D6 reads "Sign in to send 3
  records", and `resume()` runs when the session answers again. D6's banner is `DriverOfflineBanner`. AC-SYN-04
  (e2e), 12 (e2e), 14 and 15 (Vitest) pass. Not yet: the client's pull of the feed into Dexie, metrics, and
  06 to 11 (ROO-45)
- 2026-10-04 `POST /sync` built (ROO-44, first slice): `SyncService` checks the envelope (400), refuses a batch
  over 100 events (413), answers 403 to a role with neither `stop:record` nor `load:check`, sorts by deviceSeq,
  applies each event in its own savepoint through execution's `StopEventService.apply` or loading's
  `LoaderEventService.apply`, maps a 409 or 412 to `conflict` and other refusals to `rejected`, and writes one
  `sync_batches` row, one `sync.batch_applied` event and one log line with counts. The wire contract is
  `syncEventSchema` in `packages/shared/src/schemas/sync.ts` (a union of driver and loader events; it replaces
  the stop-only `stopEventSchema`); the PWA's `postSync` reads the envelope. AC-SYN-01, 02, 03, 05 and 13 have
  e2e tests. Not yet: conflict rows and 19c (06 to 11), the changes feed (12), metrics; a conflicting event is
  reported to the device and left unapplied
- 2026-09-30 created from the Build Spec

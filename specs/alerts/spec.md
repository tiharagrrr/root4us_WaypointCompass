---
module: alerts
owner: Harini
status: draft          # draft | ready | in-progress | done
screens: ["01", "19", "19a"]
depends-on: []   # core only; alerts learns about other modules from their events
---

# Alerts

## Purpose
Alerts turn problems from every module into one short list for the dispatcher, each pointing at the
action that fixes it. They never block an action, and they close themselves when the fix happens.

## Scope
In: the alert catalog; AlertRules, which maps events to alerts with dedupe keys; raising as an
upsert on the open alert for a key; acknowledge; manual resolve; auto-resolve; fix links; the list
and detail endpoints behind the exception panel on 01 and the alerts column on 19 and 19a.

Out:
- The fixes themselves: planning (reassign on 20, re-sequence on 19b, stop deferral, redelivery,
  deferrals), loading (the flag decision on L3b), receipt (issues), sync (conflict resolution on 19c
  and /sync-conflicts).
- Push and in-app delivery: notifications. SSE delivery: realtime.
- A broken audit chain: not an alert; admins get a critical notification (audit, notifications).
- Grafana alert rules: observability.
- The layout of 01 (Nimesha) and of 19 and 19a (Aniqa); alerts supplies their alert data.

Screens (desktop 1440 x 960):

| Frame | Node | Route | Data |
| --- | --- | --- | --- |
| 01 Dashboard | 488:8577 | /dispatch | Exception panel with each alert's fix link: GET /alerts |
| 19 Tracking | 185:17224 | /dispatch/tracking | Alerts column: GET /alerts |
| 19a Trip details | 464:1966 | /dispatch/trips/:id | The trip's alerts: GET /alerts?filter[tripId]= |

## Model
Schema file apps/backend/src/db/schema/receipt.ts: Step 1 puts the alerts table there, and only the
alerts module writes it.

Alert (alerts):

| Column | Notes |
| --- | --- |
| id | UUIDv7 |
| type | alert_type: LATE_RISK, FAILED_STOP, LOADER_SHORTFALL, STORE_ISSUE, DRIVER_CANT_RUN, VEHICLE_OFFLINE, PRIORITY_REQUEST, SYNC_CONFLICT |
| status | alert_status: OPEN, ACKNOWLEDGED, RESOLVED (default OPEN) |
| severity | 1 critical, 2 warning, 3 info (default 2) |
| depotId | required |
| planId, tripId, stopId, orderId, outletId | what it is about, by id with no foreign keys |
| title, detail | detail is jsonb; a repeat raise updates it |
| dedupeKey | for example "LATE_RISK:stop:<id>"; one OPEN alert per key |
| raisedById | the person who reported it (driver, loader or store); null when a rule raised it |
| raisedAt | defaults to now |
| acknowledgedById, acknowledgedAt | |
| resolvedById, resolvedAt, resolution | resolvedById stays empty on auto-resolve; resolution holds the manual note |

Indexes alerts_depot_status_idx on (depotId, status, raisedAt) and alerts_dedupe_idx on
(dedupeKey, status).

Invariants:
- There is one open alert per dedupe key; raising it again updates its detail instead of adding a
  row.
- Machine: OPEN → ACKNOWLEDGED → RESOLVED. An alert resolves itself when the action it asked for
  happens.
- Alerts never block an action. They point at the fix and close themselves when it happens.
- A fix link appears only if the viewer may take that action (the Step 4 affordance rule).
- Alerts have no version column; acknowledge and resolve take no If-Match.

Alert catalog:

| Alert | Raised by | Severity | Resolves itself when | Fix link | Dedupe key |
| --- | --- | --- | --- | --- | --- |
| LATE_RISK | eta.updated at or above tracking.lateRiskThreshold (0.5) | 2 | The ETA is back inside the window, or the stop is done or deferred | Re-sequence (19b), defer the stop | LATE_RISK:stop:<id> (doc) |
| FAILED_STOP | stop.failed | 2 | A redelivery is planned or a deferral confirmed | Plan redelivery, defer | FAILED_STOP:stop:<id> (proposed) |
| LOADER_SHORTFALL | load.flag_raised | 1 if the wave leaves within 30 minutes, else 2 | The flag is decided | Decide the flag (L3b) | LOADER_SHORTFALL:load_flag:<id> (proposed) |
| STORE_ISSUE | issue.reported | 2 for temperature, else 3 | The issue is resolved | Open the issue | STORE_ISSUE:issue:<id> (proposed) |
| DRIVER_CANT_RUN | trip.cant_run | 1 | The trip is reassigned or cancelled | Reassign (20) | DRIVER_CANT_RUN:trip:<id> (proposed) |
| VEHICLE_OFFLINE | vehicle.offline | 2 | vehicle.back_online | Trip details, call the driver | VEHICLE_OFFLINE:trip:<id> (proposed) |
| PRIORITY_REQUEST | deferral.store_responded with a priority request | 2 | The order is planned or the dispatcher replies | Open the deferral, plan it | PRIORITY_REQUEST:deferral:<id> (proposed) |
| SYNC_CONFLICT | sync.conflict_detected | 1 | The conflict is resolved | Resolve (19c) | SYNC_CONFLICT:sync_conflict:<id> (proposed) |

Late risk is 1 / (1 + exp((slack − 10) / 5)) on the minutes of slack before the window closes
(Step 6), so 10 minutes of slack reads 0.5, the threshold; 5 minutes reads 0.73, 0 reads 0.88,
−5 reads 0.95, −10 reads 0.98 and 15 reads 0.27.

## Endpoints
| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| GET | /alerts | alert:read | 01 and 19: filter by type, status, severity, trip; open first, then severity; offset pages |
| GET | /alerts/{id} | alert:read | With a link to the fix |
| POST | /alerts/{id}/acknowledge | alert:act | "I'm on it"; visible to other dispatchers |
| POST | /alerts/{id}/resolve | alert:act | Manual resolve with a note |

Links: acknowledge and resolve follow the state machine and alert:act; fix links come from
AlertLinks and point at the fixing endpoint, for example POST /trips/{id}/reassign,
POST /trips/{id}/resequence, POST /trips/{id}/stops/{stopId}/defer, POST /load-flags/{id}/decision,
GET /issues/{id}, GET /deferrals/{id}, GET /trips/{id}/tracking and
POST /sync-conflicts/{id}/resolve.

## Services and helpers
Module folder apps/backend/src/modules/alerts.

- **AlertRules** maps each event to an alert with a dedupe key such as `LATE_RISK:stop:<id>`.
- **AlertsService**: raise (an upsert on the open alert for that key), acknowledge, resolve,
  auto-resolve.
- **AlertQueries**: list and detail through the dispatcher ScopePolicy.
- **AlertLinks** follows the Step 4 affordance rule, so a fix link appears only if the viewer may
  take that action.
- Listeners run in the worker on the outbox relay's in-process events. Delivery is at least once,
  so each listener dedupes by event id before it raises or resolves.
- No jobs and no exported lifecycle service.

## Events
Emits:

| Event | Consumed by | Payload |
| --- | --- | --- |
| alert.raised, alert.acknowledged, alert.resolved | realtime, notifications (severity 1 pushes to dispatchers) | v: 1, ids, type and severity (fields not given) |

The web invalidates its alerts queries on alert.raised and alert.resolved.

Consumes every event in the catalog, to raise: eta.updated, stop.failed, load.flag_raised,
issue.reported, trip.cant_run, vehicle.offline, deferral.store_responded, sync.conflict_detected.
And to resolve: eta.updated, stop.completed, stop.failed and stop.deferred for the stop,
deferral.confirmed, load.flag_decided, issue.resolved, trip.reassigned, trip.cancelled,
vehicle.back_online, sync.conflict_resolved, and the events that plan an order or carry the
dispatcher's reply (see Open questions).

Audit actions (proposed names; the doc gives only the log names):

| Action | When |
| --- | --- |
| alerts.alert.raised | a new alert row is created |
| alerts.alert.acknowledged | a dispatcher acknowledges |
| alerts.alert.resolved | a dispatcher resolves with a note |
| alerts.alert.auto_resolved | the fix happened |

## Log events
- `alerts.alert.raised` (type, severity)
- `alerts.alert.auto_resolved` (type, minutes open)

## Permissions
| Permission | Held by | Used for |
| --- | --- | --- |
| alert:read | dispatcher | list and detail |
| alert:act | dispatcher | acknowledge and resolve (also guards /sync-conflicts in sync) |

Admin, loader, driver and store manager hold neither and get 403. Scope: depotId =
actor.depotId, or all depots when none is set. Out of scope answers 404.

## Acceptance criteria
- [ ] AC-ALR-01  Every catalog event raises its alert
- [ ] AC-ALR-02  Late risk dedupes per stop
- [ ] AC-ALR-03  Late risk clears itself
- [ ] AC-ALR-04  Can't run clears on reassign
- [ ] AC-ALR-05  Loader shortfall severity follows departure
- [ ] AC-ALR-06  Store issue severity and clearing
- [ ] AC-ALR-07  Fix links follow the affordance rule
- [ ] AC-ALR-08  Acknowledge and resolve by hand
- [ ] AC-ALR-09  The list, its order and access
- [ ] AC-ALR-10  Replays dedupe; a new episode opens a new alert
- [ ] AC-ALR-11  Alerts never block the fix
- [ ] AC-ALR-12  A broken audit chain is not an alert

```gherkin
AC-ALR-01  Every catalog event raises its alert
  Given Tihara Egodage is a dispatcher for all depots and no alert is open at Peliyagoda
  When <event> arrives for a Peliyagoda record
  Then exactly one OPEN alert of type <alert> exists with severity <severity>, depotId PLG and the
      dedupe key from the catalog
    And alert.raised is emitted once and alerts.alert.raised is logged with type and severity
  Examples:
    | event                                                       | alert            | severity |
    | eta.updated with 5 minutes of slack (late risk 0.73)        | LATE_RISK        | 2        |
    | stop.failed                                                 | FAILED_STOP      | 2        |
    | load.flag_raised on a trip leaving in 45 minutes            | LOADER_SHORTFALL | 2        |
    | issue.reported with type DAMAGED                            | STORE_ISSUE      | 3        |
    | issue.reported with type TEMPERATURE                        | STORE_ISSUE      | 2        |
    | trip.cant_run                                               | DRIVER_CANT_RUN  | 1        |
    | vehicle.offline                                             | VEHICLE_OFFLINE  | 2        |
    | deferral.store_responded with a priority request            | PRIORITY_REQUEST | 2        |
    | sync.conflict_detected                                      | SYNC_CONFLICT    | 1        |

AC-ALR-02  Late risk dedupes per stop
  Given the sixth stop of REF-07 trip 1 on 2026-10-02 has no alert
  When eta.updated at 07:30 Asia/Colombo reports 5 minutes past the window's close (late risk 0.95)
    And eta.updated at 07:36 reports 10 minutes past it (late risk 0.98)
  Then exactly one alerts row with dedupeKey LATE_RISK:stop:<that stop's id> exists, OPEN with
      severity 2
    And its detail holds the later update, late risk 0.98
  When eta.updated reports 15 minutes of slack (late risk 0.27) for a stop with no alert
  Then no alert is raised for that stop

AC-ALR-03  Late risk clears itself
  Given the OPEN LATE_RISK alert from AC-ALR-02, raised at 2026-10-02 07:30
  When eta.updated at 07:42 puts the ETA 15 minutes inside the window (late risk 0.27)
  Then the alert is RESOLVED with resolvedAt 2026-10-02T07:42:00+05:30 and no resolvedById
    And alert.resolved is emitted and alerts.alert.auto_resolved is logged with type LATE_RISK and
      12 minutes open
    And the alert carries no acknowledge, resolve or fix link

AC-ALR-04  Can't run clears on reassign
  Given DRY-31 trip 1 on 2026-10-02 is RELEASED with Dinushi Rathnayake driving
  When she reports CANT_RUN with reason breakdown at 05:05 Asia/Colombo and trip.cant_run arrives
  Then an OPEN DRIVER_CANT_RUN alert with severity 1 exists for the trip
    And Peliyagoda's dispatchers get a push
    And Tihara's view of the alert carries a fix link to POST /trips/{id}/reassign
  When Tihara reassigns the trip at 05:20 and trip.reassigned arrives
  Then the alert is RESOLVED with resolvedAt 2026-10-02T05:20:00+05:30 and no resolvedById
    And alert.resolved is emitted and alerts.alert.auto_resolved is logged with type
      DRIVER_CANT_RUN and 15 minutes open

AC-ALR-05  Loader shortfall severity follows departure
  Given DRY-31 trip 1 is planned to leave at 2026-10-02 05:15 and another Peliyagoda trip at 06:00
    And the demo clock reads 2026-10-02 04:50 Asia/Colombo
  When Harini De Mel raises a MISSING flag on DRY-31 trip 1 (25 minutes before it leaves)
  Then its LOADER_SHORTFALL alert has severity 1 and Peliyagoda's dispatchers get a push
  When she raises a flag on the 06:00 trip (70 minutes before it leaves)
  Then that trip's LOADER_SHORTFALL alert has severity 2
  When Tihara decides the first flag REPLACE at 04:55 and load.flag_decided arrives
  Then the first alert is RESOLVED with no resolvedById and the second stays OPEN

AC-ALR-06  Store issue severity and clearing
  Given Nimesha Periyapperuma reports a TEMPERATURE issue and a DAMAGED issue for Fresh Kadawatha
  Then the TEMPERATURE issue's STORE_ISSUE alert has severity 2 and the DAMAGED one severity 3
    And each carries a fix link to GET /issues/{id} for its issue
  When Tihara resolves the DAMAGED issue and issue.resolved arrives
  Then the DAMAGED issue's alert is RESOLVED with no resolvedById
    And the TEMPERATURE issue's alert stays OPEN

AC-ALR-07  Fix links follow the affordance rule
  Given an OPEN LOADER_SHORTFALL alert for a flag on a Peliyagoda trip
  When Tihara (dispatcher, all depots, holding load:decide) requests GET /alerts/{id}
  Then the response is 200 and _links include self, acknowledge, resolve and a fix link to
      POST /load-flags/{flagId}/decision
  When a dispatcher scoped to Kandy requests GET /alerts/{id}
  Then the response is 404 NOT_FOUND and GET /alerts does not list it
  When AlertLinks renders the alert for an actor without load:decide
  Then it has no fix link, and its other links are unchanged
  When the flag has been decided
  Then the alert is RESOLVED and carries no fix, acknowledge or resolve link

AC-ALR-08  Acknowledge and resolve by hand
  Given an OPEN VEHICLE_OFFLINE alert for DRY-31 raised at 2026-10-02 05:40
  When Tihara acknowledges it at 05:45 Asia/Colombo
  Then the response is 200 with status ACKNOWLEDGED, acknowledgedById Tihara's id and
      acknowledgedAt 2026-10-02T05:45:00+05:30
    And alert.acknowledged is emitted, one audit row alerts.alert.acknowledged exists, and another
      Peliyagoda dispatcher's 01 panel shows who is on it without a reload
    And the alert carries resolve and no acknowledge link
  When she acknowledges it again
  Then the response is 409 CONFLICT_STATE
  When she resolves it with no note
  Then the response is 400 VALIDATION_FAILED on note
  When she resolves it with the note "Driver reached by phone"
  Then the response is 200 with status RESOLVED, resolution "Driver reached by phone" and
      resolvedById Tihara's id
    And alert.resolved is emitted and the alert carries no acknowledge or resolve link
  When she resolves it again
  Then the response is 409 CONFLICT_STATE

AC-ALR-09  The list, its order and access
  Given Peliyagoda alerts A (OPEN, severity 3, raised 04:00), B (OPEN, severity 1, raised 05:00)
      and C (RESOLVED, severity 1, raised 03:00) on 2026-10-02
  When Tihara requests GET /alerts
  Then data is B, A, C and meta.page is { limit 10, offset 0, total 3 }
  When she requests GET /alerts?filter[status]=OPEN&filter[severity]=1
  Then data is B only and meta.page.total is 1
  When she requests GET /alerts?filter[outletId]=<an outlet id>
  Then the response is 400 VALIDATION_FAILED naming filter[outletId]
  When Harini De Mel (loader), Nimesha Periyapperuma (store manager), Aniqa Razick (driver) or
      Rusiru Withanage (admin) requests GET /alerts
  Then each gets 403 FORBIDDEN

AC-ALR-10  Replays dedupe; a new episode opens a new alert
  Given stop.failed event E for a Peliyagoda stop has raised one FAILED_STOP alert
  When the relay delivers E again
  Then there is still exactly one FAILED_STOP alert for that stop and alert.raised is not emitted
      again
  Given a VEHICLE_OFFLINE alert for DRY-31 raised at 2026-10-02 05:22
  When vehicle.back_online arrives at 05:52
  Then the alert is RESOLVED with no resolvedById and alerts.alert.auto_resolved is logged with
      30 minutes open
  When vehicle.offline arrives again for DRY-31's trip at 06:40
  Then a new OPEN VEHICLE_OFFLINE row exists and the resolved row is unchanged

AC-ALR-11  Alerts never block the fix
  Given an OPEN LATE_RISK alert on the sixth stop of REF-07 trip 1
  When Aniqa Razick's DELIVERED event for that stop syncs at 2026-10-02 07:58
  Then the sync result is applied and stop.completed is emitted
    And the alert is RESOLVED with no resolvedById

AC-ALR-12  A broken audit chain is not an alert
  Given the audit chain verify job finds a mismatch
  When the job finishes
  Then no alerts row is created
    And admins get a critical notification instead
```

## Non-functional
- Nothing polls: 01, 19 and 19a stay live over SSE, and alert.raised and alert.resolved invalidate
  the alerts queries.
- Severity 1 alerts push to the depot's dispatchers.
- Listeners are idempotent: at-least-once delivery never adds a second row or a second event.
- Severity shows as text as well as colour on 01, 19 and 19a (status never by colour alone).
- 01 and 19 are on the judge path.

## Open questions
- Dedupe keys: the doc gives only LATE_RISK:stop:<id>; the other keys in the catalog table are
  proposed. VEHICLE_OFFLINE per trip or per vehicle? (Harini)
- Does ACKNOWLEDGED count as open for the one-per-key rule and the list's open-first order, and may
  a dispatcher resolve straight from OPEN? (Harini)
- LATE_RISK clears when "the ETA is back inside the window", but it is raised at late risk 0.5,
  which is 10 minutes of slack, still inside the window. Clear it when late risk drops below the
  threshold instead? The criteria use values that satisfy both readings. (Harini, Aniqa)
- LOADER_SHORTFALL: does "the wave leaves" mean the trip's plannedDepartAt or the depot wave's
  start, is exactly 30 minutes severity 1, and does an undone flag clear the alert? (Harini)
- Resolve triggers with no named event: FAILED_STOP's "redelivery is planned" and
  PRIORITY_REQUEST's "the dispatcher replies" (a deferral comment?). Also, vehicle.offline and
  vehicle.back_online are missing from the boundaries table's consumes list. (Harini, Tihara)
- Relation names for fix links, and whether a repeat raise re-emits alert.raised so 01 refreshes.
  (Harini, Nimesha)
- Step 2 says the chain verify job "raises an alert"; the module tab says a broken chain is not an
  alert. These criteria follow the module tab. (Nimesha)
- Dates: the doc's examples call 1 Oct 2026 a Wednesday, but 30 Sep is the Wednesday. These
  criteria use ISO dates without weekdays. (Nimesha)

## Changelog
- 2026-09-30 created from the Build Spec
- 2026-09-30 Model: `alerts.raisedById` (merged from the Supabase draft's reported_by)

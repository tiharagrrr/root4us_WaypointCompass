---
module: fleet
owner: Tihara
status: draft          # draft | ready | in-progress | done
screens: [A5, "06", "09"]
depends-on: [audit, master-data]   # core is implied
---

# Fleet

## Purpose
Fleet keeps the vehicles, their status and the weekly fuel ledger. Planning reads them to build
trips, and a breakdown reaches planning as an event so the dispatcher can repair the plan.

## Scope
In:
- Vehicles: list, read and edit (A5, and the vehicle cards on 06 and 09).
- Vehicle status ACTIVE, WORKSHOP or BREAKDOWN, always with a reason.
- The weekly fuel ledger: planned entries on publish, reversals on revision, actuals at close; the
  weekly view of quota, planned, actual and left.
- The low-quota event.

Out:
- Which vehicle runs which trip, vehicle options on 06 and repair runs: planning.
- The `FUEL_WEEKLY` and `VEHICLE_AVAILABLE` rules and the km and litres per trip
  (`time/fuel.ts`): `packages/engine`, see `specs/engine/rules.md`.
- Positions, pings and the offline alert: execution. Alerts, including the repair suggestion: alerts.
- Loading `vehicles.csv` and the S1 fleet status at seed time: the seed (master data and seed,
  Harini).
- Weekly fleet capacity for 22: forecasting.

## Model
Schema file: `apps/backend/src/db/schema/fleet.ts` (owner Tihara).

| Table | Key columns | Invariants |
| --- | --- | --- |
| `vehicles` | `id` (natural key, e.g. `VEH001`), `code` (e.g. `REF-07`, `DRY-31`, `VAN-03`), `registrationNo` (synthetic), `type` (TRUCK, VAN), `temp` (AMBIENT, REEFER), `weightCapKg`, `volumeCapM3`, `fuelType`, `kmPerL`, `weeklyFuelQuotaL`, `depotId`, `status` (ACTIVE, WORKSHOP, BREAKDOWN; default ACTIVE), `statusReason`, `statusChangedAt`, `version` | `code` and `registrationNo` unique. Unique `(id, depotId)` is the target of the trips' composite key, so a vehicle serves only its home depot. Check: `weightCapKg`, `volumeCapM3` and `kmPerL` are above 0. Index `(depotId, status)` |
| `fuel_ledger_entries` | `vehicleId`, `tripId` (optional), `isoYear`, `isoWeek`, `date`, `kind` (PLANNED, ACTUAL, ADJUSTMENT), `km`, `litres`, `note`, `createdAt` | `litres` is negative for reversals, so a correction is a new entry, never an edit. Index `(vehicleId, isoYear, isoWeek)` |

Other invariants:
- `vehicles` carries `version`; writes need `If-Match` (Step 4).
- Planned fuel is km divided by km per litre, written at publish; the weekly quota is a hard rule.
- The engine sees `available: false` with `unavailableReason` WORKSHOP or BREAKDOWN for any vehicle
  not ACTIVE, and `fuelUsedThisWeek` (litres planned or used this ISO week) from the ledger.

## Endpoints
Paths omit `/api/v1`. Vehicles use offset pages (default limit 10, max 100).

| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| GET | `/vehicles`, `/vehicles/{id}` | `masterData:read` | A5 |
| PATCH | `/vehicles/{id}` | `masterData:manage` | A5; JSON merge patch; `If-Match` |
| PUT | `/vehicles/{id}/status` | `masterData:manage` or `plan:revise` | ACTIVE, WORKSHOP or BREAKDOWN with a reason; `If-Match` |
| GET | `/vehicles/{id}/fuel?week=` | `plan:read` | Quota, planned, actual, left (A5 shows this week's fuel against quota) |

## Services and helpers
- `VehiclesService`: vehicle edits (A5), audited.
- `VehicleStatusService`: status changes with a reason; a breakdown emits `vehicle.status_changed`.
- `FuelLedgerService` (exported for planning): planned entries on publish, reversals on revision,
  actuals at close. It runs inside planning's transaction.
- Queries: vehicle list and detail with the dispatcher's depot scope; the weekly fuel summary, and
  the vehicles and `fuelUsedThisWeek` that planning's `PlanContextBuilder` feeds the engine.
- Helpers: `isoWeekOf(date)` from `packages/shared`; km and litres per trip come from the engine
  (`km = 2 × depotToDistrictKm + interStopKm × (n − 1)`, `litres = km ÷ kmPerL`).

## Events
Every payload has `v: 1`; the doc gives no further payload fields for these two.

Emits:

| Event | Consumed by |
| --- | --- |
| `vehicle.status_changed` | planning (offers repair mode), alerts (repair suggestion), realtime |
| `fuel.quota_low` | alerts, realtime |

Consumes: none.

Audit actions: every status change and vehicle edit writes an audit row in the same transaction.
The doc names none; by the naming convention the status change is `fleet.vehicle.status_changed`
(derived, the same as its log event).

## Log events
- `fleet.vehicle.status_changed`

Ids only; no personal data.

## Permissions
From the Step 2 matrix:

| Permission | Roles | Used by |
| --- | --- | --- |
| `masterData:read` | admin, dispatcher, loader, driver, store_manager | `GET /vehicles`, `GET /vehicles/{id}` |
| `masterData:manage` | admin | `PATCH /vehicles/{id}`, `PUT /vehicles/{id}/status` |
| `plan:revise` | dispatcher | `PUT /vehicles/{id}/status` |
| `plan:read` | admin, dispatcher | `GET /vehicles/{id}/fuel` |

Scope: admin sees every depot; a dispatcher sees `depotId = actor.depotId`, or every depot when none
is set. A missing permission is 403; a vehicle out of scope is 404.

## Acceptance criteria
Times are Asia/Colombo. 2026-10-02 falls in ISO week 40 of 2026 (Mon 2026-09-28 to Sun 2026-10-04).
The test vehicle is a hand-built Peliyagoda fixture from `seedMinimal()`, never a dataset row.

```gherkin
AC-FLT-01  Planned fuel counts against the quota
  Given a Peliyagoda test vehicle with weeklyFuelQuotaL 100 and kmPerL 5
    And PLANNED ledger entries for it in ISO week 40 of 2026 totalling 90 L, with no ACTUAL entries
    And the DRAFT plan for PLG on 2026-10-02
  When Tihara posts an edit list adding a trip on it whose planned km is 60 (12 L)
  Then the response is 422 PLAN_RULE_VIOLATION with a FUEL_WEEKLY violation of severity HARD, actual 102 and limit 100
    And the plan is unchanged
    And GET /plans/{id}/vehicle-options shows 10 L of fuel left for the vehicle
    And no engine run places a trip that takes the vehicle past its quota

AC-FLT-02  Publishing writes planned fuel
  Given the test vehicle has no ledger entries in ISO week 40 of 2026
    And the plan for PLG on 2026-10-02 passes every publish check at 2026-10-01T16:05:00+05:30, with one trip on the vehicle whose plannedKm is 60
  When Tihara publishes the plan
  Then the ledger holds exactly one PLANNED entry for that trip with km 60, litres 12, isoYear 2026, isoWeek 40 and date 2026-10-02
    And the trip's plannedFuelL is 12
    And GET /vehicles/{id}/fuel for ISO week 40 of 2026 returns quota 100, planned 12, actual 0 and left 88

AC-FLT-03  A revision reverses planned fuel
  Given the published plan holds the 12 L PLANNED entry for the test vehicle's trip
  When Tihara cancels that trip with a reason
  Then the ledger gains one entry for that trip with litres -12
    And the original 12 L entry is unchanged
    And GET /vehicles/{id}/fuel for ISO week 40 of 2026 returns planned 0 and left 100

AC-FLT-04  Closing the day records actual fuel
  Given every trip on the PLG plan for 2026-10-02 is COMPLETED or CANCELLED
  When Tihara closes the day on 21
  Then each COMPLETED trip has one ACTUAL entry with its vehicleId, tripId, isoYear 2026, isoWeek 40 and date 2026-10-02
    And no CANCELLED trip has an ACTUAL entry
    And GET /vehicles/{id}/fuel for ISO week 40 of 2026 reports those litres as actual

AC-FLT-05  A breakdown takes a vehicle out
  Given REF-07 is ACTIVE at version 3
    And the demo clock reads 2026-10-02T04:40:00+05:30
  When Tihara sets its status to BREAKDOWN with a reason through PUT /vehicles/{id}/status and If-Match W/"3"
  Then the response is 200 with status BREAKDOWN, statusReason set, statusChangedAt 2026-10-02T04:40:00+05:30 and version 4
    And exactly one audit row (before ACTIVE, after BREAKDOWN) and one outbox event vehicle.status_changed exist
    And one log line fleet.vehicle.status_changed is written
    And GET /plans/{id}/vehicle-options shows REF-07 unavailable with reason BREAKDOWN, and no engine run places an order on it
    And the same request without a reason gets 400 VALIDATION_FAILED and changes nothing

AC-FLT-06  Who may change a status
  Given REF-07 is ACTIVE at Peliyagoda
  When each actor below sends PUT /vehicles/{id}/status with a reason and a current If-Match
  Then Rusiru (admin, masterData:manage) and Tihara (dispatcher, plan:revise) each get 200
    And Harini (loader), Aniqa (driver) and Nimesha (store manager) each get 403 FORBIDDEN and the vehicle is unchanged
    And a dispatcher scoped to Kandy gets 404 NOT_FOUND
    And GET /vehicles/{id} carries the status action link for Rusiru and Tihara, and not for Harini, Aniqa or Nimesha

AC-FLT-07  Only admins edit vehicle details
  Given REF-07 is at version 4
  When Rusiru (admin) PATCHes /vehicles/{id} with If-Match W/"4"
  Then the response is 200 with version 5, and one audit row holds the before and after values
    And the same PATCH from Tihara (dispatcher) gets 403 FORBIDDEN
    And a PATCH with If-Match W/"3" gets 412 VERSION_MISMATCH, and one with no If-Match gets 428 PRECONDITION_REQUIRED

AC-FLT-08  Only planners read fuel
  Given the test vehicle with ledger entries in ISO week 40 of 2026
  When each actor below calls GET /vehicles/{id}/fuel for that week
  Then Rusiru (admin) and Tihara (dispatcher) get 200 with quota, planned, actual and left
    And Harini (loader), Aniqa (driver) and Nimesha (store manager) get 403 FORBIDDEN

AC-FLT-09  A low quota raises an event
  Given the test vehicle's week is below the low-quota threshold
  When publishing a plan takes its planned litres for ISO week 40 of 2026 to the threshold
  Then one outbox event fuel.quota_low exists for that vehicle and week
    And alerts and realtime receive it
```

Checklist (tick in the PR that adds the passing test):
- [ ] AC-FLT-01 Planned fuel counts against the quota
- [ ] AC-FLT-02 Publishing writes planned fuel
- [ ] AC-FLT-03 A revision reverses planned fuel
- [ ] AC-FLT-04 Closing the day records actual fuel
- [ ] AC-FLT-05 A breakdown takes a vehicle out
- [ ] AC-FLT-06 Who may change a status
- [ ] AC-FLT-07 Only admins edit vehicle details
- [ ] AC-FLT-08 Only planners read fuel
- [ ] AC-FLT-09 A low quota raises an event

## Non-functional
- Every status change and edit is audited in the same transaction as the write, with its outbox
  event.
- Fuel entries are append-only in practice: corrections are new entries with negative litres.
- A5 at 1440 × 960 with loading, empty and error states; the vehicle cards on 06 and 09 read the same
  data.
- Logs carry ids only.

## Open questions
- AC-FLT-09: the `fuel.quota_low` threshold, its payload, and whether it fires once per vehicle and
  week. Decides: Tihara.
- AC-FLT-03: the `kind` of a reversal entry (PLANNED with negative litres, or ADJUSTMENT), and whether
  a revision also writes new PLANNED entries for the changed trips. Decides: Tihara.
- AC-FLT-04: where actual km and litres come from at close, and whether PLANNED entries still count
  towards "used" once ACTUAL ones exist (the formula for left). Decides: Tihara with Aniqa.
- AC-FLT-02, 08: the format of the `week` query parameter. Decides: Tihara.
- AC-FLT-05, 07: does every status change emit `vehicle.status_changed`, or only BREAKDOWN (the doc
  says "a breakdown emits")? Which audit action and outbox event does a vehicle PATCH write, and which
  fields may it change? Decides: Tihara.

## Changelog
- 2026-09-30 created from the Build Spec

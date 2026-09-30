---
module: forecasting
owner: Tihara
status: draft          # draft | ready | in-progress | done
screens: ["22", "12"]
depends-on: [master-data, ordering]   # core is implied
---

# Forecasting

## Purpose
Forecasting shows the weeks ahead against fleet capacity (22) and gives plan ahead (12, 13) the
expected demand for a date, so the dispatcher can reserve scarce vehicles before orders arrive.

## Scope
In:
- Weekly demand forecasts per depot and brand: a baseline from order history by ISO week with the
  calendar's festival ramp, or the imported Datathon forecast.
- Weekly fleet capacity for the same weeks.
- Expected demand for one date, split by brand, district and class, for plan ahead.
- `GET /depots/{id}/forecasts` for 22 and 12, and `POST /forecasts/import` for the Datathon CSV.

Out:
- Reservations, `reserve()` and filling reserved trips: planning and `packages/engine`.
- Vehicles and their status: fleet. Order history: ordering (read only). The calendar: master-data.
- The chart on 22: web (Recharts), built by Tihara.

## Model
Schema file: `apps/backend/src/db/schema/forecasting.ts` (owner Tihara).

| Table | Key columns | Invariants |
| --- | --- | --- |
| `demand_forecasts` | `id`, `depotId`, `brand` (FRESH, STYLE, TECH), `isoYear`, `isoWeek`, `totalVolumeM3`, `chilledVolumeM3`, `expectedOrders`, `source` (BASELINE, DATATHON), `modelVersion`, `createdAt` | Unique `(depotId, brand, isoYear, isoWeek, source)`. `chilledVolumeM3` is 0 for Style and Tech, as in Task 2A |
| `capacity_plans` | `id`, `depotId`, `isoYear`, `isoWeek`, `vehiclesPlanned`, `driversPlanned`, `note`, `createdById`, `createdAt`, `updatedAt` | Unique `(depotId, isoYear, isoWeek)`: saving a week again is an upsert. Counts are null or >= 0 |

Expected demand by district and class is computed on request, not stored. The fleet's capacity is
computed by `CapacityService`, not stored; `capacity_plans` stores only what a depot plans to field.

## Endpoints
Paths omit `/api/v1`.

| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| GET | `/depots/{id}/forecasts?weeks=10` | `forecast:read` | 22: volume by week against fleet capacity; 12 reads it too |
| POST | `/forecasts/import` | `forecast:manage` | Loads the Datathon forecast CSV |

## Services and helpers
- `ForecastService`: the baseline from history by ISO week with the calendar's festival ramp, or the
  imported Datathon forecast. For plan ahead it gives each brand, district and class its expected
  volume for a date: the weekly forecast split by that district's share over the last 8 same
  weekdays. Planning's `ReservationService` passes these groups to the engine's
  `reserve(input, forecastGroups)`.
- `CapacityService`: weekly fleet capacity per depot.
- Import: each CSV row is validated with drizzle-zod `createInsertSchema(demandForecasts)` before
  insert, so a bad row names its column instead of failing in Postgres. Column names are in
  `specs/data/datasets.md`; agents never open `data/seed/`.
- Helpers: `isoWeekOf(date)` from `packages/shared`.

## Events
Emits:

| Event | Payload | Consumed by |
| --- | --- | --- |
| `forecast.updated` | `v: 1`; no other fields given | realtime (22) |

Consumes: none.

Audit: the import is a state change, so it is audited in its transaction (see Open questions: the
boundaries table does not let forecasting import audit). No action name is given.

## Log events
None are named in the doc (see Open questions).

## Permissions
From the Step 2 matrix:

| Permission | Roles | Used by |
| --- | --- | --- |
| `forecast:read` | admin, dispatcher | `GET /depots/{id}/forecasts` |
| `forecast:manage` | admin | `POST /forecasts/import` |

Scope: admin sees every depot; a dispatcher sees `depotId = actor.depotId`, or every depot when none
is set. A missing permission is 403; a depot out of scope is 404.

## Acceptance criteria
Times are Asia/Colombo. Forecast and history rows in tests are hand-built fixtures, never dataset
rows.

```gherkin
AC-FC-01  Ten weeks against capacity
  Given Tihara, a dispatcher, and the demo clock at 2026-10-01T10:00:00+05:30
    And PLG has forecast rows for ten consecutive ISO weeks, one of which exceeds that week's fleet capacity
  When she opens 22, which calls GET /depots/PLG/forecasts?weeks=10
  Then the response is 200 with exactly ten weeks in ISO week order, each with its forecast volume (total and chilled) and the fleet capacity for that week
    And the week whose volume exceeds capacity is flagged over capacity, and no other week is
    And 22 draws the ten weeks against capacity as frame 22 shows

AC-FC-02  Importing the Datathon forecast
  Given Rusiru, an admin, and a Datathon forecast CSV whose columns match specs/data/datasets.md
  When he posts it to /forecasts/import
  Then demand_forecasts holds one row per depot, brand and ISO week in the file, with source DATATHON and the file's modelVersion
    And chilledVolumeM3 is 0 on every Style and Tech row
    And exactly one outbox event forecast.updated exists, and 22 open in Tihara's browser refreshes without a reload
    And the import is audited in the same transaction

AC-FC-03  A bad import row is named
  Given a Datathon forecast CSV where one row's total volume is not a number
  When Rusiru posts it to /forecasts/import
  Then the response is 400 VALIDATION_FAILED with an errors[] entry naming that row and its column
    And no forecast.updated event exists

AC-FC-04  The baseline comes from history
  Given PLG has no DATATHON rows and hand-built closed history covering several ISO weeks
  When ForecastService builds the forecast for the coming weeks
  Then the rows it serves have source BASELINE and come from history by ISO week with the calendar's festival ramp applied
    And GET /depots/PLG/forecasts?weeks=10 returns them

AC-FC-05  Expected demand for plan ahead
  Given a PLG forecast for the ISO week holding 2026-10-03 and hand-built history for the last 8 Saturdays
  When planning asks ForecastService for expected demand on 2026-10-03
  Then it returns one group per brand, district and class, each with the weekly forecast split by that district's share over those 8 Saturdays
    And no CHILLED group exists for Style or Tech
    And 13 shows expected against confirmed volume for each group while orders keep arriving

AC-FC-06  Permissions and scope hold
  Given forecast rows for PLG
  When each actor below calls the forecasting endpoints
  Then Rusiru (admin) gets 200 on GET /depots/PLG/forecasts?weeks=10
    And Tihara (dispatcher) gets 200 on the GET and 403 FORBIDDEN on POST /forecasts/import
    And Nimesha (store manager), Harini (loader) and Aniqa (driver) get 403 on the GET
    And a dispatcher scoped to Kandy gets 404 NOT_FOUND on GET /depots/PLG/forecasts
```

Checklist (tick in the PR that adds the passing test):
- [ ] AC-FC-01 Ten weeks against capacity
- [ ] AC-FC-02 Importing the Datathon forecast
- [ ] AC-FC-03 A bad import row is named
- [ ] AC-FC-04 The baseline comes from history
- [ ] AC-FC-05 Expected demand for plan ahead
- [ ] AC-FC-06 Permissions and scope hold

## Non-functional
- The dataset guardrail: the forecast CSV is read by the importer (from `SEED_DATA_DIR` or an admin
  upload), never by an agent; tests use hand-built fixtures.
- 22 at 1440 × 960 with loading, empty and error states; it updates over SSE on `forecast.updated`.
- 12, 13 and 22 sit in the last build tier (Sat 3 Oct in the day plan).

## Open questions
- `capacity_plans` came from the Supabase draft's capacity_plan. Which screen edits it (22?), who may
  (dispatcher, admin), and does 22 compare the forecast with the planned vehicles or with the whole
  active fleet? Decides: Tihara.
- Boundaries: Step 2 lets forecasting import neither audit (the import must be audited) nor fleet
  (capacity needs vehicles), and does not let planning import forecasting (plan ahead needs expected
  demand). Add the imports, or use a read model? Decides: Nimesha with Tihara.
- AC-FC-01: how weekly fleet capacity is defined (unit, which vehicles and statuses count, trips per
  week) and the field that flags a week over capacity. Decides: Tihara.
- AC-FC-01, 04: which ten weeks `weeks=10` covers (from the current ISO week?), and which source
  wins when BASELINE and DATATHON rows exist for the same week. Decides: Tihara.
- AC-FC-02, 03: the import's request format, whether one bad row rejects the whole file, and what
  re-importing an existing week does (replace, or 409 on the unique key). Decides: Tihara.
- AC-FC-04, 05: the festival ramp's shape, and how the weekly forecast becomes a daily figure before
  the district split. No log events or audit action names are given for forecasting. Decides:
  Tihara.

## Changelog
- 2026-09-30 created from the Build Spec
- 2026-09-30 Model: `capacity_plans` for the vehicles and drivers a depot plans per ISO week (merged from the Supabase draft)

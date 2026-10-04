---
module: master-data
owner: Harini
status: in-progress    # draft | ready | in-progress | done
screens: [A3, A4, M9, D9]
depends-on: [core, audit]
---

# Master data

## Purpose
Master data turns the booklet's CSVs into depots, districts, outlets, the calendar and the catalog.
It holds the booklet's reference tables column for column, so the engine, ordering and the driver's
offline bundle all read the same facts, and it gives the admin screens A3 and A4 and the store's
catalog M9 their APIs.

## Scope
In:
- Depots, depot waves (Run 1 and Run 2 departure bands), districts with travel figures, service
  allowances, traffic speeds, road conditions, the calendar, outlets and items.
- Admin edits: outlet windows, dock, parking, receiving contact and access notes (A3); depot docks,
  chilled docks and cutoff override, and waves (A4); the catalog (items, admin only).
- Reads for every role, including the M1a item picker, date pickers and the engine context.
- The reference-data part of the seed and CSV import (`pnpm db:seed`, `apps/backend/src/db/seed.ts`).

Out:
- Vehicles, status and fuel (A5): fleet.
- Users, invitations and the admin screens' shells (A1, A2, A6): identity. A3 and A4 are identity's
  admin screens, but their endpoints and criteria live here.
- The global cutoff setting `ordering.cutoffMin` and other settings (A6): core settings, through
  identity's admin API.
- Orders, templates and the receiving roster, including `/outlets/{id}/receiving-roster`: ordering.
- The D9 Dock and access sheet's data on the phone: execution's offline bundle
  (`GET /trips/{id}/offline-bundle`), which it refreshes on `outlet.updated`.
- Planning rules that use this data (windows, van-only, travel time): packages/engine.

Screens (Figma file `F22bpXWBPLlXkXwA89XHfQ`):

| Frame | Node | Route | Data | Actions and states | Owner |
| --- | --- | --- | --- | --- | --- |
| A3 Outlets | 185:9392 | /admin/outlets | GET, PATCH /outlets | Windows, dock, parking, access notes; outlets without a manager flagged | Nimesha |
| A4 Depots | 185:9769 | /admin/depots | GET, PATCH /depots, /depots/{id}/waves | Docks, chilled docks, cutoff override, run waves | Nimesha |
| M9 Item catalog | 238:825 | /store/catalog | GET /items | 50 Fresh items: 32 dry, 18 chilled | Harini |
| D9 Dock and access | 185:20487 | Sheet on the driver's phone | Outlet access notes and contact from the bundle | Tap to call | Aniqa |

## Model
Schema file: `apps/backend/src/db/schema/master-data.ts` (owner: master-data). Dataset rows keep natural
keys (depots "PLG" and "KDY", outlets "OUT001", district slugs such as "gampaha"). Clock times are
integer minutes after midnight (`windowOpenMin` 330 is 05:30). Dates are business dates, YYYY-MM-DD
in Asia/Colombo.

| Table | Key columns |
| --- | --- |
| `depots` | `id` ("PLG"); `name` (unique); `kind` (depot_kind: CENTRAL, REGIONAL; default CENTRAL, the seed sets KDY to REGIONAL); `address`, `lat`, `lng`; `dockCount` (default 6); `chilledDocks` (default 2); `cutoffMin` (overrides the 16:00 cutoff, 960); `createdAt`, `updatedAt` |
| `depot_waves` | `id`; `depotId` (FK); `label` ("Run 1"); `departFromMin`, `departToMin`; `brands` (brand array) |
| `districts` | `id` (slug); `name` (unique); `province` (not in the dataset, nullable); `depotId` (FK); `roadClass`; `freeFlowKmh`; `depotToDistrictKm`, `depotToDistrictMin`; `interStopKm`, `interStopMin`; `centroidLat`, `centroidLng` (map only, not in the dataset) |
| `service_allowances` | `brand`, `dockType` (primary key); `minutes` (> 0) |
| `traffic_speeds` | `districtId`, `hour`, `monsoon` (primary key); `speedIndex` (100 = free flow) |
| `road_conditions` | `date`, `districtId` (primary key); `disruptionIndex` (100 = clear) |
| `calendar_days` | `date` (primary key); `dow` (0 = Monday, checked 0 to 6); `isWeekend`; `isoYear`, `isoWeek`; `isPayday`; `festival`, `festivalRamp`; `isHoliday`; `monsoon`; `isOperating` |
| `outlets` | `id` ("OUT001"); `name` (generated, "Fresh Kadawatha"); `brand`; `districtId`, `depotId` (FK); `dockType`; `parkingConstraint`; `mallWindowOpenMin`, `mallWindowCloseMin` (nullable); `windowOpenMin`, `windowCloseMin`; `styleDeliveryDow` (Style's weekly delivery day, 0 = Monday); `address`, `lat`, `lng`; `receivingContactName`, `receivingContactPhone`, `accessNotes`, `accessNotesUpdatedAt`, `accessNotesUpdatedById` (D9); `createdAt`, `updatedAt` |
| `items` | `id` (UUIDv7); `sku` (unique); `name`; `brand`; `category`; `tempClass`; `packLabel` ("Tray of 30"); `unitWeightKg`, `unitVolumeM3`; `unitValueLkr` (Tech high-value check); `barcode` (unique); `fragile`; `isAdjustment` (the "mixed cases" line that holds a seeded order's remainder); `active`; `createdAt`, `updatedAt` |

Enums (`apps/backend/src/db/schema/enums.ts`): `brand` FRESH, STYLE, TECH; `temp_class` AMBIENT, CHILLED;
`dock_type` REAR_DOCK, STREET, MALL_BAY; `parking_constraint` NORMAL, VAN_ONLY, MALL_DOCK;
`road_class` URBAN, SUBURBAN, HIGHWAY, HILL.

Enforced by the database:
- `outlets_window_chk`: `windowCloseMin > windowOpenMin`.
- `outlets_mall_window_chk`: both mall window columns are null, or both are set with close after open.
- `outlets_scope_uq` on (id, depotId, brand, districtId): the target of the composite keys on orders
  and stops, so an order or stop can't claim another depot, brand or district.
- `items_size_chk`: `unitWeightKg > 0` and `unitVolumeM3 > 0`.
- `depot_waves_label_uq`: one wave label per depot. Unique `sku`, `barcode`, depot and district names.
- Indexes: `outlets_depot_brand_district_idx`, `items_brand_class_idx` (brand, tempClass, active),
  `calendar_days_iso_week_idx`.

Other rules:
- Master-data tables have no `version` column, so their writes need no If-Match (Step 4 lists
  If-Match for orders, plans, trips, stops and vehicles only).
- No hard deletes of business records: an item leaves the catalog by `active = false`.
- No row-level security policies on these tables; row-level security covers orders, order lines,
  deferrals, receipts and issues.

## Endpoints
Paths omit `/api/v1`. Every list follows `specs/api-conventions.md` (outlets use offset pages:
limit 10 by default, 100 at most). Minutes of the day go out as integers beside a label
(`windowOpenMin: 360, windowOpen: "06:00"`).

| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| GET | `/depots`, `/depots/{id}` | `masterData:read` | A4 |
| PATCH | `/depots/{id}` | `masterData:manage` | Docks, chilled docks, cutoff override |
| GET, POST, PATCH, DELETE | `/depots/{id}/waves` | `masterData:manage` | Run 1 and Run 2 departure bands |
| GET | `/districts` | `masterData:read` | Travel figures, read-only from the dataset |
| GET | `/outlets` | `masterData:read` | A3: filter by brand, district, depot, dock type, parking, has manager |
| GET, PATCH | `/outlets/{id}` | `masterData:read`, `masterData:manage` | Windows, dock, parking, receiving contact, access notes; audited |
| GET | `/items` | `catalog:read` | M9 and the M1a picker (`GET /items?filter[tempClass]=`): filter by brand, class, category; search |
| POST, PATCH | `/items`, `/items/{id}` | `catalog:manage` | Admin only; POST answers 201 with Location |
| GET | `/calendar?from=&to=` | `masterData:read` | Operating days and holidays for date pickers |
| GET | `/service-allowances`, `/traffic-speeds`, `/road-conditions` | `masterData:read` | Reference data for the engine context and admin views |

## Services and helpers
Module folder `apps/backend/src/modules/master-data/`, with the same anatomy as every module (controllers,
dto, services, policies, domain, `__tests__`).

- `OutletsService`, `DepotsService` and `CatalogService` extend `SimpleCrudCommands`
  (`core/persistence/simple-crud.commands.ts`): `create` and `update`, each `@Transactional()`, with
  `audit.record({ action: '<entityType>.created' | '<entityType>.updated', before, after })` and
  `outbox.add('<entityType>.created' | '<entityType>.updated', { v: 1, id })`.
- `CalendarService`: `isOperatingDay(date)`, `nextOperatingDay(date)` (the next date after `date`
  whose row is operating). packages/shared has the same business-time helper, `nextOperatingDay`,
  which falls back to Monday to Saturday when a date has no row.
- `ReferenceQueries`: districts, service allowances, traffic speeds and road conditions.
- Helper listed with the ordering helpers in the Build Spec: `effectiveWindow(outlet)`, the outlet
  window intersected with the mall window (see Open questions for its home).
- Seed and import (`pnpm db:seed`, idempotent, runs on every fresh install). The importers validate
  each row with drizzle-zod's `createInsertSchema(outlets)` (and friends) before inserting, so a bad row
  names its column instead of failing in Postgres. The seed stops with a list of any missing file.

| CSV | Model | Transform |
| --- | --- | --- |
| outlets.csv | Outlet | depot Peliyagoda becomes PLG; enums upper-cased (van_only becomes VAN_ONLY); HH:MM becomes minutes; mall_window "HH:MM-HH:MM" becomes two columns, blank becomes null |
| district_travel.csv | District | depot_to_district_freeflow_min becomes depotToDistrictMin, inter_stop_freeflow_min becomes interStopMin |
| service_allowance.csv | ServiceAllowance | keyed by brand and dock type |
| calendar.csv | CalendarDay | 0 and 1 become booleans |
| traffic_speed.csv, road_conditions.csv | TrafficSpeed, RoadCondition | imported by `src/db/seed/conditions.ts`, which finds the undocumented key columns by name (specs/data/datasets.md) and refills both tables on every seed |

Generated by the seed: outlet names as "Brand Town" from a fixed town list per district, chosen
deterministically by outlet id; map coordinates as the district centroid plus a deterministic offset;
the catalog (Fresh 50 items, 32 dry and 18 chilled, as on M9; Style about 20; Tech about 15; one
adjustment item per brand and class, such as "Mixed dry cases"); depot waves Run 1 05:15–06:30 and
Run 2 11:00–12:30 (from A4). Tests use hand-built fixtures, never the files in data/seed/.

## Events
Emits:

| Event | Payload | Consumed by |
| --- | --- | --- |
| `outlet.updated` | `{ v: 1, id }` (from `SimpleCrudCommands`) | realtime; execution refreshes D9 in the next offline bundle |
| `catalog.updated` | not given | realtime |

Consumes: none.

## Log events
- `master_data.outlet.updated` (outlet id only; never the receiving contact's name or phone)

## Permissions
From the Step 2 matrix (`packages/shared/src/auth/permissions.ts`). A missing permission is 403
`FORBIDDEN`.

| Permission | admin | dispatcher | store_manager | loader | driver |
| --- | --- | --- | --- | --- | --- |
| `masterData:read` | yes | yes | yes | yes | yes |
| `masterData:manage` | yes | | | | |
| `catalog:read` | yes | yes | yes | | |
| `catalog:manage` | yes | | | | |

No ScopePolicy for master data is given in the Build Spec (see Open questions).

## Acceptance criteria
Each criterion is one test named after it, for example
`it('AC-MD-01 close before open or half a mall window is refused')`. Times are the demo clock in
Asia/Colombo. Tests use hand-built fixtures (never data/seed/) and the helpers in `apps/backend/CLAUDE.md`.

```gherkin
AC-MD-01  Close before open is refused
  Given an admin and an outlet with windowOpenMin 360, windowCloseMin 600 and no mall window
  When the admin patches the outlet with windowCloseMin 300
  Then the response is 400 VALIDATION_FAILED with an error on windowCloseMin
    And the outlet is unchanged, and no audit row and no outbox event exist for it
  When the admin patches the outlet with mallWindowOpenMin 420 and no mallWindowCloseMin
  Then the response is 400 VALIDATION_FAILED with an error on mallWindowCloseMin
    And the outlet is unchanged

AC-MD-02  Outlet edits are audited and announced
  Given an admin and an outlet
    And the clock reads 2026-10-01 09:00:00
  When the admin patches the outlet's accessNotes
  Then the response is 200 with the new accessNotes, accessNotesUpdatedAt 2026-10-01T09:00:00+05:30 and accessNotesUpdatedById the admin's id
    And exactly one audit row outlet.updated with before and after, and one outbox event outlet.updated with data { v: 1, id }, exist
    And the log line master_data.outlet.updated carries the outlet id and no contact details

AC-MD-03  Outlet times carry minutes and labels
  Given an outlet with windowOpenMin 360 and windowCloseMin 600
  When a dispatcher sends GET /outlets/{id}
  Then the response is 200 with windowOpenMin 360 beside windowOpen "06:00" and windowCloseMin 600 beside windowClose "10:00"
    And it carries brand, districtId, depotId, dockType, parkingConstraint, receivingContactName, receivingContactPhone and accessNotes

AC-MD-04  A3 outlet list filters and pages
  Given an admin and outlets of every brand at both PLG and KDY
  When the admin sends GET /outlets?filter[brand]=FRESH&filter[depotId]=PLG&limit=10
  Then the response is 200 with at most 10 outlets, every one Fresh and at PLG
    And meta.page is { limit: 10, offset: 0, total } where total counts every Fresh PLG outlet
  When the admin sends GET /outlets?filter[address]=x
  Then the response is 400 VALIDATION_FAILED with an error naming address

AC-MD-05  Outlets without a manager are flagged
  Given two outlets, one with a store manager user and one with none
  When the admin sends GET /outlets?filter[hasManager]=false
  Then only the outlet with no store manager is returned

AC-MD-06  Depot settings are audited (A4)
  Given an admin and depot PLG with dockCount 6, chilledDocks 2 and no cutoffMin
  When the admin patches PLG with chilledDocks 3 and cutoffMin 900
  Then the response is 200 with dockCount 6, chilledDocks 3 and cutoffMin 900
    And exactly one audit row holds PLG before (chilledDocks 2, cutoffMin null) and after (chilledDocks 3, cutoffMin 900)

AC-MD-07  Depot waves have unique labels
  Given an admin and depot PLG with no waves
  When the admin posts a wave to /depots/PLG/waves with label "Run 1", departFromMin 315 and departToMin 390
  Then the wave is created and GET /depots/PLG/waves lists Run 1 with departFromMin 315 and departToMin 390
  When the admin posts another wave labelled "Run 1" for PLG
  Then the response is 409 CONFLICT_STATE and PLG still has one Run 1

AC-MD-08  Item picker filters the catalog (M1a)
  Given Fresh items of both classes and some Style items
  When the store manager for Fresh Kadawatha sends GET /items?filter[brand]=FRESH&filter[tempClass]=CHILLED
  Then every item returned is a Fresh CHILLED item, with sku, name, category, packLabel, unitWeightKg, unitVolumeM3 and active
  When she adds q with part of one item's name, in a different case
  Then only items whose name contains that text are returned

AC-MD-09  Only admins change the catalog
  Given an admin
  When the admin posts a new Fresh item with a new sku
  Then the response is 201 with Location, one audit row with the new item, and one outbox event catalog.updated
  When the admin posts an item whose sku already exists
  Then the response is 409 CONFLICT_STATE and no second item exists
  When the admin posts an item with unitWeightKg 0
  Then the response is 400 VALIDATION_FAILED on unitWeightKg
  When the admin patches an item with active false
  Then GET /items/{id} returns it with active false, and the item still exists

AC-MD-10  Operating days and the fallback
  Given calendar rows for 2026-09-30 to 2026-10-04, where only 2026-10-04 has isOperating false, and no rows after 2026-10-04
  When a store manager sends GET /calendar?from=2026-09-30&to=2026-10-04
  Then the response is 200 with 5 days, each with date (YYYY-MM-DD), isOperating and isHoliday
    And nextOperatingDay("2026-10-02") is "2026-10-03"
    And nextOperatingDay("2026-10-03") skips 2026-10-04 and, with no row for 2026-10-05 (a Monday), returns "2026-10-05"
    And nextOperatingDay("2026-10-10") (a Saturday, no row) returns "2026-10-12" (a Monday)

AC-MD-11  Reference data for every role
  Given the reference tables hold rows
  When an admin, a dispatcher, a store manager, a loader or a driver sends GET /districts, /service-allowances, /traffic-speeds, /road-conditions, /depots or /calendar?from=2026-09-30&to=2026-10-04
  Then each response is 200
  When the same requests are sent with no session
  Then each response is 401 UNAUTHENTICATED

AC-MD-12  A missing permission is 403
  When each role below sends its request
  Then the response is 403 FORBIDDEN and nothing changes
    | role          | request                    | missing permission |
    | dispatcher    | PATCH /outlets/{id}        | masterData:manage  |
    | dispatcher    | PATCH /depots/PLG          | masterData:manage  |
    | dispatcher    | GET /depots/PLG/waves      | masterData:manage  |
    | store_manager | PATCH /outlets/{id}        | masterData:manage  |
    | store_manager | POST /items                | catalog:manage     |
    | dispatcher    | PATCH /items/{id}          | catalog:manage     |
    | loader        | GET /items                 | catalog:read       |
    | driver        | GET /items                 | catalog:read       |

AC-MD-13  Effective window meets the mall window
  Given a MALL_DOCK outlet with windowOpenMin 360 and windowCloseMin 600
  When effectiveWindow runs with a mall window 420 to 540
  Then it returns 420 to 540
  When effectiveWindow runs with a mall window 300 to 480
  Then it returns 360 to 480
  When effectiveWindow runs with no mall window
  Then it returns 360 to 600
  And for a NORMAL or VAN_ONLY outlet with a mall window 420 to 540 it returns 360 to 600, as the engine does

AC-MD-14  The seed is repeatable and checks rows
  Given hand-built fixture CSVs in a temporary SEED_DATA_DIR
  When pnpm --filter api db:seed runs twice
  Then the second run adds and changes nothing: the same depots, districts, outlets, calendar days and items, with the same ids
    And an outlet row with a 05:30 window opening has windowOpenMin 330, van_only arrives as VAN_ONLY, and a blank mall_window gives two nulls
  When a fixture outlet row has an unknown dock type
  Then the seed stops with a message that names the dock type column
  When a required CSV file is missing
  Then the seed stops and lists the missing file
```

Checklist (tick in the same PR as the passing test):
- [x] AC-MD-01 Close before open is refused
- [x] AC-MD-02 Outlet edits are audited and announced
- [x] AC-MD-03 Outlet times carry minutes and labels
- [x] AC-MD-04 A3 outlet list filters and pages
- [ ] AC-MD-05 Outlets without a manager are flagged
- [x] AC-MD-06 Depot settings are audited (A4)
- [ ] AC-MD-07 Depot waves have unique labels
- [x] AC-MD-08 Item picker filters the catalog (M1a)
- [ ] AC-MD-09 Only admins change the catalog
- [x] AC-MD-10 Operating days and the fallback
- [x] AC-MD-11 Reference data for every role
- [x] AC-MD-12 A missing permission is 403
- [x] AC-MD-13 Effective window meets the mall window
- [ ] AC-MD-14 The seed is repeatable and checks rows

## Non-functional
- Reference tables mirror the booklet's CSVs column for column; seeded orders elsewhere depend on
  them matching the dataset exactly.
- Every change is audited in the same transaction as the write, with before and after.
- The seed is idempotent and runs on every fresh install; CI seeds a fresh database, so a migration
  that breaks the seed fails the PR.
- Log lines carry ids only: never receiving contact names or phone numbers.
- Datasets stay out of agent sessions and tests: fixtures are hand-built; the real files are read only
  by the seed from `SEED_DATA_DIR`.

## Decided while building (ROO-19)
Ordering needed the reads, so this much of the module landed with it. What is left is noted against
each criterion in the checklist above.

- **Scope.** `OutletScope` and `DepotScope` give every Waypoint role every row: a driver's offline
  bundle, a dispatcher's map and a store's catalog all read the same facts, and `PermissionGuard`
  decides who may read or change them. An account with no Waypoint role sees nothing. These tables
  carry no row-level security policy.
- **`effectiveWindow` lives in master-data** (`domain/windows.ts`) and is exported from the module's
  index, because the outlet's own columns decide it. Ordering reads it for an order's
  `deliveryWindow`, and planning will snapshot it onto a stop.
- **`CalendarService`** is exported too: `range`, `isOperating`, `nextOperating`,
  `previousOperating`, `cutoffAt` and the lookups a batch needs. The maths is
  `packages/shared/src/rules/business-time.ts`, which falls back to Monday to Saturday for a date
  with no row (AC-MD-10), so one calendar decides both the day an order rolls to and the instant its
  cutoff falls on.
- **Audit and events.** Outlet edits audit `master_data.outlet.updated` and emit `outlet.updated`
  `{ v: 1, id }`; depot edits audit `master_data.depot.updated` and emit `depot.updated`. Log lines
  carry the outlet or depot id and the names of the fields that changed, never a contact's name or
  phone number.
- **Still to come.** The catalog's writes (AC-MD-09), depot waves (AC-MD-07), the has-manager filter
  (AC-MD-05) and the CSV seed (AC-MD-14) are not built yet, so `/depots/{id}/waves`,
  `POST /items` and `PATCH /items/{id}` are not mounted.

## Open questions
- Item changes have no audit action or event yet, because the catalog's writes are not built. Is the
  item entity type "catalog", as the module tab's `catalog.updated` suggests? (Harini)
- The has-manager filter needs identity's users, but master-data may import only core and audit
  (Step 2). Where does the flag come from, and what is the filter called (this spec uses
  `hasManager`)? `ResourceSpec` filters are column-based, so it needs a home of its own either way.
  (Harini, Nimesha)
- Waves need `masterData:manage` even for GET, so dispatchers can't read them there. Intended? May a
  wave that trips reference be deleted? (Harini)
- Limits: window minutes and `cutoffMin` are checked as 0 to 1439, `chilledDocks` may not exceed
  `dockCount`, `/items` pages with a maximum of 200 and `q` searches an item's name and SKU. Still
  open: `departFromMin` before `departToMin`, when the waves land. (Harini)

## Changelog
- 2026-10-03 AC-MD-13: `effectiveWindow` narrows by the mall window only at a MALL_DOCK outlet,
  matching the engine (`packages/engine/src/plan/window.ts`) and `specs/engine/rules.md`; before,
  mall times on any other outlet narrowed the window the order showed
- 2026-10-02 ROO-19: the reads ordering needs are built — `/depots`, `/districts`, `/outlets`,
  `/items`, `/calendar`, `/service-allowances`, `/traffic-speeds` and `/road-conditions`, plus the
  A3 outlet edit and the A4 depot edit, with `CalendarService` and `effectiveWindow` exported for
  ordering. AC-MD-01 to 04, 06, 08 and 10 to 13 pass
- 2026-09-30 created from the Build Spec
- 2026-09-30 Model: `depots.kind`, `districts.province`, allowance and weekday checks (merged from the Supabase draft)

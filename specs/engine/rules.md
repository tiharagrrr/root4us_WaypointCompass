# Engine rules

The reference for `packages/engine`: the time model, the 18 planning rules, the allocator, deferral reasons and the Task 2B export. The engine-rule skill tells you to update this file whenever a rule changes. Source: Build Spec Step 5 (Planning engine), with the engine `CLAUDE.md` and the engine-rule skill from Step 3. Where the booklet or the draft in `packages/shared/src/rules` differ, Step 5 wins (see section 10).

Paths are relative to `packages/engine/`. Code lives under `src/`.

## Quick rules

1. The engine is pure: no clock, no randomness, no I/O. The same input gives the same output, byte for byte.
2. Budgets use the booklet's trip minutes. The schedule never changes budget arithmetic.
3. Compare numbers with `lte(a, b)`, never `<=` on floats.
4. Sort every collection by a stable key before iterating.
5. `validate(allocate(x))` never contains a HARD violation.
6. Every rule has a pass and a fail fixture in `fixtures/rules/`.
7. Bump `ENGINE_VERSION` whenever output can change.

## 1. What the engine is

The engine is a deterministic, explainable greedy allocator with a repair pass, written as pure TypeScript. One `EngineInput` goes in; an `EngineOutput` with trips, unplanned orders, excluded orders, violations and stats comes out. The API, the web plan editor, the tests and the Task 2B export all run this code, so a plan the UI shows as valid is the plan the server accepts.

It has no Nest, no database, no `Date.now`, no `Math.random` and no network. The plan date comes in as `input.date` (`YYYY-MM-DD`).

| Path | Holds |
| --- | --- |
| `src/index.ts` | `allocate()`, `validate()`, `explain()`, `optionsForTrip()`, `suggestFixes()`, `ENGINE_VERSION` |
| `src/types.ts`, `src/params.ts` | Core shapes; `DEFAULT_PARAMS` and its zod schema |
| `src/time/` | `trip-minutes.ts` (booklet formula), `schedule.ts` (departure, arrivals, waits, return, reload), `fuel.ts` (km and litres) |
| `src/rules/` | One file per rule, `index.ts` (registry), `meta.ts` (severity and scope), `codes.ts`, `reason-map.ts` |
| `validate.ts` | `validate(input, plan)`: measures every trip from its orders, runs every enabled rule over the plan and `input.fixedTrips`, and returns violations sorted by rule, trip, vehicle and order |
| `src/plan/` | `measure.ts` (trip totals from orders), `stops.ts` (stops with effective windows), `trip-schedule.ts` (departure and arrivals for the window rules) |
| `src/allocate/` | prescreen, priority, groups, pack, sequence, repair, index |
| `src/manual/` | `edit-ops.ts` (the `EditOp` union), `apply-edits.ts`, `fits.ts`, `order-options.ts` (`optionsForTrip`), `vehicle-options.ts`, `suggest-fixes.ts`; see "Manual plan helpers" below |
| `src/priority.ts` | `priorityOf()`: the priority score, with weights from `params.priorityWeights` |
| `src/explain.ts` | Violations and unplanned orders as sentences |
| `src/export/task2b.ts` | The Datathon Task 2B CSV and policy draft |
| `src/util/` | `lte`, `round`, `stableSort`, canonical hash. Day of week, the HH:MM label and the domain enums come from `@waypoint/shared/business-time` and `@waypoint/shared/domain`, not copies |
| `fixtures/` | Small hand-built instances, including the booklet's 101, 112 and 213-minute examples |

### ENGINE_VERSION

- Bump `ENGINE_VERSION` in the same change as anything that can alter output for the same input: a rule, a param default, a priority weight, a tie-break, sequencing, repair, or message text.
- `EngineOutput.version` carries it, and every EngineRun row records it (`engine_runs.engineVersion`) with `inputHash`, the sha256 of the canonical input.
- A bump changes the output hash, so the golden S1 snapshot (`golden.spec.ts`) is updated in the same change, with the reason in the PR.

### Float tolerance

`lte(a, b)` is true when `a <= b + 1e-6`. Every limit check is written as `lte(actual, limit)`. A strict "more than" check fails when `!lte(actual, limit)`. A "less than" check on slack fails when `!lte(limit, actual)`. Reported numbers go through `round(x, 2)`.

### Determinism

- Sort by a stable key before iterating any map or set. Orders rank by priority descending, then earliest effective window close, then order ref (Step 5). Other collections sort by id.
- The repair loop stops after `improveIterations` (2,000) moves, never after a wall-clock limit.
- Shuffled input gives byte-identical output; the property test checks it.

## 2. Time model

Budgets use the booklet's trip minutes exactly. A separate schedule adds departure times, waits and the return leg, only to check delivery windows and to show times on screen.

### Units

- Times are minutes after midnight, Asia/Colombo, as numbers (03:30 is 210, 08:00 is 480). The API converts to ISO instants at the edge.
- Weight in kg, volume in m³, distance in km, fuel in litres, value in LKR.

### Trip minutes (booklet, Task 2B rule 7)

```
trip_minutes = outbound travel + inter-stop travel + total handling time

outbound travel   = depot_to_district_freeflow_min for the trip's district, counted once
inter-stop travel = inter_stop_freeflow_min × (number of orders − 1)
handling time     = Σ service_allowance_min for (trip brand, outlet dock_type), one per stop
```

The return journey is not added; the budgets already allow for it. In code (`src/time/trip-minutes.ts`):

- `outbound = district.depotToDistrictMin`
- `between = district.interStopMin × (n − 1)`
- `handling = Σ allowances["<brand>:<dockType>"]`
- A trip with no stops is 0 minutes.
- Stop order does not change trip minutes. The sequencer changes only when each stop is reached.

### Budgets

| Trips | Window | Budget per vehicle per day | Param |
| --- | --- | --- | --- |
| Fresh | 03:30 to 08:00 | 270 minutes | `freshBudgetMin` (start `freshStartMin` = 210) |
| Style and Tech combined | Trading day | 480 minutes | `styleTechBudgetMin` |

Budgets are per vehicle and per window. One Fresh and one Style trip is allowed, each against its own budget, but never more than two trips in total (`maxTripsPerVehicle` = 2).

### Worked examples (the first unit tests, byte for byte)

These live in `fixtures/time/` and run in `time.spec.ts`. Ids are fixture ids, not dataset ids.

`fixtures/time/cases/fresh-gampaha-3-stops.json`: Fresh to Gampaha, 3 stops (2 rear dock, 1 street).

```json
{
  "district": { "id": "fx-gampaha", "depotToDistrictMin": 37, "interStopMin": 9 },
  "brand": "FRESH",
  "dockTypes": ["REAR_DOCK", "REAR_DOCK", "STREET"],
  "allowances": { "FRESH:REAR_DOCK": 15, "FRESH:STREET": 16 },
  "expect": { "minutes": 101 }
}
```

37 + 9 × 2 + 15 + 15 + 16 = 101.

`fixtures/time/cases/fresh-colombo-4-stops.json`: Fresh to Colombo, 4 street stops.

```json
{
  "district": { "id": "fx-colombo", "depotToDistrictMin": 24, "interStopMin": 8 },
  "brand": "FRESH",
  "dockTypes": ["STREET", "STREET", "STREET", "STREET"],
  "allowances": { "FRESH:STREET": 16 },
  "expect": { "minutes": 112 }
}
```

24 + 8 × 3 + 16 × 4 = 112.

`fixtures/time/cases/two-trips-one-vehicle.json`: the same vehicle runs both trips.

```json
{
  "vehicleId": "fx-veh-1",
  "trips": [
    { "tripNo": 1, "brand": "FRESH", "minutes": 101 },
    { "tripNo": 2, "brand": "FRESH", "minutes": 112 }
  ],
  "params": { "freshBudgetMin": 270, "maxTripsPerVehicle": 2 },
  "expect": { "freshMinutes": 213, "violations": [] }
}
```

101 + 112 = 213, within the 270-minute Fresh budget.

`fixtures/time/cases/third-trip-refused.json`: a third trip on that vehicle.

```json
{
  "vehicleId": "fx-veh-1",
  "existingFreshMinutes": 213,
  "addTrip": { "brand": "FRESH", "minutes": 40 },
  "expect": { "refusedBy": "TRIP_LIMIT" }
}
```

Refused by the two-trip limit whatever minutes remain. Here 57 Fresh minutes remain and the trip needs 40, and it is still refused.

### Schedule (windows and display only)

- A Fresh trip 1 departs at 03:30 (`freshStartMin`).
- A Style or Tech trip departs so its first arrival meets the first window, within the depot's wave if one is set.
- First arrival = departure + `depotToDistrictMin`. Each later arrival = previous stop's finish + `interStopMin`.
- If a vehicle arrives before the window opens, it waits. Start = max(arrival, effective open). Finish = start + the stop's allowance. Service must finish by the effective close.
- Return leg = `depotToDistrictMin` again. Trip 2 departs after the return plus `reloadMin` (30).
- Effective window = the outlet window, intersected with the mall window for mall-dock outlets.
- Traffic is off for planning by default (`trafficAware: false`), matching the booklet. With it on, travel minutes divide by `speedIndex / 100` for the departure hour and monsoon flag, and by the date's disruption index. Budgets still use the booklet minutes. Live ETAs always use traffic.

### Fuel

- `km = 2 × depotToDistrictKm + interStopKm × (n − 1)` (fuel counts the return leg; minutes do not).
- `litres = km ÷ kmPerL`.
- Checked against `weeklyFuelQuotaL` minus what the ISO week has already used (`fuelUsedThisWeek`).

## 3. Rule table

Eighteen rules: fifteen HARD rules the engine never breaks, and three SOFT rules that need a written reason to override. Step 5 gives this count; there is no discrepancy. `WINDOW_OUTLET` and `WINDOW_MALL` are HARD only while `enforceWindows` is on, and `FUEL_WEEKLY` only while `enforceFuel` is on; when off, the rule is disabled through `Rule.enabled(params)`.

Scope uses Step 5's `Rule.scope` values: `trip`, `vehicle`, `order`, `plan`. There is no `stop` scope; a per-stop finding is a `trip` violation that also sets `orderId`. Step 5 fixes the scope only for `CAP_VOLUME` (in the engine-rule skill); the others follow from what each check reads.

Message templates: `CAP_VOLUME` is fixed by the engine-rule skill. The others are proposed wording in the same style; change them here and in the rule file together. Placeholders are in braces. Vehicles print by `code`, orders by `ref`, times as HH:MM, numbers through `round(x, 2)`.

| Code | Severity | Scope | Check (violation when false) | Message template | Deferral reason | Fixtures |
| --- | --- | --- | --- | --- | --- | --- |
| `CAP_WEIGHT` | HARD | trip | `lte(trip.weightKg, vehicle.weightCapKg)`; `trip.weightKg` = Σ order `weightKg` | Over weight by {trip.weightKg − weightCapKg} kg | `OVER_CAPACITY` | `CAP_WEIGHT.pass.json`, `CAP_WEIGHT.fail.json` |
| `CAP_VOLUME` | HARD | trip | `lte(trip.volumeM3, vehicle.volumeCapM3)`; `trip.volumeM3` = Σ order `volumeM3` | Over volume by {trip.volumeM3 − volumeCapM3} m³ | `OVER_CAPACITY` | `CAP_VOLUME.pass.json`, `CAP_VOLUME.fail.json` |
| `TEMP_REEFER` | HARD | trip | Every `CHILLED` order rides in a `REEFER` vehicle; with `reeferCarriesAmbient` off (default on), a reefer trip carries `CHILLED` orders only | {ref} is chilled but {code} is not a reefer / {code} is a reefer and carries chilled orders only | `NO_REEFER_CAPACITY` | `TEMP_REEFER.pass.json`, `TEMP_REEFER.fail.json` |
| `ACCESS_VAN_ONLY` | HARD | trip | Every order whose outlet has `parkingConstraint = VAN_ONLY` rides in a vehicle with `type = VAN` | {ref} needs a van; {code} is a truck | `VAN_SHORTAGE` | `ACCESS_VAN_ONLY.pass.json`, `ACCESS_VAN_ONLY.fail.json` |
| `DEPOT_HOME` | HARD | trip | Every order's outlet `depotId` equals the vehicle's `depotId` | {ref} belongs to {outlet depot}; {code} is based at {vehicle depot} | Never a reason; filtered before packing | `DEPOT_HOME.pass.json`, `DEPOT_HOME.fail.json` |
| `TRIP_BRAND_DISTRICT` | HARD | trip | Every order on the trip has `brand = trip.brand` and `districtId = trip.districtId` | A trip serves one brand and district ({brand}, {district}); {ref} is {brand}, {district} | Structural | `TRIP_BRAND_DISTRICT.pass.json`, `TRIP_BRAND_DISTRICT.fail.json` |
| `WHOLE_ORDER` | HARD | plan | Each order id appears in at most one trip's `orderIds` (fixed trips included); an order is never split | {ref} is on {n} trips; an order rides on one trip only | Structural | `WHOLE_ORDER.pass.json`, `WHOLE_ORDER.fail.json` |
| `TRIP_LIMIT` | HARD | vehicle | Trips per vehicle per day, counting fixed and reserved trips, ≤ `maxTripsPerVehicle` (2) | {code} has {n} trips; the limit is {limit} | `OVER_CAPACITY` | `TRIP_LIMIT.pass.json`, `TRIP_LIMIT.fail.json` |
| `BUDGET_FRESH` | HARD | vehicle | `lte(Σ minutes of the vehicle's FRESH trips, freshBudgetMin)` (270) | {code} uses {used} of {limit} Fresh minutes | `TIME_BUDGET` | `BUDGET_FRESH.pass.json`, `BUDGET_FRESH.fail.json` |
| `BUDGET_STYLE_TECH` | HARD | vehicle | `lte(Σ minutes of the vehicle's STYLE and TECH trips, styleTechBudgetMin)` (480) | {code} uses {used} of {limit} Style and Tech minutes | `TIME_BUDGET` | `BUDGET_STYLE_TECH.pass.json`, `BUDGET_STYLE_TECH.fail.json` |
| `WINDOW_OUTLET` | HARD (with `enforceWindows`) | trip | For each stop, service starts at or after the outlet's `windowOpenMin` and finishes by its `windowCloseMin` | {ref} is served {start} to {finish}, outside its window {open} to {close} | `WINDOW_CONFLICT` | `WINDOW_OUTLET.pass.json`, `WINDOW_OUTLET.fail.json` |
| `WINDOW_MALL` | HARD (with `enforceWindows`) | trip | For each stop at a `MALL_DOCK` outlet, service starts and finishes inside the mall window | {ref} is served {start} to {finish}, outside the mall window {open} to {close} | `WINDOW_CONFLICT` | `WINDOW_MALL.pass.json`, `WINDOW_MALL.fail.json` |
| `FUEL_WEEKLY` | HARD (with `enforceFuel`) | vehicle | `lte(fuelUsedThisWeek[vehicleId] + Σ trip.litres, weeklyFuelQuotaL)` | {code} would use {used + planned} of {quota} L this week | `FUEL_QUOTA` | `FUEL_WEEKLY.pass.json`, `FUEL_WEEKLY.fail.json` |
| `VEHICLE_AVAILABLE` | HARD | vehicle | A vehicle with trips is `available` (status `ACTIVE`, not `WORKSHOP` or `BREAKDOWN`) | {code} is not available ({unavailableReason}) | `VEHICLE_BREAKDOWN` (breakdown), else `OVER_CAPACITY` | `VEHICLE_AVAILABLE.pass.json`, `VEHICLE_AVAILABLE.fail.json` |
| `OPERATING_DAY` | HARD | plan | The plan date is an operating day, and every STYLE order falls on its outlet's delivery day | {date} is not an operating day / {ref} is a Style order for {day}, not {plan day} | Structural | `OPERATING_DAY.pass.json`, `OPERATING_DAY.fail.json` |
| `REPEAT_SKIP` | SOFT | order | An unplanned order whose outlet was deferred on its previous run needs an override note | {outlet} was deferred on its last run; deferring it again needs a note | — | `REPEAT_SKIP.pass.json`, `REPEAT_SKIP.fail.json` |
| `TECH_VALUE_LIMIT` | SOFT | trip | Only when `techValueLimitLkr` is set (default `null`, no limit): a TECH trip with Σ `valueLkr` more than it needs a note | Tech trip {tripKey} carries LKR {value}, over the LKR {limit} limit; add a note | — | `TECH_VALUE_LIMIT.pass.json`, `TECH_VALUE_LIMIT.fail.json` |
| `LATE_RISK` | SOFT | trip | Any stop with less than `lateRiskSlackMin` (15) minutes of window slack is flagged | {ref} has {slack} min of window slack, under {limit} | — | `LATE_RISK.pass.json`, `LATE_RISK.fail.json` |

All fixture files live in `fixtures/rules/`. `rules.spec.ts` loads every pair. A fixture lists only what its case changes; the test loader fills in a default vehicle, outlet, order, district (`fx-gampaha`, 37/9 minutes) and 15-minute allowances, so the other rules stay quiet. Window rules run with the Fresh start at 03:30.

Where the rules come from: booklet rule 1 is `TRIP_BRAND_DISTRICT`; 2 is `TEMP_REEFER`; 3 is `ACCESS_VAN_ONLY`; 4 is `DEPOT_HOME`; 5 is `WHOLE_ORDER`; 6 is `CAP_WEIGHT` and `CAP_VOLUME`; 7 is `TRIP_LIMIT`, `BUDGET_FRESH` and `BUDGET_STYLE_TECH`. The windows come from the outlets data, `FUEL_WEEKLY` from the vehicles data, `VEHICLE_AVAILABLE` from the Task 2B fleet and the product, `OPERATING_DAY` from the calendar, `REPEAT_SKIP` from the booklet's `deferred_yesterday`, `TECH_VALUE_LIMIT` from the design and `LATE_RISK` from the product.

### Rule shape

```ts
// src/rules/types.ts
export interface Rule {
  code: RuleCode;
  severity: 'HARD' | 'SOFT';
  scope: 'trip' | 'vehicle' | 'order' | 'plan';
  enabled?: (p: EngineParams) => boolean;   // WINDOW_* read enforceWindows, FUEL_WEEKLY reads enforceFuel
  check(ctx: RuleContext): Violation[];     // pure; a clean result is []
}
```

A `Violation` carries `rule`, `severity`, `scope`, and where relevant `tripKey`, `vehicleId`, `orderId`, `actual`, `limit` and `message`. Limit checks set `actual` and `limit`.

`RuleContext` holds the trip or plan under test, the vehicle, the outlets, the travel and allowance tables, the history, the fuel used this week and the params. `src/types.ts` is the source of truth for its fields. Outlet field names follow the outlets table in Step 1 (`depotId`, `dockType`, `parkingConstraint`, `windowOpenMin`, `windowCloseMin`, `mallWindowOpenMin`, `mallWindowCloseMin`, `styleDeliveryDow`).

The same rule objects answer two questions. `validate()` reports violations on a whole plan. `fits(ctx, current, trip, orderIds)` in `allocate/fits.ts` asks whether one trip may carry those orders: it measures the trip, sequences its stops and runs the thirteen HARD trip and vehicle rules over it, returning either the measured trip or the first rule that refused it. `current` is every trip in the plan as it stands, fixed trips included; the candidate replaces the trip with its key. The packer, the repair pass and the manual editor all call it, so a dimmed order on screen 07 shows exactly the reason the engine would give.

### Fixture shape

Each rule fixture is a small hand-built instance. Never copy dataset rows; use fixture ids such as `fx-veh-1`, `fx-out-1` and `fx-ord-1`.

```json
{
  "rule": "CAP_WEIGHT",
  "params": {},
  "input": { "vehicles": [], "outlets": {}, "districts": {}, "allowances": {}, "orders": [] },
  "plan": { "trips": [], "unplanned": [] },
  "expect": []
}
```

`params` holds overrides of `DEFAULT_PARAMS` only. `expect` lists the violations `validate()` must return for this rule, as `{ "rule", "severity", "tripKey" | "vehicleId" | "orderId", "actual", "limit" }`. A pass fixture expects `[]`. A fail fixture expects at least one violation of its own rule and no other HARD violation, so it fails for one reason.

## 3a. Manual plan helpers

The pure functions the web plan editor and the Planning API call to build a plan by hand (`src/manual/`). They run the same rules as `validate()`, so a dimmed order on screen 07 shows exactly the violation the engine would give. None mutates its input, and the same input always gives the same output.

| Function | Returns | Screen |
| --- | --- | --- |
| `applyEdits(input, plan, edits)` | `{ plan, violations, introduced }`: the new plan (trips sorted by key), every violation, and the ones the edits caused | 08, `POST /edits` |
| `fits(input, plan, orderId, tripKey)` | `{ fits, blocking, warnings, result }`: the hard violations adding the order would cause, the soft ones, and the trip's totals with it | 07 |
| `optionsForTrip(input, plan, { vehicleId, tripNo, selectedOrderIds? })` | Unplanned orders (on no trip) as `FITS`, `WARNING` or `BLOCKED` with the reason and totals; fits first, then higher priority, earlier window, ref | 07 |
| `vehicleOptions(input, plan)` | Per vehicle: status (`AVAILABLE`, `NO_TRIPS_LEFT`, `WORKSHOP`, `BREAKDOWN`), trips used and left, next trip number, Fresh and Style-Tech minutes left, capacities, fuel left; sorted by code | 06 |
| `suggestFixes(input, plan, violation, limit = 5)` | Ranked edit lists that clear a hard violation: `MOVE`, then `SWAP`, then `DEFER` | 10, 11 |

`EditOp` is a zod union (`editOpSchema`; `parseEdits(raw)` checks a list from outside): `ADD_TRIP`, `REMOVE_TRIP`, `ASSIGN_ORDER`, `UNASSIGN_ORDER`, `MOVE_ORDER` and `RESEQUENCE`, with trips named by key ("REF-07#1") and an optional `position` on assign and move. `SET_DRIVER` and `SET_WAVE` are plan data the engine does not know; the API adds them.

Rules of the road:
- Edits apply in order. A violation is returned, never thrown. An edit that cannot be applied throws `EngineInputError` naming the edit (`edits[2].tripKey`): `INVALID_EDIT`, `UNKNOWN_TRIP`, `TRIP_EXISTS`, `FIXED_TRIP` (a released or in-progress trip cannot be edited), `ORDER_ALREADY_ASSIGNED`, `ORDER_NOT_ASSIGNED`, `INVALID_RESEQUENCE` (says what is missing, extra or repeated), `INVALID_POSITION`.
- **Unplanned means on no trip.** There is one list, `plan.unplanned`, and `unplannedOrders(input, plan)` is the one definition of it (not on a trip in the plan, nor on a fixed trip). Each entry is one flat `Unplanned` type, the same shape as the `deferrals` columns. An engine decision fills `reasonCode`, `bindingRule` and `choice`; a manual removal leaves all three `null`, meaning "not decided yet", because only the dispatcher knows why and she picks the reason when she confirms the deferral (which needs a reason and a note, AC-PLN-16). The engine does not enforce that she does: the API's publish check does (AC-PLN-04).
- `applyEdits` keeps that list complete: an order that was on a trip and is not after the edits (`REMOVE_TRIP`, `UNASSIGN_ORDER`) is added with its priority and its repeat-skip flag, so `REPEAT_SKIP` fires in the editor and the browser needs no logic of its own. An order that is unassigned and put back in the same list is not added, a `MOVE_ORDER` never adds one, and an order that gets a trip leaves the list. Entries stay sorted by order id. The API turns each new entry into a `PROPOSED` deferral with source `PLANNING` (prefilling the reason `OTHER`), which publishing then needs decided.
- `fits` and the option lists compare with what the plan already violated, so a problem that was already on the trip is not blamed on the new order. A violation whose numbers get worse counts as new.
- With no trip yet and no order chosen, `optionsForTrip` tries each order as a trip of its own. Once an order is chosen the trip so far is the baseline, and its brand and district fix those of a new trip.
- `suggestFixes` tries every suggestion with `validate()`: it must clear the violation and cause no new hard one. Within a kind the least disruptive wins: fewest edits, then the lowest-priority and smallest order, then the lowest trip number. A soft violation, or one with no trip or vehicle (`WHOLE_ORDER`, `OPERATING_DAY`), has no suggestions. At 25 trips, 30 vehicles and 125 unplanned orders it takes about 60 ms.

## 4. Rule details

Only rules whose check needs more than a table cell. The table's check column is the contract; these notes cover inputs and edges.

### TEMP_REEFER

- Inputs: each order's `tempClass`, `vehicle.temp`, `params.reeferCarriesAmbient`.
- `reeferCarriesAmbient` is `true` by default: a reefer may carry ambient orders, so only the first half of the check applies. With it off, a reefer trip carries chilled orders only.
- The rule only says what is allowed. Preference is the allocator's job (ROO-28): chilled orders ride reefers, and ambient orders prefer ambient vehicles. A reefer takes ambient orders only when (a) a high-priority ambient order has no ambient vehicle that can take it, or (b) every chilled order is planned and reefers are still spare.
- Grouping keys trips by chilled or ambient class, so the allocator does not mix the two on one trip unless one of those two cases applies.
- Pass: a reefer carries three chilled Fresh orders.
- Fail: an ambient truck carries one chilled order; or, with `reeferCarriesAmbient` off, a reefer carries one ambient order.

### ACCESS_VAN_ONLY

- Inputs: `outlets[order.outletId].parkingConstraint`, `vehicle.type`.
- Only `VAN_ONLY` needs a van. `MALL_DOCK` is an access window, checked by `WINDOW_MALL`. `NORMAL` takes any vehicle.
- A van-only outlet stays in its brand-district group; the group is marked as needing a van for any trip that serves it.
- Pass: a van serves two van-only outlets and one normal outlet in the same group.
- Fail: a truck trip includes one van-only outlet.

### DEPOT_HOME

- Inputs: `outlets[order.outletId].depotId`, `vehicle.depotId`.
- The allocator filters candidates to home-depot vehicles before packing, so this rule never becomes a deferral reason. It catches manual edits and bad fixed trips.
- Pass: a vehicle serves outlets of its own depot.
- Fail: a vehicle serves one outlet assigned to the other depot.

### WHOLE_ORDER

- Inputs: every trip's `orderIds`, including `fixedTrips`.
- Orders are whole units in the engine; a split shows as the same order id on two trips.
- The property test adds the stronger invariant: every order is on exactly one trip or unplanned with a reason.
- Pass: each order id appears once across all trips.
- Fail: one order id appears on two trips of different vehicles.

### TRIP_LIMIT

- Inputs: all trips for the vehicle on the plan date: planned, `fixedTrips` and reserved trips (a reservation holds a trip slot).
- `tripNo` is 1 or 2. Trip keys look like `REF-07#1`.
- Refused whatever minutes remain; see the third-trip time fixture.
- Pass: a vehicle runs one Fresh trip and one Style trip.
- Fail: a vehicle with two trips gets a third, even a short one that fits the budget.

### BUDGET_FRESH and BUDGET_STYLE_TECH

- Inputs: `trip.minutes` (booklet formula) and `trip.brand` for each of the vehicle's trips, fixed trips included; `freshBudgetMin`, `styleTechBudgetMin`.
- FRESH trips count against 270; STYLE and TECH trips count together against 480. The two windows never share minutes.
- The budget is minutes, not clock time. Arriving by 08:00 for Fresh is the window rules' job.
- A reserved trip with no stops is 0 minutes.
- Edge: two trips with the same 213 budget minutes can end at different clock times. Trip 1 departs at 03:30 and trip 2 departs after trip 1's return plus 30. Gampaha (101) then Colombo (112) ends the last service at 08:10 (490). Colombo then Gampaha ends at 07:57 (477). The budget passes both ways; with `enforceWindows` on, a window that closes at 08:00 fails the first.
- Pass: two Fresh trips of 101 and 112 minutes (213 of 270).
- Fail: two Fresh trips totalling more than 270 minutes, for example 150 and 130.

### WINDOW_OUTLET and WINDOW_MALL

- Enabled only when `params.enforceWindows` is on (default on; the Task 2B export turns it off).
- Inputs: the trip's schedule (`arrivals[]` with `arriveMin`, `startMin`, `waitMin`), each stop's allowance, the outlet's `windowOpenMin` and `windowCloseMin`, and for `MALL_DOCK` outlets `mallWindowOpenMin` and `mallWindowCloseMin`.
- Finish = `startMin` + the stop's allowance. Pass when `lte(open, startMin)` and `lte(finish, close)`.
- The computed schedule waits for the window to open, so a start before opening appears only when checking a given order of stops against actual times (repair mode). A late finish is the usual failure.
- Each rule checks its own window. A mall-dock stop outside both windows reports both; the reason is `WINDOW_CONFLICT` either way.
- The sequencer orders stops by effective window close, then inserts each where it adds the least waiting while keeping every window.
- Pass: a stop arrives before its window opens, waits, and finishes before it closes.
- Fail: the fourth stop of a trip finishes after its outlet's window has closed; or a mall-dock stop finishes after the mall window closes although the outlet window is still open.

### FUEL_WEEKLY

- Enabled only when `params.enforceFuel` is on (default on; the Task 2B export turns it off).
- Inputs: each trip's `km` and `litres` from `src/time/fuel.ts`, `vehicle.kmPerL`, `vehicle.weeklyFuelQuotaL`, `input.fuelUsedThisWeek[vehicleId]` (litres planned or used this ISO week).
- The check is per vehicle, over all of its trips in the plan, fixed trips included.
- `fuelUsedThisWeek` must therefore exclude this plan's own trips, or they would be counted twice: the API sums the ledger for the ISO week without this plan's entries (other days and actuals only). A vehicle with no entry has used 0.
- Pass: a vehicle with most of its quota left runs two short trips.
- Fail: a vehicle close to its weekly quota gets a trip whose litres take it over.

### VEHICLE_AVAILABLE

- Inputs: `vehicle.available`, `vehicle.unavailableReason` (`WORKSHOP` or `BREAKDOWN`).
- The pre-screen and the packer consider available vehicles only, so this rule fires on fixed trips, manual edits and vehicles that break down after planning.
- Reason: `VEHICLE_BREAKDOWN` for a breakdown; otherwise the fleet is short and the reason is `OVER_CAPACITY`.
- Pass: every vehicle with a trip is active.
- Fail: a trip is assigned to a vehicle in the workshop.

### OPERATING_DAY

- Inputs: whether `input.date` is an operating day (calendar `isOperating`), the weekday of `input.date` (0 = Monday), and each Style outlet's `styleDeliveryDow`.
- The weekday comes from the date string, never from the clock.
- Pass: a plan on an operating day holds Style orders only for outlets whose delivery day is that weekday.
- Fail: a plan on a non-operating day; or a Style order for an outlet whose delivery day is another weekday.

### REPEAT_SKIP

- Inputs: the plan's `unplanned[]`, `input.history[outletId].deferredOnLastRun`, `params.repeatSkipLookbackRuns` (1).
- Sets `Unplanned.repeatSkip = true` and a SOFT violation. The dispatcher overrides it with a written note.
- The allocator avoids it: priority weight 40 for `deferredOnLastRun`, and an order that would become a repeat skip is only displaced by an order with a higher score.
- Pass: an outlet deferred on its last run is served today.
- Fail: an outlet deferred on its last run is unplanned again.

### TECH_VALUE_LIMIT

- Inputs: `trip.brand`, each order's `valueLkr`, `params.techValueLimitLkr`.
- Disabled while `techValueLimitLkr` is `null`, which is the default; set it in the A6 settings to switch the rule on. A missing `valueLkr` counts as 0.
- "More than" is strict: a trip at exactly the limit passes (`lte(value, limit)`).
- Pass: a Tech trip carries goods worth less than the limit.
- Fail: a Tech trip's orders add up to more than the limit.

### LATE_RISK

- Inputs: the trip's schedule, each stop's effective window close, `params.lateRiskSlackMin` (15).
- Slack = effective window close − service finish. Flag when `!lte(lateRiskSlackMin, slack)`; exactly 15 minutes passes.
- A stop that breaks its window also has slack below 15, so it shows both the HARD window violation and this flag.
- Pass: every stop finishes at least 15 minutes before its window closes.
- Fail: one stop finishes 10 minutes before its window closes.

## 5. Allocator

The allocator is a deterministic greedy heuristic with a repair pass. It runs on every click (well under a second for about 150 orders and 30 vehicles), explains every order, and never produces a HARD violation.

`allocate(input, options?)` returns an `EngineOutput`: `version`, `date`, `trips`, `unplanned`, `excluded`, `violations` and `stats`. It is also a `Plan`, so `validate(input, allocate(input))` type-checks and measures the same trips. `output.trips` holds only the plan's own trips, because `validate()` adds `input.fixedTrips` itself; each carries the `departMin` the schedule derives, so the plan keeps its own times.

1. **Pre-screen.** For each order, ask whether any available home-depot vehicle could carry it alone: capacity, temperature, access, a one-stop trip inside its window, the budget and fuel left. If none could, the order is unplanned now, marked `UNAVOIDABLE`, with the rule that ruled out the last candidate as `bindingRule`. A chilled order with every reefer in the workshop gets `NO_REEFER_CAPACITY`. The reefer preference does not apply here: a reefer counts as a place an ambient order could go, so nothing is called unavoidable while a vehicle could take it. A Style order that is not due today is left out altogether (`excluded[]`, `NOT_DUE_TODAY`).
2. **Rank.** Score every remaining order with `priorityOf()` and sort by score descending, then earliest effective window close, then order ref.
3. **Group.** Key orders by brand, district and trip class (chilled or ambient). Van-only outlets stay in their group but mark it as needing a van for any trip that serves them; a group of nothing but van-only outlets counts only vans as its capacity.
4. **Pack.** Process groups scarcest first, by demand over the capacity of vehicles that could serve them, so reefer and van groups claim scarce vehicles before ambient trucks are spread thin. Scarcity is the larger of the weight and volume ratios, counting each preferred vehicle's free trip slots; a group with no capacity at all is the scarcest there is. Within a group, walk orders in priority order (largest dominant share first within a priority band) and place each where it fits best.
5. **Sequence.** Inside each trip, order stops by effective window close, then insert each stop where it adds the least waiting while keeping every window. With nothing to choose between two positions the stop stays in window-close order. Trip minutes do not change; only when each stop is reached does.
6. **Repair and improve.** Try each unplanned order again in rank order, now that the plan is fuller: a vehicle may have budget for a second trip, and spare reefer room is open to ambient orders once every chilled order has had its turn. Then try to make room by pushing a strictly lower-priority order off a trip of the same brand and district. The order pushed off goes back in the queue, so it is a move between trips when something else can take it and a swap only when nothing can; then it is `PRIORITY_CHOICE` with `displacedBy`. Stop after `improveIterations` placements.
7. **Validate.** Every rule runs over the final plan. In tests a HARD violation fails the build; in production it appears on the plan as a violation, never silently. A HARD violation can only come from the input's own fixed or locked trips: everything the allocator places was checked first.

**Repair mode** runs the same pipeline with `fixedTrips` holding everything released or in progress and only the freed orders (a broken-down vehicle's, for example) as input. The result is shown as a diff before anything changes. An order already on a fixed trip is never planned again, whether or not the caller left it in `input.orders`.

**Plan ahead** uses `reserve(input, forecastGroups)`: it packs placeholder orders (`FC-` refs) sized from the forecast with every vehicle rule. A reservation is a trip with no stops that holds a vehicle's capacity and trip slot. `reserve()` itself is still to come; `allocate()` already fills reservations handed to it (below).

### Choosing where an order goes

`allocate/place.ts` tries the candidates for one order in a fixed order and stops at the first that fits. Nothing is placed unless `fits` says the whole trip is legal, so a HARD violation cannot reach the plan and then be reported.

- **Candidate vehicles** are the available vehicles based at the order's outlet's depot. `DEPOT_HOME` is therefore never a deferral reason. They are tried in two passes: the vehicles the order prefers (a reefer for a chilled order, an ambient vehicle for an ambient one), then the rest. The rest are tried even when they cannot take the order, because their refusal is the telling one: for a chilled order with no reefer room left, the last vehicle tried is an ambient truck, `TEMP_REEFER` refuses it, and the reason reads "no reefer capacity".
- **Candidate trips** are the open trips of the same brand and district on those vehicles, reservations first, then the fullest trip the order still fits on (so slack is not scattered), then by trip key. A trip kept from the input is closed: nothing is added to it.
- **A new trip** opens on the vehicle with the most budget minutes left for the brand's window, then the most volume, then the most weight, then the first vehicle code. Its `tripNo` is the lowest slot the vehicle has free.
- **`bindingRule`** is the rule that refused the last candidate tried; `tried[]` holds one entry per vehicle, in the order they were tried, with the first rule that refused it. Only a rule in `BINDING_RULES` is recorded, so `DEPOT_HOME` and the structural rules never appear.
- **Rule order inside `fits`** is eligibility (`DEPOT_HOME`, `VEHICLE_AVAILABLE`, `TEMP_REEFER`, `ACCESS_VAN_ONLY`, `TRIP_BRAND_DISTRICT`), then fullness (`CAP_WEIGHT`, `CAP_VOLUME`, `TRIP_LIMIT`, `BUDGET_FRESH`, `BUDGET_STYLE_TECH`, `FUEL_WEEKLY`), then timing (`WINDOW_OUTLET`, `WINDOW_MALL`). The first violation is the binding rule, so a vehicle that could never serve the order says so instead of reporting it as full.
- **Knock-on effects.** A Fresh trip 2 leaves after trip 1 returns, so growing trip 1 can push trip 2 past a window. A placement that gives one of the vehicle's other trips a problem it did not already have is refused. A problem the trip already had is left alone: it belongs to the plan, not to this placement, and blocking on it would make the vehicle unusable.

### Reefer preference

`TEMP_REEFER` allows a reefer to carry ambient orders (`reeferCarriesAmbient`, on by default); which of them it should carry is the allocator's. Chilled orders are packed first, because their group is almost always the scarcest. An ambient order may take a reefer when either:

- (a) it scores at least `reeferAmbientMinPriority` (40, a repeat skip's own weight) and no ambient vehicle can take it, or
- (b) no chilled order is left to place.

(b) is read as "no chilled order is still waiting for its turn", not "every chilled order is planned": a chilled order that no reefer could ever take does not become plannable by keeping a reefer empty, and holding the room back would serve nobody. By the time the repair pass runs, every chilled order has had its turn, so an ambient order is never deferred while reefer room sits idle.

### Re-runs: keepLocked and reservations

Two kinds of trip can come in with the orders they already hold, both as `TripDraft`s whose orders stay in `input.orders`:

- `input.lockedTrips` are the trips a dispatcher built or edited by hand (`trips.locked`). `allocate(input, { keepLocked: true })` keeps each one exactly as it is — vehicle, trip number and stops, unsequenced — and plans the rest of the day around it; its orders leave the pool and nothing is added to it. Without the option they are ignored and their orders planned again, which is the only way the engine may replace a hand-built trip (AC-PLN-10).
- `input.reservedTrips` are plan-ahead reservations (`trips.isReserved`). They are open trips with no stops, filled before a new trip opens, and one nobody fills stays in the plan with its slot and 0 minutes. They count against `TRIP_LIMIT` either way, so a vehicle holding two reservations has no slot left.

Both come back in `output.trips` with `locked` or `reserved` set, for the columns the API writes.

### Orders left out

`output.excluded[]` is not a deferral: no `deferrals` row, no store notice, and the API raises an alert for it, because the queue should never have held the order.

| Code | When |
| --- | --- |
| `NOT_DUE_TODAY` | A Style order whose outlet takes Style on another weekday (see section 9, "Decided 2026-10-01") |
| `NOT_AN_OPERATING_DAY` | The plan date is not an operating day. Nothing is planned and the plan-level `OPERATING_DAY` violation is returned with it |

### Allocator params

| Param | Default | What it does |
| --- | --- | --- |
| `priorityWeights` | the seven weights below | The priority score (settings `planning.priorityWeights`, set in code) |
| `tightWindowMin` | 120 | An effective window shorter than this scores the tight-window weight |
| `improveIterations` | 2000 | Placements the repair pass may evaluate before it stops. Never a wall-clock limit |
| `reeferAmbientMinPriority` | 40 | What an ambient order must score to take a reefer chilled orders could still want |
| `limitingUtilisationPct` | 90 | Past this, a resource that caused a deferral is a limiting resource |

### Priority

```
priority = 40 × deferredOnLastRun
         + 10 × min(consecutiveDeferrals, 3)
         +  2 × min(daysSinceLastServed, 10)
         + 15 × (brand = FRESH)
         + 10 × (tempClass = CHILLED)
         +  8 × urgent
         +  6 × (effective window under 120 minutes)
```

Weights are `params.priorityWeights`. The maximum is 129. A repeat skip (40 or more) outranks any order that is only fresh and chilled (25). Ties break on earliest window close, then order ref.

### Invariants

- `validate(allocate(x))` has no HARD violation.
- Every order is on exactly one trip or unplanned with a reason.
- Sorting is stable: priority descending, then earliest window close, then ref for orders; id for everything else.
- Shuffled input gives byte-identical output: every list reversed and every table's keys reversed changes nothing.
- An S1-sized input allocates in under 500 ms in Node; `validate()` runs in under 50 ms in the browser. Measured on a hand-built 150-order, 30-vehicle day: 54 ms to allocate, 1 ms to validate (ROO-28; the bench itself is ROO-59).
- The allocator checks a rule before placing an order (`fits` and the pre-screen), not only in the final validate.
- An order on a fixed or kept trip is never planned twice, so `WHOLE_ORDER` cannot break.

### Tests

| Layer | What it proves | File |
| --- | --- | --- |
| Rules | A pass and a fail fixture for each of the 18 rules | `fixtures/rules/*.json`, `rules.spec.ts` |
| Time model | 101, 112 and 213 minutes exactly; a third trip is refused | `time.spec.ts` |
| Allocator | Grouping, packing, sequencing, repair, the reefer preference, keepLocked and reservations, the reasons and the numbers, on small hand-built cases | `allocate/__tests__/{allocate,group,pack,sequence,repair,priority,temp-preference,keep-locked,explain}.spec.ts` |
| Properties (fast-check) | 1 to 6 vehicles, up to 40 orders: no HARD violation; every order on one trip or unplanned with a reason; shuffled input gives identical output | `property.spec.ts` |
| Golden S1 | Read from `SEED_DATA_DIR` in CI: no HARD violations, `check_allocation.py` passes, served count and output hash match the snapshot | `golden.spec.ts` |
| Performance | The timings above | `bench/` |

### explain()

`explain(input, output)` builds sentences from fixed templates, out of the numbers `output.stats` already carries. It works nothing out and invents nothing. The optional AI panel only rephrases these facts and falls back to the template text. It takes the input as well, because the sentences name orders by ref, vehicles by code and districts by name, and `EngineOutput` carries ids. It returns `{ plan, resources[], deferrals[], unplanned[] }`.

Plan stats (`allocate/stats.ts`, `PlanStats`): served and deferred by brand and class; utilisation of each scarce resource (reefer volume, van trips, Fresh minutes, Style-Tech minutes, fuel); limiting resources (over `limitingUtilisationPct` and whose shortage caused deferrals); repeat skips avoided and incurred; deferrals split into unavoidable and chosen, each with its cost in units, m³ and outlets.

How those numbers are counted, so two screens never disagree:

- `used` and `total` are over everything the fleet has, not only what it deployed: reefer volume is every available reefer's capacity across its trip slots, Fresh and Style-Tech minutes are every available vehicle's budget, fuel is every available vehicle's weekly quota (what the ISO week already used included), van trips are every van's slots. A resource with slots to spare is therefore never called the limit.
- `trips` and `fullTrips` are over the trips the plan actually runs. A trip is **full** when no order that is still waiting fits on it, asked through `fits`, which is exactly "it could take no more". With nothing waiting, nothing is full.
- A resource is **limiting** when it is used past `limitingUtilisationPct` *and* a deferral's `bindingRule` points at it: `TEMP_REEFER` at reefer volume, `ACCESS_VAN_ONLY` at van trips, the two budgets at their minutes, `FUEL_WEEKLY` at fuel, and a capacity or trip-limit refusal at whichever kind of vehicle the order needed. A window conflict and an unavailable vehicle name no resource.
- Repeat skips avoided counts the orders this plan serves whose outlet was deferred on its last run; incurred counts the unplanned orders whose `repeatSkip` is set. Both use the same `isRepeatSkip()` the `REPEAT_SKIP` rule uses, so the flag and the rule cannot disagree.
- A deferral's cost counts orders, `orders.units`, m³, kg and distinct outlets.

Plan sentence, as given in Step 5:

> Reefer capacity was the limit: 11 of 12 reefer trips are full (97% of volume). 7 chilled Fresh orders wait; 5 were unavoidable and 2 made room for outlets skipped yesterday.

Shape: "{Resource} was the limit: {full} of {total} {resource} trips are full ({pct}% of {measure}). {n} {class} {brand} orders wait; {unavoidable} were unavoidable and {chosen} made room for outlets skipped yesterday."

Order sentence, as given in Step 5 (`explainUnplanned`, screen 15):

> WF-0171 waits: it needs 1.8 m³ chilled, and the most space left on any Gampaha reefer trip is 0.6 m³ (REF-07 trip 2). Tried REF-03, REF-07, REF-11.

Shape: "{ref} waits: it needs {need} {unit} {class}, and the most space left on any {district} {vehicle kind} trip is {best} {unit} ({code} trip {tripNo}). Tried {codes}." The numbers come from `Unplanned.detail` and `Unplanned.tried`. "The most space left" is over the plan's trips of the order's own brand and district on the kind of vehicle it needs (a reefer when it is chilled, a van when its outlet is van-only, otherwise any truck); when there is no such trip the sentence says so instead. An `Unplanned` with no `detail` (a deferral a dispatcher made by hand) falls back to the reason's label.

Screen M4 uses the store-safe wording from the reason map, never internal numbers.

## 6. Deferral reasons

Every unplanned order records:

- `reasonCode`: from the reason map below.
- `bindingRule`: the rule that ruled out the last candidate vehicle tried.
- `choice`: `UNAVOIDABLE` when no feasible place existed even after repair; `PRIORITY_CHOICE` when a higher-priority order took its place, with `displacedBy` naming that order.
- `detail`: `needUnits`, `needWeightKg`, `needVolumeM3`, and `bestVolumeM3` with `bestTripKey`, `bestVehicleId` and `bestTripNo` for the trip that had the most room left (all null when there was no such trip).
- `priority`, `repeatSkip`, and `tried[]` as `{ vehicleId, failedRule }`, one entry per vehicle in the order they were tried.
- `displacedBy` on a `PRIORITY_CHOICE`: the order that took its place.

`src/rules/reason-map.ts`:

| Binding rule | Reason code | Dispatcher sees | Store sees on M4 |
| --- | --- | --- | --- |
| `TEMP_REEFER` | `NO_REEFER_CAPACITY` | No reefer capacity | All refrigerated trucks were full for this run. |
| `ACCESS_VAN_ONLY` | `VAN_SHORTAGE` | No van available | Your outlet needs a van, and every van was booked. |
| `CAP_WEIGHT`, `CAP_VOLUME`, `TRIP_LIMIT` | `OVER_CAPACITY` | Fleet full | Every suitable vehicle was full for this run. |
| `BUDGET_FRESH`, `BUDGET_STYLE_TECH` | `TIME_BUDGET` | No time left on the run | The delivery run had no time left to reach you. |
| `WINDOW_OUTLET`, `WINDOW_MALL` | `WINDOW_CONFLICT` | Window can't be met | We couldn't reach you inside your delivery window. |
| `FUEL_WEEKLY` | `FUEL_QUOTA` | Fuel quota reached | Our vehicles reached their weekly fuel limit. |
| `VEHICLE_AVAILABLE` (breakdown) | `VEHICLE_BREAKDOWN` | Vehicle broke down | The vehicle for your delivery broke down. |
| Manual only | `ACCESS_ISSUE`, `STORE_REQUEST`, `OTHER` | As chosen | The dispatcher's note |

- `VEHICLE_AVAILABLE` for a workshop vehicle maps to `OVER_CAPACITY`.
- `DEPOT_HOME` is never a reason: candidates are filtered to the outlet's depot before packing.
- With no available vehicle at the depot at all there is no candidate to refuse the order, so the fleet itself is the reason: `VEHICLE_AVAILABLE` with the depot's broken-down vehicle if it has one (`VEHICLE_BREAKDOWN`), else its workshop vehicle (`OVER_CAPACITY`), and with no vehicle on the books `bindingRule` is null and the reason is `OVER_CAPACITY`.
- `TRIP_BRAND_DISTRICT`, `WHOLE_ORDER` and `OPERATING_DAY` are structural: the allocator never builds a plan that breaks them, so they never bind a deferral.
- Soft rules never block an order, so they have no reason code.
- The Task 2B policy draft groups deferrals by `choice`, answering the booklet's question: which deferrals were unavoidable, which were a choice, and what they cost.

## 7. Task 2B export

```bash
pnpm engine:task2b \
  --scenario data/seed/task2b_peak_day_scenarios.csv \
  --fleet data/seed/task2b_peak_day_fleet.csv \
  --out out/
python check_allocation.py out/submission_task2b.csv
```

- Runs with the seven rules the datathon names only: `enforceWindows=false` and `enforceFuel=false`. `reeferCarriesAmbient` is already on by default. Step 5 changes no other param.
- Allocates only vehicles marked available in the fleet file; `in_workshop` vehicles cannot be used (booklet).
- Writes `out/submission_task2b.csv` with columns `scenario, order_ref, outlet_id, decision, vehicle_id, trip_id`, one row per order.
- Keeps `scenario`, `order_ref` and `outlet_id` unchanged. `order_ref` is the allocation key, because an outlet can appear more than once.
- `decision` is `served` or `deferred`, as in the booklet's completed example.
- `vehicle_id` uses the dataset's vehicle ids (the `VEH014` form), not vehicle codes. `trip_id` is 1 or 2.
- Deferred rows leave `vehicle_id` and `trip_id` blank.
- Writes `out/policy.md`, a draft of the written policy from `explain()`: limiting resources, the priority score, and unavoidable against chosen deferrals with their cost.
- The golden test runs this on S1 and requires `check_allocation.py` to pass.
- The product's demo day runs the same S1 orders with windows and fuel on, so its plan can differ from the submission. Both are correct under their own rules.

## 8. Changing a rule

Follow the engine-rule skill. For every new or changed rule:

1. Write or edit `src/rules/<code>.ts`. The check is pure: `check(ctx: RuleContext) => Violation[]`, using `lte` and `round`.
2. Register it in `src/rules/index.ts`.
3. If the allocator can defer an order because of it, map it in `src/rules/reason-map.ts` (reason code, dispatcher text, store text).
4. Add `fixtures/rules/<CODE>.pass.json` and `fixtures/rules/<CODE>.fail.json`, and make sure `rules.spec.ts` loads both.
5. If it changes allocation, make `allocate/` check it before placing an order (the pre-screen and `fits`), not only afterwards.
6. Run `pnpm --filter engine test`: unit, fixtures, the booklet examples and the property test.
7. Bump `ENGINE_VERSION` and update the golden snapshot if the output hash changes.
8. Update this file: the rule table row (code, severity, scope, check, message, reason, fixtures), a detail section if the check needs one, section 6 if it maps to a reason, and a changelog line.
9. If the plan editor shows it, read the message on screens 07, 10 and 11.

Never duplicate a rule in the API or the web app; both import `validate()`. Never use `Date.now`, `Math.random`, or iterate an unsorted map.

## 9. Open questions

- The engine's `reeferCarriesAmbient` default is `true` (decided 2026-10-01), but the API's setting `planning.reeferCarriesAmbient` and its row in `specs/planning/spec.md` still default to `false`. Whichever the API passes wins, so the two must agree before an engine run reads settings, or a reefer will refuse ambient orders in the product and take them in the tests. Decides: Tihara with Nimesha (settings registry).
- `reserve(input, forecastGroups)` is not written yet (forecasting). `allocate()` already fills `input.reservedTrips`, so the two halves can land separately. Decides: Tihara.
- Soft overrides: the engine reports soft violations; which API field stores the override note? (`deferrals.overrideNote` for REPEAT_SKIP; Tech value and late risk notes are still open.)
- Fixtures: Step 5 names `fixtures/rules/*.json` but not the folder's place; this file assumes `packages/engine/fixtures/`.
- Fixed trips whose orders are not in `input.orders` (released trips in repair mode) are measured from their stored totals and skipped by the order-level and window rules. Confirm that is what repair mode needs (ROO-56).

### Decided 2026-10-03 (ROO-28)

- The allocator's own choices, written down in section 5: candidate order (preferred vehicles first so the last refusal is the telling one), best fit (reservations, then the fullest trip with room), a new trip on the vehicle with the most budget then capacity, the rule order inside `fits`, and the knock-on check on a vehicle's other trips.
- `reeferAmbientMinPriority` is a new param, default 40, for "a high-priority ambient order" in `TEMP_REEFER` case (a). 40 is a repeat skip's own weight, the lowest score the priority table treats as pressing. **Tihara to confirm the number.**
- `TEMP_REEFER` case (b) is read as "no chilled order is left to place" rather than "every chilled order is planned", so one chilled order nothing can carry does not keep every spare reefer empty all day. **Tihara to confirm the reading.**
- A deferral's cost is reported in `orders.units`, so `EngineOrder` gained a required `units`. The API fills it from `orders.units`, which the S1 data carries as `order_units`.
- `EngineOrder` gained nothing else; `EngineDistrict` gained an optional `name`, used only by `explain()` ("any Gampaha reefer trip"), falling back to the id.
- `improveIterations` counts every placement or move the repair pass evaluates, not only the ones it applies, so the bound holds whatever the instance looks like.
- `allocate()` pins `departMin` on each trip it returns, after the plan is final, to the value the schedule derives. It changes no check: `validate()` derives the same number.
- `output.excluded[]` gained `NOT_AN_OPERATING_DAY` beside `NOT_DUE_TODAY`, so every order is accounted for on a non-operating date without inventing deferrals.

### Decided 2026-10-01

- Rule scopes and message wording: the proposals in section 3 are accepted.
- `reeferCarriesAmbient` defaults to `true`; the reefer preference lives in the allocator (see `TEMP_REEFER`).
- `techValueLimitLkr` defaults to `null` (no limit); `TECH_VALUE_LIMIT` is dormant until it is set.
- `LATE_RISK` runs only while `enforceWindows` is on.
- `tripNo` (1 or 2) is the vehicle's slot in the day's plan, unique per plan and vehicle. Trip 1 is the earlier departure; trip 2 departs after trip 1 returns plus the reload.
- Style and Tech clock times come from seeded data, not constants: outlet windows, the depot waves (`depot_waves`), operating days (`calendar_days`) and each Style outlet's delivery day. Budgets come from params and the A6 settings. `validate()` takes an optional `departMin` on a trip and otherwise arrives when the first window opens, clamped into the depot's wave once waves are in `EngineInput`.

- `OPERATING_DAY` inputs: `EngineInput.isOperatingDay` (required boolean; the API reads `calendar_days.isOperating`, the Task 2B export passes `true`) and `styleDeliveryDow` on each outlet (null means no constraint). The weekday comes from `input.date` by integer arithmetic, 0 = Monday.
- Normal path: Ordering sets a Style order's `deliveryDate` to the outlet's next weekly delivery day when it is placed (as a late order rolls to the next run), and the API queues only orders whose `deliveryDate` is the plan date. A not-due Style order therefore never reaches the engine.
- Safety net: `OPERATING_DAY` stays a HARD rule in `validate()` (a manual edit, an API date bug, or `styleDeliveryDow` changed after placement). HARD rules have no override, so a not-due order is never forced through. If one does reach `allocate()`, the pre-screen leaves it out so `validate(allocate(x))` stays free of HARD violations, and lists it in `output.excluded[]` with `NOT_DUE_TODAY`. It is not a deferral: no `deferrals` row and no store notice. `excluded[]` is a rare signal that something upstream went wrong, and the API raises an alert for it. On a non-operating date the allocator plans nothing and returns a plan-level `OPERATING_DAY` violation.
- `choice` and `bindingRule` are real columns on `deferrals` (nullable, null for a manual deferral); `tried[]` and `displacedBy` stay in `reasonDetail`. `swappedForOrderId` is dropped: a dispatcher swap is audited as `planning.order.swapped`.
- The engine owns the code lists (`RULE_CODES`, `DEFERRAL_CHOICES`, the reason map). The `deferral_reasons` seed and the schema enums are generated from them, never typed by hand.

## 10. Differences from other sources

- The planning spec puts the `EditOp` zod union in `packages/shared`. It is defined in the engine instead (`src/manual/edit-ops.ts`), because the engine cannot import the shared root and the web gets the full union, with `SET_DRIVER` and `SET_WAVE`, from the generated api-client.

- The Build Spec's Step 3 text for the engine `CLAUDE.md` lists the allocator as group, rank, pack, sequence, repair and the sort key as priority then id. Step 5 ranks before grouping, adds a pre-screen and a validate step, and breaks ties on window close before ref. This file and `packages/engine/CLAUDE.md` follow Step 5.
- An earlier draft in `packages/shared/src/rules` (`trip-time.ts`, `allocation-validator.ts`) predated Step 5, with nine lower-case rule ids, no windows, fuel or soft rules and no reason map. Nothing used it, so it was deleted on 2026-10-03; the engine is the only home of the rules (architecture rule 8).

## Changelog

- 2026-10-03 Deleted shared's unused draft time model and validator; `deferral_reasons` is now seeded from `DEFERRAL_REASONS` in the reason map
- 2026-10-02 ROO-75: one concept for "on no trip": `applyEdits` adds orders it takes off a trip to `plan.unplanned` (an `Unplanned` entry with no reason yet), `unplannedOrders()` and `isRepeatSkip()` are the shared definitions, and "unassigned" is no longer a separate term
- 2026-10-02 ROO-75: the manual plan helpers (`applyEdits`, `fits`, `optionsForTrip`, `vehicleOptions`, `suggestFixes`), the `EditOp` union, `priorityOf()` with `params.priorityWeights`, and eight edit error codes; `ENGINE_VERSION` 0.3.0
- 2026-10-02 `EngineInputError` carries `code`, `field`, `value` (`INVALID_DATE`, `UNKNOWN_ORDER`, `UNKNOWN_VEHICLE`, `UNKNOWN_DISTRICT`, `UNKNOWN_OUTLET`, `MISSING_ALLOWANCE`); `validate()` checks `input.date` before anything else; the purity test is an allowlist
- 2026-10-02 the engine uses `@waypoint/shared/domain` and `@waypoint/shared/business-time` instead of its own copies; no output change, so `ENGINE_VERSION` stays 0.2.0
- 2026-10-02 ROO-14: the 18 rules, `validate()`, the reason map and 36 fixtures; `ENGINE_VERSION` 0.2.0; params for windows, fuel, reefer, Tech value, late risk and repeat skip
- 2026-09-30 created from the Build Spec
- 2026-10-01 reefer-carries-ambient default on with an allocator preference; Tech value limit off by default; fuel ledger exclusion and trip numbering written down; fixtures renamed to descriptive cases
- 2026-10-01 settled OPERATING_DAY inputs (not-due Style orders are a rare safety-net case); deferral choice and bindingRule columns; engine owns the code lists

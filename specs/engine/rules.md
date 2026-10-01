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

The engine is a deterministic, explainable greedy allocator with a repair pass, written as pure TypeScript. One `EngineInput` goes in; an `EngineOutput` with trips, unplanned orders, violations and stats comes out. The API, the web plan editor, the tests and the Task 2B export all run this code, so a plan the UI shows as valid is the plan the server accepts.

It has no Nest, no database, no `Date.now`, no `Math.random` and no network. The plan date comes in as `input.date` (`YYYY-MM-DD`).

| Path | Holds |
| --- | --- |
| `src/index.ts` | `allocate()`, `validate()`, `explain()`, `optionsForTrip()`, `suggestFixes()`, `ENGINE_VERSION` |
| `src/types.ts`, `src/params.ts` | Core shapes; `DEFAULT_PARAMS` and its zod schema |
| `src/time/` | `trip-minutes.ts` (booklet formula), `schedule.ts` (departure, arrivals, waits, return, reload), `fuel.ts` (km and litres) |
| `src/rules/` | One file per rule, `index.ts` (registry), `reason-map.ts` |
| `validate()` | Runs every enabled rule over a plan or a proposed edit (the engine `CLAUDE.md` names it `validate.ts`) |
| `src/allocate/` | prescreen, priority, groups, pack, sequence, repair, index |
| `src/manual/` | vehicle-options, order-options, suggest-fixes, edits |
| `src/explain.ts` | Violations and unplanned orders as sentences |
| `src/export/task2b.ts` | The Datathon Task 2B CSV and policy draft |
| `src/util/` | `lte`, `round`, `stableSort`, canonical hash |
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

`fixtures/time/booklet-101.json`: Fresh to Gampaha, 3 stops (2 rear dock, 1 street).

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

`fixtures/time/booklet-112.json`: Fresh to Colombo, 4 street stops.

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

`fixtures/time/booklet-213.json`: the same vehicle runs both trips.

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

`fixtures/time/booklet-third-trip.json`: a third trip on that vehicle.

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
| `TEMP_REEFER` | HARD | trip | Every `CHILLED` order rides in a `REEFER` vehicle; with `reeferCarriesAmbient` off, a reefer trip carries `CHILLED` orders only | {ref} is chilled but {code} is not a reefer / {code} is a reefer and carries chilled orders only | `NO_REEFER_CAPACITY` | `TEMP_REEFER.pass.json`, `TEMP_REEFER.fail.json` |
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
| `TECH_VALUE_LIMIT` | SOFT | trip | A TECH trip with Σ `valueLkr` more than `techValueLimitLkr` (250,000) needs a note | Tech trip {tripKey} carries LKR {value}, over the LKR {limit} limit; add a note | — | `TECH_VALUE_LIMIT.pass.json`, `TECH_VALUE_LIMIT.fail.json` |
| `LATE_RISK` | SOFT | trip | Any stop with less than `lateRiskSlackMin` (15) minutes of window slack is flagged | {ref} has {slack} min of window slack, under {limit} | — | `LATE_RISK.pass.json`, `LATE_RISK.fail.json` |

All fixture files live in `fixtures/rules/`. `rules.spec.ts` loads every pair.

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

The same rule objects answer two questions. `validate()` reports violations on a whole plan. `fits(order, trip)` asks whether one more order can join a trip; the packer and the manual editor both call it. So a dimmed order on screen 07 shows exactly the reason the engine would give.

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

## 4. Rule details

Only rules whose check needs more than a table cell. The table's check column is the contract; these notes cover inputs and edges.

### TEMP_REEFER

- Inputs: each order's `tempClass`, `vehicle.temp`, `params.reeferCarriesAmbient`.
- `reeferCarriesAmbient` is `false` by default (Designathon rationale). The booklet allows reefers to carry ambient orders, so the Task 2B export sets it to `true`.
- With it on, only the first half of the check applies.
- Grouping keys trips by chilled or ambient class, so a default plan never mixes the two on one trip.
- Pass: a reefer carries three chilled Fresh orders.
- Fail: an ambient truck carries one chilled order; or, with the default params, a reefer carries one ambient order.

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
- The check is per vehicle, over all of its trips in the plan.
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

- Inputs: `trip.brand`, each order's `valueLkr`, `params.techValueLimitLkr` (250,000).
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

1. **Pre-screen.** For each order, ask whether any available home-depot vehicle could carry it alone: capacity, temperature, access, a one-stop trip inside its window, the budget and fuel left. If none could, the order is unplanned now, marked `UNAVOIDABLE`, with the rule that ruled out the last candidate as `bindingRule`. A chilled order with every reefer in the workshop gets `NO_REEFER_CAPACITY`.
2. **Rank.** Score every remaining order with `priority()` and sort by score descending, then earliest effective window close, then order ref.
3. **Group.** Key orders by brand, district and trip class (chilled or ambient). Van-only outlets stay in their group but mark it as needing a van for any trip that serves them.
4. **Pack.** Process groups scarcest first, by demand over the capacity of vehicles that could serve them, so reefer and van groups claim scarce vehicles before ambient trucks are spread thin. Within a group, walk orders in priority order (largest dominant share first within a priority band) and place each on the open trip where it fits best. When none fits, open a new trip on the eligible vehicle with the most budget and capacity left. "Fits" is the shared `fits(order, trip)`.
5. **Sequence.** Inside each trip, order stops by effective window close, then insert each stop where it adds the least waiting while keeping every window. Trip minutes do not change.
6. **Repair and improve.** Try to place each unplanned order by moving orders between trips of the same group, by opening a second trip on a vehicle with budget left, or by swapping out a lower-priority order that frees exactly enough room. A swapped-out order is `PRIORITY_CHOICE` with `displacedBy`. Stop after `improveIterations` moves.
7. **Validate.** Every rule runs over the final plan. In tests a HARD violation fails the build; in production it appears on the plan as a violation, never silently.

**Repair mode** runs the same pipeline with `fixedTrips` holding everything released or in progress and only the freed orders (a broken-down vehicle's, for example) as input. The result is shown as a diff before anything changes.

**Plan ahead** uses `reserve(input, forecastGroups)`: it packs placeholder orders (`FC-` refs) sized from the forecast with every vehicle rule. A reservation is a trip with no stops that holds a vehicle's capacity and trip slot.

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
- Shuffled input gives byte-identical output.
- An S1-sized input allocates in under 500 ms in Node; `validate()` runs in under 50 ms in the browser.
- The allocator checks a rule before placing an order (`fits` and the pre-screen), not only in the final validate.

### Tests

| Layer | What it proves | File |
| --- | --- | --- |
| Rules | A pass and a fail fixture for each of the 18 rules | `fixtures/rules/*.json`, `rules.spec.ts` |
| Time model | 101, 112 and 213 minutes exactly; a third trip is refused | `time.spec.ts` |
| Allocator | Grouping, packing, sequencing and repair on small hand-built cases | `allocate/*.spec.ts` |
| Properties (fast-check) | 1 to 6 vehicles, up to 40 orders: no HARD violation; every order on one trip or unplanned with a reason; shuffled input gives identical output | `property.spec.ts` |
| Golden S1 | Read from `SEED_DATA_DIR` in CI: no HARD violations, `check_allocation.py` passes, served count and output hash match the snapshot | `golden.spec.ts` |
| Performance | The timings above | `bench/` |

### explain()

`explain(output)` builds sentences from fixed templates. It never invents numbers. The optional AI panel only rephrases these facts and falls back to the template text.

Plan stats: served and deferred by brand and class; utilisation of each scarce resource (reefer volume, van trips, Fresh minutes, Style-Tech minutes, fuel); limiting resources (over 90% used and whose shortage caused deferrals); repeat skips avoided and incurred; deferrals split into unavoidable and chosen, each with its cost in units, m³ and outlets.

Plan sentence, as given in Step 5:

> Reefer capacity was the limit: 11 of 12 reefer trips are full (97% of volume). 7 chilled Fresh orders wait; 5 were unavoidable and 2 made room for outlets skipped yesterday.

Shape: "{Resource} was the limit: {full} of {total} {resource} trips are full ({pct}% of {measure}). {n} {class} {brand} orders wait; {unavoidable} were unavoidable and {chosen} made room for outlets skipped yesterday."

Order sentence, as given in Step 5 (`explainUnplanned`, screen 15):

> WF-0171 waits: it needs 1.8 m³ chilled, and the most space left on any Gampaha reefer trip is 0.6 m³ (REF-07 trip 2). Tried REF-03, REF-07, REF-11.

Shape: "{ref} waits: it needs {need} {unit} {class}, and the most space left on any {district} {vehicle kind} trip is {best} {unit} ({code} trip {tripNo}). Tried {codes}." The numbers come from `Unplanned.detail` and `Unplanned.tried`.

Screen M4 uses the store-safe wording from the reason map, never internal numbers.

## 6. Deferral reasons

Every unplanned order records:

- `reasonCode`: from the reason map below.
- `bindingRule`: the rule that ruled out the last candidate vehicle tried.
- `choice`: `UNAVOIDABLE` when no feasible place existed even after repair; `PRIORITY_CHOICE` when a higher-priority order took its place, with `displacedBy` naming that order.
- `detail` (needed m³, best space left, vehicle tried), `priority`, `repeatSkip`, and `tried[]` as `{ vehicleId, failedRule }`.

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
- `DEPOT_HOME` is never a reason: candidates are filtered before packing.
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

- Runs with the booklet's seven rules only: `enforceWindows=false`, `enforceFuel=false`, `reeferCarriesAmbient=true`. Step 5 changes no other param.
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

- Scope per rule: Step 5 lists the scope values but assigns only `CAP_VOLUME`. Confirm the assignments in section 3.
- Messages: Step 5 fixes only the `CAP_VOLUME` template. Confirm the proposed wording for the other 17.
- `FUEL_WEEKLY` in repair mode: published trips already put planned fuel in the ledger. Does `fuelUsedThisWeek` exclude `fixedTrips` so they are not counted twice? What does a missing entry mean (0 assumed)?
- `TECH_VALUE_LIMIT`: `valueLkr` is optional. Does a missing value count as 0?
- `LATE_RISK`: does it run when `enforceWindows` is off (the Task 2B export)?
- Soft overrides: the engine reports soft violations; which API field stores the override note? (`deferrals.overrideNote` for REPEAT_SKIP; Tech value and late risk notes are still open.)
- Trip order on a vehicle: which trip goes first is not specified. For Fresh it decides whether trip 2 ends before 08:00 (see `BUDGET_FRESH`).
- Fixtures: Step 5 names `fixtures/rules/*.json` but not the folder's place; this file assumes `packages/engine/fixtures/`.

### Decided 2026-10-01

- `OPERATING_DAY` inputs: `EngineInput.isOperatingDay` (required boolean; the API reads `calendar_days.isOperating`, the Task 2B export passes `true`) and `styleDeliveryDow` on each outlet (null means no constraint). The weekday comes from `input.date` by integer arithmetic, 0 = Monday.
- Normal path: Ordering sets a Style order's `deliveryDate` to the outlet's next weekly delivery day when it is placed (as a late order rolls to the next run), and the API queues only orders whose `deliveryDate` is the plan date. A not-due Style order therefore never reaches the engine.
- Safety net: `OPERATING_DAY` stays a HARD rule in `validate()` (a manual edit, an API date bug, or `styleDeliveryDow` changed after placement). HARD rules have no override, so a not-due order is never forced through. If one does reach `allocate()`, the pre-screen leaves it out so `validate(allocate(x))` stays free of HARD violations, and lists it in `output.excluded[]` with `NOT_DUE_TODAY`. It is not a deferral: no `deferrals` row and no store notice. `excluded[]` is a rare signal that something upstream went wrong, and the API raises an alert for it. On a non-operating date the allocator plans nothing and returns a plan-level `OPERATING_DAY` violation.
- `choice` and `bindingRule` are real columns on `deferrals` (nullable, null for a manual deferral); `tried[]` and `displacedBy` stay in `reasonDetail`. `swappedForOrderId` is dropped: a dispatcher swap is audited as `planning.order.swapped`.
- The engine owns the code lists (`RULE_CODES`, `DEFERRAL_CHOICES`, the reason map). The `deferral_reasons` seed and the schema enums are generated from them, never typed by hand.

## 10. Differences from other sources

- The booklet lets reefers carry ambient orders. The engine defaults `reeferCarriesAmbient` to `false`; only the Task 2B export sets it to `true`.
- The Build Spec's Step 3 text for the engine `CLAUDE.md` lists the allocator as group, rank, pack, sequence, repair and the sort key as priority then id. Step 5 ranks before grouping, adds a pre-screen and a validate step, and breaks ties on window close before ref. This file and `packages/engine/CLAUDE.md` follow Step 5.
- The draft in `packages/shared/src/rules` (`trip-time.ts`, `allocation-validator.ts`) predates Step 5:
  - It has 9 lower-case rule ids. They map to `TRIP_BRAND_DISTRICT` (`brand_district`), `TEMP_REEFER` (`refrigeration`), `ACCESS_VAN_ONLY` (`vehicle_access`), `DEPOT_HOME` (`home_depot`), `CAP_WEIGHT` and `CAP_VOLUME` (`capacity_*`), `TRIP_LIMIT` (`max_trips`), `BUDGET_FRESH` and `BUDGET_STYLE_TECH` (`time_budget`), and `VEHICLE_AVAILABLE` (`vehicle_unavailable`).
  - It has no windows, fuel, whole-order, operating-day or soft rules, and no reason map.
  - `refrigeration` allows a reefer to carry ambient orders (booklet behaviour, not the engine default).
  - It compares floats with `>` instead of `lte`.
  - It picks a trip's budget window from its first order's brand, and compares with `'Fresh'` while `domain.ts` now uses `'FRESH'`.
  - `tripMinutes` takes precomputed handling minutes; Step 5's takes the district, brand, dock types and allowances. The formula and the 101 and 112 results agree.

## Changelog

- 2026-09-30 created from the Build Spec
- 2026-10-01 settled OPERATING_DAY inputs (not-due Style orders are a rare safety-net case); deferral choice and bindingRule columns; engine owns the code lists

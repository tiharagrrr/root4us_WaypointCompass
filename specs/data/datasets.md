# Datasets

The column dictionary for every CSV file in the Challenge Booklet (pages 7 and 15 to 31), mapped to
the tables in Step 1 of the Build Spec. Owner: Harini (master data and seed).

> **No data rows here, on purpose.** The booklet's terms (page 22) forbid sharing, distributing or
> transmitting the datasets in any form, and sending rows to an AI service arguably counts. So:
>
> - Agents never open, list, grep or read anything under `data/seed/`. The shared settings deny it.
> - This file holds column names, types, units, the categorical codes the booklet defines and the
>   ranges it states. It holds no rows, no ID lists, no outlet names and no values from the CSVs.
> - Tests use hand-built fixtures (see Building a fixture).
> - The seed reads the real files from `SEED_DATA_DIR` at runtime. The engine's golden S1 test
>   (`golden.spec.ts`) reads them from `SEED_DATA_DIR` in CI only, never through an agent.
>
> If you need something this file doesn't say, add it to Open questions and ask a person.

## At a glance

The booklet ships the files in four folders: `General Data/` (reference tables), `Training Data/`,
`Test Data/` and `Submission Templates/`.

| File | One row per | Loads into |
| --- | --- | --- |
| `outlets.csv` | outlet | `outlets` |
| `vehicles.csv` | vehicle | `vehicles` |
| `calendar.csv` | calendar date | `calendar_days` |
| `district_travel.csv` | district | `districts` |
| `service_allowance.csv` | brand and dock type | `service_allowances` |
| `traffic_speed.csv` | district, hour and monsoon flag | `traffic_speeds` |
| `road_conditions.csv` | date and district | `road_conditions` |
| `deliveries_train.csv` | historical order | 14 days of history: `orders`, `plans`, `trips`, `stops`, `receipts` |
| `route_legs_train.csv` | historical route leg | nothing (Datathon only) |
| `task1_test_inputs.csv` | order in the Task 1 period | nothing (Datathon only) |
| `route_legs_test.csv` | route leg in the Task 1 period | nothing (Datathon only) |
| `task2a_test_inputs.csv` | depot, brand and forecast week | `demand_forecasts`, through the Task 2A submission |
| `task2b_peak_day_scenarios.csv` | order in scenario S1 | demo day D: `orders`, `order_lines`, `deferrals` |
| `task2b_peak_day_fleet.csv` | vehicle in scenario S1 | `vehicles.status` |
| `submission_task1.csv`, `submission_task2a.csv`, `submission_task2b.csv` | template row | see Submission templates |

## Conventions

- Clock times are `HH:MM` in Asia/Colombo; columns ending `_time` hold them. The import converts
  each to minutes after midnight in a `minutes()` column (`05:30` becomes `330`).
- Durations are minutes; columns ending `_duration_min` hold them.
- Flags are `0` or `1`; the import turns them into booleans.
- Categorical codes are lower case in the files and upper-case Postgres enums in the database
  (`van_only` becomes `VAN_ONLY`). Brands `Fresh`, `Style`, `Tech` become `FRESH`, `STYLE`, `TECH`.
- Depot names become depot codes: Peliyagoda is `PLG`, Kandy is `KDY`. District names become slugs.
- `dow` counts from `0` = Monday, in the files and in the database. JavaScript's `getDay()` counts
  from Sunday, so never mix the two.
- The booklet doesn't state the date format. Parse dates strictly and fail loudly.
- The column order below follows the booklet's tables, which may not be the header order. Importers
  map by header name, never by position.

## Reference files

### outlets.csv

The 120 outlets with brand, district, depot, physical access and delivery windows. One row per
outlet. Loads into `outlets`; the seed generates `name`, `address`, `lat`, `lng` and the receiving
contact, which the file doesn't have.

| Column | Type | Unit | Allowed values or range | Meaning | Maps to (table.column) |
| --- | --- | --- | --- | --- | --- |
| `outlet_id` | string | — | `OUT` plus three digits, 001 to 120 | Outlet identifier | `outlets.id` (natural key) |
| `brand` | string | — | `Fresh`, `Style`, `Tech` | Brand the outlet trades as | `outlets.brand` |
| `district` | string | — | one of 12 districts | District the outlet sits in | `outlets.districtId` (slug) |
| `depot` | string | — | `Peliyagoda`, `Kandy` | Assigned depot | `outlets.depotId` |
| `dock_type` | string | — | `rear_dock`, `street`, `mall_bay` | Proper loading bay; curbside unloading; shared mall bay | `outlets.dockType` |
| `parking_constraint` | string | — | `normal`, `van_only`, `mall_dock` | Any vehicle; trucks cannot reach it; access only inside the mall's window | `outlets.parkingConstraint` |
| `mall_window` | string | `HH:MM-HH:MM` | blank for outlets outside malls | Fixed mall delivery window | `outlets.mallWindowOpenMin`, `outlets.mallWindowCloseMin` (blank gives two nulls) |
| `window_open_time` | string | `HH:MM` | clock time | Start of the requested delivery window | `outlets.windowOpenMin` |
| `window_close_time` | string | `HH:MM` | later than the open time (schema CHECK) | End of the requested delivery window | `outlets.windowCloseMin` |

### vehicles.csv

The 60 vehicles with type, temperature capability, capacity, fuel profile and home depot. One row
per vehicle. Loads into `vehicles`; the seed assigns `code` (reefer trucks `REF-nn`, ambient trucks
`DRY-nn`, vans `VAN-nn`, by depot then id) and a synthetic `registrationNo`.

| Column | Type | Unit | Allowed values or range | Meaning | Maps to (table.column) |
| --- | --- | --- | --- | --- | --- |
| `vehicle_id` | string | — | `VEH` plus three digits, 001 to 060 | Vehicle identifier | `vehicles.id` (natural key) |
| `type` | string | — | `truck`, `van` | Only vans may serve `van_only` outlets | `vehicles.type` |
| `temp` | string | — | `reefer`, `ambient` | Reefer carries chilled or ambient; ambient cannot carry chilled | `vehicles.temp` |
| `weight_cap_kg` | number | kg | above 0 (schema CHECK) | Maximum weight per trip | `vehicles.weightCapKg` |
| `volume_cap_m3` | number | m³ | above 0 (schema CHECK) | Maximum volume per trip | `vehicles.volumeCapM3` |
| `fuel_type` | string | — | not enumerated in the booklet | Fuel type | `vehicles.fuelType` (as is) |
| `km_per_l` | number | km/L | above 0 (schema CHECK) | Fuel economy | `vehicles.kmPerL` |
| `weekly_fuel_quota_l` | number | L | not stated | Weekly fuel quota; route distance consumes it | `vehicles.weeklyFuelQuotaL` |
| `depot` | string | — | `Peliyagoda`, `Kandy` | Home depot; the vehicle serves only that depot's outlets | `vehicles.depotId` |

### calendar.csv

Calendar context across the history and the forecast horizon. One row per date. Loads into
`calendar_days`.

| Column | Type | Unit | Allowed values or range | Meaning | Maps to (table.column) |
| --- | --- | --- | --- | --- | --- |
| `date` | date | — | every date in the horizon | The calendar date | `calendar_days.date` |
| `dow` | integer | — | 0 to 6, 0 = Monday | Day number | `calendar_days.dow` |
| `dow_name` | string | — | day name | Day name | not stored |
| `is_weekend` | 0 or 1 | — | 0, 1 | Weekend flag | `calendar_days.isWeekend` |
| `iso_year` | integer | — | ISO year | Groups demand by ISO week | `calendar_days.isoYear` |
| `iso_week` | integer | — | ISO week number | Groups demand by ISO week | `calendar_days.isoWeek` |
| `is_payday` | 0 or 1 | — | 0, 1 | 1 on payday | `calendar_days.isPayday` |
| `festival` | string | — | festival name, or blank | Name on the festival date only | `calendar_days.festival` (blank gives null) |
| `festival_ramp` | number | — | 0 to 1 | Rises over the nine days before a festival; 1 on the day | `calendar_days.festivalRamp` |
| `is_holiday` | 0 or 1 | — | 0, 1 | 1 on a festival date or public holiday | `calendar_days.isHoliday` |
| `monsoon` | 0 or 1 | — | 0, 1 | 1 in a monsoon or inter-monsoon month | `calendar_days.monsoon` |
| `is_operating` | 0 or 1 | — | 0, 1 | 1 when deliveries operate | `calendar_days.isOperating` |

### district_travel.csv

District travel distances and free-flow times. One row per district. Loads into `districts`; the
seed adds `centroidLat` and `centroidLng` for the map, which the file doesn't have.

| Column | Type | Unit | Allowed values or range | Meaning | Maps to (table.column) |
| --- | --- | --- | --- | --- | --- |
| `district` | string | — | one of 12 districts | District name | `districts.id` (slug), `districts.name` |
| `depot` | string | — | `Peliyagoda`, `Kandy` | Depot that serves the district | `districts.depotId` |
| `road_class` | string | — | `urban`, `suburban`, `highway`, `hill` | Road class | `districts.roadClass` |
| `free_flow_kmh` | number | km/h | not stated | Clear-road speed assumed in the plan | `districts.freeFlowKmh` |
| `depot_to_district_km` | number | km | not stated | Depot to district distance | `districts.depotToDistrictKm` |
| `depot_to_district_freeflow_min` | number | minutes | not stated | Clear-road time, depot to district; counted once per trip | `districts.depotToDistrictMin` |
| `inter_stop_km` | number | km | not stated | Typical distance between outlets in the district | `districts.interStopKm` |
| `inter_stop_freeflow_min` | number | minutes | not stated | Typical clear-road time between outlets; counted n − 1 times | `districts.interStopMin` |

### service_allowance.csv

The dispatcher's standard handling-time allowance. One row per brand and dock type. Loads into
`service_allowances` (primary key brand and dock type).

| Column | Type | Unit | Allowed values or range | Meaning | Maps to (table.column) |
| --- | --- | --- | --- | --- | --- |
| `brand` | string | — | `Fresh`, `Style`, `Tech` | Brand of the trip | `service_allowances.brand` |
| `dock_type` | string | — | `rear_dock`, `street`, `mall_bay` | Dock type of the outlet | `service_allowances.dockType` |
| `service_allowance_min` | number | minutes | not stated | Handling time budgeted per stop; a planning allowance, not an observed duration | `service_allowances.minutes` |

### traffic_speed.csv

Typical congestion by district and hour. Loads into `traffic_speeds` (primary key district, hour,
monsoon). The booklet documents only two columns; the district and hour column names are unknown.

| Column | Type | Unit | Allowed values or range | Meaning | Maps to (table.column) |
| --- | --- | --- | --- | --- | --- |
| `monsoon` | 0 or 1 | — | 0, 1 | 1 in a monsoon or inter-monsoon month | `traffic_speeds.monsoon` |
| `speed_index` | number | — | 100 = free flow; lower is slower | Speed relative to clear roads | `traffic_speeds.speedIndex` |
| district, hour (names undocumented) | — | — | — | Key columns | `traffic_speeds.districtId`, `traffic_speeds.hour` |

### road_conditions.csv

Date-specific district disruptions such as roadworks, flooding or incidents. Loads into
`road_conditions` (primary key date and district). The booklet documents only one column.

| Column | Type | Unit | Allowed values or range | Meaning | Maps to (table.column) |
| --- | --- | --- | --- | --- | --- |
| `disruption_index` | number | — | 100 = clear; lower means disruption | Disruption in a district on a date | `road_conditions.disruptionIndex` |
| date, district (names undocumented) | — | — | — | Key columns | `road_conditions.date`, `road_conditions.districtId` |

## History and Datathon files

### deliveries_train.csv and task1_test_inputs.csv

Order records. One row per order. In `deliveries_train.csv`, each dispatched order is its own stop,
and its `route_id` plus `seq_in_route` match exactly one route leg. `task1_test_inputs.csv` has the
same columns for a later period, and every row in it was dispatched.

The seed builds the 14 operating days before the demo day from `deliveries_train.csv`, with dates
shifted, as closed plans with trips, stops and receipts. `task1_test_inputs.csv` is not loaded.
Step 1 doesn't give a column-by-column transform for history, so the mappings below are
**proposed** (see Open questions).

| Column | Type | Unit | Allowed values or range | Meaning | Maps to (table.column) |
| --- | --- | --- | --- | --- | --- |
| `delivery_id` | string | — | unique | Order identifier; the Task 1 prediction key | `orders.externalRef` |
| `order_date` | date | — | — | The date the store's order was for | `orders.requestedDate` (shifted) |
| `dispatch_date` | date | — | blank if the order never ran | Date the order was dispatched | `orders.deliveryDate`, `plans.date` (shifted) |
| `dispatch_status` | string | — | `attempted`, `deferred`, `not_run` | Ran on `order_date`; ran later because capacity was short; never ran | `deferrals` row when `deferred`; `orders.status` |
| `outlet_id`, `brand`, `district`, `depot` | string | — | as in `outlets.csv` | Outlet information | `orders.outletId`, `orders.brand`, `orders.districtId`, `orders.depotId` |
| `temp_requirement` | string | — | `chilled`, `ambient` | Chilled needs a refrigerated vehicle | `orders.tempClass` |
| `order_units` | integer | units | — | Number of items or cases | `orders.units` |
| `order_weight_kg` | number | kg | — | Order weight | `orders.weightKg` |
| `order_volume_m3` | number | m³ | — | Order volume | `orders.volumeM3` |
| `route_id` | string | — | blank if the order never ran | Route carrying the order; one route serves one depot, brand and district | groups rows into `trips` (not stored) |
| `seq_in_route` | integer | — | starts at 0 | Position on the route | `stops.seq` |
| `vehicle_id`, `vehicle_type`, `vehicle_temp` | string | — | as in `vehicles.csv` | Vehicle assigned to the order | `trips.vehicleId` (type and temp only cross-check) |
| `planned_arrival_time` | `HH:MM` | — | clock time | Planned arrival | `stops.plannedArrivalAt` |
| `window_open_time` | `HH:MM` | — | clock time | Start of the outlet's requested window | `stops.windowOpenMin` (snapshot) |
| `window_close_time` | `HH:MM` | — | clock time | End of the outlet's requested window | `stops.windowCloseMin` (snapshot) |

### route_legs_train.csv and route_legs_test.csv

Route legs, from the depot or the previous outlet to the next outlet. One row per leg. The training
file has planned and actual times; the test file has planned times only. Neither is loaded by the
seed.

| Column | Type | Unit | Allowed values or range | Meaning | Maps to (table.column) |
| --- | --- | --- | --- | --- | --- |
| `leg_id` | string | — | unique | Route-leg identifier | — |
| `date` | date | — | — | Date the route ran | — |
| `route_id` | string | — | — | Route identifier | — |
| `seq` | integer | — | starts at 0 | Position on the route | — |
| `depot`, `vehicle_id`, `vehicle_type`, `vehicle_temp`, `brand`, `district` | string | — | as in the reference files | Route attributes; one depot, brand and district per route | — |
| `from_point` | string | — | `DEPOT` for the first leg, else the previous outlet | Where the leg starts | — |
| `to_outlet` | string | — | an outlet id | Outlet served by this leg | — |
| `distance_km` | number | km | — | Road distance | — |
| `planned_depart_time` | `HH:MM` | — | clock time | Planned departure from the previous point | — |
| `planned_travel_duration_min` | number | minutes | — | Planned travel under clear-road assumptions | — |
| `planned_arrival_time` | `HH:MM` | — | clock time | Planned arrival at the outlet | — |
| `actual_depart_time` | `HH:MM` | — | training file only | Actual departure from the previous point | — |
| `actual_travel_duration_min` | number | minutes | training file only | Actual travel duration | — |
| `arrival_time` | `HH:MM` | — | training file only | Actual arrival at the outlet | — |
| `leave_outlet_time` | `HH:MM` | — | training file only | When the vehicle left after the delivery | — |
| `monsoon` | 0 or 1 | — | 0, 1 | 1 in a monsoon or inter-monsoon month | — |
| `dow` | integer | — | 0 to 6, 0 = Monday | Day of the week | — |

### task2a_test_inputs.csv

The Task 2A forecast grid: one row per depot, brand and forecast week, over 10 future weeks. The
booklet names only `row_id`, the key that `submission_task2a.csv` keeps. The depot, brand and week
column names are undocumented. The product loads the team's forecast through
`POST /forecasts/import` into `demand_forecasts` with `source = DATATHON`.

| Column | Type | Unit | Allowed values or range | Meaning | Maps to (table.column) |
| --- | --- | --- | --- | --- | --- |
| `row_id` | string | — | unique | Row identifier | joins to `submission_task2a.csv` |
| depot, brand, week (names undocumented) | — | — | 10 future ISO weeks | The forecast cell | `demand_forecasts.depotId`, `.brand`, `.isoYear`, `.isoWeek` |

## Scenario S1

S1 is one dispatch day at Peliyagoda where demand exceeds the fleet. A festival is one week away,
Fresh demand is rising (dairy, meat, produce), it is not a payday, there is no monsoon, and several
vehicles are in the workshop. The seed makes it the demo day D, and asserts after seeding that S1
demand exceeds the available capacity.

### task2b_peak_day_scenarios.csv

Every S1 order with the facts needed to allocate or defer it. One row per order. Loads into
`orders` on day D (status `CONFIRMED`), with catalog `order_lines` that sum exactly to the order's
totals (the last line uses the brand's adjustment item), and `deferrals`.

| Column | Type | Unit | Allowed values or range | Meaning | Maps to (table.column) |
| --- | --- | --- | --- | --- | --- |
| `scenario` | string | — | always `S1` | Scenario identifier | — |
| `order_ref` | string | — | unique within the scenario; `S1-` prefix | Order identifier and the allocation key | `orders.externalRef` |
| `outlet_id` | string | — | an outlet id; may repeat | Outlet placing the order | `orders.outletId` |
| `brand`, `district`, `depot` | string | — | as in `outlets.csv` | Outlet and network identifiers | `orders.brand`, `orders.districtId`, `orders.depotId` |
| `dock_type`, `parking_constraint`, `mall_window`, `window_open_time`, `window_close_time` | string | — | as in `outlets.csv` | Outlet access and window, copied into the file | not stored; the `outlets` row is the source |
| `temp_requirement` | string | — | `chilled`, `ambient` | Temperature class | `orders.tempClass` |
| `order_units` | number | units | — | Order size | `orders.units` |
| `order_weight_kg` | number | kg | — | Order weight | `orders.weightKg` |
| `order_volume_m3` | number | m³ | — | Order volume | `orders.volumeM3` |
| `deferred_yesterday` | 0 or 1 | — | 0, 1 | 1 if the outlet was skipped on the previous run | a `CONFIRMED` deferral on D−1; the engine's repeat-skip priority |
| `days_since_last_served` | integer | days | — | Days since the outlet last received a delivery | the outlet's last delivered stop in the seeded history |

### task2b_peak_day_fleet.csv

Vehicle availability on the S1 day. One row per vehicle in the scenario. Loads into
`vehicles.status`; capacity, temperature and home depot come from `vehicles.csv`.

| Column | Type | Unit | Allowed values or range | Meaning | Maps to (table.column) |
| --- | --- | --- | --- | --- | --- |
| `scenario` | string | — | always `S1` | Scenario identifier | — |
| `vehicle_id` | string | — | a vehicle id | Vehicle | `vehicles.id` |
| `status` | string | — | available, `in_workshop` | Available vehicles can be allocated; workshop vehicles cannot | `vehicles.status` (`in_workshop` gives `WORKSHOP`, available gives `ACTIVE`) |

## Submission templates and the checker

None of these is seeded. Keep every supplied identifier and row unchanged; Task 1 also keeps the
row order.

| File | Columns | Notes |
| --- | --- | --- |
| `submission_task1.csv` | `delivery_id` (string), `pred_service_min` (number, minutes), `pred_late_prob` (number, 0 to 1) | Fill only the two prediction columns |
| `submission_task2a.csv` | `row_id` (string), `pred_total_volume_m3` (number, m³), `pred_chilled_volume_m3` (number, m³) | Chilled is 0 for Style and Tech; feeds `demand_forecasts.totalVolumeM3` and `.chilledVolumeM3` |
| `submission_task2b.csv` | `scenario` (always `S1`), `order_ref`, `outlet_id`, `decision` (`served` or `deferred`), `vehicle_id` (blank if deferred), `trip_id` (1 or 2, blank if deferred) | Written by `pnpm engine:task2b`; checked by `check_allocation.py` |

`check_allocation.py` checks a Task 2B allocation against the booklet's seven feasibility rules:
one brand and district per trip, chilled needs a reefer, `van_only` needs a van, home depot only,
whole orders, weight and volume capacity, and at most two trips per vehicle within the daily
budgets (Fresh 270 minutes between 03:30 and 08:00; Style and Tech together 480 minutes). Trip
minutes are the outbound time once, plus `inter_stop_freeflow_min` times (orders − 1), plus each
stop's service allowance, with no return leg.

## Not in the datasets

The seed generates these, deterministically: depot details and depot waves, outlet names ("Brand
Town" from a fixed town list per district), addresses, map coordinates and receiving contacts,
vehicle codes and plates, district centroids, the item catalog (Fresh 50 items, 32 dry and 18
chilled; Style about 20; Tech about 15; one adjustment item per brand and class), users, settings
and deferral reasons.

## Known quirks

- **Counts.** 120 outlets (80 Fresh, 25 Style, 15 Tech), 60 vehicles (12 reefer trucks, 40 dry-box
  trucks, 8 vans of which 4 are refrigerated, so 16 can carry chilled), two depots, 12 districts.
  The seed prints its counts after loading.
- **Design against data.** The schema review lists mismatches between the Day 5 design and the
  datasets: Wattala's window, REF-07's departure, 86 against 120 outlets, a Sunday on screen 12,
  and a Fresh trip 2 at 11:00. The data wins. The seed uses the booklet's datasets and the README
  logs each difference. Waypoint operates Monday to Saturday (`is_operating` decides each date), and
  the Fresh budget runs 03:30 to 08:00, so a screen that shows otherwise is a logged departure.
- **Windows.** Fresh must arrive before stores open at 08:00, but individual outlet windows differ,
  so read each outlet's window. For `mall_dock` outlets the effective window is the outlet window
  intersected with the mall window. Early arrivals wait; lateness means arriving after the window
  closes.
- **Two orders per outlet.** A Fresh outlet can have a dry and a chilled order for the same day, so
  `outlet_id` repeats in S1. Key on `order_ref`.
- **Chilled.** Only Fresh has chilled demand. The booklet lets reefers carry ambient goods; the
  design assumed chilled only, so the engine keeps `reeferCarriesAmbient` as a switch.
- **Style days.** Style orders weekly for a scheduled delivery day, but `outlets.csv` has no
  delivery-day column (see Open questions).
- **Task 2A.** Count every order once, including `deferred` and `not_run`, in the week the store
  requested it (`order_date`), using the calendar's ISO year and week.
- **Datathon labels.** Service time and lateness are not columns anywhere. Only the training route
  legs have actual times.
- **Traffic.** Planning uses free-flow times, as the booklet does; `speed_index` and
  `disruption_index` feed live ETAs and the optional `trafficAware` mode.
- **S1 export against demo day.** `pnpm engine:task2b` runs only the booklet's seven rules. The
  demo day plans the same orders with windows and fuel on, so the two plans can differ.

## Building a fixture

Tests never read `data/seed/` or `SEED_DATA_DIR`. Build the smallest instance that proves the case:

1. Pick one depot (two only for cross-depot rules), one or two districts, a few outlets and
   vehicles, the service allowances for the brands and dock types you use, and the calendar dates
   you touch. API tests can start from `seedMinimal()` (2 depots, 6 outlets, 6 vehicles).
2. Invent the values. Use round numbers so a reader can check totals by hand. Don't recall or
   paraphrase real rows. The booklet's worked trip examples (101, 112 and 213 minutes, page 21) are
   published in the booklet, so the time-model fixtures may use them.
3. Use IDs in the right shape that are clearly not real, such as `OUT901`, `VEH901` or the district
   slug `test-district`.
4. Write values in the form the code under test expects: enums, minutes after midnight, booleans and
   depot codes for the engine and services; a short inline CSV string with header names from this
   file for importer tests, written to a temporary directory.
5. Respect the constraints: close after open, both mall-window ends or neither, capacities and km
   per litre above 0, an outlet's depot, brand and district matching its orders and stops, each
   district served by one depot, vehicles only at their home depot, chilled only for Fresh, trip 1
   or 2.
6. Give each engine rule a passing and a failing fixture in the engine's `fixtures/rules/`, named
   after what it proves.

```ts
// Invented values for a test; nothing here comes from data/seed. Match the shape the code under
// test takes (engine input types, Drizzle insert types or CSV text).
const outlet = { id: 'OUT901', brand: 'FRESH', districtId: 'test-district', depotId: 'PLG',
  dockType: 'REAR_DOCK', parkingConstraint: 'NORMAL', windowOpenMin: 240, windowCloseMin: 420 };
const vehicle = { id: 'VEH901', type: 'TRUCK', temp: 'REEFER', depotId: 'PLG',
  weightCapKg: 1000, volumeCapM3: 10, kmPerL: 5, weeklyFuelQuotaL: 200 };
```

## Open questions

- What are the header names of the key columns in `traffic_speed.csv` (district, hour) and
  `road_conditions.csv` (date, district)? A person must confirm them for the importer.
- What are the depot, brand and week column names in `task2a_test_inputs.csv`? Does
  `POST /forecasts/import` take the Task 2A submission joined to it on `row_id`?
- Where does `outlets.styleDeliveryDow` come from? `outlets.csv` has no delivery-day column. Should
  the seed derive it from history, or generate it? The team's Supabase draft keeps one
  `delivery_day` per brand, which suggests every Style outlet gets the same day.
- How does history map exactly? Does `delivery_id` go to `orders.externalRef`? Which status and
  `deliveryDate` do `not_run` rows get? Do the actual times in `route_legs_train.csv` fill
  `stops.arrivedAt` and `stops.completedAt` for the 14 history days?
- What is the exact literal for an available vehicle in `task2b_peak_day_fleet.csv`?
- Does `SEED_DATA_DIR` keep the booklet's folders (`General Data/` and so on) or a flat layout, as
  the `pnpm engine:task2b` example assumes?
- If an S1 row's copied outlet fields differ from `outlets.csv`, which wins? The proposal is
  `outlets.csv`, because orders don't store them.
- The schema review holds the design mismatches' details, and it isn't in the Build Spec. Link it
  here once it's in `docs/`.

## Changelog

- 2026-09-30 created from the booklet and the Build Spec

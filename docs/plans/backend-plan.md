# Backend plan: fixes, Planning API, critical backend tickets

Written 2026-10-03 against `main` at 4271573. Hand one PR section at a time to the implementing model.

## How to work (applies to every PR)

- Read `CLAUDE.md`, `apps/backend/CLAUDE.md`, the module's `specs/<module>/spec.md` and
  `specs/api-conventions.md` before coding. Follow the existing patterns; copy from the files named
  under "Pattern to copy".
- One PR per section, on its own branch (`<type>/roo-<n>-<short>`), created from up-to-date `main`.
- Write the tests first and show them failing. Name each test after its AC:
  `it('AC-PLN-08 one plan per depot and date')`.
- `pnpm check` must be green. Backend DB suites need `TEST_DATABASE_URL` (see `apps/backend/CLAUDE.md`).
- Update the spec in the same PR: tick the ACs, and add a changelog line plus any decision below that
  the PR relies on.
- Add a row to `docs/ai-log.md`.
- After any controller or DTO change, run `pnpm api:gen` and commit `openapi.json` plus the
  generated client. Never hand-edit `packages/api-client/src/gen`.
- At most one migration per PR. Never edit an applied migration.
- Do not: read `.env` files, open `data/seed/`, add dependencies, re-implement an engine rule,
  or skip a failing test.
- Keep it simple. No new abstractions beyond the services named here. No generic frameworks.

## Decisions this plan relies on

Record each one in `specs/planning/spec.md` (under "Open questions" or "Model") in the PR that first
uses it.

- **D1. Unplanned is derived; deferral rows store decisions.** An order is unplanned when it is
  CONFIRMED for the plan's depot and date and has no live stop (stop status not CANCELLED or
  FAILED). `deferrals` rows only hold reasons and decisions: PROPOSED (from the engine), CONFIRMED
  (from the dispatcher), or CANCELLED. An order removed by hand has no deferral row until the
  dispatcher decides, so `/unplanned` shows it with `reasonCode: null`. Each order has at most one
  live deferral (PROPOSED or CONFIRMED) per plan: cancel the old one before inserting a new one.
- **D2. `orders.activeStopId` is set only at publish**, through `OrderLifecycleService.markPlanned`.
  In a DRAFT plan, the `stops` table is the source of truth.
- **D3. One writer for trips and stops.** `PlanWriter.save(planId, enginePlan)` turns the engine's
  `Plan` into rows. Edits, decisions and engine runs all use it. No other code inserts trips or
  stops.
- **D4. Errors.**
  - **Publish blockers are shown before publishing, not discovered by publishing.**
    - The plan carries the `publish` link only when publishing is open and there are no blockers,
      so the web greys out Publish (architecture rule 9).
    - `publish-preview` lists each blocker with what to fix:
      `{ kind, orderId?, orderNo?, tripId?, tripKey?, rule?, message }`, where `kind` is
      `HARD_VIOLATION`, `NO_DRIVER` or `UNDECIDED_ORDER`. The screen shows the reason next to that
      order or trip.
    - The server still checks on `POST publish`, because two dispatchers can race. In that case
      it returns 409 `CONFLICT_STATE` with the same `blockers[]`.
  - A soft violation without an override note returns 422 `PLAN_RULE_VIOLATION`, listing the soft
    violations.
  - An `EngineInputError` becomes 400 `VALIDATION_FAILED`, with the error's `field` and `code`.
- **D5. A trip with no orders never stays in the plan.** It is set to CANCELLED with `tripNo`
  null (this frees the vehicle's slot). It is never a blocker.
  - `PlanWriter.save` cancels any trip left with no stops, except reserved trips (12, 13), which
    are meant to be empty until the engine fills them.
  - Publish cancels the reserved trips that are still empty.
  - In the wizard, the vehicle and its orders are saved together in one edit list (ADD_TRIP plus
    the ASSIGN_ORDERs), so an empty trip only appears when every order is taken off it.
- **D6. The store hears about a deferral only at publish.** In a draft, a decision can still be
  undone: a later PLAN_ON or SWAP cancels it. So the DEFER decision writes its audit row, and the
  `deferral.confirmed` outbox event is emitted by publish, one per CONFIRMED deferral.
  - **Spec change:** AC-PLN-16 currently puts the event at the decision. Amend it in PR-5, and
    close the matching open question.
  - A store manager's `/deferrals` shows only deferrals on PUBLISHED or CLOSED plans.
- **D7. Revision 1 (publish) uses `reasonCode: 'PUBLISH'`.** `plan_revisions.reasonCode` is plain
  text, not a foreign key to `deferral_reasons`.
- **D8. A deferral's `toDate`** is the next run after the plan's date: ordering's
  `CutoffService.nextRun(plan.date, { brand, styleDeliveryDow })`. That is the next operating day,
  or for a Style outlet its next weekly delivery day. Any other date would make the engine exclude
  the order as NOT_DUE_TODAY. `DeferralService.deferralDate(orderId, planDate)` already does this
  (PR-A); PR-5 reuses it.
- **D9. The edits body** is `{ ops: unknown[], reasonCode?, note?, overrideNote? }`.
  - The service parses `ops` with the engine's `editOpSchema`, extended in planning by two zod
    variants: `SET_DRIVER { tripKey, driverId }` and `SET_WAVE { tripKey, waveId }`.
  - Swagger documents `ops` as `oneOf` the ten op DTO classes (`@ApiExtraModels`), for docs and
    mocks only.
  - An unknown op returns 400 `VALIDATION_FAILED`.
- **D10. A deferred order stays DEFERRED until it is planned again.** It never goes back to
  CONFIRMED.
  - **Machine change:** the order machine in `packages/shared` gains `DEFERRED: { PLAN → PLANNED,
    DEFER → DEFERRED }`. DEFER adds 1 to `deferredCount` again.
  - **Queue:** the planning queue is CONFIRMED and DEFERRED orders whose `deliveryDate` is the plan
    date.
  - **No requeue at cutoff:** cutoff close does not requeue anything.
  - **Specs to update:** the ordering spec's machine and `specs/planning/spec.md`, in PR-B.

## The deferred order's flow (what each person sees)

| Step | Order status | Deferral | Store manager sees |
| --- | --- | --- | --- |
| Cutoff passes (16:00) | CONFIRMED | none | M3: "Confirmed" |
| Engine run on the draft can't fit it | CONFIRMED | PROPOSED, engine reason | nothing |
| Dispatcher decides DEFER on 15 or 16 (reason and note) | CONFIRMED | CONFIRMED, `toDate` set (D8), `storeResponse` AWAITING | nothing: the draft can still change |
| Dispatcher changes their mind (PLAN_ON or SWAP) | CONFIRMED | CANCELLED | nothing |
| Plan published | DEFERRED, `deliveryDate` = `toDate`, `deferredCount` +1 | CONFIRMED | a `deferral.confirmed` notice (M4) with the reason text and the dispatcher's note; M3: "Deferred to Sat 3 Oct"; the deferral appears in M7 |
| Store responds on M4 | DEFERRED | `storeResponse` ACKNOWLEDGED or PRIORITY_REQUESTED (+ note) | no respond button any more |
| (priority requested) | DEFERRED | same | the dispatchers get a PRIORITY_REQUEST alert. They can mark the order urgent, which raises its priority in the next plan |
| Next day: cutoff for `toDate` | DEFERRED (no change) | same | M3: still "Deferred to Sat 3 Oct" |
| Next day's plan: the engine sees it in the queue, its priority raised by `deferredCount` | DEFERRED | the old row stays as history | nothing until publish |
| Next plan published with the order on a trip | PLANNED | old row unchanged | M3: "Planned" with its trip and ETA |
| …or deferred again | DEFERRED, `deferredCount` +1 | a new CONFIRMED row; the engine flags `repeatSkip`, so the dispatcher must give an override note (AC-PLN-05) | a new M4 notice |

Rules this table depends on:
- **The store's response never changes the order.** ACKNOWLEDGED, PRIORITY_REQUESTED or no answer
  at all: the order stays DEFERRED with its new `deliveryDate`, so `queueFor` picks it up for that
  date either way. Only cancelling the order (DEFERRED → CANCELLED) takes it out of the queue.
- **Respond link:** the `respond` link appears only while the deferral's `storeResponse` is
  AWAITING, its plan is PUBLISHED or CLOSED, and the order is still DEFERRED. Once the order is
  planned again, there is nothing left to respond to.
- **Store reads:** store managers never see PROPOSED deferrals, or any deferral on a DRAFT plan.
  Enforce this in the deferral `ScopePolicy`, not in the controller.
- **Partial deferrals:** a load-check removal (`deferPartially`, source LOAD_CHECK) happens after
  publish. It does not move the parent order's status; its backorder is a new CONFIRMED order.
  - The store is already told: loading's `load_flag.decided` event is routed to the order's
    outlet. So `deferPartially` emits no `deferral.confirmed`; emitting one would notify the store
    twice.

## Logic that does not match the spec (fix first)

| # | Problem | Where | Effect |
| --- | --- | --- | --- |
| 1 | The seed inserts deferral reasons `REEFER_CAPACITY`, `VEHICLE_CAPACITY`, `MANUAL` from `@waypoint/shared` `ENGINE_DEFERRAL_REASONS`. The engine emits `NO_REEFER_CAPACITY`, `OVER_CAPACITY`, `VEHICLE_BREAKDOWN`, `ACCESS_ISSUE`, `STORE_REQUEST`, `OTHER` (`packages/engine/src/rules/reason-map.ts`). | `apps/backend/src/db/seed.ts:359`, `packages/shared/src/domain.ts:136` | `deferrals.reasonCode` is a foreign key, so the first engine run's deferral insert fails. AC-PLN-16 expects `OVER_CAPACITY`. The store wording in the engine's `storeText` is never seeded. |
| 2 | Deferred orders never come back: nothing puts a DEFERRED order into a later plan's queue, and the order machine has no DEFERRED → PLANNED transition. | `packages/shared/src/machines/order.machine.ts`, `ordering/services/order.queries.ts` | An order deferred to 10-03 never reaches the 10-03 plan. Fixed by D10. |
| 3 | `deferPartially` sets `toDate` to the next calendar day, not the next operating day or the Style delivery day (D8). | `planning/services/deferral.service.ts:211` | A backorder can land on a closed day, or on a non-delivery day for Style. |
| 4 | master-data's `effectiveWindow` narrows by the mall window whenever mall times exist. The engine (and the spec) do this only for `parkingConstraint === 'MALL_DOCK'`. | `master-data/domain/windows.ts` vs `packages/engine/src/plan/window.ts` | Screens (the order's `deliveryWindow`) and the planner can show different hours for the same outlet. |
| 5 | Dead duplicate rule code in shared: `rules/allocation-validator.ts`, `rules/trip-time.ts` (a second time model and validator), `ENGINE_DEFERRAL_REASONS`. Nothing imports them except `seed.ts`. | `packages/shared/src/rules/`, `packages/shared/src/index.ts` | This breaks architecture rule 8 (rules live only in the engine), and it is what caused #1. |
| 6 | The outbox relay does not exist. Rows stay `publishedAt: null`. `AlertEventListener.handle` and `LoadListBuilder.handle` are written but never called. `outbox.add()` throws when `routing.userIds` is set. | `core/outbox/outbox.service.ts` | Alerts never open, load lists are never built from `plan.published`, and nothing reaches SSE or notifications. This blocks the judge path. |
| 7 | The fleet module is empty. There is no vehicle reader, no `FuelLedgerService`, no vehicle status. | `modules/fleet/` | Planning cannot build the engine input (vehicles, fuel used this week) or write planned fuel at publish. |
| 8 | `deferrals` still has `swappedForOrderId`, and has no `choice` or `bindingRule` columns (ROO-74). | `db/schema/planning.ts:294` | Engine-run deferrals cannot be stored as AC-PLN-01 requires. |
| 9 | `OrderQueries` has no query for the planning queue. | `ordering/services/order.queries.ts` | The plan context has no orders to plan. |

## Order of work

```
PR-A fixes (1, 3, 4, 5) ─┐
PR-B deferred queue (2,9) ┤
PR-C ROO-74 migration (8) ┼─> PR-1 contract (+PR-1b deferrals contract) ─> PR-2 reads+context ─> PR-3 wizard reads ─> PR-4 edits
PR-D fleet read side (7)  ┘                                          ─> PR-5 decisions ─> PR-6 publish
PR-E ROO-24 relay (6)  ─── independent; do it early (it unblocks alerts, loading, notifications, SSE)
PR-F ROO-22 seed       ─── independent; needed before any end-to-end test (catalog, history, demo-day orders)
PR-7 engine runs: after ROO-28 (allocator) lands in packages/engine
```

PR-A to PR-F do not depend on each other. Run them in any order, or in parallel worktrees.

The screens (S1 to S5, under "Screens to test the flow") can start on mocks as soon as PR-1 and
PR-1b are merged, in parallel with PR-2 onwards.

---

## PR-A `fix(planning): one deferral-reason list, operating-day deferrals, mall windows` (done: branch `fix/roo-29-deferral-reasons-and-dates`)

Fixes problems 1, 3, 4 and 5.

1. **Seed.** In `seed.ts`, replace `ENGINE_DEFERRAL_REASONS` + `'MANUAL'` with the engine's
   `DEFERRAL_REASONS` (import from `@waypoint/engine`; the backend already depends on it, or add
   `"@waypoint/engine": "workspace:*"` and say why in the PR).
   - Map each entry to `{ code, label, description: storeText, fromEngine, sortOrder }`.
   - Use `onConflictDoUpdate` on `code`, setting only `fromEngine` and `sortOrder`, so admin
     relabels survive.
   - Delete `DEFERRAL_REASON_LABELS`.
2. **Shared.** Delete `packages/shared/src/rules/allocation-validator.ts`,
   `rules/trip-time.ts` and their tests. Delete `ENGINE_DEFERRAL_REASONS` and
   `EngineDeferralReason` from `domain.ts`. Remove the exports. Grep the whole repo (frontend
   included) for users first.
3. **Mall windows.** `master-data/domain/windows.ts`: add `parkingConstraint` to
   `WindowedOutlet`, and narrow only when it is `'MALL_DOCK'` (copy the engine's condition). Update
   the callers and the master-data test for AC-MD-13.
4. **Deferral dates.** `DeferralService.deferPartially`: compute `toDate` per D8, in one private
   `deferralDate(orderId, planDate)` method that PR-5 reuses.
5. **Tests:** the seed reason codes equal `DEFERRAL_REASON_CODES`; the window narrows only for
   MALL_DOCK; a partial deferral on the day before a closed day gets the next open day, and a
   Style order gets its delivery weekday.

## PR-B `feat(ordering): deferred orders stay deferred until planned again` (done: branch `feat/roo-29-deferred-order-queue`; ACs are AC-ORD-38 and 39)

Fixes problems 2 and 9, and applies D10. First add two ACs to `specs/ordering/spec.md`:
- `AC-ORD-xx A deferred order joins the queue for its new date`;
- `AC-ORD-yy A deferred order is planned or deferred again without returning to CONFIRMED`.

1. **Order machine.** `packages/shared/src/machines/order.machine.ts`: add `PLAN: 'PLANNED'` and
   `DEFER: 'DEFERRED'` to `DEFERRED`. Keep `REQUEUE`, because a FAILED or PLANNED order still uses
   it.
   - Update the machine test.
   - Update the copy of the machine in `specs/ordering/spec.md`.
2. **Status changes.** `OrderLifecycleService.markPlanned` and `markDeferred` need no code change:
   they go through the machine.
   - Add a test that DEFERRED → PLANNED works.
   - Add a test that DEFERRED → DEFERRED adds 1 to `deferredCount` and moves `deliveryDate`.
3. **Queue query.** Add `OrderQueries.queueFor(depotId, date): Promise<OrderRow[]>`: orders in
   CONFIRMED or DEFERRED with that `deliveryDate`, sorted by `orderNo`.
   - No actor scope: it is called by planning, which applies its own plan scope. Say so in the
     doc comment.
4. **Cutoff close:** no change.
5. **Store screens.** Check what M3 shows for a DEFERRED order: it should read "Deferred to
   <deliveryDate>". This is a label in the frontend, so only note it in the PR if it is wrong.
6. **Tests:**
   - the two new ACs;
   - `queueFor` leaves out other depots, other dates, SUBMITTED, PLANNED and CANCELLED orders.

## PR-C `feat(planning): deferral choice and binding rule` (ROO-74) (done, on the PR-B branch; additive only: drop `swappedForOrderId` in a follow-up after 4 Oct, and the live index exempts partial deferrals)

Fixes problem 8. Follow the `drizzle-change` skill.

1. `db/schema/enums.ts`: add `deferralChoiceEnum` ('UNAVOIDABLE', 'PRIORITY_CHOICE') if it is
   missing.
2. `db/schema/planning.ts` `deferrals`:
   - add `choice: deferralChoiceEnum()` (nullable) and `bindingRule: text()` (nullable);
   - drop `swappedForOrderId`;
   - add a partial unique index
     `deferrals_live_uq on (orderId, planId) where status in ('PROPOSED','CONFIRMED')` (D1).
3. `pnpm --filter api db:generate --name=planning_deferral_choice`, then `db:migrate`. Check the
   generated SQL by eye.
4. Update `docs/data-model.md` and the Model table in the planning spec (it already describes the
   two columns).
5. **Test:** a schema test that inserts two live deferrals for the same order and plan, and fails.

## PR-D `feat(fleet): vehicle reads and fuel ledger` (part of ROO-42) (done: branch `feat/roo-42-fleet-vehicles-fuel-ledger`; the reversal method is `reversePlanned`, and `weekOf` backs `GET /vehicles/{id}/fuel`)

Fixes problem 7, with the read side planning needs and nothing more. Vehicle edits and status
endpoints (A5) come later. Copy the module layout from `master-data`.

1. `fleet/services/vehicle.queries.ts`, `VehicleQueries`:
   - `forDepot(depotId): Promise<VehicleRow[]>`, all of the depot's vehicles with status, sorted by
     id;
   - `get(id)`.
2. `fleet/services/fuel-ledger.service.ts`, `FuelLedgerService`:
   - `usedThisWeek(vehicleIds, date, { excludePlanId }): Promise<Map<vehicleId, litres>>`. It sums
     PLANNED + ACTUAL + REVERSAL entries for the ISO week of `date` and leaves out entries whose
     trip belongs to `excludePlanId`, so a plan never counts its own fuel twice.
   - `addPlanned(trips)`: one PLANNED entry per trip, `litres = plannedKm / kmPerL`
     (AC-PLN-19, AC-FLT-02).
   - `reverse(tripIds)`: negative entries for the trips' current PLANNED total (AC-FLT-03; used by
     ROO-42 later).
   - Each method is `@Transactional()` and joins the caller's transaction. Audit is the caller's.
3. Export both from `fleet/index.ts` and the module. Planning imports `FleetModule`.
4. Check `specs/fleet/spec.md` for the ISO week helper. If shared has no `isoWeekOf`, add it to
   `packages/shared/src/rules/business-time.ts` with a test.
5. **Tests:** AC-FLT-01 and AC-FLT-02 (service level), plus the `excludePlanId` case.

## PR-E `feat(platform): outbox relay and event bus` (ROO-24) (done: branch `feat/roo-24-outbox-relay`; drains every second, not on the minute tick; consumers register on `EventBus` in `onModuleInit`)

Fixes problem 6. Read the ROO-24 ticket and the comments on it first.

1. **Migration:** `outbox_events.userIds text[] not null default '{}'`. Make `outbox.add()` store
   `routing.userIds` instead of throwing.
2. **Relay:** `core/outbox/outbox-relay.service.ts`, an `@OnTick('outbox.relay')` method in the
   worker (copy `ticker.processor.ts`).
   - Each tick, select up to 100 rows with `publishedAt IS NULL` in id order, using
     `FOR UPDATE SKIP LOCKED`.
   - For each row, call every registered handler, then set `publishedAt`.
   - A handler error is logged (`event: 'outbox.relay.failed'`, ids only), and the row stays
     unpublished for the next tick; add `attempts` and `lastError` only if those columns already
     exist.
   - Each row runs in its own transaction, so one bad row does not block the batch.
   - The tick loops while full batches come back, so events go out within a minute.
3. **Handler registry:** `core/outbox/event-handlers.ts`, a Nest provider holding
   `Map<eventType, Handler[]>`, where `Handler = (row) => Promise<unknown>`.
   - Modules register in `onModuleInit`: alerts registers `AlertEventListener.handle` for its
     types, and loading registers `LoadListBuilder.handle` for `plan.published` and
     `plan.revised`.
   - Planning registers its own consumers later.
4. **Redis fan-out:** after handlers succeed, `PUBLISH` the row to the `events` channel on Redis
   (ioredis is already there for BullMQ), for the SSE gateway (ROO-25) to consume.
5. Write `docs/events.md`: the table of event types, producers and consumers, taken from the specs'
   Events sections.
6. **Tests:**
   - a row is handled once and marked published;
   - a failing handler leaves it unpublished and the next tick retries;
   - two relays running at once handle each row once (SKIP LOCKED);
   - `userIds` is stored.

## PR-F `feat(platform): seed catalog, history and the demo day` (rest of ROO-22) (done: branch `feat/roo-22-demo-day-seed`; code in `src/db/seed/`, D follows the demo clock, plus a Kandy day)

Today `seed.ts` loads only reference data (depots, waves, districts, outlets, vehicles, calendar,
allowances, deferral reasons) and users. There is a `TODO(ROO-22)` for everything else.

**Never open `data/seed/`.**
- Column names, row counts and meanings come from `specs/data/datasets.md` and the ROO-22 ticket.
- The seed code reads the CSVs at runtime, as it already does; the model writing it must not.
- Use the existing `readCsv`-style helpers in `seed.ts`.

Do it in this order, as separate functions in `apps/backend/src/db/seed/` (split `seed.ts` if it
passes ~500 lines):
1. **Catalog:** Fresh 50 items (32 dry, 18 chilled), Style ~20, Tech ~15, plus one adjustment item
   per brand and class. Generate it deterministically (fixed names and a fixed list in code, no
   randomness). Check `specs/master-data/spec.md` for the item columns.
2. **Settings defaults,** if the settings registry needs rows.
3. **Demo day D (PLG, 2026-10-02):** the orders from the dataset's S1 scenario, per
   `specs/data/datasets.md`.
   - Insert them CONFIRMED, with lines from the catalog. Use `computeTotals` from ordering so
     totals match the lines.
   - Add a DRAFT dry order for Fresh Kadawatha on D+1.
   - Print the counts, and assert that the S1 demand exceeds capacity (sum of weight and volume
     against the depot's vehicles).
4. **History:** 14 operating days before D, from `deliveries_train.csv`, as CLOSED plans. Keep it
   minimal: what the engine's repeat-skip `history` and the priority score need (deferrals per
   outlet), not full trips. If datasets.md doesn't support this cheaply, leave it out and say so in
   the PR.
5. **Demo reset:** register the demo-day builder with `demoDay.register(this)`
   (`core/demo/demo-day.ts`), so `pnpm db:reset-demo` and `POST /demo/reset` rebuild D−1..D+1.

Rules:
- Every insert is `onConflictDoNothing` or `onConflictDoUpdate` on a natural key (`externalRef`
  for orders), so running the seed twice changes nothing.
- **Tests:** running the seed twice gives the same row counts. Use a tiny CSV fixture directory
  written by the test, not `data/seed/`.

---

## Planning API (ROO-29) (PR-2 to PR-7 done together on branch `feat/roo-29-planning-api`)

Shared pattern for PR-1 to PR-7:
- **Controllers:** `planning/controllers/plans.controller.ts`, one controller (add a second only if
  it passes ~300 lines).
- **Pattern to copy:** `deferral-reasons.controller.ts`, `deferral-reason.links.ts`, and
  `deferral-reason.dto.ts`. For scope, copy `ordering/policies/order.scope.ts`.
- **Scope:** `PlanScope` (dispatcher: `depotId = actor.depotId`, or all depots when it is null;
  admin: all). It applies to every query. Out of scope returns 404.
- **Versioned writes:** `@IfMatch()` with `plans.version`. A version-filtered update that matches
  no row throws `VersionMismatchError('plan')`.
- **Engine calls:** go through `PlanEngine`, a thin wrapper in `planning/services/plan-engine.ts`.
  It converts `EngineInputError` to `ValidationError` (D4) and nothing else.
- **Commands:** every command is `@Transactional()` and writes one `audit.record`, one
  `outbox.add` and one log line. Add the names to `planning.constants.ts`.

### PR-1 `feat(planning): plans contract` (contract-first skill) (done with PR-1b: branch `feat/roo-29-planning-contract`; the vehicle options DTO is `PlanVehicleOptionDto`, because `VehicleOptionDto` is taken by identity)

Covers the 15 operations: `GET /depots/{id}/plans/{date}`, `GET /plans/{id}`,
`GET /plans/{id}/trips`, `GET /plans/{id}/context`, `POST /plans/{id}/engine-runs` (202),
`GET /plans/{id}/engine-runs/{runId}`, `GET vehicle-options`, `GET order-options`, `POST validate`,
`POST edits`, `POST suggest-fixes`, `GET unplanned`, `POST deferrals/decisions`,
`GET publish-preview`, `POST publish`, `GET revisions`.

- Every handler throws `NotImplementedException`.
- **DTOs:**
  - `PlanDto` (with `_links`: trips, context, engineRuns, edits, publish, publishPreview,
    unplanned);
  - `TripDto` (with `stops: StopDto[]`, totals and `key`, such as `REF-07#1`);
  - `ViolationDto`, `VehicleOptionDto`, `OrderOptionDto`, `FixDto`, `UnplannedDto`;
  - `EditListDto` (D9);
  - `DecisionDto` (`{ orderId, action: DEFER|PLAN_ON|SWAP, reasonCode, note, overrideNote?, tripKey?, swapOrderId?, swapReasonCode? }`);
  - `PublishPreviewDto` (`opensAt`, `open`, `blockers[]`, `notify` counts), `RevisionDto`,
    `EngineRunDto`.
- **Shapes:** response DTOs mirror the engine types in `packages/engine/src/types.ts` and
  `manual/*.ts` field for field. `/context` returns the engine's `EngineInput` plus the plan's
  current `Plan`. Document it as an object; its exact type is `EngineInput`.
- **Examples:** use PLG, 2026-10-02, REF-07, DRY-31, WF-0171 and WF-0172.
- **Codegen:** run `pnpm api:gen`, and keep these paths out of `apps/frontend/src/mocks/live.ts`.
  Careful: `live.ts` already lets `/api/v1/depots/*` and `/api/v1/trips/*` through to the real API
  (master data and execution). Those wildcards also catch `/depots/{id}/plans/{date}` and the
  `/trips/{id}/...` actions, so they would hit the 501s instead of the mocks. Narrow the two
  wildcards to the paths master data and execution actually serve.
- **Tests:** one guard test per operation (store manager 403, dispatcher 501; admin 501 on reads
  and 403 on writes).
- **Spec:** `specs/planning/spec.md` status goes to `in-progress`.

### PR-1b `feat(planning): deferrals contract`

The same pattern as PR-1, for the store's side. This lets M4 and M7 be built on mocks now.

- **Operations:** `GET /deferrals`, `GET /deferrals/{id}`, `POST /deferrals/{id}/response`,
  `POST /deferrals/{id}/reverse`.
- **`DeferralDto`:**
  - `reasonText`: the store wording from `deferral_reasons.description`, never the engine's
    numbers (AC-PLN-16);
  - the order's `orderNo`, current status and `deliveryDate`;
  - `repeatSkip`;
  - `storeResponse`;
  - `_links`: `respond`, `reverse`, `order`.
- **Tests:** guard tests (store manager allowed on reads and respond; dispatcher allowed on reads
  and reverse).

### PR-2 `feat(planning): plan reads and engine context`

ACs: AC-PLN-08, AC-PLN-32 (plan and trip parts), AC-PLN-33 (publish link timing only).

1. `PlansService.getOrCreate(depotId, date, actor)`:
   - insert ... `onConflictDoNothing` on `(depotId, date)`, then select. Two calls return the same
     row.
   - Audit only when it was inserted (`planning.plan.created`). No outbox event.
2. `PlanQueries`: `get(id, actor)`, `trips(planId, actor)` (trips with live stops ordered by
   `seq`; cancelled trips left out).
3. **`PlanContextBuilder.build(plan): Promise<{ input: EngineInput; plan: Plan }>`.** Read
   `EngineInput` in `packages/engine/src/types.ts` and fill each field:
   - `vehicles`: fleet `VehicleQueries.forDepot`;
   - `outlets`: master-data `OutletQueries` for the depot;
   - `districts`: `ReferenceQueries`;
   - `allowances`: `service_allowances`;
   - `orders`: ordering `OrderQueries.queueFor`, plus any order already on a live stop of this
     plan;
   - `history`: the last `repeatSkipLookbackRuns` plans' deferrals per outlet;
   - `fuelUsedThisWeek`: fleet `usedThisWeek(..., { excludePlanId: plan.id })`;
   - `fixedTrips`: trips whose status is RELEASED or later;
   - `isOperatingDay`: `CalendarService`;
   - `params`: settings named in the spec's "Settings read".
   - Current `Plan`: build it from the trips and stops; `unplanned` is per D1.
   - Sort every array by id, so the input hash is stable.
4. **Links:**
   - `publish` appears only when the actor has `plan:publish`, the plan is DRAFT, and
     `clock.now() >= publishOpensAt(plan.date)`. PR-6 adds the last condition: no blockers (D4);
   - `publishOpensAt` = `CutoffService.cutoffAt(depotId, date)`;
   - write links in `policies/plan.links.ts`.
5. **Tests:** AC-PLN-08; the scope 404 for a Kandy dispatcher; store manager 403; the publish link
   at 15:59 vs 16:00. Also a context test: build a small fixture with
   `seedMinimal()`/`fixtures.ts`, then `validate(context.input, context.plan)` from
   `@waypoint/engine` returns no throw.

### PR-3 `feat(planning): wizard reads (options, validate, suggest fixes, unplanned)`

ACs: AC-PLN-12, AC-PLN-15. Each endpoint is: build the context, call one engine function, map the
result. Nothing is written.

| Endpoint | Engine call |
| --- | --- |
| `vehicle-options` | `vehicleOptions(input, plan)` |
| `order-options?vehicleId=&tripNo=` | `optionsForTrip(input, plan, tripKey)` |
| `validate` (body: optional `ops`) | `applyEdits(input, plan, ops)` and return `violations`, or `validate(input, plan)` when there are no ops |
| `suggest-fixes` (body: one violation) | `suggestFixes(input, plan, violation)` |
| `unplanned` | the context's `plan.unplanned`, joined with the live deferral row for `reasonCode`, `note` and `status` |

Tests: AC-PLN-12 (no audit row, no outbox row, version unchanged); AC-PLN-15 (WORKSHOP vehicle
unavailable, no trips left, fits ordering).

### PR-4 `feat(planning): edits with validation and soft overrides`

ACs: AC-PLN-02, AC-PLN-07, AC-PLN-13, AC-PLN-14.

1. **`PlanWriter.save(planId, before: Plan, after: Plan)` (D3).**
   - **Trips:** match on `vehicleId + tripNo`:
     - a new trip is inserted;
     - a removed trip is set to CANCELLED with `tripNo` null;
     - a trip that is still there gets its totals, `driverId`, `waveId` and `locked` updated.
   - **Stops:** match on `tripId + orderId`:
     - a new one is inserted;
     - a removed one gets CANCELLED with `seq` null;
     - a kept one gets its new `seq`. To keep `stops_trip_seq_uq` happy, first set every changed
       stop's `seq` to `-seq`, then to the final values, in the same transaction.
     - Stop fields (window snapshot, travel, service minutes, planned arrival) come from
       `measureTrip`/`tripSchedule` output.
   - A trip that is not reserved and has no live stops left is cancelled (D5).
   - Return the ids of changed trips.
2. **`PlansService.applyEdits(planId, version, body, actor)`:**
   - plan must be DRAFT (PUBLISHED → 409 for now; ROO-42 adds revisions; CLOSED → `PlanLockedError`);
   - parse `ops` (D9);
   - apply SET_DRIVER and SET_WAVE directly (check the driver is a driver at this depot);
   - pass the engine ops to `applyEdits`;
   - any HARD violation in `introduced` → throw `RuleViolationError(violations, undefined, { fixes: POST suggest-fixes })`;
   - SOFT in `introduced` without `overrideNote` + `reasonCode` → 422 (D4);
   - else: `PlanWriter.save`, mark touched trips `locked = true`, bump `plans.version` with a
     version check;
   - audit `planning.plan.edited` (and `planning.plan.soft_rule_overridden` when overriding);
   - one outbox event `plan.edited`.
3. **Tests:**
   - AC-PLN-02: the exact violation body, with the version, audit and outbox unchanged;
   - AC-PLN-07: 412 and 428;
   - AC-PLN-13: one audit row, `locked` true, three stops, version +1, and an unknown op gives 400;
   - AC-PLN-14.

### PR-5 `feat(planning): deferral decisions`

ACs: AC-PLN-05, AC-PLN-16, AC-PLN-17, AC-PLN-18. Add `decide(planId, version, decisions[], actor)`
to `DeferralService`.

- **DEFER:**
  - requires `reasonCode` (active, else 404) and `note`;
  - when `repeatSkip` (from the engine context), `overrideNote` is required, else
    `ValidationError` on `overrideNote`;
  - upsert the live deferral: an existing PROPOSED one becomes CONFIRMED; with none, insert
    CONFIRMED with source PLANNING. Set `toDate` per D8, `decidedById` and `decidedAt`;
  - audit `planning.deferral.confirmed` (plus `planning.deferral.repeat_skip_overridden`);
  - log `planning.deferral.confirmed`;
  - no outbox event here: publish emits it (D6). The decision as a whole writes one
    `plan.edited` event, so the other dispatcher's screen refreshes.
- **PLAN_ON:** run the engine op `ASSIGN_ORDER`.
  - A HARD violation gives 422 and changes nothing.
  - Otherwise `PlanWriter.save`, and the live deferral becomes CANCELLED.
- **SWAP:**
  - ops `UNASSIGN_ORDER B` + `ASSIGN_ORDER A`, with the same 422 handling;
  - A's deferral becomes CANCELLED;
  - B gets a CONFIRMED deferral with its own reason;
  - audit `planning.order.swapped` with `{ deferredOrderId: B, addedOrderId: A, tripId }`.
- Each decision's ops go through the same `applyEdits` path as PR-4, so rules are never
  re-checked by hand.
- **Spec:** amend AC-PLN-16 for D6. The decision writes the audit row and the log line, and
  publishing writes the `deferral.confirmed` event.
- **Tests:**
  - the four ACs, with AC-PLN-16 as amended;
  - a DEFER decision on a draft writes no `deferral.confirmed` event;
  - a store manager's `GET /deferrals` does not list it yet. That endpoint lands later, so test the
    scope policy directly.

### PR-6 `feat(planning): publish, publish preview, revisions list`

ACs: AC-PLN-03, AC-PLN-04, AC-PLN-19, AC-PLN-20.

1. **`PublishPolicy.check(plan, context)` returns `{ opensAt, open, blockers[] }`.** The blockers
   are:
   - a HARD violation from `validate()`;
   - a trip without a driver;
   - an unplanned order without a CONFIRMED deferral (name its `orderNo`);
   - the plan is not DRAFT.
   - Not yet open → `PlanLockedError` with `opensAt` (checked before blockers).
2. `publish-preview` returns `check()` plus counts of who would be notified: loaders at the depot,
   drivers on trips, and outlets on trips or deferred. Each blocker has the shape in D4, so screens
   17 and 18 can show the reason next to the order or trip.
3. `plan.links.ts`: add "no blockers" to the `publish` link's conditions (D4). To check that, the
   link needs `check()`'s result. Compute it once per request in the service, and pass it to the
   link builder.
4. **`PlansService.publish(planId, version, actor)`, in one transaction:**
   - run `check`, and throw on blockers (D4: 409 `CONFLICT_STATE` with `blockers`);
   - cancel empty reserved trips (D5);
   - for every live stop, call `OrderLifecycleService.markPlanned(orderId)` and set `activeStopId`
     (add `markPlanned(id, stopId?)` in ordering, or reuse `Extra`);
   - for every CONFIRMED deferral on this plan:
     - call `markDeferred(orderId, toDate)`. It works from CONFIRMED and from DEFERRED (D10);
     - emit one outbox `deferral.confirmed`
       `{ v:1, deferralId, orderId, orderNo, reasonCode, toDate }`, routed to the order's outlet
       (D6);
   - call fleet `addPlanned(trips)`;
   - set the plan to PUBLISHED with `revision` 1, `publishedAt` and `publishedById`;
   - insert `plan_revisions` revision 1 (D7);
   - audit `planning.plan.published`, outbox `plan.published { v:1, revision:1, tripIds }`, log.
   - `@UseIdempotency()` on the route.
5. `GET revisions`: list the `plan_revisions` rows for the plan, newest first.
6. **Tests:**
   - the four ACs as written, including the idempotent replay in AC-PLN-19;
   - the plan has no `publish` link while a blocker exists, and gets one once the blocker is fixed;
   - publishing emits one `deferral.confirmed` per CONFIRMED deferral, and none for CANCELLED ones;
   - an order that was already DEFERRED and is planned in this plan moves straight to PLANNED.

### PR-7 `feat(planning): engine runs` (needs ROO-28 `allocate()`)

ACs: AC-PLN-01, AC-PLN-09, AC-PLN-10, AC-PLN-11.

1. `POST engine-runs`:
   - insert `engine_runs` RUNNING, with `inputHash` = sha256 of the canonical-JSON context input
     (node:crypto) and `engineVersion = ENGINE_VERSION`;
   - enqueue on `QUEUES.allocation` with `_ctx`;
   - return 202.
2. `AllocationProcessor` (rewrite the TODO, keep it in `worker/`):
   - load the run;
   - rebuild the context, and with `keepLocked` pass locked trips as fixed;
   - call `allocate()`;
   - in one transaction: `PlanWriter.save`, cancel the plan's old PROPOSED ENGINE deferrals, bulk
     insert new PROPOSED deferrals (`choice`, `bindingRule`, `reasonDetail`, `priorityScore`,
     `repeatSkip`, `engineRunId`), and update the run to SUCCEEDED with counts, stats and
     `finishedAt`;
   - audit `planning.engine.run_completed`, outbox `plan.engine_run.completed`.
   - On any error: run FAILED with `error` and `finishedAt`, in a separate transaction; outbox
     `plan.engine_run.failed`; no trip, stop or deferral changes.
3. `GET engine-runs/{runId}` returns the row.
4. **Tests:** the four ACs as written. Test the processor directly; no Redis is needed in the test.

---

## Screens to test the flow

Contract-first means the screens don't wait for the backend.
- **Build on mocks:** each screen PR starts on MSW mocks as soon as its contract (PR-1, PR-1b) is
  merged.
- **Go live:** as each backend PR lands, its paths are added to `apps/frontend/src/mocks/live.ts`
  in that backend PR, and the screen talks to the real API.

Rules for every screen PR (the `react-screen` skill):
- **Before coding:** read the frame with the Figma MCP (`get_design_context` and
  `get_screenshot`; file `F22bpXWBPLlXkXwA89XHfQ`). The Figma MCP must be signed in first
  (`/mcp`).
- **Data and actions:** data comes only from the generated hooks in `@compass/api-client`. A
  button shows only when the resource carries its `_links` entry.
- **Never:** hand-write fetch calls or mocks.
- **States:** loading, empty, error and offline. Check each frame with `/fidelity <frame>` at
  1440×960.
- **Styling:** Compass tokens and text styles only; no hex values. Put copy in `i18n`.
- **Where:** the nav entries already exist in `dispatch-shell.tsx` and `store-shell.tsx`. Add the
  routes in `apps/frontend/src/app`, and the pages in `features/planning` and
  `features/deferrals`.

| Screen PR | Frames (Figma node) | Route | Uses | Can start after | Live after |
| --- | --- | --- | --- | --- | --- |
| S1 ROO-30 Plan build | 05 `265:2134`, 06 `265:2419`, 07 `488:9309`, 08 `267:2216`, 09 `268:2245` | `/dispatch/plan/:date` (wizard is a dialog) | plan, trips, `vehicle-options`, `order-options`, `validate`, `edits`, `engine-runs` | PR-1 | PR-2, 3, 4 (Auto-suggest after PR-7) |
| S2 ROO-40 Edit and fix | 10 `488:9736`, 11 `269:2996` | dialogs on 09 | `edits`, `validate`, `suggest-fixes` | PR-1 | PR-4 |
| S3 ROO-41 Confirm and publish | 14 `185:15323`, 15 `185:15715`, 16 `185:16098`, 17 `185:16544`, 18 `185:16860` | wizard steps on `/dispatch/plan/:date` | `validate`, `unplanned`, `deferrals/decisions`, `publish-preview`, `publish` | PR-1 | PR-5, 6 |
| S4 ROO-49 + ROO-51 Store orders and deferrals | M3 `185:10924`, M4 `185:11128`, M7 `185:11685` | `/store/orders`, `/store/deferrals/:id`, `/store/deferrals` | `GET /orders`, `/deferrals`, `response` | PR-1b (M3: now) | the deferral reads (M3: already live) |
| S5 ROO-43 Dispatcher deferrals | 23 `185:18890` | `/dispatch/deferrals` | `/deferrals` | PR-1b | the deferral reads |

Screen details that the flow depends on:
- **07:** blocked orders are dimmed with the engine's reason. In the browser, use
  `optionsForTrip` on `/context` for instant feedback, and the API for the first load.
- **08:** saving sends one edit list (ADD_TRIP + ASSIGN_ORDERs), so a vehicle is never saved
  without orders (D5).
- **15:**
  - each unplanned order shows its reason, priority and the repeat-skip flag;
  - an order removed by hand shows "Needs a decision" (`reasonCode` null, D1);
  - DEFER asks for a reason and a note to the store, plus an override note when it is a repeat
    skip.
- **17:**
  - lists each blocker next to its order or trip (D4);
  - Publish is greyed out until the plan carries the `publish` link, with the reason shown: "Opens
    at 16:00", or the number of blockers left.
- **M3 (ROO-51, part of S4):**
  - `/store/orders` lists the outlet's orders with status chips;
  - a DEFERRED order reads "Deferred to <deliveryDate>", and a PLANNED order shows its trip;
  - it uses `GET /orders`, which is already live. Show the ETA only when the order carries one;
    the ETA endpoint belongs to execution and is not needed for this flow.
- **M4:**
  - shows the store wording and the dispatcher's note, never the engine's numbers;
  - Acknowledge and Request priority show only with the `respond` link;
  - after responding, it shows the response and no buttons.
- **M7:** lists deferrals with reasons, and highlights repeat skips.

**End-to-end check once S3 and S4 are live.** Two browsers: Tihara (dispatcher) and Nimesha (store
manager, Fresh Kadawatha). Use the demo clock on A3. With PR-F, run `pnpm db:reset-demo` first;
the demo day's orders are then already CONFIRMED, and step 1 is only needed for extra orders.
1. Nimesha places orders for 10-02. Move the clock past 16:00 on 10-01; the orders become CONFIRMED.
2. Tihara opens 05 for 10-02 and builds trips on 06 to 08, leaving one Fresh Kadawatha order off.
3. On 15, that order shows "Needs a decision". Tihara defers it with a reason and a note.
4. Nimesha sees nothing yet: no M4 notice, and M7 is empty.
5. On 17, Publish is greyed out while any blocker is left, then enabled. Tihara publishes.
6. Nimesha now has the deferral on M7, and M4 shows the store wording and the note. M3 shows
   "Deferred to 10-03". She acknowledges; the buttons disappear.
7. Move the clock past 16:00 on 10-02, and open the plan for 10-03: the order is in the queue.
   Plan it on a trip and publish.
8. Nimesha's M3 shows it as Planned. The old deferral on M7 has no respond button.

## After the Planning API (in this order)

Each one needs its own short plan when you reach it. Do not start these in the PRs above.

0. **Deferral reads and respond** (done: branch `feat/roo-29-deferral-reads`, with reverse) (the item 3 work below; do it first, because S4 and S5 need it to
   go live): `/deferrals` list and detail, and `response` (AC-PLN-27).
1. **ROO-42:** edits after publish become revisions: AC-PLN-21, AC-PLN-22, fuel reversals.
2. **Trip operations:** reassign, re-sequence, stop defer and cancel (AC-PLN-23 to AC-PLN-26).
   They feed screens 19b and 20 (ROO-61).
3. **Deferral reads and actions:**
   - `/deferrals` list and detail, respond and reverse (AC-PLN-27 and AC-PLN-28; screens 23, M4
     and M7). Follow the respond-link and store-visibility rules under "The deferred order's flow";
   - planning's event consumers `order.cancelled` and `order.priority_changed` (AC-PLN-31), which
     register on the relay from PR-E.
4. **ROO-25 SSE gateway:** subscribes to the Redis `events` channel from PR-E.
5. **ROO-26 notifications core:** a relay handler for `plan.published`, `plan.revised` and
   `deferral.confirmed`.
6. **Close the day** (AC-PLN-29) and reservations (AC-PLN-30).

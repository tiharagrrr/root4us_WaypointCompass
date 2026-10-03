---
module: ordering
owner: Harini
status: done           # draft | ready | in-progress | done
screens: [M1, M1a, M1b, M2, M3, M8, "03", "04"]
depends-on: [core, audit, master-data]
---

# Ordering

## Purpose
Store managers send one order per class per delivery day before the 16:00 cutoff; the dispatcher
sees the day's queue. Ordering takes store orders up to the cutoff, confirms them when it passes, and
hands planning one confirmed queue per depot and date. It also owns the order status: other modules
move an order only through the `OrderLifecycleService` it exports.

## Scope
In:
- Drafts, lines, templates, submit, cancel and reorder (M1, M1a, M1b, M8).
- The cutoff: `cutoffFor`, the late roll to the next run with its notice (M2), the one-minute cutoff
  job, the 15:30 reminder, the depot override and the demo-mode close.
- Order lists for the store (M3, M8) and the dispatcher (03 Order queue, 04 Past orders), the depot
  day summary, and the dispatcher's urgent flag.
- The receiving roster (who receives deliveries, and when).
- `OrderLifecycleService`, exported for planning, loading, execution and receipt.

Out:
- Planning, trips, stops and deferrals, including a store's priority request on M4: planning.
- Receipt and issues (M5, M6): receipt.
- The store's ETA on M3, `GET /orders/{id}/eta`: execution.
- The order timeline, `GET /timelines/order/{id}`: audit.
- Items, outlets, depots and the calendar: master-data (`specs/master-data/spec.md`).
- Sending the messages for order events: notifications. Live updates over SSE: realtime.
- The `planning.techValueLimitLkr` soft rule on Tech order value: packages/engine.

Screens (Figma file `F22bpXWBPLlXkXwA89XHfQ`, desktop 1440 x 960, all owned by Harini):

| Frame | Node | Route | Data | Actions and states |
| --- | --- | --- | --- | --- |
| M1 New order | 185:10376 | /store/orders/new | POST /orders, PUT /orders/{id}/lines, /order-templates | Send, save as template, cutoff countdown from editableUntil |
| M1a Add item | 232:813 | Dialog on M1 | GET /items?filter[tempClass]= | Search, category filter, pack stepper |
| M1b Chilled order | 228:970 | /store/orders/new?class=chilled | Same as M1 | Chilled items only; the sent confirmation |
| M2 Cutoff passed | 185:10649 | Notice on M1 and M3 | meta.notices: ORDER_ROLLED_TO_NEXT_RUN | Moved to the next run, with the new date |
| M3 Orders | 185:10924 | /store/orders | GET /orders, GET /orders/{id}/eta | Today's deliveries with ETA, status chips, receipts still to confirm, pagination |
| M8 Order history | 185:11842 | /store/history | GET /orders, POST /orders/{id}/reorder, /timelines/order/{id} | Reorder, open the timeline |
| 03 Order queue | 185:12856 | /dispatch/orders | GET /orders, PATCH /orders/{id}/priority, cancel | Date selector, group by district and brand, pagination |
| 04 Past orders | 488:8916 | /dispatch/past-orders | GET /orders, timelines | Search, open the timeline |

## Model
Schema file: `apps/backend/src/db/schema/ordering.ts` (owner: ordering). "Dry" on the screens is
`tempClass` AMBIENT; "chilled" is CHILLED.

| Table | Key columns |
| --- | --- |
| `orders` | `id` (UUIDv7); `orderNo` (unique, "WF-0171"); `outletId`, `depotId`, `brand`, `districtId` (copied from the outlet); `tempClass`; `requestedDate` (the day the store asked for); `deliveryDate` (the run it is on now; moves on a late roll or a deferral); `status` (default DRAFT); `afterCutoff`; `urgent`; `units`, `weightKg`, `volumeM3`, `valueLkr`; `source` (web, seed, reorder, backorder); `externalRef` (unique, dataset key); `note`; `templateId`; `placedById` (FK users); `submittedAt`, `confirmedAt`, `cancelledAt`, `cancelReason`; `deferredCount`, `lastDeferredAt`; `activeStopId` (unique, FK stops); `parentOrderId` (backorder from a partial deferral); `version`; `createdAt`, `updatedAt` |
| `order_lines` | `id`; `orderId` (FK, cascade); `itemId` (FK items); `qty` (packs); `unitWeightKg`, `unitVolumeM3`, `unitValueLkr` (item snapshot); `available` (default true) |
| `order_templates` | `id`; `outletId` (FK); `name`; `tempClass`; `createdById`; `createdAt`, `updatedAt` |
| `order_template_lines` | `templateId` (FK, cascade); `itemId`; `qty` |
| `receiving_roster_entries` | `id`; `outletId` (FK); `date` (business date); `staffName`; `fromMin`, `toMin` (minutes after midnight) |
| `order_day_marks` | `kind` (`cutoff_closed` or `cutoff_reminder`), `scopeId` (a depot for a close, an outlet for a reminder), `deliveryDate` — together the primary key; `at`; `detail` (jsonb). The once-a-day acts ordering must not repeat: an `ON CONFLICT DO NOTHING` insert lets exactly one caller win, so the cutoff is announced once however many times the ticker and the demo button reach the same day |

Sequences: `order_no_fresh_seq` (WF-0001), `order_no_style_seq` (WS-0001), `order_no_tech_seq`
(WT-0001).

Enforced by the database:
- `orders_outlet_scope_fk`: (outletId, depotId, brand, districtId) must match one outlet row.
- `orders_totals_chk`: weightKg, volumeM3 and units are 0 or more.
- `order_lines_qty_chk`: qty > 0; `order_lines_item_uq`: one line per item per order.
- `order_templates_name_uq`: template names are unique per outlet; template lines key on (templateId, itemId).
- `orders.activeStopId` is unique: an order has at most one live stop.
- Indexes: `orders_depot_date_status_idx` (depotId, deliveryDate, status),
  `orders_outlet_date_class_idx` (outletId, requestedDate, tempClass), `roster_outlet_date_idx`.
- Row-level security: `orders_app_scope` uses `orderVisible` and `order_lines_app_scope` uses
  `viaVisibleOrder` (`apps/backend/src/db/rls.ts`) for `compass_app`; `compass_readonly` may select.

Enforced by the service:
- One non-cancelled order per outlet, requested date and class. A second answers 409 with a link to
  the first. Backorders are exempt.
- Lines match the order's class and the outlet's brand. Quantities are whole packs of at least 1.
  Inactive items are refused.
- Only Fresh outlets place chilled orders; Style and Tech are ambient only.
- Style outlets order for their weekly delivery day (`outlets.styleDeliveryDow`, 0 = Monday); another
  day answers 400 naming the right one.
- The cutoff is 16:00 on the operating day before delivery, or the depot's override. A late submit
  rolls to the next operating day; a late edit or cancel answers 409 `CUTOFF_PASSED`.
- Totals are recomputed on every line change. The engine plans on order totals, so seeded orders
  match the dataset exactly. Tech orders carry value.
- No hard deletes of business records; orders are cancelled.

State machine, `packages/shared/src/machines/order.machine.ts` (the file is the source; the table
below mirrors it). `nextOrderStatus` (`domain/transitions.ts`) refuses anything else with
`StateConflictError`, which renders as 409 `CONFLICT_STATE`; the same table drives `_links` and the
status chips.

```ts
export const orderMachine = defineMachine<OrderStatus, OrderEvent>('order', {
  DRAFT:          { SUBMIT: 'SUBMITTED', CANCEL: 'CANCELLED' },
  SUBMITTED:      { EDIT: 'SUBMITTED', CUTOFF: 'CONFIRMED', CANCEL: 'CANCELLED' },
  CONFIRMED:      { PLAN: 'PLANNED', DEFER: 'DEFERRED', CANCEL: 'CANCELLED' },
  // A deferred order waits as DEFERRED until a run carries it: its new date's plan takes it
  // straight to PLANNED or defers it again; it never shows CONFIRMED in between (AC-ORD-39).
  // DEFERRED also takes DELIVER and PARTIAL: a device that recorded a delivery for a stop
  // deferred while it was offline stands, through KEEP_DEVICE on the sync conflict (19c).
  DEFERRED:       { PLAN: 'PLANNED', DEFER: 'DEFERRED', REQUEUE: 'CONFIRMED', DELIVER: 'DELIVERED', PARTIAL: 'PARTIAL', CANCEL: 'CANCELLED' },
  PLANNED:        { LOAD: 'LOADED', DEFER: 'DEFERRED', REQUEUE: 'CONFIRMED' },
  LOADED:         { DEPART: 'IN_TRANSIT', DEFER: 'DEFERRED' },
  IN_TRANSIT:     { DELIVER: 'DELIVERED', PARTIAL: 'PARTIAL', FAIL: 'FAILED', DEFER: 'DEFERRED' },
  DELIVERED:      { RECEIVE: 'RECEIVED', REPORT: 'ISSUE_REPORTED' },
  PARTIAL:        { RECEIVE: 'RECEIVED', REPORT: 'ISSUE_REPORTED' },
  FAILED:         { REQUEUE: 'CONFIRMED' },
  RECEIVED:       { REPORT: 'ISSUE_REPORTED' },
  ISSUE_REPORTED: {},
  CANCELLED:      {},
});
```

## Endpoints
Paths omit `/api/v1`. Every write to an order or its lines sends `If-Match: W/"<version>"` (428
`PRECONDITION_REQUIRED` without it, 412 `VERSION_MISMATCH` when stale). Create, submit and cancel
also send `Idempotency-Key`. Every list follows `specs/api-conventions.md` for paging and filters.

| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| GET | `/orders` | `order:read` | M3, M8, 03, 04; scoped; offset pages (limit 10 by default, 100 at most). Filters: status, tempClass, depotId, outletId, deliveryDate, requestedDate. Sort: submittedAt, orderNo, districtId (default `-submittedAt`, id as tiebreaker). `q` searches orderNo and outlet name. `include=lines,outlet`. Collection `_links.create` when the actor holds `order:create` |
| POST | `/orders` | `order:create` | M1: class, requested date, optional template; outlet, depot, brand and district come from scope. 201 with Location |
| GET | `/orders/{id}` | `order:read` | ETag `W/"<version>"`; `include=lines,outlet` |
| PATCH | `/orders/{id}` | `order:update` | Note and date while editable |
| DELETE | `/orders/{id}` | `order:update` | Removes drafts only: 204, else 409 |
| GET | `/orders/{id}/lines` | `order:update` | The order's lines |
| PUT | `/orders/{id}/lines` | `order:update` | Replaces all lines |
| POST | `/orders/{id}/lines` | `order:update` | Adds one line (M1a) |
| PATCH | `/orders/{id}/lines/{lineId}` | `order:update` | Quantity |
| DELETE | `/orders/{id}/lines/{lineId}` | `order:update` | Removes the line |
| POST | `/orders/{id}/submit` | `order:submit` | M1 Send; a late submit rolls to the next run with a notice (M2) |
| POST | `/orders/{id}/cancel` | `order:cancel` | Store before the cutoff with `reasonNote`; dispatcher before PLANNED with `reasonCode` |
| POST | `/orders/{id}/reorder` | `order:create` | M8: a draft for the next open date with the same lines |
| POST | `/orders/{id}/save-as-template` | `order:create` | M1 |
| PATCH | `/orders/{id}/priority` | `order:queue` | Dispatcher marks urgent, for example after a priority request |
| GET, POST | `/order-templates` | `order:create` | M1 Use template; scoped to the store's outlet |
| GET, PATCH, DELETE | `/order-templates/{id}` | `order:create` | PATCH renames; DELETE answers 204 |
| GET, PUT | `/outlets/{id}/receiving-roster?date=` | `order:update` | Who receives deliveries, and when; PUT replaces the day's entries |
| GET | `/depots/{id}/days/{date}` | `order:read` | Day summary for 01 and 03: counts by status, brand and class, cutoff state |
| POST | `/depots/{id}/days/{date}/close-cutoff` | `order:queue` | Demo mode only; the ticker normally does this |

Order response (Step 4 example): `id`, `orderNo`, `status`, `tempClass`, `requestedDate`,
`deliveryDate`, `afterCutoff`, `totals { units, weightKg, volumeM3 }`, `outlet { id, name }`,
`submittedAt`, `editableUntil` (the cutoff instant), `version`, `_links`. Business dates are
YYYY-MM-DD; instants are ISO 8601 with +05:30.

The contract adds what M1's summary card shows and the client would otherwise have to derive:
`brand`, `urgent`, `note`, `templateId`, `totals.lines` (distinct items, M1's "5 lines · 40 packs")
and `totals.valueLkr`, and `deliveryWindow { openMin, open, closeMin, close }`, the outlet's
receiving window on the delivery day (M1's "Wed 30 Sep · 07:00–09:00").

`GET /orders/{id}/lines` answers `{ orderId, version, lines[] }`, and every write to a line answers
with the order, whose totals and version have already moved on, so M1 redraws from one response.
Each line carries `sku`, `name` and `packLabel` from the item, `qty`, the `unitWeightKg` and
`unitVolumeM3` snapshot, the line's own `weightKg` and `volumeM3`, and `available`.

Links (`policies/order.links.ts`, `OrderLinks`): always `self`, `lines`, `timeline`
(`/api/v1/timelines/order/{id}`). Action links appear only when the state machine allows the move, the
actor holds the permission, the row is in scope and the time rules allow it:

| Link | Method | Requires | Rule |
| --- | --- | --- | --- |
| `submit` | POST `/orders/{id}/submit` | If-Match | `OrderRules.canSubmit` |
| `edit` | PATCH `/orders/{id}` | If-Match | `OrderRules.canEdit` |
| `cancel` | POST `/orders/{id}/cancel` | If-Match, reasonNote | `OrderRules.canCancel` |
| `reorder` | POST `/orders/{id}/reorder` | | `OrderRules.canReorder` |
| `addLine` | POST `/orders/{id}/lines` | If-Match | `OrderRules.canEdit`; M1's Add item and M1a |
| `setLines` | PUT `/orders/{id}/lines` | If-Match | `OrderRules.canEdit`; M1's preset and its quantity fields |
| `saveAsTemplate` | POST `/orders/{id}/save-as-template` | | `order:create` and the order has lines; M1's Save as preset |

Each line of `GET /orders/{id}/lines` carries `edit` (PATCH) and `remove` (DELETE), both requiring
If-Match, while the order is editable. M1 renders every button from these relations, so a sent
order offers none (AC-ORD-03, AC-ORD-15).

## Services and helpers
Module folder `apps/backend/src/modules/ordering/`:

```text
ordering.module.ts, index.ts (OrderingModule, OrderQueries, OrderLifecycleService, CutoffService, event types)
ordering.constants.ts            event names, audit actions, notice codes, tick names, setting keys
order.resource.ts                ORDER_RESOURCE (filters, sorts, search, includes)
order-template.resource.ts       ORDER_TEMPLATE_RESOURCE
controllers/                     orders, order-lines, order-templates, receiving-roster, depot-days
dto/                             order.dto.ts, order-template.dto.ts, receiving-roster.dto.ts, depot-day.dto.ts
services/                        orders.service.ts, order-lines.service.ts, order.queries.ts, order.views.ts,
                                 order.view.ts (the OrderView type), order-lines.validator.ts,
                                 order-lifecycle.service.ts, order-number.service.ts, templates.service.ts,
                                 roster.service.ts, cutoff.service.ts, cutoff-close.service.ts,
                                 cutoff-reminder.service.ts, depot-day.queries.ts
policies/                        order.scope.ts (OrderScope, OrderTemplateScope, ReceivingRosterScope),
                                 order.rules.ts (OrderRules), order.links.ts, order-template.links.ts,
                                 depot-day.links.ts, receiving-roster.links.ts
domain/                          totals.ts, order-number.ts, transitions.ts, errors.ts
jobs/cutoff.processor.ts         the two @OnTick handlers, run once a minute in the worker
events/ordering.events.ts        typed payloads with v: 1
__tests__/                       ordering.world.ts (the fixtures every suite shares) and the AC-ORD suites
```

`OrderView` is the shape every response is built from: the order row plus the outlet's name, the
cutoff instant, the receiving window and the totals with their line count. `OrderViews` fills it in
one pass per page, so a page of 25 orders costs three extra queries rather than 25, and `OrderLinks`
stays a pure mapping that never reads the database.

- `OrdersService` (commands, each `@Transactional()` with `audit.record()`, `outbox.add()` and one log
  line): `createDraft`, `updateDraft`, `setLines`, `submit`, `cancel`, `reorder`, `setPriority`.
- `OrderQueries`: list and get, always with `this.scope.where(actor)`, via `CrudQueryService` and
  `ORDER_RESOURCE`; and `queueFor(depotId, date)`, the CONFIRMED and DEFERRED orders a plan is built
  from, with no actor scope because planning calls it for a plan it already holds in its own scope.
- `CutoffService`: `cutoffFor(depotId, deliveryDate)` (the previous operating day at `cutoffMin`: the
  depot's `cutoffMin` or the setting `ordering.cutoffMin`, default 960 = 16:00); `nextRun(depotId,
  date)` (the next operating day); `closeCutoff(depotId, date)`. A submit is late when
  `now >= cutoffFor(...)`. The business-time helpers `cutoffFor` and `nextOperatingDay` live in
  packages/shared.
- `OrderNumberService`: per-brand sequences, WF-0001.
- `TemplatesService`, `RosterService`.
- `OrderRules`: `canSubmit`, `canEdit`, `canCancel`, `canReorder`. Each is
  `orderMachine.can(...) && can(actor, permission) && inScope(o, actor) && timeAllows(o, now)`. The
  service and `OrderLinks` call the same function, so a link never promises what the server refuses.
- `OrderLifecycleService` (exported): `markConfirmed`, `markPlanned`, `markDeferred`, `requeue`,
  `markLoaded`, `markInTransit`, `markDelivered`, `markPartial`, `markFailed`, `markReceived`,
  `markIssueReported`, plus `statusesOf(ids)` and `createBackorder` (ROO-33). `markPlanned` and
  `markDeferred` take CONFIRMED and DEFERRED orders alike (AC-ORD-39). Each move checks the
  state machine and audits. Planning, loading, execution and receipt call it; planning's publish
  calls `markPlanned` inside its own transaction.
  `createBackorder({ parentOrderId, lines, deliveryDate, note })` is what a dock removal leaves
  behind (AC-LOD-12): one CONFIRMED order with `source` backorder and `parentOrderId` set, holding
  only the quantity that stayed behind, with the parent's item weights and values copied onto its
  lines so the engine plans it on the same numbers after a catalog change. CONFIRMED, not DRAFT:
  nobody has to place it — the store already ordered these goods and the next plan should carry
  them. It writes `ordering.order.backordered` and emits `order.backordered`.
- Helpers (pure, `domain/`): `computeTotals(lines)` (units, kg, m³, value), `snapshotLine(item, qty)`,
  `effectiveWindow(outlet)` (the outlet window intersected with the mall window),
  `orderNoFor(brand, n)`.
- Jobs: `ordering.cutoff` runs each minute from the ticker and confirms every submitted order whose
  cutoff has passed. `ordering.cutoff-reminder` at 15:30 (setting `ordering.cutoffReminderMin`, 930)
  reminds outlets with no order for the next day. Both restore context with `runInJobContext`
  (role `system`) and read time from `ClockService.now()`, so the demo clock triggers them.
- Settings: `ordering.cutoffMin` (960, per-depot override, edited on A6 and A4),
  `ordering.cutoffReminderMin` (930, A6).

## Events
Emits (all through the outbox, in the use case's transaction):

| Event | Payload (`v: 1`) | Routing | Consumed by |
| --- | --- | --- | --- |
| `order.submitted` | `orderId`, `outletId`, `afterCutoff`, `deliveryDate` | aggregate order; `depotId`; `outletIds: [outletId]` | notifications (M1b confirmation to the store manager, in-app and email: "Order WF-0171 sent for Fri 2 Oct."), realtime (03; the web invalidates `['orders']` and `['depot-day', depotId]`) |
| `order.rolled_to_next_run` | `orderId`, `outletId`, `requestedDate`, `deliveryDate`, `reason` (`AFTER_CUTOFF` or `WEEKLY_DELIVERY_DAY`) | aggregate order; `depotId`; `outletIds` | notifications (M2 notice to the store manager, in-app, email and push: "Sent after 16:00, so it goes on Sat 3 Oct's run."), realtime |
| `order.cancelled` | `orderId`, `outletId`, `deliveryDate`, `cancelledBy` (`store` or `dispatcher`), `reasonCode` | aggregate order; `depotId`; `outletIds` | realtime, planning (removes the order from a draft plan) |
| `order.priority_changed` | `orderId`, `outletId`, `deliveryDate`, `urgent` | aggregate order; `depotId`; `outletIds` | realtime, planning (re-ranks the order in a draft plan) |
| `order.cutoff_closed` | `depotId`, `deliveryDate`, `confirmed`, `closedBy` (`ticker` or `demo`); aggregate `depot_day`, `<depotId>#<date>` | `depotId` | realtime, planning (day summary) |
| `order.created`, `order.updated`, `order.deleted`, `order.lines_changed` | `orderId`, `outletId`, and for the line event `lines` and `units` | aggregate order; `depotId`; `outletIds` | realtime (M1 and 03 refresh from one stream) |
| `order_template.created`, `order_template.deleted` | `templateId`, `outletId` | `outletIds` | realtime (M1's preset list) |
| `receiving_roster.replaced` | `outletId`, `date`, `entries` | `outletIds` | realtime (M3) |
| `order.cutoff_reminder` | `outletId`, `depotId`, `deliveryDate`, `cutoffAt` | `depotId`; `outletIds` | notifications (push and in-app: "Cutoff for tomorrow's delivery is in 30 minutes.") |

A late submit adds both `order.submitted` (with `afterCutoff: true`) and `order.rolled_to_next_run`.
The 15:30 reminder reaches store managers with no order for tomorrow by push and in-app: "Cutoff for
tomorrow's delivery is in 30 minutes."

Consumes: none.

## Log events
Each as `this.log.info({ event, ...ids }, 'message')`, ids only, no personal data:
- `ordering.order.created`
- `ordering.order.submitted` (with `afterCutoff`)
- `ordering.order.cancelled`
- `ordering.cutoff.closed` (depot, date, count)
- `ordering.reminder.sent` (count)

## Permissions
From the Step 2 matrix (`packages/shared/src/auth/permissions.ts`). A missing permission is 403
`FORBIDDEN`; a row outside the actor's scope is 404 `NOT_FOUND`.

| Role | Order permissions | Scope (OrderScope, re-checked by row-level security) |
| --- | --- | --- |
| admin | `order:read` | Everything |
| dispatcher | `order:read`, `order:queue`, `order:cancel` | `depotId = actor.depotId`, or all depots when none is set |
| store_manager | `order:read`, `order:create`, `order:update`, `order:submit`, `order:cancel` | `outletId = actor.outletId` |
| loader | `order:read` | `depotId = actor.depotId` |
| driver | none | |

The store manager's item picker uses `catalog:read` from master-data.

Reasons (Step 2): a store's cancel needs a note; a dispatcher's cancel needs a code.

## Acceptance criteria
Each criterion is one test named after it, for example
`it('AC-ORD-02 a late order rolls to the next run')`. Tests use the helpers in `apps/backend/CLAUDE.md`:
`createTestApp()`, `seedMinimal()`, `as(role, scope?)`, `freezeClock()` and `expectProblem()`, with
hand-built fixtures (never data/seed/).

Conventions for these criteria:
- Times are the demo clock in Asia/Colombo. "She" is the store manager for Fresh Kadawatha, a
  Peliyagoda (PLG) Fresh outlet, unless a criterion says otherwise.
- Fixtures mark 2026-09-30 to 2026-10-03 as operating days, with no depot cutoff override unless a
  criterion sets one.
- AC-ORD-01 to AC-ORD-06 come from the Build Spec (Step 3), with only their weekday labels corrected
  to the 2026 calendar: Thu 1 Oct is 2026-10-01, Fri 2 Oct is 2026-10-02, Sat 3 Oct is 2026-10-03.
  Tests use the ISO dates. Later criteria use ISO dates only.

```gherkin
AC-ORD-01  Submit before the cutoff
  Given a store manager for Fresh Kadawatha with a draft dry order for Fri 2 Oct holding 3 lines
    And the demo clock reads Thu 1 Oct 15:59:00 Asia/Colombo
  When she submits the order
  Then the response is 200 with status SUBMITTED, afterCutoff false and deliveryDate 2026-10-02
    And the order's _links include edit and cancel
    And exactly one audit row ordering.order.submitted and one outbox event order.submitted exist

AC-ORD-02  A late order rolls to the next run
  Given the same draft
    And the clock reads Thu 1 Oct 16:00:00
  When she submits the order
  Then status is SUBMITTED, afterCutoff true and deliveryDate is the next operating day, Sat 3 Oct
    And meta.notices contains ORDER_ROLLED_TO_NEXT_RUN, which M2 shows
    And an order.rolled_to_next_run notification is queued for her

AC-ORD-03  Edits lock at the cutoff
  Given a SUBMITTED order for Fri 2 Oct
  When she changes a line at Thu 1 Oct 16:00:00
  Then the response is 409 CUTOFF_PASSED and the order is unchanged
    And GET on the order returns no edit or cancel link

AC-ORD-04  One order per outlet, date and class
  Given Fresh Kadawatha already has a non-cancelled dry order for Fri 2 Oct
  When she creates another dry order for Fri 2 Oct
  Then the response is 409 CONFLICT_STATE with a link to the existing order

AC-ORD-05  Chilled items stay in chilled orders
  Given a dry draft order
  When she adds an item whose class is CHILLED
  Then the response is 400 VALIDATION_FAILED on itemId with "Add chilled items to a chilled order"

AC-ORD-06  The cutoff confirms the day's orders
  Given 57 SUBMITTED Peliyagoda orders for Fri 2 Oct
  When the clock passes Thu 1 Oct 16:00
  Then within one minute all 57 are CONFIRMED and order.cutoff_closed is emitted exactly once

AC-ORD-07  Reorder from order history
  Given a RECEIVED dry order for Fresh Kadawatha holding 3 lines, one of whose items is now inactive
    And she has no dry order for 2026-10-02
    And the clock reads 2026-10-01 10:00:00
  When she posts reorder on that order from M8
  Then the response is 201 with a Location header for a new DRAFT dry order
    And its requestedDate is 2026-10-02, the next open date, and its source is reorder
    And it holds the 2 active items with their original quantities, with totals computed from them
    And meta.notices names the inactive item that was left out
    And the original order is unchanged

AC-ORD-08  Style orders only for the delivery day
  Given a store manager for a Style outlet whose weekly delivery day is Friday (styleDeliveryDow 4)
  When she creates an order with requestedDate 2026-10-01, a Thursday
  Then the response is 400 VALIDATION_FAILED on requestedDate with a message that names Friday
    And no order exists for that outlet

AC-ORD-09  Create a draft order
  Given she has no dry order for 2026-10-02
    And the clock reads 2026-10-01 10:00:00
  When she posts /orders with tempClass AMBIENT, requestedDate 2026-10-02, 2 lines and an Idempotency-Key
  Then the response is 201 with Location /api/v1/orders/{id} and ETag W/"1"
    And the order is DRAFT with an orderNo from the Fresh sequence (WF-nnnn), deliveryDate 2026-10-02, afterCutoff false and source web
    And its outletId, depotId, brand and districtId are Fresh Kadawatha's, and placedById is her user id
    And editableUntil is 2026-10-01T16:00:00+05:30
    And its _links include self, lines, timeline and submit
    And exactly one audit row ordering.order.created exists and the log line ordering.order.created is written

AC-ORD-10  Outlet from scope, whole packs
  Given the clock reads 2026-10-01 10:00:00
  When she posts /orders with an outletId in the body
  Then the response is 400 VALIDATION_FAILED with an error on outletId and no order exists
  When she posts /orders whose first line has qty 0
  Then the response is 400 VALIDATION_FAILED with field lines[0].qty, code min and message "Enter at least 1"
    And no order exists

AC-ORD-11  Only Fresh outlets order chilled
  Given a store manager for a Style outlet and another for a Tech outlet
  When either creates an order with tempClass CHILLED
  Then the response is 400 VALIDATION_FAILED on tempClass and no order exists

AC-ORD-12  Lines match brand; inactive items refused
  Given a dry draft order for Fresh Kadawatha at version 1
  When she adds a line for a Style item with If-Match W/"1"
  Then the response is 400 VALIDATION_FAILED on itemId and the order is unchanged at version 1
  When she adds a line for an inactive Fresh dry item with If-Match W/"1"
  Then the response is 400 VALIDATION_FAILED on itemId and the order is unchanged at version 1

AC-ORD-13  Totals follow every line change
  Given a dry draft order for Fresh Kadawatha at version 1 with 2 lines
  When she replaces its lines through PUT /orders/{id}/lines with If-Match W/"1"
  Then GET on the order shows version 2, units equal to the sum of qty, weightKg equal to the sum of qty x unitWeightKg and volumeM3 equal to the sum of qty x unitVolumeM3 over the new lines
    And each line stores its item's unitWeightKg, unitVolumeM3 and unitValueLkr
    And the totals and version update the same way after adding a line (POST), changing a qty (PATCH) and removing a line (DELETE)
    And for a Tech order, valueLkr is the sum of qty x unitValueLkr

AC-ORD-14  Versioned writes need current If-Match
  Given a dry draft order at version 2
  When she replaces its lines without an If-Match header
  Then the response is 428 PRECONDITION_REQUIRED and the order is unchanged
  When she replaces its lines with If-Match W/"1"
  Then the response is 412 VERSION_MISMATCH and the order is unchanged at version 2

AC-ORD-15  Submitted orders stay editable until cutoff
  Given a SUBMITTED dry order for Fresh Kadawatha for 2026-10-02 at version 3
    And the clock reads 2026-10-01 15:40:00
  When she reads the order
  Then editableUntil is 2026-10-01T16:00:00+05:30
    And _links include edit (requires If-Match) and cancel (requires If-Match and reasonNote), and no submit
  When she changes one line's qty with If-Match W/"3"
  Then the order is still SUBMITTED, at version 4, with recomputed totals
    And one audit row holds the order before and after the change

AC-ORD-16  Submit needs lines and a draft
  Given a dry draft order with no lines
    And the clock reads 2026-10-01 15:00:00
  When she submits it
  Then the response is 400 VALIDATION_FAILED with field lines, code min and message "Add at least one item"
    And the order is still DRAFT, and no audit row ordering.order.submitted and no outbox event order.submitted exist
  When she submits an order that is SUBMITTED, CONFIRMED or CANCELLED
  Then the response is 409 CONFLICT_STATE and the order is unchanged

AC-ORD-17  Replays apply once
  Given the clock reads 2026-10-01 10:00:00
  When she sends the same create request twice with the same Idempotency-Key
  Then both responses are 201 with the same order id, the second carries Idempotent-Replayed: true, and one order exists
  When she sends that key again with a different body
  Then the response is 422 IDEMPOTENCY_KEY_REUSED
  When she submits a dry draft for 2026-10-02 twice with the same Idempotency-Key
  Then exactly one audit row ordering.order.submitted and one outbox event order.submitted exist
    And the event's data is { v: 1, orderId, outletId, afterCutoff: false, deliveryDate: "2026-10-02" }, routed to depotId PLG and outletIds [Fresh Kadawatha's id]

AC-ORD-18  Only drafts can be deleted
  Given a dry draft order for Fresh Kadawatha
  When she deletes it
  Then the response is 204
  When she deletes a SUBMITTED order
  Then the response is 409 CONFLICT_STATE and the order is unchanged

AC-ORD-19  Store cancels before cutoff with note
  Given a SUBMITTED dry order for Fresh Kadawatha for 2026-10-02 at version 3
    And the clock reads 2026-10-01 15:00:00
  When she cancels it with If-Match W/"3", an Idempotency-Key and reasonNote "Ordered twice"
  Then the response is 200 with status CANCELLED, cancelledAt 2026-10-01T15:00:00+05:30 and cancelReason "Ordered twice"
    And the order's _links include no edit, cancel or submit
    And exactly one audit row ordering.order.cancelled with reasonNote "Ordered twice" and one outbox event order.cancelled exist
    And she can then create a new dry order for 2026-10-02, which answers 201

AC-ORD-20  Store cancel needs note, before cutoff
  Given a SUBMITTED dry order for Fresh Kadawatha for 2026-10-02
  When she cancels it at 2026-10-01 15:00:00 without a reasonNote
  Then the response is 400 VALIDATION_FAILED on reasonNote and the order is unchanged
  When she cancels it at 2026-10-01 16:00:00 with a reasonNote
  Then the response is 409 CUTOFF_PASSED, the order is unchanged and no outbox event order.cancelled exists

AC-ORD-21  Dispatcher cancels before planning with code
  Given a dispatcher scoped to Peliyagoda and a CONFIRMED Peliyagoda order for 2026-10-02 at version 4
    And the clock reads 2026-10-01 17:00:00
  When the dispatcher cancels it with If-Match W/"4" and no reasonCode
  Then the response is 400 VALIDATION_FAILED with field reasonCode, code required and message "A reason is required"
  When the dispatcher cancels it with If-Match W/"4" and a reasonCode
  Then the response is 200 with status CANCELLED
    And exactly one audit row ordering.order.cancelled with that reasonCode and one outbox event order.cancelled exist
  When the dispatcher cancels a PLANNED Peliyagoda order
  Then the response is 409 CONFLICT_STATE and that order is unchanged

AC-ORD-22  Dispatcher marks an order urgent
  Given a dispatcher scoped to Peliyagoda and a CONFIRMED Peliyagoda order at version 2 with urgent false
  When the dispatcher sends PATCH /orders/{id}/priority with { "urgent": true } and If-Match W/"2"
  Then the response is 200 with urgent true at version 3
    And one audit row with the order before and after and one outbox event order.priority_changed exist

AC-ORD-23  Depot override moves the cutoff
  Given depot KDY has cutoffMin 900 (15:00)
    And a store manager for a Fresh outlet served by Kandy has a dry draft for 2026-10-02 with 2 lines
    And she, for Fresh Kadawatha, has a dry draft for 2026-10-02 with 2 lines
    And the clock reads 2026-10-01 15:00:00
  When both drafts are submitted
  Then the Kandy order is SUBMITTED with afterCutoff true and deliveryDate 2026-10-03
    And the Fresh Kadawatha order is SUBMITTED with afterCutoff false and deliveryDate 2026-10-02

AC-ORD-24  Cutoff confirms only due orders
  Given these Peliyagoda orders: 2 SUBMITTED for 2026-10-02, 1 DRAFT for 2026-10-02, and 1 SUBMITTED that rolled to 2026-10-03
  When the clock passes 2026-10-01 16:00
  Then within one minute the 2 are CONFIRMED with confirmedAt set, each with an audit row
    And the DRAFT is still DRAFT and the rolled order is still SUBMITTED
    And the close is audited, and the log line ordering.cutoff.closed carries depot PLG, date 2026-10-02 and count 2

AC-ORD-25  Close a cutoff in demo mode
  Given DEMO_MODE=true, a dispatcher scoped to Peliyagoda and 3 SUBMITTED Peliyagoda orders for 2026-10-02
    And the clock reads 2026-10-01 15:00:00
  When the dispatcher posts /depots/PLG/days/2026-10-02/close-cutoff
  Then the response is 200 and all 3 orders are CONFIRMED
    And order.cutoff_closed for PLG and 2026-10-02 is emitted exactly once, also after the clock later passes 16:00
  When, in a run with DEMO_MODE=false and the same 3 SUBMITTED orders, the dispatcher posts the same request
  Then no order changes and no order.cutoff_closed is emitted

AC-ORD-26  Reminder at 15:30 for missing orders
  Given Fresh Kadawatha has no order for 2026-10-02 and another Peliyagoda outlet has a SUBMITTED one
  When the clock passes 2026-10-01 15:30
  Then within one minute one cutoff reminder is queued for Fresh Kadawatha's store manager and none for the other outlet's
    And the log line ordering.reminder.sent carries the number of outlets reminded
    And no second reminder is queued for Fresh Kadawatha for 2026-10-02

AC-ORD-27  Save and reuse a template
  Given a SUBMITTED dry order for Fresh Kadawatha holding 3 lines
  When she posts save-as-template on it with name "Weekday dry"
  Then the response is 201 with a template for Fresh Kadawatha, tempClass AMBIENT and the same 3 items and quantities
  When she saves another template named "Weekday dry"
  Then the response is 409 CONFLICT_STATE and only one template has that name
  When she creates a dry order for 2026-10-03 with that template's id
  Then the new DRAFT holds the template's 3 lines and its templateId is set

AC-ORD-28  Receiving roster replaces the day
  Given she has 1 roster entry for Fresh Kadawatha on 2026-10-02
  When she sends PUT /outlets/{Fresh Kadawatha's id}/receiving-roster?date=2026-10-02 with 2 entries of staffName, fromMin and toMin
  Then GET on the same URL returns exactly those 2 entries
    And the change is audited
  When she sends the same PUT for another outlet's id
  Then the response is 404 NOT_FOUND and that outlet's roster is unchanged

AC-ORD-29  Dispatcher's order queue (03)
  Given a dispatcher scoped to Peliyagoda and 30 CONFIRMED Peliyagoda orders for 2026-10-02 across several districts
  When the dispatcher sends GET /orders?filter[depotId]=PLG&filter[deliveryDate]=2026-10-02&filter[status]=CONFIRMED&sort=districtId,orderNo&limit=25
  Then the response is 200 with 25 orders sorted by districtId, then orderNo
    And meta.page is { limit: 25, offset: 0, total: 30 }
    And the top-level _links include self, first, next and last, and no create
    And every order carries _links.self

AC-ORD-30  Unlisted filters are refused
  Given a dispatcher scoped to Peliyagoda
  When the dispatcher sends GET /orders?filter[note]=late
  Then the response is 400 VALIDATION_FAILED with an error naming note

AC-ORD-31  Past orders search (04)
  Given Peliyagoda orders from earlier days, some of them Fresh Kadawatha's
  When the dispatcher sends GET /orders?q=kadawatha
  Then every order returned is Fresh Kadawatha's or has "kadawatha" in its orderNo, matched without regard to case
    And each order's _links.timeline is /api/v1/timelines/order/{id}
  When the dispatcher sends GET /orders?q= with an existing orderNo, such as WF-0171
  Then that order is returned

AC-ORD-32  Store sees only its orders
  Given orders for Fresh Kadawatha and for another Fresh outlet, requested on dates since 2026-09-01
  When she sends GET /orders?filter[requestedDate][gte]=2026-09-01&sort=-requestedDate&limit=10&offset=0
  Then only Fresh Kadawatha's orders are returned, latest requestedDate first, and meta.page.total counts only hers
    And the collection's _links include create
    And with OrderScope removed in a test module, the same request still returns only Fresh Kadawatha's orders

AC-ORD-33  Out of scope is 404
  Given a Fresh Kadawatha order, a Fresh Kadawatha template and an order at a Kandy outlet
  When the store manager of another outlet reads, edits, submits or cancels the Fresh Kadawatha order, or reads the template
  Then each response is 404 NOT_FOUND and nothing changes
  When a dispatcher scoped to Peliyagoda reads or cancels the Kandy order, or a Peliyagoda loader reads it
  Then each response is 404 NOT_FOUND and nothing changes

AC-ORD-34  A missing permission is 403
  When each role below sends its request against an order, outlet or day in its own scope
  Then the response is 403 FORBIDDEN and nothing changes
    | role          | request                                                 | missing permission |
    | dispatcher    | POST /orders                                            | order:create       |
    | dispatcher    | POST /orders/{id}/submit                                | order:submit       |
    | dispatcher    | PUT /orders/{id}/lines                                  | order:update       |
    | dispatcher    | GET /order-templates                                    | order:create       |
    | dispatcher    | GET /outlets/{id}/receiving-roster?date=2026-10-02      | order:update       |
    | admin         | POST /orders/{id}/cancel                                | order:cancel       |
    | store_manager | PATCH /orders/{id}/priority                             | order:queue        |
    | store_manager | POST /depots/PLG/days/2026-10-02/close-cutoff           | order:queue        |
    | loader        | POST /orders                                            | order:create       |
    | driver        | GET /orders                                             | order:read         |

AC-ORD-35  Depot day summary (01, 03)
  Given Peliyagoda orders for 2026-10-02 in several statuses, brands and classes
    And the clock reads 2026-10-01 15:12:00
  When a dispatcher scoped to Peliyagoda sends GET /depots/PLG/days/2026-10-02
  Then the response is 200 with counts by status, by brand and by class that match those orders
    And its cutoff state shows the cutoff at 2026-10-01T16:00:00+05:30 as not yet passed
  When the same request is sent after the cutoff job has confirmed the day
  Then its cutoff state shows the cutoff closed

AC-ORD-36  Lifecycle moves check the machine
  Given a SUBMITTED order and a CONFIRMED order at Peliyagoda
  When planning calls OrderLifecycleService.markPlanned for each inside its own transaction
  Then the SUBMITTED order's call throws StateConflictError (409 CONFLICT_STATE), that order is unchanged and no audit row is written for it
    And the CONFIRMED order becomes PLANNED with one audit row written in planning's transaction

AC-ORD-37  A Style order's run is its outlet's weekly delivery day
  Given a store manager for a Style outlet whose weekly delivery day is Friday (styleDeliveryDow 4)
    And the clock reads 2026-10-01 15:00:00
  When she creates an order with requestedDate 2026-10-02, a Friday
  Then its deliveryDate is 2026-10-02, the day that outlet is served
  When she submits it at 2026-10-01 16:00:00, after the cutoff
  Then status is SUBMITTED, afterCutoff true and deliveryDate 2026-10-09, the next Friday, not Sat 3 Oct
    And an order.rolled_to_next_run event carries deliveryDate 2026-10-09

AC-ORD-38  A deferred order joins the queue for its new date
  Given Peliyagoda orders with deliveryDate 2026-10-03: one CONFIRMED, one DEFERRED from an earlier plan, one SUBMITTED, one PLANNED and one CANCELLED
    And a DEFERRED Peliyagoda order with deliveryDate 2026-10-05 and a CONFIRMED Kandy order with deliveryDate 2026-10-03
  When planning asks OrderQueries.queueFor(PLG, 2026-10-03)
  Then it gets the CONFIRMED and the DEFERRED order for that date, sorted by orderNo, and no other
    And nothing ran at the cutoff to move the DEFERRED order: it is still DEFERRED

AC-ORD-39  A deferred order is planned or deferred again without returning to CONFIRMED
  Given two DEFERRED orders with deliveryDate 2026-10-03
  When the 2026-10-03 plan is published carrying the first on a trip and deferring the second to 2026-10-05
  Then markPlanned moves the first from DEFERRED to PLANNED, with one ordering.order.status_changed audit row
    And markDeferred keeps the second DEFERRED, with deliveryDate 2026-10-05 and deferredCount one higher
```

Checklist (tick in the same PR as the passing test):
- [x] AC-ORD-01 Submit before the cutoff
- [x] AC-ORD-02 A late order rolls to the next run
- [x] AC-ORD-03 Edits lock at the cutoff
- [x] AC-ORD-04 One order per outlet, date and class
- [x] AC-ORD-05 Chilled items stay in chilled orders
- [x] AC-ORD-06 The cutoff confirms the day's orders
- [x] AC-ORD-07 Reorder from order history
- [x] AC-ORD-08 Style orders only for the delivery day
- [x] AC-ORD-09 Create a draft order
- [x] AC-ORD-10 Outlet from scope, whole packs
- [x] AC-ORD-11 Only Fresh outlets order chilled
- [x] AC-ORD-12 Lines match brand; inactive items refused
- [x] AC-ORD-13 Totals follow every line change
- [x] AC-ORD-14 Versioned writes need current If-Match
- [x] AC-ORD-15 Submitted orders stay editable until cutoff
- [x] AC-ORD-16 Submit needs lines and a draft
- [x] AC-ORD-17 Replays apply once
- [x] AC-ORD-18 Only drafts can be deleted
- [x] AC-ORD-19 Store cancels before cutoff with note
- [x] AC-ORD-20 Store cancel needs note, before cutoff
- [x] AC-ORD-21 Dispatcher cancels before planning with code
- [x] AC-ORD-22 Dispatcher marks an order urgent
- [x] AC-ORD-23 Depot override moves the cutoff
- [x] AC-ORD-24 Cutoff confirms only due orders
- [x] AC-ORD-25 Close a cutoff in demo mode
- [x] AC-ORD-26 Reminder at 15:30 for missing orders
- [x] AC-ORD-27 Save and reuse a template
- [x] AC-ORD-28 Receiving roster replaces the day
- [x] AC-ORD-29 Dispatcher's order queue (03)
- [x] AC-ORD-30 Unlisted filters are refused
- [x] AC-ORD-31 Past orders search (04)
- [x] AC-ORD-32 Store sees only its orders
- [x] AC-ORD-33 Out of scope is 404
- [x] AC-ORD-34 A missing permission is 403
- [x] AC-ORD-35 Depot day summary (01, 03)
- [x] AC-ORD-36 Lifecycle moves check the machine
- [x] AC-ORD-37 A Style order's run is its outlet's weekly delivery day
- [x] AC-ORD-38 A deferred order joins the queue for its new date
- [x] AC-ORD-39 A deferred order is planned or deferred again without returning to CONFIRMED

## Non-functional
- M1 loads in under 1 s on 4G.
- Every change is audited in the same transaction as the write, with its outbox event; a missing
  `@Transactional()` fails the first test because `audit.record()` and `outbox.add()` throw outside
  a transaction.
- The cutoff job confirms a depot's day within one minute of the cutoff, at about 150 orders per
  depot per day.
- Time comes from `ClockService.now()` on the API and `useServerClock()` on the web, never
  `new Date()`; business dates are Asia/Colombo strings.
- Every action link is tested present and absent (AC-ORD-01, 03, 15, 19, 29, 32).
- Log lines carry ids only: no names, notes or roster staff names.
- Row-level security on `orders` and `order_lines` backs up `OrderScope` (AC-ORD-32).

## Decided while building (ROO-19)
Every answer below is the behaviour the tests now pin; the questions they came from are gone.

- **Audit actions and events.** Audit actions are `ordering.order.created`, `.updated`,
  `.lines_changed`, `.submitted`, `.cancelled`, `.confirmed`, `.priority_changed`, `.deleted`,
  `.reordered`, `.status_changed`, plus `ordering.order_template.created`, `.deleted`,
  `ordering.receiving_roster.replaced` and `ordering.cutoff.closed`
  (`ordering.constants.ts`, `ORDER_AUDIT`). The event catalog gains `order.created`,
  `order.updated`, `order.deleted`, `order.lines_changed`, `order_template.created`,
  `order_template.deleted`, `receiving_roster.replaced` and `order.cutoff_reminder`, so rule 4's
  "an outbox event on every state change" holds for a draft's whole life. Payloads are in
  `events/ordering.events.ts`, each with `v: 1`.
- **Lifecycle moves emit no event of their own.** `OrderLifecycleService` audits the move and
  leaves the event to the use case it runs inside (planning's `plan.published`, loading's and
  execution's own), so publishing a plan with 57 orders does not put 57 events on the outbox. The
  cutoff is the one exception: it is ordering's own use case and emits one `order.cutoff_closed`
  for the depot's day.
- **`CreateOrderDto`.** `lines` is optional and `templateId` is accepted: M1 starts an order from a
  preset or from nothing, and submit is what insists on at least one line (AC-ORD-16).
- **A draft is always editable.** The cutoff governs what has been sent, so `editableUntil` locks a
  SUBMITTED order's edits and a store's cancel, while a DRAFT stays editable and simply rolls to the
  next run when it is sent late. A draft therefore carries `edit`, `addLine`, `setLines`, `cancel`,
  `delete` and `submit`.
- **DELETE on a draft is a hard delete.** A draft was never sent anywhere, so it is no business
  record; its lines go with it and the removal is audited as `ordering.order.deleted`. Anything
  sent answers 409 and is cancelled instead (AC-ORD-18).
- **Reorder.** The next open date is the next run whose cutoff has not passed
  (`CutoffService.nextOpenDate`), or for a Style outlet its next weekly delivery day. Any status but
  DRAFT can be reordered. An order of that class already on the date answers 409 with a link to it,
  as a second create does. Items that have left the catalog are dropped and named in the notice
  `REORDER_ITEMS_LEFT_OUT`; if none remain, the reorder answers 409.
- **Priority.** SUBMITTED, CONFIRMED, DEFERRED and PLANNED orders may be marked urgent: after that
  the order is on a vehicle and re-ranking it would change nothing.
- **`close-cutoff` outside demo mode answers 404**, like every other demo tool (identity's
  `/demo/*`), and the link is absent from the day summary. On success it answers
  `{ depotId, date, confirmed, closed }`; the day summary's fields are `DepotDaySummaryDto`.
- **The cutoff closes once.** `order_day_marks` holds one row per depot and delivery date, so the
  demo button and the ticker reaching the same day emit `order.cutoff_closed` once between them
  (AC-ORD-25). The same table keeps the 15:30 reminder to one per outlet and date.
- **The 15:30 reminder** emits `order.cutoff_reminder` per outlet, and "no order" means no
  non-cancelled order of any class for that run.
- **Order resource.** `ORDER_RESOURCE` now sorts by `requestedDate`, `deliveryDate`, `brand`,
  `tempClass` and `createdAt` as well, filters by `brand`, `districtId`, `urgent` and
  `afterCutoff`, and `q` matches the order number or the outlet's name. The response nests `totals`
  and carries `urgent`, `afterCutoff`, `editableUntil`, `cancelledAt` and `cancelReason`.
- **Dispatcher cancel reasons** are free upper-case codes for now (`^[A-Z][A-Z0-9_]*$`), stored in
  `orders.cancelReason` and the audit row's `reasonCode`. The reason table that A6 edits is
  planning's `deferral_reasons`; a cancel-reason list of its own is still to come.

## Open questions
- `order_lines.available` (default true) came from the Supabase draft's `order_lines.availability`.
  What sets it to false (the depot is out of stock at cutoff, the loader flags it missing, the store
  removes it?), and does an unavailable line still count towards the order's weight and volume? The
  column is written as true and read back on every line; nothing sets it to false yet. (Harini)
- AC-ORD-01 to 06 in the Build Spec say Wed 1 Oct, Thu 2 Oct and Fri 3 Oct, but 2026-10-01 is a
  Thursday. This spec corrects the labels and keeps the dates, so AC-ORD-02's late order rolls to
  Sat 3 Oct. Confirm Saturday is an operating day for Fresh at Peliyagoda in the demo calendar, and
  fix Step 3 of the Build Spec. (Harini)
- `GET /orders/{id}/lines` needs `order:update`, so dispatchers, loaders and admins read lines only
  through `?include=lines`. Intended? (Harini)
- Should a store manager be refused a `requestedDate` in the past? Nothing refuses one today, and
  the engine only ever plans the day it is given. (Harini)
- Which cancel reason codes may a dispatcher use, and where should the list live: a table of its
  own, or the deferral reasons A6 already edits? (Harini)

## Changelog
- 2026-10-03 A deferred order stays DEFERRED until a run carries it: the order machine gains
  DEFERRED to PLANNED and DEFERRED to DEFERRED, and `OrderQueries.queueFor(depotId, date)` (exported,
  for planning) returns the CONFIRMED and DEFERRED orders for a depot's date. Nothing requeues at
  the cutoff, so a store never sees a deferred order flip back to Confirmed (AC-ORD-38, AC-ORD-39)
- 2026-09-30 created from the Build Spec
- 2026-09-30 AC-ORD-01..06 weekday labels corrected to the 2026 calendar; dates and behaviour unchanged
- 2026-09-30 Model: `order_lines.available` (merged from the Supabase draft; meaning is an open question)
- 2026-10-01 Contract first (ROO-20): the M1 slice's routes, DTOs and `_links` are in openapi.json
  and answer 501; the store screens M1, M1a, M1b and M2 run on them through MSW. Adds `addLine`,
  `setLines` and `saveAsTemplate` links, the line-level `edit` and `remove`, and the response fields
  M1 shows (`totals.lines`, `deliveryWindow`, `brand`, `templateId`)
- 2026-10-02 ROO-19: the module is built. Every endpoint answers for real, AC-ORD-01 to 37 pass, and
  the decisions the build had to make are in "Decided while building" above. Adds AC-ORD-37 (a Style
  order's run is its outlet's weekly delivery day), `order_day_marks` (the once-a-day marks behind
  the cutoff close and the 15:30 reminder), `cancelledAt` and `cancelReason` on the order response,
  and the business-time helpers `cutoffFor`, `nextOperatingDay`, `nextWeekdayAfter` and
  `minuteLabel` in packages/shared
- 2026-10-02 ROO-33 (Nimesha) added `OrderLifecycleService.createBackorder` and the
  `ordering.order.backordered` audit action and `order.backordered` event, because only ordering
  may write `orders`: a dispatcher's REMOVE at the dock owes the store the goods that stayed
  behind. Harini owns them from here; covered by AC-LOD-12, with no ordering test of its own yet

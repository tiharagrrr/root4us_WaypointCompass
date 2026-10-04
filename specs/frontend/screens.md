# Screens

The Day 5 design is the spec for the web app. This file maps each of its 75 frames to a Figma node,
a route, its endpoints, a module, an owner and a build day. The react-screen skill and the
`/fidelity` command look frames up here. Source: Build Spec, Step 8 · Frontend.

## How to use this file

- Figma file key: `F22bpXWBPLlXkXwA89XHfQ`. The Figma MCP server is in `.mcp.json`. Sign in once
  through `/mcp`.
- Read a frame with the Figma MCP, passing the file key and the frame's node id. Load the
  figma-design-to-code guidance before `get_design_context`.
  - `get_design_context(fileKey: "F22bpXWBPLlXkXwA89XHfQ", nodeId: "185:20174")` returns layout,
    components and copy.
  - `get_screenshot(fileKey: "F22bpXWBPLlXkXwA89XHfQ", nodeId: "185:20174")` returns the image
    that `/fidelity` compares with the Playwright screenshot.
- Check every screen at its frame's viewport:
  - Desktop: 1440x960 (admin, store, dispatcher, and A0 sign-in).
  - Tablet: 1194x834 landscape (dock frames L1 to L5, including L3a to L3c).
  - Phone: 390x844 (driver frames, and the dock phone variants that end in `m`).
- Each route file starts with `// Figma: <code> <name> · <node>`, for example
  `// Figma: D4 Record stop · 185:20174`. A dialog, sheet or state component that lives inside
  another route puts the same line at the top of its own file.
- Endpoints are relative to `/api/v1`, except BetterAuth paths under `/api/auth`. "Via outbox" means
  the write goes through `outbox.enqueue` and `POST /sync` (see the offline-action skill).
- `/demo/inbox` is a plain page for demo mode only. It has no frame.

## Admin

Seven desktop frames in the Admin section of the Figma file.

| Code | Name | Figma node | Viewport | Route | Endpoints | Module | Owner | Build day |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A0 | Sign in | 185:8713 | 1440x960 | `/sign-in` | `/api/auth/sign-in/email` | identity | Nimesha | Thu 1 Oct |
| A1 | Users | 185:8751 | 1440x960 | `/admin/users` | `GET /users`, `GET /invitations` | identity | Nimesha | Thu 1 Oct |
| A2 | Invite user | 185:9045 | 1440x960 | Dialog on A1 | `POST /invitations` | identity | Nimesha | Thu 1 Oct |
| A3 | Outlets | 185:9392 | 1440x960 | `/admin/outlets` | `GET`, `PATCH /outlets` | master-data | Nimesha | Thu 1 Oct |
| A4 | Depots | 185:9769 | 1440x960 | `/admin/depots` | `GET`, `PATCH /depots`, `/depots/{id}/waves` | master-data | Nimesha | Thu 1 Oct |
| A5 | Vehicles | 185:9904 | 1440x960 | `/admin/vehicles` | `GET`, `PATCH /vehicles`, `PUT /vehicles/{id}/status`, `GET /vehicles/{id}/fuel` | fleet | Nimesha | Thu 1 Oct |
| A6 | Settings | 185:10227 | 1440x960 | `/admin/settings` | `/settings`, `/deferral-reasons`, `/clock`, `/devices/{id}/dock`, `/webhook-endpoints` | core (settings and clock) | Nimesha | Thu 1 Oct |

## Store manager

Eleven desktop frames, built for the Fresh Kadawatha store manager.

| Code | Name | Figma node | Viewport | Route | Endpoints | Module | Owner | Build day |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| M1 | New order | 185:10376 | 1440x960 | `/store/orders/new` | `POST /orders`, `PUT /orders/{id}/lines`, `/order-templates` | ordering | Harini | Wed 30 Sep (mocks) |
| M1a | Add item | 232:813 | 1440x960 | Dialog on M1 | `GET /items?filter[tempClass]=` | ordering | Harini | Wed 30 Sep (mocks) |
| M1b | Chilled order | 228:970 | 1440x960 | `/store/orders/new?class=chilled` | Same as M1 | ordering | Harini | Wed 30 Sep (mocks) |
| M2 | Cutoff passed | 185:10649 | 1440x960 | Notice on M1 and M3 | `meta.notices`: `ORDER_ROLLED_TO_NEXT_RUN` | ordering | Harini | Wed 30 Sep (mocks) |
| M3 | Orders | 185:10924 | 1440x960 | `/store/orders` | `GET /orders`, `GET /orders/{id}/eta` | ordering, execution (ETA) | Harini | Fri 2 Oct |
| M4 | Deferral notice | 185:11128 | 1440x960 | `/store/deferrals/:id` | `GET /deferrals/{id}`, `POST /deferrals/{id}/response`, comments | receipt (planning's deferral endpoints) | Harini | Fri 2 Oct |
| M5 | Confirm receipt | 185:11384 | 1440x960 | `/store/orders/:id/receipt` | `GET`, `POST /orders/{id}/receipt`, proof-of-delivery attachments | receipt | Harini | Fri 2 Oct |
| M6 | Report issue | 185:11543 | 1440x960 | `/store/orders/:id/issue` | `POST /issues`, `/attachments/presign` | receipt | Harini | Fri 2 Oct |
| M7 | Deferrals | 185:11685 | 1440x960 | `/store/deferrals` | `GET /deferrals` | receipt (planning's deferral endpoints) | Harini | Fri 2 Oct |
| M8 | Order history | 185:11842 | 1440x960 | `/store/history` | `GET /orders`, `POST /orders/{id}/reorder`, `/timelines/order/{id}` | ordering | Harini | Fri 2 Oct |
| M9 | Item catalog | 238:825 | 1440x960 | `/store/catalog` | `GET /items` | master-data | Harini | Fri 2 Oct |

## Dispatcher

Twenty-six desktop frames, built for the Peliyagoda dispatcher. Owners split by flow.

| Code | Name | Figma node | Viewport | Route | Endpoints | Module | Owner | Build day |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 01 | Dashboard | 488:8577 | 1440x960 | `/dispatch` | `/depots/{id}/days/{date}`, `/alerts`, tracking summary | alerts, planning | Nimesha | Fri 2 Oct |
| 02 | Notifications | 185:12422 | 1440x960 | Bell panel | `GET /me/notifications` (cursor), read | notifications | Nimesha | Fri 2 Oct |
| 03 | Order queue | 185:12856 | 1440x960 | `/dispatch/orders` | `GET /orders`, `PATCH /orders/{id}/priority`, cancel | ordering | Harini | Thu 1 Oct |
| 04 | Past orders | 488:8916 | 1440x960 | `/dispatch/past-orders` | `GET /orders`, timelines | ordering | Harini | Thu 1 Oct |
| 05 | Plan · empty | 265:2134 | 1440x960 | `/dispatch/plan/:date` | `GET /depots/{id}/plans/{date}`, `POST engine-runs` | planning | Tihara | Thu 1 Oct |
| 06 | Add vehicle · Vehicle | 265:2419 | 1440x960 | Wizard dialog | `vehicle-options`, `/context` | planning, fleet | Tihara | Thu 1 Oct |
| 07 | Add vehicle · Orders | 488:9309 | 1440x960 | Wizard | `order-options`, client `optionsForTrip` | planning | Tihara | Thu 1 Oct |
| 08 | Add vehicle · Check | 267:2216 | 1440x960 | Wizard | `POST /validate`, `POST /edits` | planning | Tihara | Thu 1 Oct |
| 09 | Plan · vehicles | 268:2245 | 1440x960 | `/dispatch/plan/:date` | Plan and trips; engine progress over SSE | planning, fleet | Tihara | Thu 1 Oct |
| 10 | View and edit vehicle | 488:9736 | 1440x960 | Dialog | `POST /edits`, `suggest-fixes` | planning | Tihara | Fri 2 Oct |
| 11 | Over capacity | 269:2996 | 1440x960 | Dialog state | Violations, `suggest-fixes` | planning | Tihara | Fri 2 Oct |
| 12 | Plan ahead | 290:2387 | 1440x960 | `/dispatch/plan-ahead` | `/forecasts`, reservations | planning, forecasting | Tihara | Sat 3 Oct |
| 13 | Plan ahead · day | 289:2797 | 1440x960 | `/dispatch/plan-ahead/:date` | `POST reservations` | planning | Tihara | Sat 3 Oct |
| 14 | Confirm trips | 185:15323 | 1440x960 | Wizard step 2 | `POST /validate` | planning | Tihara | Fri 2 Oct |
| 15 | Unplanned orders | 185:15715 | 1440x960 | Wizard step 3 | `GET /unplanned`, `POST deferrals/decisions` | planning | Tihara | Fri 2 Oct |
| 16 | Swap order | 185:16098 | 1440x960 | Dialog | Decisions with `SWAP` | planning | Tihara | Fri 2 Oct |
| 17 | Review and publish | 185:16544 | 1440x960 | Wizard step 4 | `GET publish-preview` | planning | Tihara | Fri 2 Oct |
| 18 | Publish plan | 185:16860 | 1440x960 | Dialog | `POST /publish` | planning | Tihara | Fri 2 Oct |
| 19 | Tracking | 185:17224 | 1440x960 | `/dispatch/tracking` | `/depots/{id}/tracking`, positions over SSE, alerts | execution, alerts | Aniqa | Fri 2 Oct |
| 19a | Trip details | 464:1966 | 1440x960 | `/dispatch/trips/:id` | `/trips/{id}/tracking`, alerts | execution, alerts | Aniqa | Fri 2 Oct |
| 19b | Re-sequence stops | 464:2353 | 1440x960 | Dialog | `POST /trips/{id}/resequence`, stop defer | planning (endpoints) | Aniqa | Sat 3 Oct |
| 19c | Sync conflict | 464:2740 | 1440x960 | Dialog | `/sync-conflicts` | sync | Aniqa | Fri 2 Oct |
| 20 | Reassign trip | 185:17727 | 1440x960 | Dialog | `POST /trips/{id}/reassign`, `vehicle-options` | planning (endpoints) | Aniqa | Sat 3 Oct |
| 21 | End-of-day summary | 185:18295 | 1440x960 | `/dispatch/end-of-day` | `/plans/{id}/end-of-day`, `POST /close` | execution, planning (close) | Aniqa | Sat 3 Oct |
| 22 | Forecast | 185:18562 | 1440x960 | `/dispatch/forecast` | `/depots/{id}/forecasts` | forecasting | Tihara | Sat 3 Oct |
| 23 | Deferrals | 185:18890 | 1440x960 | `/dispatch/deferrals` | `GET /deferrals`, timelines | planning, audit | Tihara | Fri 2 Oct |

## Loader

Tablet frames at 1194x834 landscape, plus phone variants at 390x844 for loaders without a tablet.
Every write goes through the offline outbox except release.

| Code | Name | Figma node | Viewport | Route | Endpoints | Module | Owner | Build day |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| L1 | Sign in | 185:19312 | 1194x834 | `/sign-in/dock` | `/api/auth/sign-in/pin` | identity | Harini | Thu 1 Oct |
| L2 | Loading list | 185:19377 | 1194x834 | `/dock/trips/:id` | `/depots/{id}/loading/trips`, `/trips/{id}/load-list`, checks via outbox | loading | Harini | Thu 1 Oct |
| L3 | Flag an item | 185:19537 | 1194x834 | Dialog | Flag via outbox, photo attachment | loading | Harini | Thu 1 Oct |
| L3a | Item flagged | 549:2497 | 1194x834 | State on L2 | Waiting for the decision over SSE | loading | Harini | Fri 2 Oct |
| L3b | Dispatcher replied | 542:2659 | 1194x834 | State on L2 | `load.flag_decided` over SSE, comments | loading | Harini | Fri 2 Oct |
| L3c | Item re-checked | 542:2821 | 1194x834 | State on L2 | Re-check via outbox | loading | Harini | Fri 2 Oct |
| L4 | Release trip | 185:19748 | 1194x834 | `/dock/trips/:id/release` | `GET release-checks`, `POST /release` | loading | Harini | Thu 1 Oct |
| L5 | Trip released | 185:19880 | 1194x834 | State | — | loading | Harini | Thu 1 Oct |
| L1m | Sign in | 254:1243 | 390x844 | `/sign-in/dock` | Same as L1 | identity | Harini | Thu 1 Oct |
| L2m-a | Runs | 254:1306 | 390x844 | `/dock` | `/depots/{id}/loading/runs` | loading | Harini | Thu 1 Oct |
| L2m-b | Loading list | 254:1498 | 390x844 | `/dock/trips/:id` | Same as L2 | loading | Harini | Thu 1 Oct |
| L3m | Flag an item | 254:1605 | 390x844 | Sheet | Same as L3 | loading | Harini | Thu 1 Oct |
| L3m-a | Item flagged | 549:3616 | 390x844 | State | Same as L3a | loading | Harini | Fri 2 Oct |
| L4m | Release trip | 254:1675 | 390x844 | `/dock/trips/:id/release` | Same as L4 | loading | Harini | Thu 1 Oct |
| L5m | Trip released | 254:1804 | 390x844 | State | — | loading | Harini | Thu 1 Oct |

## Driver

Phone frames at 390x844, built for the REF-07 driver. Every screen after D1 works from Dexie, and
every write goes through the outbox.

| Code | Name | Figma node | Viewport | Route | Endpoints | Module | Owner | Build day |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| D0a | Sign in | 244:828 | 390x844 | `/sign-in/driver` | `/api/auth/phone-number/send-otp` | identity | Aniqa | Wed 30 Sep (mocks) |
| D0b | Enter code | 244:937 | 390x844 | `/sign-in/driver` | `/api/auth/phone-number/verify` | identity | Aniqa | Wed 30 Sep (mocks) |
| D1 | Today's trip | 185:19938 | 390x844 | `/driver` | `/me/trips`, the offline bundle, `/downloaded`, `TRIP_STARTED` | execution | Aniqa | Wed 30 Sep (mocks), Thu 1 Oct (live) |
| D2 | Download failed | 185:20021 | 390x844 | State on D1 | Retry the bundle | execution | Aniqa | Thu 1 Oct |
| D3 | Next stop | 185:20107 | 390x844 | `/driver/stops/:id` | Dexie; `ARRIVED` via outbox | execution | Aniqa | Wed 30 Sep (mocks), Thu 1 Oct (live) |
| D4 | Record stop | 185:20174 | 390x844 | `/driver/stops/:id/record` | `DELIVERED` or `PARTIAL` via outbox, signature or photo | execution | Aniqa | Thu 1 Oct |
| D5 | Exception | 185:20240 | 390x844 | `/driver/stops/:id/exception` | `FAILED` or `ISSUE_REPORTED` via outbox | execution | Aniqa | Thu 1 Oct |
| D6 | Offline | 185:20316 | 390x844 | Banner and state | Outbox count and last sync | execution, sync | Aniqa | Fri 2 Oct |
| D7 | Trip complete | 185:20391 | 390x844 | `/driver/trips/:id/done` | `TRIP_COMPLETED` via outbox | execution | Aniqa | Sat 3 Oct |
| D8 | Can't run this trip | 185:20441 | 390x844 | Dialog | `CANT_RUN` via outbox, sent at once when online | execution | Aniqa | Thu 1 Oct |
| D9 | Dock and access | 185:20487 | 390x844 | Sheet | Outlet access notes and contact from the bundle | execution (master-data read) | Aniqa | Thu 1 Oct |
| D10 | Trips | 245:828 | 390x844 | `/driver/trips` | `/me/trips` for 7 days | execution | Aniqa | Sat 3 Oct |
| D11 | Past trip | 245:1009 | 390x844 | `/driver/trips/:id` | Trip with stops and proof-of-delivery thumbnails | execution | Aniqa | Sat 3 Oct |
| D12 | Account | 246:874 | 390x844 | `/driver/account` | `GET`, `PATCH /me`, devices | identity | Aniqa | Sat 3 Oct |
| D13 | Sign out | 246:1034 | 390x844 | Dialog | Outbox check, then sign out | identity, sync | Aniqa | Fri 2 Oct |
| D14 | No trip | 247:924 | 390x844 | `/driver` when empty | `/me/trips` returns nothing | execution | Aniqa | Sat 3 Oct |

Build days follow the Overview's day-by-day plan. "Mocks" means built against MSW before the
endpoint is live.

## Build order

Screens are built in tiers so the judges' path is finished and polished first.

1. Foundation. Compass tokens and components (below), the five shells, sign-in, and MSW mocks, so
   every later screen starts from real parts.
2. The judge path, in this order: A0, M1, M1b, 03, 05, 06, 07, 08, 09, 15, 17, 18, L2, L3, L4, D1,
   D3, D4, 19, M5, 21. One order travels from store to plan to dock to truck to receipt. Build
   against MSW first and switch to the real API as each endpoint lands.
3. Exceptions and depth: 10, 11, 16, 19a, 19b, 19c, 20, L3a, L3b, L3c, D2, D5, D6, D7, D8, M2, M4,
   M6, M7. These are the moments where the day goes wrong; the engine and offline scores depend on
   them.
4. Everything else: A1 to A6, 12, 13, 22, 23, M8, M9, D9 to D14, 02.

Step 8 places no tier on 01, 04, 14, M1a, M3, L5 or the loader phone variants (see Open questions).

Every screen gets `/fidelity <code>` before merge: a Playwright screenshot at the frame's size
beside the Figma screenshot, checked for layout and spacing tokens, type styles, colours from
tokens only, copy word for word, all required states, and 44-pixel touch targets on dock and
driver shells. Harini signs off each screen as the fidelity owner. Log any intended difference in
`docs/departures.md`. The judge-path screens are snapshotted in CI with the demo clock frozen and
the seed fixed.

## Shared components

Build from these before writing screen-specific markup. If a Figma component has no React twin,
add it to `src/ui` first: one component, its variants, a story.

- `src/ui` (Compass), all built: Button, Badge, Card, Input, Field, Select, Switch, RadioCards,
  SegmentedControl, Table, Pagination, Dialog, Sheet, Toast, StatusChip, Skeleton, Empty and error
  states, Avatar, DemoTimeBadge, CapacityMeter, DeliveryWindow, StopSequenceRow, DriverStopCard,
  PinKeypad. `/admin/dev/ui` renders every one of them beside its frame.
- Icons come from `@material-symbols/svg-400` (rounded, filled, weight 400), the set the Figma file
  draws with; `Icon` names them for Waypoint (`deferrals` is Material's `event_upcoming`). The
  compass mark in the wordmark is the only local SVG.
- `src/ui/action.tsx`: `<Action>` renders a button only when the resource carries the link. It
  sends one Idempotency-Key per press, adds If-Match when the link requires it, and shows a confirm
  or a reason picker when needed.
- Tokens and text styles come from `@compass/ui-tokens`. No hex values.
- Shells: sign-in (centred card; phone layout for drivers), admin, store and dispatcher (desktop
  sidebar; the dispatcher adds the depot switch, the demo-time badge and the 02 bell), dock (tablet
  1194x834 or phone 390) and driver (phone 390 with Today, Trips and Account tabs). Dock and
  driver shells set `data-density="touch"`: 44-pixel minimum targets and larger type.
  All five are built (ROO-15), each loading as its own chunk:

  | Shell | File | Area | Chrome |
  | --- | --- | --- | --- |
  | Admin | `layouts/admin-layout.tsx` | `/admin/*` | A1's sidebar and header |
  | Store | `layouts/store-shell.tsx` | `/store/*` | `DesktopShell`; New order, Orders, Deferrals, Receipts, Item catalog |
  | Dispatcher | `layouts/dispatch-shell.tsx` | `/dispatch/*` | `DesktopShell` plus the depot switch and the demo-time badge |
  | Dock | `layouts/dock-shell.tsx` | `/dock/*` | Top bar with the depot, the loader and Switch user; touch density |
  | Driver | `layouts/driver-shell.tsx` | `/driver/*` | Top bar and the Today, Trips and Account tabs; touch density |

  `RoleArea` keeps each role in its own area: a route elsewhere redirects to `ROLE_HOME[role]`.
  The control heights come from `--compass-size-control*`, so touch density raises every Button,
  Input and Select to 44 pixels without a second set of components.
- Data and time: generated hooks from `@compass/api-client`, `useEventStream` in `src/realtime`,
  `outbox.enqueue` and `useLiveQuery` in `src/offline`, `useServerClock()` and `formatColombo()`.
- Maps and charts: MapLibre GL with cached OpenStreetMap tiles for 19; Recharts for 22.

## Required states

Every screen:

- Loading: a skeleton that matches the frame's layout.
- Error: the problem detail with a retry. Forms map a problem's `errors[]` onto fields with
  `applyProblem`.
- Actions: every button comes from `_links` through `<Action>`. Test the link-present and the
  link-absent state.
- Live data: `useEventStream` keeps the cache fresh. Dialogs and states inherit their parent's
  loading and error handling.

Empty: show an empty state on every list that can be empty. These frames have one: A1, A3, A4,
A5, A6 (reasons, dock tablets, webhooks), M1 (no lines yet), M1a (no search results), M3, M7, M8,
M9, 01 (no open alerts), 02, 03, 04, 12, 15 (nothing unplanned), 19 (no trips in progress), 19c (no
open conflicts), 23, L2, L2m-a, D10. The empty plan (05) and the driver's empty day (D14) are
frames of their own. Take empty-state copy from Figma.

Offline applies to the dock and driver shells only:

- Driver frames D1 to D14 and dock frames L2 to L5 with their phone variants show the offline
  banner. On the driver shell this is D6, with the outbox count and the last sync time. Writes keep
  working through the outbox.
- D1 without a downloaded bundle shows D2 with retry and the last download time.
- L4 and L4m need a connection to release. Offline, show that release is waiting for a connection.
- D13 waits until the outbox is empty. There is no discard option.
- Admin, store and dispatcher shells have no offline mode. A failed request shows the error state.

Screen-specific states and actions, from Step 8:

| Code | Actions and states |
| --- | --- |
| A0 | Wrong password, rate-limited, forgot password |
| A1 | Invite, change role or scope with a reason, deactivate, resend or revoke an invitation; filter by role and depot; pagination |
| A2 | Fields change with the role: outlet for stores, depot for loaders and dispatchers, phone and vehicle for drivers |
| A3 | Windows, dock, parking, access notes; outlets without a manager flagged |
| A4 | Docks, chilled docks, cutoff override, run waves |
| A5 | Status with a reason, this week's fuel against quota |
| A6 | Demo time travel, deferral reasons, dock tablets, webhooks |
| M1 | Send, save as template, cutoff countdown from `editableUntil` |
| M1a | Search, category filter, pack stepper |
| M1b | Chilled items only; the sent confirmation |
| M2 | Moved to the next run, with the new date |
| M3 | Today's deliveries with ETA, status chips, receipts still to confirm, pagination |
| M4 | Acknowledge, or request priority with a note |
| M5 | Quantity and condition per line; the waiting-for-driver state |
| M6 | Type, quantity, photos |
| M7 | History with reasons; repeat skips highlighted |
| M8 | Reorder, open the timeline |
| M9 | 50 Fresh items: 32 dry, 18 chilled |
| 01 | Exception panel with each alert's fix link; cutoff and plan state |
| 02 | Unread count live over SSE |
| 03 | Date selector, group by district and brand, pagination |
| 04 | Search, open the timeline |
| 05 | Auto-suggest or Add vehicle; the publish-opens banner |
| 06 | Unavailable vehicles show why |
| 07 | Blocked orders dimmed with their reason |
| 08 | Minutes against budget, capacity bars, windows |
| 09 | Summary strip from `explain()` |
| 10 | Move, remove, re-sequence |
| 11 | Suggest fixes applies one edit list |
| 12 | Days ahead against capacity |
| 13 | Reserve vehicles against the forecast |
| 14 | Every trip passes its checks |
| 15 | Reason picker, repeat-skip override note |
| 16 | Serves a repeat skip in place of a lower priority |
| 17 | Blockers listed until clear |
| 18 | Who gets notified |
| 19 | Map, late risk, "no signal since" |
| 19a | Planned, ETA and actual per stop |
| 19b | Validated against actual times |
| 19c | Keep device or keep server |
| 20 | Another driver or vehicle, validated |
| 21 | Per-trip results, close the day |
| 22 | Ten weeks of volume against fleet capacity |
| 23 | The deferral log with reasons and responses |
| L1 | Depot and PIN keypad; wrong PIN; not a dock device |
| L2 | Last stop first, Checked by name, Plan updated banner, offline banner |
| L3 | Reason, quantity, note |
| L3a | Undo until the dispatcher decides |
| L3b | Replace or remove, with the note |
| L3c | Flag resolved |
| L4 | Reefer temperature for chilled trips; needs a connection |
| L5 | On to the next trip in the wave |
| L1m, L2m-b, L3m, L3m-a, L4m, L5m | Phone layout of the matching tablet frame |
| L2m-a | Trips by wave with progress and open flags |
| D0a | Phone in +94 format |
| D0b | Resend after 60 seconds; in the demo the code is in `/demo/inbox` |
| D1 | Download state, Start trip, location-sharing indicator |
| D2 | Last successful download time |
| D3 | Window, map link, Dock and access |
| D4 | Quantities per line, receiver name |
| D5 | Outcome, note, photo |
| D6 | "3 records waiting to send" |
| D7 | Summary of the run |
| D8 | Reason and photo |
| D9 | Tap to call |
| D10 | — |
| D11 | For settling disputes |
| D12 | Language, notifications |
| D13 | Waits until everything has synced |
| D14 | The next planned trip, if any |

## Open questions

- Build tiers: Step 8 places no tier on 01 Dashboard, 04 Past orders, 14 Confirm trips, M1a, M3,
  L5 or the loader phone variants (L1m, L2m-a, L2m-b, L3m, L3m-a, L4m, L5m). 14 sits between 09
  and 15 in the publish wizard, so it likely belongs on the judge path. Confirm.
- Sign-in timing: the Overview plans A0 and L1 for Thu 1 Oct, but Step 8 puts sign-in in the
  foundation tier and the Wed 22:00 gate needs every role to sign in. Confirm whether A0, L1 and
  L1m land on Wed.
- The architecture table in Step 8 lists fewer routes than the frame tables. Missing there:
  `/dispatch/past-orders`, `/dispatch/plan-ahead/:date`, `/store/deferrals/:id`,
  `/store/orders/:id/receipt`, `/store/orders/:id/issue`, `/driver/stops/:id/record`,
  `/driver/stops/:id/exception` and `/driver/trips/:id/done`. This file uses the frame tables.
- The architecture table names the dock phone frames "L2m–L5m" and the store frames "M1–M9"; the
  real codes include L2m-a, L2m-b, L3m-a, M1a and M1b.
- The store sidebar (M1) lists Receipts between Deferrals and Item catalog, but no receipts list
  has a frame: M5 is one order's receipt. Is Receipts a list of its own, or M3 filtered to the
  receipts still to confirm? `/store/receipts` is a placeholder until this is settled.
- Dock tablet landing: `/dock` is L2m-a Runs on the phone. What does the tablet show at `/dock`
  before a trip is chosen? L2's data includes the trip list.
- 01 Dashboard has no single owning module: alerts owns the exception panel, loading owns the flag
  panel, and the owner of `/depots/{id}/days/{date}` is not named.
- The ordering spec example in Step 3 lists M9 and not 04; the Module specs tab puts M9 in
  master-data and 04 in ordering. This file follows the Module specs tab.
- Map library: Step 8 says MapLibre GL for 19; the Overview stack table says react-leaflet.
- Departures: Step 8 and Step 3 log them in `docs/departures.md`; the Overview says the README log.
- Route file layout (resolved in the kit, confirm): `src/app/routes/<role>.tsx` registers a role's
  routes and loaders; each frame is one file in `src/features/<module>/` carrying the `// Figma:`
  header, following Step 2's web layout.
- Landing after sign-in: Step 8 says to call `GET /api/v1` and follow the role's landing link, but
  that endpoint has no response DTO, so the generated client types it `void`, and its links are API
  hrefs, not routes. Sign-in reads the role from `GET /me` and maps it in `ROLE_HOME`. Give the root
  endpoint a DTO and the client can follow the links themselves.
- The store sidebar label reads "STORE · FRESH KADAWATHA" in M1, but `/me` carries only `outletId`.
  The shell shows "STORE" until master data publishes `GET /outlets/{id}` (or `/me` carries the
  scope names).
- M1's sidebar has a Receipts entry with no frame of its own; `/store/receipts` stands in for the
  list until the receipt module says what belongs there (M5 is the per-order screen).
- The dock phone frame (L2m-a) puts Switch user in the page header, the tablet (L2) in the top bar.
  The shell keeps it in the top bar at both sizes; confirm at `/fidelity L2m-a`.
- PWA icons are one SVG (`public/app-icon.svg`). iOS wants PNGs at 192 and 512; add them before the
  demo if the app is installed on a phone.

## Changelog

- 2026-10-04 ROO-81 A3 Outlets, A4 Depots and A5 Vehicles built at `/admin/outlets`,
  `/admin/depots` and `/admin/vehicles`, replacing their placeholders: the outlet edit dialog with
  the window rules, the depot's docks, cutoff override and run waves, and the vehicle list with its
  edit and status dialogs and this week's fuel against quota. Screens live in
  `src/features/master-data/` and `src/features/fleet/`. Outlets with no manager and vehicles that
  are not active are flagged in their lists. The three frames still need `/fidelity`: the Figma MCP
  was not reachable in the session that built them, so they follow A1 and A6's parts and spacing

- 2026-10-02 ROO-15 the five shells, their routes and the role guard; the six composites
  (Sheet, CapacityMeter, DeliveryWindow, StopSequenceRow, DriverStopCard, PinKeypad); touch density
  on the control tokens; `useEventStream`; i18n in `src/i18n/en.json`; the service worker. Icons now
  come from @material-symbols. The dock and driver areas are `/dock` and `/driver`, as Step 8 says.
- 2026-10-04 D10 Trips and D11 Past trip built (ROO-62); D11 hides the tab bar, as its frame does
- 2026-09-30 created from the Build Spec
- 2026-10-01 M1, M1a, M1b and M2 built on mocks with the store shell (ROO-20)
- 2026-10-04 04 Past orders built (ROO-35); 03 and 04 share a Queue / Past runs switch, and the
  sidebar's Order queue entry stays lit on both

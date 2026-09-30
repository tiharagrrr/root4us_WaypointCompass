---
module: receipt
owner: Harini
status: draft          # draft | ready | in-progress | done
screens: [M5, M6, M4, M7]   # M4 and M7 run on planning's deferral endpoints
depends-on: [audit, ordering, execution]
---

# Receipt and issues

## Purpose
Receipt closes the loop at the store: the manager confirms what actually arrived and reports
anything wrong. Issues carry disputes to the dispatcher, who resolves them on the record's thread.

## Scope
In: the receipt view of expected against delivered lines with the driver's proof of delivery (M5);
confirming a receipt, including early confirmation with `awaitingDriverSync` and its reconciliation
on `stop.completed`; issues (report, list, read, resolve, reopen) and the store and dispatcher
thread on each issue; M6; the issue detail.

Out:
- Stop events, delivery lines and proof-of-delivery capture on D4 and D5: execution.
- Order status (RECEIVED, ISSUE_REPORTED): ordering, through OrderLifecycleService.
- M4 Deferral notice and M7 Deferrals: built in this slice on planning's deferral endpoints; their
  behaviour is specified in specs/planning/spec.md.
- The STORE_ISSUE alert: alerts. Push, in-app and email messages: notifications.
- Comment storage and the shared comments controller: platform (Step 6).
- Photo presign, upload and download: the attachments endpoints (execution).
- M3's list of receipts still to confirm: ordering (GET /orders).

Screens (desktop 1440 x 960):

| Frame | Node | Route | Data | States |
| --- | --- | --- | --- | --- |
| M5 Confirm receipt | 185:11384 | /store/orders/:id/receipt | GET, POST /orders/{id}/receipt, proof-of-delivery attachments | Quantity and condition per line; the waiting-for-driver state |
| M6 Report issue | 185:11543 | /store/orders/:id/issue | POST /issues, /attachments/presign | Type, quantity, photos |
| M4 Deferral notice | 185:11128 | /store/deferrals/:id | Planning: GET /deferrals/{id}, POST /deferrals/{id}/response, comments | Acknowledge, or request priority with a note |
| M7 Deferrals | 185:11685 | /store/deferrals | Planning: GET /deferrals | History with reasons; repeat skips highlighted |

## Model
Schema file apps/backend/src/db/schema/receipt.ts. Receipt owns receipts, receipt_lines and issues; the
alerts table in the same file belongs to alerts.

Receipt (receipts):

| Column | Notes |
| --- | --- |
| id | UUIDv7 |
| orderId | unique, references orders.id: one receipt per order |
| stopId | the stop that delivered it |
| status | receipt_status: CONFIRMED, CONFIRMED_WITH_ISSUES |
| note | the store's note |
| confirmedById, confirmedAt | confirmedById references users.id; confirmedAt defaults to now |
| awaitingDriverSync | true when the store confirmed before the driver's record arrived |

Row-level security: receipts_app_scope follows the order (viaVisibleOrder); receipts_readonly
selects all.

ReceiptLine (receipt_lines): primary key (receiptId, orderLineId); qtyReceived; condition (ok,
damaged, short, missing, temperature). Deleted with its receipt.

Issue (issues):

| Column | Notes |
| --- | --- |
| id | UUIDv7 |
| outletId | references outlets.id |
| orderId, stopId | the order or stop it is about |
| receiptId | the receipt it was raised with on M5, if any; indexed |
| orderLineId | the order line it is about, if any |
| type | issue_type: MISSING, DAMAGED, SHORT, TEMPERATURE, LATE, OTHER |
| qtyAffected, description | description is required |
| status | issue_status: OPEN, IN_PROGRESS, RESOLVED (default OPEN) |
| resolution, resolutionNote | issue_resolution: CREDIT_ISSUED, CREDIT_REQUESTED, REDELIVERY, NO_ACTION |
| raisedById, raisedByRole | who raised it (store manager or driver) |
| resolvedById, createdAt, resolvedAt | |

Index issues_outlet_status_idx on (outletId, status). Row-level security issues_app_scope uses
issueVisible: admin and system see all, dispatchers their depot's outlets, store managers their
outlet, drivers issues on stops of their own trips.

Invariants:
- One receipt per order.
- The store can confirm once the stop is DELIVERED or PARTIAL, or after the ETA has passed even if
  the driver's record hasn't synced (awaitingDriverSync).
- Unconfirmed deliveries stay on M3 until the store confirms; there is no auto-confirm in the
  hackathon build.
- A short quantity or a bad condition needs an issue, and the receipt becomes
  CONFIRMED_WITH_ISSUES.
- Stores see their outlet's issues and dispatchers their depot's; drivers can raise issues but not
  read others'.
- The store may reopen an issue within 48 hours of its resolution.
- Receipts carry no version column: confirming a receipt and reporting an issue send If-Match with
  the order's version, and an Idempotency-Key.
- Issue threads live in the platform comments table (entityType issue): plain text up to 1,000
  characters, no editing or deleting, every comment audited. Issue photos are attachments of kind
  ISSUE_PHOTO with ownerType issue.
- Order moves used: DELIVERED or PARTIAL → RECEIVED (RECEIVE) or ISSUE_REPORTED (REPORT);
  RECEIVED → ISSUE_REPORTED (REPORT).

## Endpoints
| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| GET | /orders/{id}/receipt | receipt:read | M5: expected against delivered lines, the driver's proof of delivery, `awaitingDriverSync` |
| POST | /orders/{id}/receipt | receipt:confirm | M5: lines with quantity and condition, and a note; `If-Match` on the order; Idempotency-Key; 201 with Location |
| GET | /issues | issue:read | Scoped: stores see their outlet, dispatchers their depot; offset pages |
| POST | /issues | issue:create | M6: order or stop, type, quantity, description, photos; drivers raise them from D5; `If-Match` on the order; Idempotency-Key; 201 with Location |
| GET | /issues/{id} | issue:read | The issue detail |
| GET, POST | /issues/{id}/comments | issue:read; issue:create or issue:resolve to post | The store and dispatcher thread (Step 6), served by the shared comments controller, which checks read access on the issue |
| POST | /issues/{id}/resolve | issue:resolve | Credit issued, credit requested, redelivery or no action, with a note |
| POST | /issues/{id}/reopen | issue:create | The store, within 48 hours of resolution |

Links (the Step 4 affordance rule): the receipt carries confirm; an issue carries comments, resolve
and reopen. Each appears only when the state allows it, the actor holds the permission, the row is
in scope and the time rules allow it.

## Services and helpers
Module folder apps/backend/src/modules/receipt.

- **ReceiptService.confirm()** compares received with delivered lines, creates issues for
  discrepancies, and calls `OrderLifecycleService.markReceived` or `markIssueReported`. If the
  driver's events haven't synced yet it sets `awaitingDriverSync` and reconciles on
  `stop.completed`.
- **ReceiptQueries**: the receipt view, reading delivery lines and proof of delivery through
  execution's exported queries.
- **IssuesService**: create, comment, resolve, reopen.
- A `stop.completed` listener in the worker opens the receipt for confirmation and reconciles early
  confirmations; it dedupes by event id.
- Policies: a ScopePolicy for receipts and issues (store: outletId = actor.outletId; dispatcher:
  depotId = actor.depotId, or all depots) and LinkBuilders for both.

## Events
Emits:

| Event | Consumed by | Payload |
| --- | --- | --- |
| receipt.confirmed | realtime, webhooks, 21 End-of-day | v: 1, ids and statuses (fields not given) |
| issue.reported, issue.commented, issue.resolved | alerts, notifications (store and dispatcher), realtime, webhooks | v: 1, ids and statuses (fields not given) |

Webhook subscribers can take receipt.confirmed, issue.reported and issue.resolved; payloads carry
ids, numbers and statuses only, never names or photos.

Consumes: `stop.completed` (opens the receipt, reconciles early confirmations).

Notifications (Step 7 catalog): issue.reported and issue.resolved go to the dispatchers, then the
store manager, by push, in-app and email ("3 trays damaged on WF-0171."). stop.completed gives the
store manager push, in-app and email with a proof link ("Delivered 04:22, received by S. Perera.").

Audit actions (same transaction as the write):

| Action | When | Reason required | Name from |
| --- | --- | --- | --- |
| receipt.confirmed | a receipt is confirmed | — | the doc's log name |
| receipt.issue.reported | an issue is created | the issue type | the doc's log name |
| receipt.issue.resolved | a dispatcher resolves an issue | the resolution | proposed |
| receipt.issue.reopened | the store reopens an issue | — | proposed |

## Log events
- `receipt.confirmed` (with or without issues)
- `receipt.issue.reported` (type)

Never log receiver names, photos or comment bodies.

## Permissions
| Permission | Held by | Used for |
| --- | --- | --- |
| receipt:read | dispatcher, store manager | the receipt view |
| receipt:confirm | store manager | confirming a receipt |
| issue:read | dispatcher, store manager | listing and reading issues and their threads |
| issue:create | store manager, driver | reporting issues, posting on the thread, reopening (store) |
| issue:resolve | dispatcher | resolving issues, posting on the thread |

Admin and loader hold none of these and get 403. Scope: store managers see outletId =
actor.outletId; dispatchers depotId = actor.depotId, or all depots when none is set. Out of scope
answers 404.

## Acceptance criteria
- [ ] AC-RCP-01  Confirm a clean delivery
- [ ] AC-RCP-02  A short line opens an issue
- [ ] AC-RCP-03  Confirm before the driver's record syncs
- [ ] AC-RCP-04  A partial delivery confirmed as delivered
- [ ] AC-RCP-05  No confirmation before delivery or ETA
- [ ] AC-RCP-06  No auto-confirm
- [ ] AC-RCP-07  Confirmation needs the current order version
- [ ] AC-RCP-08  A retried confirmation applies once
- [ ] AC-RCP-09  Who may read and confirm
- [ ] AC-RCP-10  Report an issue after receipt
- [ ] AC-RCP-11  Issues are scoped
- [ ] AC-RCP-12  The issue thread
- [ ] AC-RCP-13  The dispatcher resolves an issue
- [ ] AC-RCP-14  Reopen within 48 hours
- [ ] AC-RCP-15  Proof of delivery on M5

```gherkin
AC-RCP-01  Confirm a clean delivery
  Given Aniqa Razick delivered WF-0171 for Fresh Kadawatha on REF-07 trip 1 at 2026-10-02 04:22,
      all 3 lines in full, so the stop and the order are DELIVERED and the order is at version 8
    And the demo clock reads 2026-10-02 09:10 Asia/Colombo
  When Nimesha Periyapperuma confirms all 3 lines at the delivered quantity with condition ok,
      with If-Match W/"8" and an Idempotency-Key
  Then the response is 201 with Location /orders/{id}/receipt, status CONFIRMED,
      awaitingDriverSync false, confirmedById Nimesha's id and confirmedAt
      2026-10-02T09:10:00+05:30
    And the order is RECEIVED through OrderLifecycleService.markReceived, at version 9
    And exactly one audit row receipt.confirmed and one outbox event receipt.confirmed exist
    And no issue exists for WF-0171
    And the receipt carries no confirm link and M3 no longer lists WF-0171 as a receipt to confirm

AC-RCP-02  A short line opens an issue
  Given the same DELIVERED WF-0171, whose line 2 was delivered with 12
  When Nimesha confirms line 2 with qtyReceived 10 and condition short, the other lines in full
      and ok, and the note "2 trays short"
  Then the response is 201 with status CONFIRMED_WITH_ISSUES and line 2 stored as qtyReceived 10,
      condition short
    And one OPEN issue exists for Fresh Kadawatha on WF-0171 with type SHORT, qtyAffected 2 and
      raisedByRole store_manager
    And the order is ISSUE_REPORTED through OrderLifecycleService.markIssueReported
    And exactly one of each exists: audit rows receipt.confirmed and receipt.issue.reported,
      outbox events receipt.confirmed and issue.reported
    And an OPEN STORE_ISSUE alert with severity 3 appears on Peliyagoda's 01 panel
    And the depot's dispatchers get push, in-app and email notices of the issue

AC-RCP-03  Confirm before the driver's record syncs
  Given WF-0171's stop on REF-07 trip 1 has etaAt 2026-10-02T04:10:00+05:30
    And Aniqa recorded DELIVERED at 04:22 while offline, so the server has no delivery record yet
      and the order is IN_TRANSIT
    And the demo clock reads 2026-10-02 04:40 Asia/Colombo
  When Nimesha confirms all lines in full with condition ok
  Then the response is 201 with status CONFIRMED and awaitingDriverSync true
    And the order stays IN_TRANSIT
    And M5 shows the waiting-for-driver state
  When Aniqa's phone syncs the DELIVERED event at 05:05 and stop.completed is emitted
  Then the receipt has awaitingDriverSync false and the order moves to DELIVERED and then RECEIVED
    And no sync_conflicts row and no SYNC_CONFLICT alert exist

AC-RCP-04  A partial delivery confirmed as delivered
  Given Aniqa recorded PARTIAL for WF-0171: line 2 delivered 10 of 12 with a shortage reason, so
      the stop and the order are PARTIAL
  When Nimesha confirms line 2 with qtyReceived 10 and condition ok, and the other lines in full
  Then the response is 201 with status CONFIRMED
    And the order is RECEIVED
    And no issue exists for WF-0171

AC-RCP-05  No confirmation before delivery or ETA
  Given WF-0171's stop is PENDING with etaAt 2026-10-02T04:10:00+05:30 and no delivery record
    And the demo clock reads 2026-10-02 03:55 Asia/Colombo
  When Nimesha requests GET /orders/{id}/receipt
  Then the response is 200 with the expected lines, no delivered lines, awaitingDriverSync false
      and no confirm link
  When she posts a confirmation anyway
  Then the response is 409 CONFLICT_STATE and no receipt row exists

AC-RCP-06  No auto-confirm
  Given WF-0171 was DELIVERED at 2026-10-02 04:22 and Nimesha has not confirmed it
  When the demo clock moves to 2026-10-03 09:00 Asia/Colombo
  Then no receipt row exists for WF-0171 and the order is still DELIVERED
    And M3 still lists WF-0171 as a receipt to confirm, and its receipt carries a confirm link

AC-RCP-07  Confirmation needs the current order version
  Given WF-0171 is DELIVERED at version 8
  When Nimesha confirms without If-Match
  Then the response is 428 PRECONDITION_REQUIRED
  When she confirms with If-Match W/"7"
  Then the response is 412 VERSION_MISMATCH
    And after both attempts no receipt, issue, audit row or outbox event exists and the order is
      unchanged

AC-RCP-08  A retried confirmation applies once
  Given Nimesha confirmed WF-0171 with Idempotency-Key K and got 201
  When the same request with K and the same body arrives again
  Then the stored response comes back with Idempotent-Replayed: true
    And there is still one receipt, one audit row receipt.confirmed and one receipt.confirmed event
  When a request with K and a different body arrives
  Then the response is 422 IDEMPOTENCY_KEY_REUSED
  When she confirms again with a new key and the order's current version
  Then the response is 409 CONFLICT_STATE and the receipt is unchanged

AC-RCP-09  Who may read and confirm
  Given WF-0171 is DELIVERED
  When Tihara Egodage (dispatcher) posts a confirmation
  Then the response is 403 FORBIDDEN
  When Tihara requests GET /orders/{id}/receipt
  Then the response is 200 with no confirm link
  When Aniqa Razick (driver) or Harini De Mel (loader) requests the receipt
  Then each gets 403 FORBIDDEN
  When a store manager for another outlet requests or confirms it
  Then each answers 404 NOT_FOUND

AC-RCP-10  Report an issue after receipt
  Given WF-0171 is RECEIVED at version 9 and the demo clock reads 2026-10-02 10:30 Asia/Colombo
  When Nimesha posts /issues with the order, type DAMAGED, qtyAffected 3, description "3 trays
      damaged", one photo uploaded as an ISSUE_PHOTO attachment, If-Match W/"9" and an
      Idempotency-Key
  Then the response is 201 with Location /issues/{id}, status OPEN, raisedByRole store_manager
      and Fresh Kadawatha's outletId
    And the order is ISSUE_REPORTED
    And exactly one audit row receipt.issue.reported with type DAMAGED and one outbox event
      issue.reported exist
    And the depot's dispatchers get push, in-app and email "3 trays damaged on WF-0171."
    And the photo is an attachment with ownerType issue and the issue's id

AC-RCP-11  Issues are scoped
  Given an OPEN issue for Fresh Kadawatha (Peliyagoda) and one for a Kandy outlet
  When Nimesha requests GET /issues
  Then data holds only Fresh Kadawatha's issue and meta.page.total is 1
  When Tihara (dispatcher, all depots) requests GET /issues
  Then data holds both issues
  When a dispatcher scoped to Kandy requests Fresh Kadawatha's issue by id
  Then the response is 404 NOT_FOUND
  When Aniqa Razick (driver) requests GET /issues or GET /issues/{id}
  Then each gets 403 FORBIDDEN
  When Aniqa posts /issues for a stop on her own trip
  Then the response is 201 with raisedByRole driver

AC-RCP-12  The issue thread
  Given the OPEN DAMAGED issue on WF-0171
  When Tihara posts the comment "Credit on the way"
  Then the response is 201 and the comment is stored with entityType issue, authorRole dispatcher
    And exactly one outbox event issue.commented and one audit row for the comment exist
    And Nimesha sees the comment over SSE on the issue and gets an in-app notice
  When Nimesha posts a comment of 1,001 characters
  Then the response is 400 VALIDATION_FAILED on body and no comment is stored
  When Aniqa Razick (driver) requests GET /issues/{id}/comments
  Then the response is 403 FORBIDDEN

AC-RCP-13  The dispatcher resolves an issue
  Given the OPEN DAMAGED issue on WF-0171 with its OPEN STORE_ISSUE alert
    And the demo clock reads 2026-10-02 11:00 Asia/Colombo
  When Nimesha posts /issues/{id}/resolve
  Then the response is 403 FORBIDDEN
  When Tihara resolves it with no resolution
  Then the response is 400 VALIDATION_FAILED on resolution
  When Tihara resolves it with resolution CREDIT_ISSUED and the note "Credit note sent"
  Then the response is 200 with status RESOLVED, resolution CREDIT_ISSUED, resolutionNote set,
      resolvedById Tihara's id and resolvedAt 2026-10-02T11:00:00+05:30
    And exactly one outbox event issue.resolved and one audit row receipt.issue.resolved exist
    And the STORE_ISSUE alert is RESOLVED without anyone resolving it
    And Nimesha gets push, in-app and email notices, and her view of the issue carries a reopen
      link and no resolve link

AC-RCP-14  Reopen within 48 hours
  Given an issue on WF-0171 RESOLVED at 2026-10-02T11:00:00+05:30
  When Nimesha reopens it at 2026-10-04 10:59 Asia/Colombo
  Then the response is 200 with status OPEN
    And exactly one audit row receipt.issue.reopened exists
  Given another Fresh Kadawatha issue RESOLVED at 2026-10-02T11:00:00+05:30
  When Nimesha reopens it at 2026-10-04 11:01 Asia/Colombo
  Then the response is 409, the issue stays RESOLVED and it carries no reopen link
  When Tihara (dispatcher) tries to reopen an issue
  Then the response is 403 FORBIDDEN

AC-RCP-15  Proof of delivery on M5
  Given Aniqa recorded DELIVERED for WF-0171 at 2026-10-02 04:22 with the receiver name
      "S. Perera", a signature and one photo, and the event has synced
  When Nimesha requests GET /orders/{id}/receipt
  Then the response is 200 with each line's expected and delivered quantity, the receiver name,
      the delivery time and links to the signature and the photo
    And awaitingDriverSync is false and the receipt carries a confirm link
    And GET /attachments/{id} for the photo redirects to a download URL valid for 5 minutes
```

## Non-functional
- M5 and M6 at 1440 x 960 desktop, with loading, empty, error and waiting-for-driver states; each
  passes /fidelity at its frame size.
- Row-level security re-checks store scope on receipts and issues: with the ScopePolicy removed in a
  test module, a store manager still reads only Fresh Kadawatha's receipts and issues.
- Photos upload through a presigned URL valid for 10 minutes; downloads redirect to a URL valid for
  5 minutes.
- Every change writes its audit row and outbox event in the same transaction as the write.
- Webhook payloads carry ids, numbers and statuses only.
- M5 and 21 are on the judge path; M6 is in the exceptions tier.

## Open questions
- When confirm() creates issues for discrepancies: one per line or one per receipt (the Supabase
  draft had one per line, which receiptId and orderLineId now allow), how does the
  line's condition map to the issue type, and where does the required description come from?
  (Harini)
- Early confirmation: the order has no IN_TRANSIT → RECEIVED move, so it stays IN_TRANSIT until
  stop.completed; confirm. What does "opens the receipt" store, when a receipt row needs a status
  and confirmedById? What if the synced delivery differs from the early receipt? (Harini, Aniqa)
- Reopen: which problem code refuses it after 48 hours, is exactly 48 hours still inside, is there
  an issue.reopened event, and does the STORE_ISSUE alert open again? (Harini)
- What moves an issue to IN_PROGRESS? (Harini)
- Driver issues: does D5's ISSUE_REPORTED stop event create an Issue, or does D5 call POST /issues?
  And may a second issue be raised on an ISSUE_REPORTED order, which has no REPORT exit? (Harini,
  Aniqa)
- Issue comments: Step 6 emits comment.created and this module issue.commented. Which one drives
  notifications, so nobody is pushed twice? (Harini, Nimesha)
- Audit names: this spec reuses the doc's log names (receipt.confirmed, receipt.issue.reported);
  Step 2's reason table calls the action issue.reported. Link names confirm and reopen are
  proposed. (Nimesha)
- Dates: the doc's examples call 1 Oct 2026 a Wednesday, but 30 Sep is the Wednesday. These
  criteria use ISO dates without weekdays. (Nimesha)

## Changelog
- 2026-09-30 created from the Build Spec
- 2026-09-30 Model: `issues.receiptId` and `issues.orderLineId` (merged from the Supabase draft's receipt_issues)

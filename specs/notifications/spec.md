---
module: notifications
owner: Nimesha
status: in-progress    # draft | ready | in-progress | done
screens: ["02", D12]
depends-on: [identity, audit, webhooks, realtime]
---

# Notifications

## Purpose
Turn domain events into the right message for the right people on the right channels, exactly once
each, always from a worker job. In-app is the record of every notification; email, SMS and push get
someone to look at it.

## Scope
In: the notification catalog, recipient resolvers, channel selection, preferences, quiet rules,
templates and their i18n keys, Notification rows and statuses, the dispatch and send jobs, and the
02 bell feed.
Out: provider ports and adapters (core/providers, provider-adapter skill); provider callbacks and
signature checks (webhooks); SSE delivery (realtime); push subscriptions (identity,
PUT /me/devices/{id}/push); comment storage (core, comments table); the /demo/inbox endpoint (core
DemoService). WhatsApp stays disabled before 4 Oct.

## Model
Schema file apps/backend/src/db/schema/notifications.ts.
- Notification (notifications): userId, eventType, channel (IN_APP, EMAIL, SMS, PUSH, WHATSAPP),
  status (QUEUED, SENT, DELIVERED, FAILED, READ, SUPPRESSED), title, body, data (deep link and
  entity refs), dedupeKey, provider, providerMessageId, error, attempts, sentAt, deliveredAt, readAt,
  archivedAt, createdAt.
- NotificationPreference (notification_preferences): userId, eventType, channels[]; key
  (userId, eventType).

Invariants: dedupeKey is unique and equals `<eventId>:<userId>:<channel>`; providerMessageId is
unique; entities are referenced by (type, id) in data, never by foreign key; in-app can't be
switched off.

## Endpoints
| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| GET | /me/notifications | any signed-in user | 02 bell; own in-app rows only; cursor pages (limit default 50, max 200), newest first |
| GET | /me/notifications/summary | any signed-in user | `unread` for the badge; `_links.readAll` while there is something to mark |
| POST | /me/notifications/{id}/read | any signed-in user | Own row, else 404; audited; announces `notification.read` to the user |
| POST | /me/notifications/read-all | any signed-in user | Marks every unread in-app row read; one audit row |
| GET | /me/notification-preferences | any signed-in user | One row per catalog event that reaches the caller's role: defaults, available channels, current channels, `_links.update`; `emailSuppressed` with `_links.resumeEmail` |
| PUT | /me/notification-preferences/{eventType} | any signed-in user | `{ channels }`, a subset of the event's channels for that role; in-app always kept; 404 for an event that doesn't reach the role; audited |
| POST | /me/notification-preferences/resume-email | any signed-in user | Email back on after a bounce or complaint; audited |
| GET | /notifications | admin (no matrix entry yet) | Delivery log, filterable; see Open questions |
| GET | /dev/notifications/preview/{event} | any signed-in user; 404 in production unless DEMO_MODE | `?channel=sms&locale=en`; renders every audience's message from `domain/fixtures.ts` |

Preferences are edited on D12 (phone) and from 02's Settings (desktop).

## Services and helpers
- `modules/notifications/catalog.ts`: one entry per event with its recipients and default channels.
- Recipient resolvers: `storeManagersOf(outletId)`, `driverOf(tripId)`, `dispatchersOf(depotId)`,
  `loadersOf(depotId)`.
- Jobs: `notify.dispatch` (queued by the outbox relay for every event with a catalog entry), then
  `notify.email`, `notify.sms` and `notify.push`, each rendering in the recipient's locale.
- Pipeline: recipients, then channels (defaults, minus preferences, minus what the user can't
  receive; in-app always on; security messages ignore preferences), then quiet rules (bursts
  collapse per recipient and event group; no push when the record is open on a live stream), then
  one row per event, user and channel, then send, then status.
- Retries: a retryable ProviderError backs off at 30 s, 2 min and 10 min, then the row is FAILED; a
  non-retryable one fails at once with the reason.
- Templates: React Email in `modules/notifications/templates/email/`; SMS, push and in-app per
  event; copy under `notifications/<event>.<channel>` in `packages/shared/i18n/{en,si,ta}.json`.
- Providers from core/providers: EMAIL_PROVIDER (smtp, resend, console), SMS_PROVIDER (demo-inbox,
  twilio, notifylk), PUSH_PROVIDER (webpush, disabled), DemoInbox.

## Events
Emits, both routed to the one user (userIds) so only their stream carries them:
- `notification.created` `{ notificationId, eventType }` for each new in-app row: the 02 badge and
  list refetch.
- `notification.read` `{ notificationIds }` when rows are read: the user's other tabs clear the
  badge.

Consumes, per the catalog:

| Event | Recipients | Channels | Example |
| --- | --- | --- | --- |
| order.submitted | The store manager | In-app, email | Order WF-0171 sent for Fri 2 Oct. |
| order.rolled_to_next_run | The store manager | In-app, email, push | Sent after 16:00, so it goes on Sat 3 Oct's run. |
| Cutoff reminder (15:30) | Store managers with no order for tomorrow | Push, in-app | Cutoff for tomorrow's delivery is in 30 minutes. |
| plan.published | The depot's loaders | Push, in-app | Tomorrow's plan is ready: 24 trips. |
| plan.published | Drivers with trips | Push, SMS, in-app | Your trip: REF-07, Run 1, 6 stops. |
| plan.published | Store managers with planned orders | In-app, email | Delivery planned for Fri 2 Oct, 06:00–08:00. |
| deferral.confirmed | The store manager | Push, email, in-app | Your chilled order moves to Fri: no reefer capacity. (M4) |
| plan.revised | Only the affected loaders, drivers and stores | Push, in-app | Plan updated: 2 stops moved. |
| load.flag_raised | The depot's dispatchers | Push, in-app | REF-07: 2 cases missing, Fresh Kadawatha. |
| load.flag_decided | The loader who raised it | In-app (live on the tablet) | Dispatcher: replace from stock. |
| trip.released | The driver | Push, SMS | REF-07 released: 6 stops, first at 04:10. |
| stop.completed | The store manager | Push, in-app, email with a proof link | Delivered 04:22, received by S. Perera. |
| eta.updated (slip of 15 minutes or more) | The store manager | Push, in-app | Now arriving around 07:10. |
| trip.cant_run | The depot's dispatchers | Push, in-app | DRY-31 can't run: breakdown. |
| trip.reassigned | Old and new driver, affected stores | Push, SMS, in-app | Your trip moved to DRY-12. |
| deferral.store_responded (priority request) | The depot's dispatchers | Push, in-app | Fresh Kadawatha asks for priority tomorrow. |
| issue.reported, issue.resolved | Dispatchers, then the store manager | Push, in-app, email | 3 trays damaged on WF-0171. |
| sync.conflict_detected | The depot's dispatchers | Push, in-app | VAN-03 synced a delivery for a deferred stop. |
| vehicle.offline | The depot's dispatchers | In-app, push | No signal from DRY-31 for 30 minutes. |
| comment.created | Everyone on that record | In-app, push | New reply on WF-0171. |
| identity.user.invited | The invitee | Email, or SMS for drivers | You're invited to Waypoint Compass. |
| Sign-in code, password reset | The user | SMS, email | Security messages; preferences don't apply. |

## Log events
- Job lines carry jobId, queue (for example notify.email) and attempt. A retry logs at warn; the
  final failed attempt logs at error.
- Metric `notifications_total` by channel, provider and status.
- Never logged: OTP codes, full phone numbers, email addresses, tokens.
- Event names follow `<module>.<entity>.<past-tense verb>`; the list is still open.

## Permissions
- `GET /me/notifications`: any signed-in user, own rows only.
- Recipients are resolved by role and scope, so a user outside an event's scope never gets a row.
- The Step 2 matrix has no notification resource, so the admin log's permission is open.

## Acceptance criteria

Progress: tick a criterion in the same PR as its passing test.

- [x] AC-NTF-01 One notification per event, person and channel
- [x] AC-NTF-02 A replayed event never sends twice
- [x] AC-NTF-03 Preferences drop a channel but never in-app
- [x] AC-NTF-04 Channels a person can't receive are dropped
- [x] AC-NTF-05 Security messages ignore preferences
- [x] AC-NTF-06 Retryable failures back off, then fail
- [x] AC-NTF-07 A permanent failure is not retried
- [x] AC-NTF-08 Provider receipts move the status
- [x] AC-NTF-09 Reading a store's deferral notice is audited
- [x] AC-NTF-10 Small ETA slips stay quiet and bursts collapse
- [x] AC-NTF-11 A revision reaches only the people it affects
- [x] AC-NTF-12 No push while the person is watching
- [x] AC-NTF-13 The bell lists only my notifications
- [x] AC-NTF-14 Templates fit their channel
- [x] AC-NTF-15 The demo inbox shows what each person received
```gherkin
AC-NTF-01  One notification per event, person and channel
  Given Nimesha Periyapperuma, store manager for Fresh Kadawatha, with an email address, a push
      subscription and no preference rows
  When deferral.confirmed is published for her chilled order
  Then exactly three Notification rows exist for her: IN_APP, EMAIL and PUSH
    And each dedupeKey is <eventId>:<userId>:<channel>
    And the email and push rows move from QUEUED to SENT with the provider's message id

AC-NTF-02  A replayed event never sends twice
  Given the deferral.confirmed event from AC-NTF-01 has been dispatched and sent
  When the relay publishes the same event id again
  Then no new Notification row exists and no provider is called

AC-NTF-03  Preferences drop a channel but never in-app
  Given Nimesha's NotificationPreference for deferral.confirmed lists PUSH only
  When deferral.confirmed is published for her order
  Then she gets an IN_APP and a PUSH notification
    And no email is sent

AC-NTF-04  Channels a person can't receive are dropped
  Given driver Aniqa Razick with a verified phone, no email and no push subscription
  When plan.published includes her trip REF-07
  Then she gets IN_APP and SMS notifications only
    And the SMS reads like "Your trip: REF-07, Run 1, 6 stops."

AC-NTF-05  Security messages ignore preferences
  Given Aniqa's preferences switch SMS off
    And DEMO_MODE=true with SMS_PROVIDER=demo-inbox
  When she asks for a sign-in code on D0a
  Then the code is sent by SMS anyway
    And it appears in /demo/inbox under her number

AC-NTF-06  Retryable failures back off, then fail
  Given the SMS provider throws a retryable ProviderError on every attempt
  When notify.sms sends Aniqa's trip.released message for REF-07
  Then the send is retried after 30 seconds, then 2 minutes, then 10 minutes
    And after the last retry the row is FAILED with the provider's error
    And each retry logs at warn and the final attempt logs at error

AC-NTF-07  A permanent failure is not retried
  Given the SMS provider answers 4xx for an invalid number (a non-retryable ProviderError)
  When notify.sms sends the message
  Then the row is FAILED with the reason after one attempt and no retry is scheduled

AC-NTF-08  Provider receipts move the status
  Given Nimesha's deferral.confirmed email is SENT with Resend's message id
  When Resend's delivered callback for that id is processed by the webhooks.inbound job
  Then the row is DELIVERED with deliveredAt set
  When a bounce or complaint for that id is processed instead
  Then the row is FAILED, her address is on the suppression list and her email channel is off

AC-NTF-09  Reading a store's deferral notice is audited
  Given Nimesha has an unread in-app deferral.confirmed notification
  When she opens it on M4
  Then the row is READ with readAt set
    And exactly one audit row records that she read it

AC-NTF-10  Small ETA slips stay quiet and bursts collapse
  Given Fresh Kadawatha's stop on REF-07 and tracking.etaSlipNotifyMinutes at its default of 15
  When eta.updated reports a 10-minute slip for her stop
  Then no notification is created for her
  When eta.updated reports a 15-minute slip, arriving around 07:10
  Then she gets push and in-app "Now arriving around 07:10."
    And ten such updates in one burst give her one notice, not ten

AC-NTF-11  A revision reaches only the people it affects
  Given a published Peliyagoda plan and a plan.revised that moves 2 stops on REF-07 and leaves
      DRY-31 unchanged
  When the revision is dispatched
  Then Aniqa Razick (REF-07) and the store managers of the 2 moved stops get push and in-app
      "Plan updated: 2 stops moved."
    And Dinushi Rathnayake (DRY-31) gets nothing

AC-NTF-12  No push while the person is watching
  Given dispatcher Tihara Egodage has the issue on WF-0171 open with a live stream
  When Nimesha adds a comment to that issue
  Then Tihara gets an in-app notification "New reply on WF-0171." and no push
  Given Tihara has no open stream
  When Nimesha adds another comment
  Then Tihara also gets a push

AC-NTF-13  The bell lists only my notifications
  Given Nimesha and Tihara each have 3 in-app notifications
  When Nimesha calls GET /me/notifications?limit=20
  Then data holds her 3 rows only and meta.page has limit 20, nextCursor and hasMore false
    And when a new in-app notification is created for her, the 02 unread count updates over SSE

AC-NTF-14  Templates fit their channel
  Given fixture data for trip.released
  When GET /dev/notifications/preview/trip.released?channel=sms&locale=en renders it
  Then the body is at most 160 GSM-7 characters with no emoji, like "Waypoint: REF-07 trip 1
      released. 6 stops, first Fresh Kadawatha at 04:10. Open the app to start."
    And every push template has a title of at most 40 characters, a body of at most 120, a deep
      link and a per-record tag
    And a locale=si request for a key with no Sinhala text renders the English copy

AC-NTF-15  The demo inbox shows what each person received
  Given DEMO_MODE=true, SMS_PROVIDER=demo-inbox, EMAIL_PROVIDER=console and 60 messages sent
  When a judge opens /demo/inbox
  Then it lists the last 50 SMS and emails, newest first, grouped by recipient
    And after POST /demo/reset it is empty
```

## Non-functional
- Providers run only inside worker jobs, so a slow provider never slows a screen.
- Each adapter's health() feeds /health/ready as a warning, not a failure; the jobs retry.
- Tests never touch the internet; real sends run only with PROVIDER_LIVE_TEST=1.
- Email: send from a subdomain such as notify.waypoint.lk with SPF, provider-managed DKIM and DMARC
  (p=none, then quarantine). Transactional mail has no tracking pixels; only optional summaries
  carry List-Unsubscribe.
- SMS: numbers stored in E.164 (+94...); sign-in codes limited to 3 per 5 minutes per number;
  production needs a registered sender ID.
- Push on iPhone works only once the PWA is on the home screen (iOS 16.4 and later).
- English ships first; Sinhala and Tamil are Saturday's stretch.

## Built (ROO-26)
- `domain/catalog.ts` holds the catalog above for the events that fire today: order.submitted,
  order.rolled_to_next_run, plan.published (loaders, drivers with trips, stores), plan.revised
  (only the drivers of the revised trips and the stores on them), deferral.confirmed,
  deferral.store_responded, load.flag_raised, load.flag_decided, trip.released, stop.completed,
  trip.cant_run and trip.reassigned. Recipients come from the event's routing: store managers of
  its outlets, dispatchers of its depot (and unscoped ones), loaders of its depot, the drivers of
  its trips, the payload's driver, the loader who raised a flag.
- `NotificationDispatcher` runs as an EventBus consumer inside the relay's transaction. In-app rows
  are written SENT (they need no provider); email, SMS and push rows are QUEUED and sent by the
  worker's `notify.send` job on the notifications queue, retried after 30 s, 2 min and 10 min.
- Providers (`services/providers.ts`): email goes through Resend's REST API when
  EMAIL_PROVIDER=resend (or RESEND_API_KEY is set and no provider named), with the row id as
  Idempotency-Key; 429 and 5xx retry, other 4xx fail at once. Otherwise email and SMS go to the
  demo inbox (DEMO_MODE=true), and with DEMO_MODE a copy of every real email lands there too.
  No provider at all fails at once. Push rows are SUPPRESSED until a push provider exists.
- Receipts (AC-NTF-08): webhooks' `POST /webhooks/resend` verifies Svix, stores the event once and
  emits `email.delivered`, `email.bounced` or `email.complained`; notifications consumes them.
  Delivered sets DELIVERED. A bounce or complaint sets FAILED and writes a `*` preference row
  without EMAIL: the suppression list is that row, so no new table. `resume-email` deletes it.
- Quiet rules (AC-NTF-10): a catalog entry may have `when` (eta.updated: slipMin at least
  tracking.etaSlipNotifyMinutes) and `collapse` (eta.updated: one notice per stop per 10 minutes,
  keyed in `data.collapseKey`). Rows are stamped with ClockService time, so the burst window and the
  bell's days follow the demo clock.
- Watching (AC-NTF-12): realtime's PresenceService keeps `presence:user:<id>` in Redis while any of
  the person's streams is open (40 s TTL, refreshed by the heartbeat). A person with the app open
  gets in-app and no push. "Watching" is the app being open, not one record.
- Templates (AC-NTF-14): `domain/render.ts` shapes a message per channel: SMS GSM-7 only, at most
  160 characters with the "Waypoint: " prefix; push title at most 40, body at most 120, a deep link
  and a tag `<eventType>:<entityId>`. A test checks every catalog entry's fixture against these
  limits. Copy is English only; other locales fall back.
- A placeholder address (`*.waypoint.local`, every driver's) counts as no email; SMS needs a
  verified phone; push needs a device with a subscription.
- A channel dropped by preferences or reachability is not written at all.
- Not yet: an SMS provider (Twilio, Notify.lk) and Web Push, the admin delivery log, the cutoff
  reminder, issue.*, sync.conflict_detected, vehicle.offline and comment.created entries, and
  Sinhala and Tamil copy (ROO-66). Nothing emits eta.updated yet (ETA with ROO-37); the rule
  expects `{ stopId, orderId, outletId, etaAt, slipMin }`.

## Open questions
- Which permission guards GET /notifications? The Step 2 matrix has no notification resource.
- Which event and recipients carry "admins are notified" for a DEAD webhook delivery?
- Which event triggers the 15:30 cutoff reminder from the ticker?

## Changelog
- 2026-09-30 created from the Build Spec
- 2026-10-04 ROO-26: catalog, dispatcher, notify.send with backoff, demo-inbox delivery, the bell
  endpoints and the 02 panel. Reading is audited as `notifications.notification.read` (and
  `notifications.notification.all_read`); plan.revised reaches drivers and stores only, since the
  dock already follows load.list_updated live; trip.released gets an in-app row too, since in-app
  is always on. Logs: notifications.event.dispatched and notifications.notification.{sent,
  retrying, failed, suppressed, read}.
- 2026-10-04 ROO-26 (second part): Resend email, receipts through webhooks (AC-NTF-08), quiet rules
  and burst collapse (AC-NTF-10), presence for "no push while watching" (AC-NTF-12), per-channel
  rendering and the preview endpoint (AC-NTF-14), preference endpoints, D12's Notifications sheet
  and 02's Settings dialog. depends-on gains webhooks (receipt event names) and realtime
  (presence). The slip is measured against the planned arrival; bursts are the 10 minutes after
  the last notice.

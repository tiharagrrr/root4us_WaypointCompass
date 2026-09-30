---
module: notifications
owner: Nimesha
status: draft          # draft | ready | in-progress | done
screens: ["02", D12]
depends-on: [identity]
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
| GET | /me/notifications | any signed-in user | 02 bell; own rows only; cursor pages (limit default 50, max 200) |
| GET | /notifications | admin (no matrix entry yet) | Delivery log, filterable; see Open questions |
| GET | /dev/notifications/preview/{event} | development only | `?channel=email&locale=en`; renders a template with fixture data |

Marking an item read (02, M4) and editing preferences (D12) need endpoints; see Open questions.

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
Emits: `notification.*` (names not listed yet; see Open questions).

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

- [ ] AC-NTF-01 One notification per event, person and channel
- [ ] AC-NTF-02 A replayed event never sends twice
- [ ] AC-NTF-03 Preferences drop a channel but never in-app
- [ ] AC-NTF-04 Channels a person can't receive are dropped
- [ ] AC-NTF-05 Security messages ignore preferences
- [ ] AC-NTF-06 Retryable failures back off, then fail
- [ ] AC-NTF-07 A permanent failure is not retried
- [ ] AC-NTF-08 Provider receipts move the status
- [ ] AC-NTF-09 Reading a store's deferral notice is audited
- [ ] AC-NTF-10 Small ETA slips stay quiet and bursts collapse
- [ ] AC-NTF-11 A revision reaches only the people it affects
- [ ] AC-NTF-12 No push while the person is watching
- [ ] AC-NTF-13 The bell lists only my notifications
- [ ] AC-NTF-14 Templates fit their channel
- [ ] AC-NTF-15 The demo inbox shows what each person received
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

## Open questions
- Which endpoint marks an in-app notification READ (02, M4), and with what permission?
- Which endpoints read and edit NotificationPreference, and is D12 the screen for it?
- Which permission guards GET /notifications? The Step 2 matrix has no notification resource.
- What are the notification.* event names, including the one that drives the 02 unread count?
- Is a channel dropped by preferences written as a SUPPRESSED row, or not written at all?
- What are the burst window and the event groups for quiet rules?
- How does the server know a user has "that record open" on a live stream?
- Where does the email suppression list live? notifications.ts has no table for it.
- What is the audit action name for reading a store's deferral notice?
- Which loaders count as "affected" by plan.revised?
- Is the eta.updated slip measured against the planned ETA or the last one notified?
- trip.released lists Push and SMS only, while in-app is "always on": does it get an in-app row?
- How does the webhooks.inbound job update Notification rows when webhooks may import only core?
- Which event and recipients carry "admins are notified" for a DEAD webhook delivery?
- Which event triggers the 15:30 cutoff reminder from the ticker?
- Which log event names does the module write?

## Changelog
- 2026-09-30 created from the Build Spec

---
name: notification-event
description: Add or change a notification in apps/backend/src/modules/notifications (catalog entry,
  recipients, default channels, templates per channel, preferences, tests). Use whenever a domain
  event should reach people in-app or by email, SMS or push, or a notification's copy, channels or
  recipients change.
---

# Add a notification

In-app is the record of every notification; email, SMS and push get someone to look at it. One
pipeline turns an event into one message per person and channel, exactly once, always in a worker
job.

## Before you start
- The event must already go through the outbox (audit-and-events skill) and carry the ids the
  recipient resolver needs (outletId, tripId, depotId).
- Read specs/notifications/spec.md, including its catalog table.

## Steps
1. Catalog. Add an entry to modules/notifications/catalog.ts: the event type, its recipient
   resolver and its default channels. The outbox relay enqueues notify.dispatch for every event
   that has an entry.
2. Recipients. Use the resolvers by role and scope: storeManagersOf(outletId), driverOf(tripId),
   dispatchersOf(depotId), loadersOf(depotId). Add one only when none fits. Reach only the people
   affected: plan.revised goes to the affected loaders, drivers and stores, not the whole depot.
3. Channels. Start from the entry's defaults. The pipeline drops channels the user switched off in
   NotificationPreference and any they can't receive (no email, no verified phone, no push
   subscription). In-app is always on. Sign-in codes, password resets and other security messages
   ignore preferences.
4. Quiet rules. Pick the event group so bursts collapse per recipient (ten ETA updates become one
   notice). Push is skipped when the user already has that record open on a live stream; the in-app
   entry still appears.
5. Templates, one per channel the entry uses:
   - Email: a React Email component in modules/notifications/templates/email/ with the Compass
     layout, rendered to HTML and plain text, with a link to the record. No tracking pixels.
   - SMS: at most 160 GSM-7 characters in English and no emoji. Sinhala and Tamil use UCS-2, so
     keep them especially short.
   - Push: a title up to 40 characters, a body up to 120, a deep link, and a tag per record so a
     newer notice replaces an older one.
   - In-app: a title, a body and the entity reference the bell links through.
6. Copy. Put every string under notifications/<event>.<channel> in
   packages/shared/i18n/{en,si,ta}.json. English ships first; si and ta fall back to English.
7. Preview. Add fixture data for the event and check each channel at
   GET /api/v1/dev/notifications/preview/{event}?channel=email&locale=en. Mailpit (port 8025) and
   /demo/inbox show what was actually sent.
8. Tests in modules/notifications/__tests__/, named after the spec's AC ids:
   - the event gives exactly one row per recipient and channel, with dedupeKey
     <eventId>:<userId>:<channel>;
   - replaying the same event adds no row and sends nothing;
   - a channel switched off in preferences sends nothing, and in-app still arrives;
   - a user outside the event's scope gets nothing;
   - each template renders within its channel's limits.
9. Spec. Add the row (event, recipients, channels, example message) to the catalog table in
   specs/notifications/spec.md and tick the criteria.

## Checklist
- [ ] Catalog entry with a resolver and default channels
- [ ] A template for every channel the entry uses; strings in i18n
- [ ] English SMS fits one GSM-7 segment; push fits 40 and 120 characters
- [ ] Dedupe, preference and scope tests pass
- [ ] Spec catalog table updated

## Never
- Send from a controller or a command service; only notify.email, notify.sms and notify.push send.
- Write a second Notification for the same event, user and channel, or work around dedupeKey.
- Let a preference switch off in-app, or apply preferences to sign-in codes and security messages.
- Hard-code copy in a template, or put an emoji in an SMS.
- Notify a whole depot when only some people are affected.
- Resolve recipients from names or phone numbers in a payload; use ids.

---
name: audit-and-events
description: Record the audit row and the outbox event for a state change in apps/backend
  (AuditService.record, OutboxService.add, reason codes, typed versioned payloads, event catalog).
  Use for any command or lifecycle method that changes state, and whenever an event type or its
  payload is added or changed.
---

# Audit a change and emit its event

## Before you start
- Find the action in specs/<module>/spec.md (Events, Log events) and the module's Emits column in
  the boundaries table.
- Check the reason table below: does this action need a reason?

## Steps
1. Transaction. The method carries @Transactional(). audit.record() and outbox.add() use the same
   TransactionHost and throw when no transaction is active. Write, audit and add the event in that
   one transaction, so none can exist without the others.
2. Audit row. Call
   `this.audit.record({ action: '<module>.<entity>.<verb>', entity: ['<type>', id], before, after })`
   with before and after as small to<Entity>Audit() projections. The service fills actor id, role
   and name, deviceId, source, correlationId, occurredAt (ClockService.now()), recordedAt
   (ClockService.realNow()), prevHash and hash. Pass occurredAt and clientUuid for events synced
   from a device, source when CLS has none, and actorName for a name typed on a shared dock tablet.
3. Reasons. If the action is in the table, add it to REASON_REQUIRED, accept reasonCode (and
   reasonNote where a note is needed) in the DTO, and pass both to record(). Without one, record()
   throws ValidationError on reasonCode (400 VALIDATION_FAILED).

   | Action | Reason |
   | --- | --- |
   | order.cancelled | store: a note; dispatcher: a code |
   | deferral.confirmed | deferral reason code and a note the store sees |
   | deferral.repeat_skip_overridden | an override note |
   | plan.revised (any edit after publish), plan.soft_rule_overridden | code and note |
   | trip.reassigned, trip.resequenced, stop.deferred, load.flag_decided (remove) | code |
   | load.flag_raised | missing, damaged, wrong temperature or over capacity |
   | stop.failed, stop.partial | outcome and note |
   | trip.cant_run | breakdown, cooling, unwell or other |
   | issue.reported | issue type |
   | user.role_changed, user.scope_changed, sync.conflict_resolved | code |

4. Outbox event. Call `this.outbox.add('<entity>.<past_tense>', { v: 1, ...ids, ...fewFields },
   { aggregate: ['<type>', id], depotId, outletIds, userIds })`. The payload carries ids and only
   the fields consumers need. The routing fields choose the SSE channels.
5. Names. Event types are <entity>.<past-tense verb> (order.submitted, load.flag_raised). Audit
   actions and log events are <module>.<entity>.<past-tense verb> (ordering.order.submitted). Log
   once: this.log.info({ event: 'ordering.order.submitted', orderId }, 'order submitted').
6. Payload type. Declare it in events/<module>.events.ts, export it from index.ts, and add the type
   to the event catalog in packages/shared/src/events/, beside the DomainEvent envelope. A change
   that breaks consumers gets a new v.
7. Routing. After commit the worker's relay publishes each row at least once: to in-process
   listeners, to Redis for SSE (depot, outlet and user channels), to notify.dispatch when
   notifications/catalog.ts has an entry, and to webhooks.outbound for subscribed endpoints.
   - A screen must refresh: add a line to INVALIDATES in apps/frontend/src/realtime/use-event-stream.ts.
   - People must hear about it: use the notification-event skill.
   - A listener: dedupe by event id, because delivery is at least once.
8. Tests. In the use case's e2e test assert exactly one audit_events row with the action for the
   entity and exactly one outbox_events row of the type, and that a refused write (409, 412) leaves
   neither. For a reason-required action, assert 400 on reasonCode and no rows. For a synced event,
   assert a replay with the same clientUuid adds no second audit row.
9. Spec. List the event under Emits and the log event under Log events in specs/<module>/spec.md.

## Checklist
- [ ] Write, audit row and outbox row in one @Transactional() method
- [ ] Reason enforced where the table says so
- [ ] Payload has v and ids; no names, phone numbers, emails or photos
- [ ] events/<module>.events.ts type and catalog entry added
- [ ] Test asserts exactly one audit row and one outbox event

## Never
- Publish to Redis, BullMQ or an SSE stream from a service. Only vehicle.position, from the ping
  pipeline, skips the outbox.
- Insert into audit_events directly, compute the hash yourself, or UPDATE, DELETE or TRUNCATE it.
  Triggers block it and the app role has INSERT and SELECT only.
- Hold the chain's advisory lock for long: use bulk inserts inside audited transactions.
- Put a whole entity in a payload, or use new Date() for occurredAt.
- Reorder offline events synced late; they are flagged, never reordered.
- Catch an error from record() or add() to let the write through.

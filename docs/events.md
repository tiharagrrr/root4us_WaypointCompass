# Domain events

Every state change writes an `outbox_events` row in the same transaction as the change
(`OutboxService.add`, the audit-and-events skill). This page is how those rows reach anyone.

## Delivery
- The worker drains the outbox every second (`OutboxRelay`, `worker/outbox.processor.ts`). Each row
  is claimed with `FOR UPDATE SKIP LOCKED` and delivered in its own transaction to every consumer
  registered on the `EventBus` for its type; the consumers' writes and `publishedAt` commit
  together. A rolled-back use case leaves no row, so it is never delivered.
- Then the event is published on the Redis channel `waypoint:events` for the SSE gateway (ROO-25).
- A consumer that throws rolls back the row's transaction; the row records `attempts` and
  `lastError`, is retried on the next drain, and is set aside after 10 attempts (log event
  `outbox.event_set_aside`).
- Delivery is at least once: consumers dedupe on the event id (the outbox row id).

Envelope as consumers receive it (`DeliveredEvent`): `id`, `type`, `depotId`, `outletIds`,
`userIds`, `payload` (`{ v, ...ids, ...few fields }`), `occurredAt`, `correlationId`.

## Consumers registered today

| Consumer | Module | Types |
| --- | --- | --- |
| `alerts` | alerts | the raise and resolve types in `ALERT_RAISED_BY` / `ALERT_RESOLVED_BY` (`alerts.constants.ts`): `eta.updated`, `stop.failed`, `stop.completed`, `load.flag_raised`, `issue.reported`, `trip.cant_run`, `vehicle.offline`, `deferral.store_responded`, `sync.conflict_detected`, ... |
| `loading` | loading | `plan.published`, `plan.revised`, `trip.reassigned` (`LOAD_CONSUMES`) |

Still to register: notifications (ROO-26), webhooks (ROO-36), planning (`order.cancelled`,
`order.priority_changed`, `vehicle.status_changed`, `trip.cant_run`).

## Producers
Event types are `<entity>.<past_tense>`; each module lists its types in its constants file and its
payloads in `events/<module>.events.ts`. The spec's Events section says who consumes what.

| Module | Types (constants) |
| --- | --- |
| ordering | `ORDER_EVENTS`: `order.submitted`, `order.rolled_to_next_run`, `order.cancelled`, `order.backordered`, `order.priority_changed`, `order.cutoff_closed`, `order.cutoff_reminder`, ... |
| loading | `LOAD_EVENTS`: `load.list_updated`, `load.flag_raised`, `load.flag_decided`, `load.flag_resolved`, `load.line_checked`, `trip.released`, ... |
| execution | `EXECUTION_EVENTS`: `trip.downloaded`, `trip.started`, `stop.arrived`, `stop.completed`, `stop.failed`, `trip.completed`, `trip.cant_run` |
| alerts | `ALERT_EVENTS`: `alert.raised`, `alert.acknowledged`, `alert.resolved` |
| planning | `plan.published`, `plan.revised`, `plan.closed`, `deferral.*`, `trip.reassigned`, ... (with the planning API, ROO-29) |
| identity, master-data | user, invitation, settings, depot and outlet changes |

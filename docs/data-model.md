# Data model

PostgreSQL, defined in [`apps/backend/src/database/schema.ts`](../apps/backend/src/database/schema.ts) with Drizzle ORM. Migrations are generated into `apps/backend/drizzle/` and applied by the `seed` service on every `docker compose up`.

## Entity relationships

```mermaid
erDiagram
  depot ||--o{ outlet : serves
  depot ||--o{ vehicle : "home of"
  depot ||--o{ district_travel : "travel times"
  depot ||--o{ plan : "plans for"

  outlet ||--o{ order : places
  order ||--o{ order_line : contains
  order ||--o| stop : "served by"
  order ||--o{ deferral : "deferred by"
  order ||--o{ load_check : "checked in"
  order ||--o{ receipt : "confirmed by"

  plan ||--o{ trip : contains
  plan ||--o{ deferral : records
  vehicle ||--o{ trip : runs
  vehicle ||--o{ fuel_ledger : consumes
  trip ||--o{ stop : "sequence of"
  trip ||--o{ load_check : "loaded with"
  trip ||--o{ fuel_ledger : "uses fuel"
  stop ||--o{ stop_event : "append-only events"
  stop ||--o{ proof_of_delivery : "proved by"

  user ||--o{ session : has
  user ||--o{ account : "credentials"
  user }o--o| outlet : "store manager scope"
  user }o--o| depot : "loader / dispatcher scope"
  user }o--o| vehicle : "driver scope"
  user ||--o{ notification : receives

  outlet {
    text id PK "OUT001..OUT120"
    brand brand
    text district
    text depot_id FK
    dock_type dock_type
    parking_constraint parking_constraint
    time mall_window_open
    time mall_window_close
    time window_open
    time window_close
  }
  vehicle {
    text id PK "VEH001..VEH060"
    vehicle_type type "truck | van"
    vehicle_temp temp "reefer | ambient"
    real weight_cap_kg
    real volume_cap_m3
    real km_per_l
    real weekly_fuel_quota_l
    text depot_id FK
    vehicle_status status
  }
  order {
    uuid id PK
    text ref UK
    text outlet_id FK
    date delivery_date
    temp_requirement temp_requirement
    int units
    numeric weight_kg
    numeric volume_m3
    order_status status
    smallint deferred_count
  }
  plan {
    uuid id PK
    text depot_id FK
    date plan_date
    plan_status status
  }
  trip {
    uuid id PK
    uuid plan_id FK
    text vehicle_id FK
    smallint trip_no "1 or 2"
    brand brand
    text district
    real planned_minutes
    real planned_km
    trip_status status
  }
  stop {
    uuid id PK
    uuid trip_id FK
    uuid order_id FK
    smallint seq
    time planned_arrival
    timestamptz eta
    stop_status status
  }
  deferral {
    uuid id PK
    uuid order_id FK
    uuid plan_id FK
    deferral_reason reason_code
    text note
    text decided_by_id FK "null = engine"
    date next_date
  }
  stop_event {
    uuid id PK
    uuid client_uuid UK "idempotency key"
    uuid stop_id FK
    stop_event_type type
    timestamptz occurred_at "device time"
    timestamptz received_at "server time"
  }
```

`audit_event`, `outbox_event`, `calendar_day`, `service_allowance` and `verification` stand alone and are left out of the diagram for readability.

## Tables by module

| Module | Tables | Notes |
| --- | --- | --- |
| Master data | `depot`, `outlet`, `vehicle`, `calendar_day`, `district_travel`, `service_allowance` | Loaded from `data/seed/*.csv` by an idempotent upsert. `vehicle.status` is operational and is not overwritten by re-seeding. |
| Identity | `user`, `session`, `account`, `verification` | Better Auth schema (username + admin plugins). `user.role` holds `dispatcher`, `loader`, `driver`, `store_manager` or `admin`. `outlet_id`, `depot_id` and `vehicle_id` are the RBAC scope. |
| Ordering | `order`, `order_line` | `ref` is the human-readable key (e.g. `ORD0092308`). `deferred_count` highlights repeated skips. |
| Planning | `plan`, `trip`, `stop`, `deferral` | One plan per depot per day. `trip_no` is limited to 1 or 2. A stop links exactly one order (whole orders, no splitting). |
| Fleet | `fuel_ledger` | Litres = km / `km_per_l`, summed per vehicle per ISO week against `weekly_fuel_quota_l`. |
| Loading | `load_check` | `checked_by_name` supports the shared loader tablet. |
| Execution | `stop_event`, `proof_of_delivery` | Append-only. `client_uuid` makes offline replays idempotent. Both device time and server time are kept. |
| Receipt | `receipt` | `received`, `received_with_issues` or `disputed`, with an issues list. |
| Notifications | `notification` | Per user or per outlet. Fanned out over SSE. |
| Audit | `audit_event` | See below. |
| Events | `outbox_event` | Transactional outbox, relayed by the worker. |

## Order state machine

```mermaid
stateDiagram-v2
  [*] --> placed
  placed --> confirmed: cutoff closes (16:00)
  placed --> cancelled: store manager (reason)
  confirmed --> planned: allocated to a trip
  confirmed --> deferred: no feasible capacity (reason code)
  deferred --> confirmed: next run
  planned --> loaded: load check ok
  loaded --> out_for_delivery: trip started
  out_for_delivery --> delivered
  out_for_delivery --> failed: reason required
  delivered --> received: store confirms
  delivered --> disputed: store reports issue
```

## Audit trail rules

1. **Same transaction.** Domain services write `audit_event` in the same Drizzle transaction as the change. If the audit write fails, the change rolls back.
2. **Append-only.** A trigger blocks `UPDATE`, `DELETE` and `TRUNCATE` on `audit_event` (see [`audit-append-only.sql`](../apps/backend/src/database/sql/audit-append-only.sql)). In production, the app's DB role should also be limited to `INSERT` and `SELECT` on that table.
3. **Tamper-evident.** `hash = sha256(prev_hash + canonical row)`. A nightly worker job re-walks the chain.
4. **Mandatory reasons** for deferrals, manual overrides, edits after publish, failed or partial deliveries, missing or damaged items, cancellations, and disputes.
5. **Two clocks.** `occurred_at` (device) and `recorded_at` (server), stored in UTC and shown in Asia/Colombo. Late offline events are flagged, not reordered.
6. **Idempotent.** A unique `client_uuid` prevents duplicate rows from replays.

## Conventions

- Clock-only values (delivery windows) use `time`. Instants use `timestamptz` in UTC. The business time zone is `Asia/Colombo`.
- Enum values are defined once in `@waypoint/shared` and reused by the DB enums, the API DTOs and the UI.
- Change the schema, then run `pnpm db:generate` and commit the SQL in `apps/backend/drizzle/`. Never edit a migration that has been merged.

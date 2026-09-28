/**
 * Waypoint data model (Drizzle ORM / PostgreSQL).
 *
 * - Reference data is loaded from the shared challenge datasets by the seed.
 * - Auth tables follow Better Auth's schema (username + admin plugins) with
 *   extra scope columns; regenerate with the Better Auth CLI if plugins change.
 * - Operational data is created by the four roles; every state change also
 *   writes an `audit_event` row in the same transaction.
 *
 * See docs/data-model.md for the ER diagram. After changing this file run
 * `pnpm db:generate` and commit the generated migration in apps/backend/drizzle.
 */
import {
  BRANDS,
  DEFERRAL_REASONS,
  DOCK_TYPES,
  ORDER_STATUSES,
  PARKING_CONSTRAINTS,
  STOP_EVENT_TYPES,
  TEMP_REQUIREMENTS,
  VEHICLE_STATUSES,
  VEHICLE_TEMPS,
  VEHICLE_TYPES,
} from '@waypoint/shared';
import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  real,
  smallint,
  text,
  time,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

// ---------------------------------------------------------------------------
// Enums (values come from @waypoint/shared so API, web and DB agree)
// ---------------------------------------------------------------------------

export const brandEnum = pgEnum('brand', BRANDS);
export const dockTypeEnum = pgEnum('dock_type', DOCK_TYPES);
export const parkingConstraintEnum = pgEnum(
  'parking_constraint',
  PARKING_CONSTRAINTS,
);
export const vehicleTypeEnum = pgEnum('vehicle_type', VEHICLE_TYPES);
export const vehicleTempEnum = pgEnum('vehicle_temp', VEHICLE_TEMPS);
export const vehicleStatusEnum = pgEnum('vehicle_status', VEHICLE_STATUSES);
export const tempRequirementEnum = pgEnum(
  'temp_requirement',
  TEMP_REQUIREMENTS,
);
export const orderStatusEnum = pgEnum('order_status', ORDER_STATUSES);
export const deferralReasonEnum = pgEnum('deferral_reason', DEFERRAL_REASONS);
export const stopEventTypeEnum = pgEnum('stop_event_type', STOP_EVENT_TYPES);
export const planStatusEnum = pgEnum('plan_status', [
  'draft',
  'published',
  'closed',
]);
export const tripStatusEnum = pgEnum('trip_status', [
  'planned',
  'loading',
  'released',
  'in_progress',
  'completed',
]);
export const stopStatusEnum = pgEnum('stop_status', [
  'pending',
  'arrived',
  'delivered',
  'partially_delivered',
  'failed',
  'skipped',
]);
export const loadCheckStatusEnum = pgEnum('load_check_status', [
  'ok',
  'missing',
  'damaged',
]);
export const receiptStatusEnum = pgEnum('receipt_status', [
  'received',
  'received_with_issues',
  'disputed',
]);
export const auditSourceEnum = pgEnum('audit_source', [
  'web',
  'pwa',
  'offline_sync',
  'engine',
  'system',
]);

// ---------------------------------------------------------------------------
// Master data (seeded from data/seed/*.csv)
// ---------------------------------------------------------------------------

export const depots = pgTable('depot', {
  id: text('id').primaryKey(), // 'Peliyagoda' | 'Kandy'
  name: text('name').notNull(),
  isRegionalHub: boolean('is_regional_hub').notNull().default(false),
});

export const outlets = pgTable(
  'outlet',
  {
    id: text('id').primaryKey(), // OUT001..OUT120
    name: text('name'),
    brand: brandEnum('brand').notNull(),
    district: text('district').notNull(),
    depotId: text('depot_id')
      .notNull()
      .references(() => depots.id),
    dockType: dockTypeEnum('dock_type').notNull(),
    parkingConstraint: parkingConstraintEnum('parking_constraint').notNull(),
    mallWindowOpen: time('mall_window_open'),
    mallWindowClose: time('mall_window_close'),
    windowOpen: time('window_open').notNull(),
    windowClose: time('window_close').notNull(),
  },
  (t) => [index('outlet_depot_brand_idx').on(t.depotId, t.brand)],
);

export const vehicles = pgTable('vehicle', {
  id: text('id').primaryKey(), // VEH001..VEH060
  type: vehicleTypeEnum('type').notNull(),
  temp: vehicleTempEnum('temp').notNull(),
  weightCapKg: real('weight_cap_kg').notNull(),
  volumeCapM3: real('volume_cap_m3').notNull(),
  fuelType: text('fuel_type').notNull(),
  kmPerL: real('km_per_l').notNull(),
  weeklyFuelQuotaL: real('weekly_fuel_quota_l').notNull(),
  depotId: text('depot_id')
    .notNull()
    .references(() => depots.id),
  status: vehicleStatusEnum('status').notNull().default('available'),
});

export const calendarDays = pgTable('calendar_day', {
  date: date('date').primaryKey(),
  dow: smallint('dow').notNull(), // 0 = Monday
  dowName: text('dow_name').notNull(),
  isWeekend: boolean('is_weekend').notNull(),
  isoYear: smallint('iso_year').notNull(),
  isoWeek: smallint('iso_week').notNull(),
  isPayday: boolean('is_payday').notNull(),
  festival: text('festival'),
  festivalRamp: real('festival_ramp').notNull().default(0),
  isHoliday: boolean('is_holiday').notNull(),
  monsoon: boolean('monsoon').notNull(),
  isOperating: boolean('is_operating').notNull(),
});

export const districtTravel = pgTable(
  'district_travel',
  {
    district: text('district').notNull(),
    depotId: text('depot_id')
      .notNull()
      .references(() => depots.id),
    roadClass: text('road_class').notNull(),
    freeFlowKmh: real('free_flow_kmh').notNull(),
    depotToDistrictKm: real('depot_to_district_km').notNull(),
    depotToDistrictFreeflowMin: real('depot_to_district_freeflow_min').notNull(),
    interStopKm: real('inter_stop_km').notNull(),
    interStopFreeflowMin: real('inter_stop_freeflow_min').notNull(),
  },
  (t) => [unique('district_travel_district_depot_uq').on(t.district, t.depotId)],
);

export const serviceAllowances = pgTable(
  'service_allowance',
  {
    brand: brandEnum('brand').notNull(),
    dockType: dockTypeEnum('dock_type').notNull(),
    minutes: real('minutes').notNull(),
  },
  (t) => [unique('service_allowance_brand_dock_uq').on(t.brand, t.dockType)],
);

// ---------------------------------------------------------------------------
// Identity (Better Auth tables + role scope)
// ---------------------------------------------------------------------------

export const users = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  // username plugin
  username: text('username').unique(),
  displayUsername: text('display_username'),
  // admin plugin: dispatcher | loader | driver | store_manager | admin
  role: text('role'),
  banned: boolean('banned').default(false),
  banReason: text('ban_reason'),
  banExpires: timestamp('ban_expires', { withTimezone: true }),
  // Scope: which records the role may touch (see spec, "RBAC is role plus scope")
  outletId: text('outlet_id').references(() => outlets.id),
  depotId: text('depot_id').references(() => depots.id),
  vehicleId: text('vehicle_id').references(() => vehicles.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const sessions = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  token: text('token').notNull().unique(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  impersonatedBy: text('impersonated_by'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const accounts = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', {
    withTimezone: true,
  }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', {
    withTimezone: true,
  }),
  scope: text('scope'),
  password: text('password'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const verifications = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

export const orders = pgTable(
  'order',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ref: text('ref').notNull().unique(), // e.g. ORD0092308
    outletId: text('outlet_id')
      .notNull()
      .references(() => outlets.id),
    brand: brandEnum('brand').notNull(),
    deliveryDate: date('delivery_date').notNull(),
    tempRequirement: tempRequirementEnum('temp_requirement').notNull(),
    units: integer('units').notNull(),
    weightKg: numeric('weight_kg', { precision: 10, scale: 2, mode: 'number' }).notNull(),
    volumeM3: numeric('volume_m3', { precision: 10, scale: 3, mode: 'number' }).notNull(),
    status: orderStatusEnum('status').notNull().default('placed'),
    deferredCount: smallint('deferred_count').notNull().default(0),
    notes: text('notes'),
    placedById: text('placed_by_id').references(() => users.id),
    placedAt: timestamp('placed_at', { withTimezone: true }).notNull().defaultNow(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('order_delivery_date_status_idx').on(t.deliveryDate, t.status),
    index('order_outlet_idx').on(t.outletId),
  ],
);

export const orderLines = pgTable('order_line', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id')
    .notNull()
    .references(() => orders.id, { onDelete: 'cascade' }),
  description: text('description').notNull(),
  quantity: integer('quantity').notNull(),
});

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

export const plans = pgTable(
  'plan',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    depotId: text('depot_id')
      .notNull()
      .references(() => depots.id),
    planDate: date('plan_date').notNull(),
    status: planStatusEnum('status').notNull().default('draft'),
    engineVersion: text('engine_version'),
    createdById: text('created_by_id').references(() => users.id),
    createdAt: createdAt(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
  },
  (t) => [unique('plan_depot_date_uq').on(t.depotId, t.planDate)],
);

/** One vehicle run from the depot to one district for one brand. */
export const trips = pgTable(
  'trip',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id, { onDelete: 'cascade' }),
    vehicleId: text('vehicle_id')
      .notNull()
      .references(() => vehicles.id),
    tripNo: smallint('trip_no').notNull(),
    brand: brandEnum('brand').notNull(),
    district: text('district').notNull(),
    status: tripStatusEnum('status').notNull().default('planned'),
    plannedDeparture: time('planned_departure'),
    plannedMinutes: real('planned_minutes'),
    plannedKm: real('planned_km'),
    releasedAt: timestamp('released_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    unique('trip_plan_vehicle_no_uq').on(t.planId, t.vehicleId, t.tripNo),
    check('trip_no_range', sql`${t.tripNo} IN (1, 2)`),
  ],
);

export const stops = pgTable(
  'stop',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tripId: uuid('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    orderId: uuid('order_id')
      .notNull()
      .unique()
      .references(() => orders.id),
    seq: smallint('seq').notNull(),
    plannedArrival: time('planned_arrival'),
    eta: timestamp('eta', { withTimezone: true }),
    status: stopStatusEnum('status').notNull().default('pending'),
    version: integer('version').notNull().default(1),
  },
  (t) => [unique('stop_trip_seq_uq').on(t.tripId, t.seq)],
);

/** Every deferral, so repeatedly skipped outlets are visible. */
export const deferrals = pgTable(
  'deferral',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    planId: uuid('plan_id').references(() => plans.id),
    reasonCode: deferralReasonEnum('reason_code').notNull(),
    note: text('note'),
    decidedById: text('decided_by_id').references(() => users.id), // null = engine
    nextDate: date('next_date'),
    createdAt: createdAt(),
  },
  (t) => [index('deferral_order_idx').on(t.orderId)],
);

/** Weekly fuel quota tracking per vehicle, one row per trip. */
export const fuelLedger = pgTable(
  'fuel_ledger',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    vehicleId: text('vehicle_id')
      .notNull()
      .references(() => vehicles.id),
    tripId: uuid('trip_id').references(() => trips.id, { onDelete: 'set null' }),
    isoYear: smallint('iso_year').notNull(),
    isoWeek: smallint('iso_week').notNull(),
    km: real('km').notNull(),
    litres: real('litres').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('fuel_ledger_vehicle_week_idx').on(t.vehicleId, t.isoYear, t.isoWeek)],
);

// ---------------------------------------------------------------------------
// Loading, execution and receipt
// ---------------------------------------------------------------------------

export const loadChecks = pgTable('load_check', {
  id: uuid('id').primaryKey().defaultRandom(),
  clientUuid: uuid('client_uuid').notNull().unique(),
  tripId: uuid('trip_id')
    .notNull()
    .references(() => trips.id, { onDelete: 'cascade' }),
  orderId: uuid('order_id')
    .notNull()
    .references(() => orders.id),
  status: loadCheckStatusEnum('status').notNull(),
  note: text('note'),
  checkedById: text('checked_by_id').references(() => users.id),
  checkedByName: text('checked_by_name'), // shared loader tablet
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

/** Append-only driver events; the stop's status is derived from them. */
export const stopEvents = pgTable(
  'stop_event',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientUuid: uuid('client_uuid').notNull().unique(),
    stopId: uuid('stop_id')
      .notNull()
      .references(() => stops.id, { onDelete: 'cascade' }),
    type: stopEventTypeEnum('type').notNull(),
    reasonCode: text('reason_code'),
    payload: jsonb('payload').$type<Record<string, unknown>>(),
    actorId: text('actor_id').references(() => users.id),
    deviceId: text('device_id'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(), // device time
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    flaggedForReview: boolean('flagged_for_review').notNull().default(false),
  },
  (t) => [index('stop_event_stop_idx').on(t.stopId)],
);

export const proofsOfDelivery = pgTable('proof_of_delivery', {
  id: uuid('id').primaryKey().defaultRandom(),
  clientUuid: uuid('client_uuid').notNull().unique(),
  stopId: uuid('stop_id')
    .notNull()
    .references(() => stops.id, { onDelete: 'cascade' }),
  photoKey: text('photo_key'), // object key in S3/MinIO
  signatureKey: text('signature_key'),
  receiverName: text('receiver_name'),
  capturedAt: timestamp('captured_at', { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

export const receipts = pgTable('receipt', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id')
    .notNull()
    .references(() => orders.id),
  status: receiptStatusEnum('status').notNull(),
  receivedUnits: integer('received_units'),
  issues: jsonb('issues').$type<{ type: string; note?: string }[]>(),
  confirmedById: text('confirmed_by_id').references(() => users.id),
  createdAt: createdAt(),
});

export const notifications = pgTable(
  'notification',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    outletId: text('outlet_id').references(() => outlets.id),
    type: text('type').notNull(), // e.g. order.deferred, eta.updated
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('notification_user_idx').on(t.userId, t.createdAt)],
);

// ---------------------------------------------------------------------------
// Audit and events
// ---------------------------------------------------------------------------

/**
 * Append-only, hash-chained audit trail. Written in the same transaction as
 * the change it records. UPDATE/DELETE/TRUNCATE are blocked by a trigger
 * (src/database/sql/audit-append-only.sql). hash = sha256(prev_hash + row).
 */
export const auditEvents = pgTable(
  'audit_event',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    seq: bigserial('seq', { mode: 'number' }).notNull().unique(),
    actorId: text('actor_id'),
    actorRole: text('actor_role'),
    deviceId: text('device_id'),
    source: auditSourceEnum('source').notNull(),
    action: text('action').notNull(), // e.g. order.deferred
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    before: jsonb('before'),
    after: jsonb('after'),
    reasonCode: text('reason_code'),
    reasonNote: text('reason_note'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
    correlationId: text('correlation_id'),
    clientUuid: uuid('client_uuid').unique(),
    prevHash: text('prev_hash'),
    hash: text('hash').notNull(),
  },
  (t) => [
    index('audit_event_entity_idx').on(t.entityType, t.entityId),
    index('audit_event_recorded_at_idx').on(t.recordedAt),
  ],
);

/** Transactional outbox: domain events published by the worker. */
export const outboxEvents = pgTable(
  'outbox_event',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: text('type').notNull(), // e.g. PlanPublished
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    attempts: integer('attempts').notNull().default(0),
  },
  (t) => [index('outbox_event_unpublished_idx').on(t.publishedAt, t.createdAt)],
);

// apps/backend/src/db/schema/planning.ts · owner: planning
// The plan aggregate (plans, trips, stops) carries composite foreign keys, so the database
// refuses a trip from another depot or a stop from another brand or district. Loading and
// execution change trips and stops only through planning's TripLifecycleService.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { appRole, readAll, readonlyRole, viaVisibleOrder } from '../rls';
import {
  businessDate,
  createdAt,
  instant,
  measure,
  minutes,
  pk,
  updatedAt,
  version,
} from '../columns';
import {
  brandEnum,
  cantRunReasonEnum,
  deferralSourceEnum,
  deferralStatusEnum,
  deliveryOutcomeEnum,
  engineModeEnum,
  engineRunStatusEnum,
  planStatusEnum,
  stopStatusEnum,
  storeResponseEnum,
  tempClassEnum,
  tripStatusEnum,
} from './enums';
import { vehicles } from './fleet';
import { users } from './identity';
import { depots, depotWaves, districts, outlets } from './master-data';
import { orders } from './ordering';

/** One plan per depot and date. */
export const plans = pgTable(
  'plans',
  {
    id: pk(),
    depotId: text()
      .notNull()
      .references(() => depots.id),
    date: businessDate().notNull(),
    status: planStatusEnum().notNull().default('DRAFT'),
    revision: integer().notNull().default(0), // 1 at first publish, +1 per published change
    cutoffClosedAt: instant(),
    createdById: text(),
    publishedAt: instant(),
    publishedById: text(),
    closedAt: instant(), // 21 Close the day
    closedById: text(),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('plans_depot_date_uq').on(t.depotId, t.date),
    unique('plans_scope_uq').on(t.id, t.depotId), // target of trips' composite key
  ],
);

export const planRevisions = pgTable(
  'plan_revisions',
  {
    id: pk(),
    planId: uuid()
      .notNull()
      .references(() => plans.id),
    revision: integer().notNull(),
    reasonCode: text().notNull(),
    note: text(),
    changes: jsonb().$type<Record<string, unknown>[]>().notNull(), // the edit ops applied
    affectedTripIds: uuid().array().notNull(),
    affectedOutletIds: text().array().notNull(),
    createdById: text(),
    createdAt: createdAt(),
  },
  (t) => [unique('plan_revisions_uq').on(t.planId, t.revision)],
);

export const engineRuns = pgTable(
  'engine_runs',
  {
    id: pk(),
    planId: uuid()
      .notNull()
      .references(() => plans.id),
    mode: engineModeEnum().notNull(),
    status: engineRunStatusEnum().notNull().default('RUNNING'),
    engineVersion: text().notNull(),
    params: jsonb().$type<Record<string, unknown>>().notNull(),
    inputHash: text().notNull(), // sha256 of the canonical engine input
    servedCount: integer(),
    deferredCount: integer(),
    stats: jsonb().$type<Record<string, unknown>>(), // limiting resources, utilisation, budget use
    error: text(),
    triggeredById: text(),
    startedAt: createdAt(),
    finishedAt: instant(),
  },
  (t) => [index('engine_runs_plan_idx').on(t.planId, t.startedAt)],
);

/** One vehicle's trip from its home depot to one district for one brand. */
export const trips = pgTable(
  'trips',
  {
    id: pk(),
    planId: uuid().notNull(),
    depotId: text().notNull(),
    vehicleId: text().notNull(),
    driverId: text().references(() => users.id),
    tripNo: integer(), // 1 or 2; null once cancelled, which frees the slot
    brand: brandEnum().notNull(),
    districtId: text()
      .notNull()
      .references(() => districts.id),
    tempClass: tempClassEnum().notNull(), // CHILLED = carries chilled orders, needs a reefer
    status: tripStatusEnum().notNull().default('PLANNED'),
    isReserved: boolean().notNull().default(false), // 13: reserved against the forecast, no orders yet
    locked: boolean().notNull().default(false), // built or edited by hand; later engine runs keep it
    waveId: uuid().references(() => depotWaves.id),
    plannedDepartAt: instant(),
    plannedReturnAt: instant(),
    budgetMinutes: measure().notNull().default(0), // booklet formula, no return leg
    plannedKm: measure().notNull().default(0),
    plannedFuelL: measure().notNull().default(0),
    loadWeightKg: measure().notNull().default(0),
    loadVolumeM3: measure().notNull().default(0),
    releasedAt: instant(),
    releasedById: text(),
    releaseTempC: doublePrecision(),
    downloadedAt: instant(), // the driver's phone saved it for offline
    startedAt: instant(),
    completedAt: instant(),
    cantRunReason: cantRunReasonEnum(), // D8, projected from the CANT_RUN event
    cancelReason: text(),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: 'trips_plan_fk',
      columns: [t.planId, t.depotId],
      foreignColumns: [plans.id, plans.depotId],
    }),
    foreignKey({
      name: 'trips_vehicle_home_fk',
      columns: [t.vehicleId, t.depotId],
      foreignColumns: [vehicles.id, vehicles.depotId],
    }),
    // With the check: at most two trips per vehicle per day.
    unique('trips_vehicle_slot_uq').on(t.planId, t.vehicleId, t.tripNo),
    // Target of stops' composite key.
    unique('trips_scope_uq').on(t.id, t.depotId, t.brand, t.districtId),
    check(
      'trips_trip_no_chk',
      sql`${t.tripNo} IS NULL OR ${t.tripNo} IN (1, 2)`,
    ),
    index('trips_plan_status_idx').on(t.planId, t.status),
    index('trips_driver_status_idx').on(t.driverId, t.status),
    index('trips_vehicle_idx').on(t.vehicleId),
  ],
);

/** One order's visit on a trip. Soft-cancelled, never deleted, so offline clients learn it went away. */
export const stops = pgTable(
  'stops',
  {
    id: pk(),
    tripId: uuid().notNull(),
    orderId: uuid()
      .notNull()
      .references((): AnyPgColumn => orders.id),
    outletId: text().notNull(),
    depotId: text().notNull(),
    brand: brandEnum().notNull(),
    districtId: text().notNull(),
    seq: integer(), // null once cancelled
    status: stopStatusEnum().notNull().default('PENDING'),
    plannedArrivalAt: instant(),
    plannedTravelMin: measure(), // the leg into this stop, from the depot or the previous stop
    plannedServiceMin: measure().notNull(),
    predictedServiceMin: measure(), // service-time model; planning still uses plannedServiceMin
    windowOpenMin: minutes().notNull(), // snapshot of the effective window
    windowCloseMin: minutes().notNull(),
    etaAt: instant(),
    etaUpdatedAt: instant(),
    lateRiskProb: doublePrecision(),
    arrivedAt: instant(), // device time
    arrivedLat: doublePrecision(), // projected from the ARRIVED event
    arrivedLng: doublePrecision(),
    completedAt: instant(),
    outcome: deliveryOutcomeEnum(),
    unitsDelivered: integer(), // projected from the outcome event; lines, when present, are in delivery_lines
    receiverName: text(),
    exceptionNote: text(),
    cancelledReason: text(),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: 'stops_trip_scope_fk',
      columns: [t.tripId, t.depotId, t.brand, t.districtId],
      foreignColumns: [trips.id, trips.depotId, trips.brand, trips.districtId],
    }),
    foreignKey({
      name: 'stops_outlet_scope_fk',
      columns: [t.outletId, t.depotId, t.brand, t.districtId],
      foreignColumns: [
        outlets.id,
        outlets.depotId,
        outlets.brand,
        outlets.districtId,
      ],
    }),
    unique('stops_trip_seq_uq').on(t.tripId, t.seq),
    // Whole orders, one trip each: a cancelled or failed stop frees the order for a new one.
    uniqueIndex('stops_live_order_uq')
      .on(t.orderId)
      .where(sql`status NOT IN ('CANCELLED', 'FAILED')`),
    index('stops_order_idx').on(t.orderId),
    check('stops_window_chk', sql`${t.windowCloseMin} > ${t.windowOpenMin}`),
    check(
      'stops_late_risk_chk',
      sql`${t.lateRiskProb} IS NULL OR ${t.lateRiskProb} BETWEEN 0 AND 1`,
    ),
    check(
      'stops_arrived_coords_chk',
      sql`(${t.arrivedLat} IS NULL OR ${t.arrivedLat} BETWEEN -90 AND 90)
    AND (${t.arrivedLng} IS NULL OR ${t.arrivedLng} BETWEEN -180 AND 180)`,
    ),
    check(
      'stops_units_delivered_chk',
      sql`${t.unitsDelivered} IS NULL OR ${t.unitsDelivered} >= 0`,
    ),
  ],
);

/** Admin-editable in A6; engine reasons can't be removed. */
export const deferralReasons = pgTable('deferral_reasons', {
  code: text().primaryKey(), // "OVER_CAPACITY"; the engine's codes come from its reason map
  label: text().notNull(), // "Fleet full"
  description: text(),
  fromEngine: boolean().notNull().default(false),
  active: boolean().notNull().default(true),
  sortOrder: integer().notNull().default(0),
});

/** Every deferral, so repeatedly skipped outlets are visible. */
export const deferrals = pgTable(
  'deferrals',
  {
    id: pk(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id),
    planId: uuid()
      .notNull()
      .references(() => plans.id),
    engineRunId: uuid().references(() => engineRuns.id),
    status: deferralStatusEnum().notNull().default('PROPOSED'),
    source: deferralSourceEnum().notNull(),
    reasonCode: text()
      .notNull()
      .references(() => deferralReasons.code),
    reasonDetail: jsonb().$type<Record<string, unknown>>(), // the engine's why-not
    note: text(), // dispatcher's note, shown to the store
    fromDate: businessDate().notNull(),
    toDate: businessDate().notNull(),
    priorityScore: doublePrecision(),
    repeatSkip: boolean().notNull().default(false),
    overrideNote: text(), // required to override a repeat skip
    swappedForOrderId: uuid().references((): AnyPgColumn => orders.id), // 16 Swap: the order served instead
    partial: boolean().notNull().default(false), // from a load-check removal
    decidedById: text(),
    decidedAt: instant(),
    storeResponse: storeResponseEnum().notNull().default('AWAITING'),
    storeNote: text(),
    storeRespondedById: text(),
    storeRespondedAt: instant(),
    reversedAt: instant(),
    reversedReason: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('deferrals_order_idx').on(t.orderId, t.createdAt),
    index('deferrals_plan_status_idx').on(t.planId, t.status),
    check('deferrals_dates_chk', sql`${t.toDate} >= ${t.fromDate}`),
    pgPolicy('deferrals_app_scope', {
      for: 'all',
      to: appRole,
      using: viaVisibleOrder(t.orderId),
      withCheck: viaVisibleOrder(t.orderId),
    }),
    pgPolicy('deferrals_readonly', {
      for: 'select',
      to: readonlyRole,
      using: readAll,
    }),
  ],
);

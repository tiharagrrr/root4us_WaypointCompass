// apps/backend/src/db/schema/execution.ts · owner: execution
// Field work is stored as append-only events with client UUIDs; stop status, delivery lines
// and positions are projections the server derives from them, which makes offline replay safe.
import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { instant, pk } from '../columns';
import { stopEventTypeEnum } from './enums';
import { vehicles } from './fleet';
import { orderLines } from './ordering';
import { stops, trips } from './planning';

/** Append-only; stop status is a projection of these. */
export const stopEvents = pgTable(
  'stop_events',
  {
    id: pk(),
    clientUuid: uuid().notNull().unique(), // generated on the phone
    tripId: uuid()
      .notNull()
      .references(() => trips.id),
    stopId: uuid().references(() => stops.id), // null for trip-level events
    type: stopEventTypeEnum().notNull(),
    occurredAt: instant().notNull(), // device clock
    receivedAt: instant().notNull().defaultNow(), // server clock
    deviceSeq: integer(), // creation order on the device
    lateSync: boolean().notNull().default(false), // received more than 5 minutes after it happened
    deviceId: text(),
    actorId: text(),
    lat: doublePrecision(),
    lng: doublePrecision(),
    payload: jsonb().$type<Record<string, unknown>>().notNull(), // outcome, lines, receiver, note, attachment ids
    appliedAt: instant(), // projection applied to stops, trips and orders
    supersededAt: instant(), // a conflict was resolved against this event
  },
  (t) => [
    index('stop_events_trip_time_idx').on(t.tripId, t.occurredAt),
    index('stop_events_stop_idx').on(t.stopId),
  ],
);

export const deliveryLines = pgTable(
  'delivery_lines',
  {
    id: pk(),
    stopId: uuid()
      .notNull()
      .references(() => stops.id),
    orderLineId: uuid()
      .notNull()
      .references(() => orderLines.id),
    qtyExpected: integer(), // snapshot of the order line's qty
    qtyDelivered: integer().notNull(),
    condition: text().notNull(), // ok | damaged | refused
    note: text(),
  },
  (t) => [
    unique('delivery_lines_uq').on(t.stopId, t.orderLineId),
    check(
      'delivery_lines_qty_chk',
      sql`${t.qtyDelivered} >= 0 AND (${t.qtyExpected} IS NULL OR ${t.qtyExpected} >= 0)`,
    ),
  ],
);

/** Latest position per vehicle, upserted. */
export const vehiclePositions = pgTable(
  'vehicle_positions',
  {
    vehicleId: text()
      .primaryKey()
      .references(() => vehicles.id),
    tripId: uuid(),
    lat: doublePrecision().notNull(),
    lng: doublePrecision().notNull(),
    speedKmh: doublePrecision(),
    heading: doublePrecision(),
    accuracyM: doublePrecision(),
    reeferTempC: doublePrecision(),
    source: text().notNull(), // pwa | simulator | flutter | traccar
    recordedAt: instant().notNull(),
    receivedAt: instant().notNull().defaultNow(),
  },
  (t) => [
    check(
      'positions_coords_chk',
      sql`${t.lat} BETWEEN -90 AND 90 AND ${t.lng} BETWEEN -180 AND 180`,
    ),
  ],
);

/** Sampled history, kept 30 days. */
export const positionPings = pgTable(
  'position_pings',
  {
    id: bigserial({ mode: 'number' }).primaryKey(),
    vehicleId: text()
      .notNull()
      .references(() => vehicles.id),
    tripId: uuid().references(() => trips.id),
    deviceId: text(),
    lat: doublePrecision().notNull(),
    lng: doublePrecision().notNull(),
    speedKmh: doublePrecision(),
    heading: doublePrecision(),
    accuracyM: doublePrecision(),
    reeferTempC: doublePrecision(),
    source: text().notNull(),
    recordedAt: instant().notNull(),
    receivedAt: instant().notNull().defaultNow(),
  },
  (t) => [
    unique('pings_vehicle_time_uq').on(t.vehicleId, t.recordedAt), // replayed batches dedupe here
    index('pings_trip_time_idx').on(t.tripId, t.recordedAt),
    check(
      'pings_coords_chk',
      sql`${t.lat} BETWEEN -90 AND 90 AND ${t.lng} BETWEEN -180 AND 180`,
    ),
  ],
);

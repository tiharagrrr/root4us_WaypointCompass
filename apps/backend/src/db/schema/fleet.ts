// apps/backend/src/db/schema/fleet.ts · owner: fleet
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import {
  businessDate,
  createdAt,
  instant,
  measure,
  pk,
  updatedAt,
  version,
} from '../columns';
import {
  fuelEntryKindEnum,
  vehicleStatusEnum,
  vehicleTempEnum,
  vehicleTypeEnum,
} from './enums';
import { depots } from './master-data';
import { trips } from './planning';

export const vehicles = pgTable(
  'vehicles',
  {
    id: text().primaryKey(), // "VEH001"
    code: text().notNull().unique(), // "REF-07", "DRY-31", "VAN-03"
    registrationNo: text().notNull().unique(), // synthetic
    type: vehicleTypeEnum().notNull(),
    temp: vehicleTempEnum().notNull(),
    weightCapKg: measure().notNull(),
    volumeCapM3: measure().notNull(),
    fuelType: text().notNull(),
    kmPerL: measure().notNull(),
    weeklyFuelQuotaL: measure().notNull(),
    depotId: text()
      .notNull()
      .references(() => depots.id),
    status: vehicleStatusEnum().notNull().default('ACTIVE'), // persistent until marked ACTIVE again
    statusReason: text(),
    statusChangedAt: instant(),
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('vehicles_home_uq').on(t.id, t.depotId), // target of trips' composite key
    index('vehicles_depot_status_idx').on(t.depotId, t.status),
    check(
      'vehicles_caps_chk',
      sql`${t.weightCapKg} > 0 AND ${t.volumeCapM3} > 0 AND ${t.kmPerL} > 0 AND ${t.weeklyFuelQuotaL} >= 0`,
    ),
  ],
);

/** Planned entries on publish, reversals on revision, actuals at close; summed per ISO week. */
export const fuelLedgerEntries = pgTable(
  'fuel_ledger_entries',
  {
    id: pk(),
    vehicleId: text()
      .notNull()
      .references(() => vehicles.id),
    tripId: uuid().references((): AnyPgColumn => trips.id),
    isoYear: integer().notNull(),
    isoWeek: integer().notNull(),
    date: businessDate().notNull(),
    kind: fuelEntryKindEnum().notNull(),
    km: measure().notNull(),
    litres: measure().notNull(), // negative for reversals
    note: text(),
    createdAt: createdAt(),
  },
  (t) => [
    index('fuel_vehicle_week_idx').on(t.vehicleId, t.isoYear, t.isoWeek),
    index('fuel_trip_idx').on(t.tripId),
  ],
);

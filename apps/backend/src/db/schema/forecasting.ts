// apps/backend/src/db/schema/forecasting.ts · owner: forecasting
// Weekly volume per depot and brand (the Datathon grain), with daily order counts for 12 and 13,
// and the vehicles and drivers each depot plans to field against it (22).
import { sql } from 'drizzle-orm';
import { check, integer, pgTable, text, unique } from 'drizzle-orm/pg-core';
import { createdAt, measure, pk, updatedAt } from '../columns';
import { brandEnum, forecastSourceEnum } from './enums';
import { depots } from './master-data';

export const demandForecasts = pgTable(
  'demand_forecasts',
  {
    id: pk(),
    depotId: text()
      .notNull()
      .references(() => depots.id),
    brand: brandEnum().notNull(),
    isoYear: integer().notNull(),
    isoWeek: integer().notNull(),
    totalVolumeM3: measure().notNull(),
    chilledVolumeM3: measure().notNull(), // 0 for Style and Tech, as in Task 2A
    expectedOrders: integer(),
    source: forecastSourceEnum().notNull(),
    modelVersion: text(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('forecasts_uq').on(
      t.depotId,
      t.brand,
      t.isoYear,
      t.isoWeek,
      t.source,
    ),
  ],
);

/** 22: how many vehicles and drivers a depot plans to field in an ISO week. */
export const capacityPlans = pgTable(
  'capacity_plans',
  {
    id: pk(),
    depotId: text()
      .notNull()
      .references(() => depots.id),
    isoYear: integer().notNull(),
    isoWeek: integer().notNull(),
    vehiclesPlanned: integer(),
    driversPlanned: integer(),
    note: text(),
    createdById: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('capacity_plans_uq').on(t.depotId, t.isoYear, t.isoWeek),
    check(
      'capacity_plans_counts_chk',
      sql`(${t.vehiclesPlanned} IS NULL OR ${t.vehiclesPlanned} >= 0) AND (${t.driversPlanned} IS NULL OR ${t.driversPlanned} >= 0)`,
    ),
  ],
);

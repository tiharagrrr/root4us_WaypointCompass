// apps/backend/src/db/schema/master-data.ts · owner: master-data
// Mirrors the booklet's reference CSVs column for column; dataset rows keep their natural keys.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  unique,
} from 'drizzle-orm/pg-core';
import {
  businessDate,
  createdAt,
  instant,
  measure,
  minutes,
  pk,
  updatedAt,
} from '../columns';
import {
  brandEnum,
  depotKindEnum,
  dockTypeEnum,
  parkingEnum,
  roadClassEnum,
  tempClassEnum,
} from './enums';

export const depots = pgTable('depots', {
  id: text().primaryKey(), // "PLG", "KDY"
  name: text().notNull().unique(), // dataset value: "Peliyagoda", "Kandy"
  kind: depotKindEnum().notNull().default('CENTRAL'), // KDY is REGIONAL
  address: text(),
  lat: doublePrecision(),
  lng: doublePrecision(),
  dockCount: integer().notNull().default(6),
  chilledDocks: integer().notNull().default(2),
  cutoffMin: minutes(), // overrides the 16:00 cutoff (960)
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** A departure band ("Run 1" 05:15–06:30); trips are one vehicle's trip within a wave. */
export const depotWaves = pgTable(
  'depot_waves',
  {
    id: pk(),
    depotId: text()
      .notNull()
      .references(() => depots.id),
    label: text().notNull(), // "Run 1"
    departFromMin: minutes().notNull(), // 05:15 = 315
    departToMin: minutes().notNull(),
    brands: brandEnum().array().notNull(),
  },
  (t) => [
    unique('depot_waves_label_uq').on(t.depotId, t.label),
    check('depot_waves_band_chk', sql`${t.departToMin} >= ${t.departFromMin}`),
  ],
);

export const districts = pgTable('districts', {
  id: text().primaryKey(), // slug of the dataset name: "gampaha"
  name: text().notNull().unique(),
  province: text(), // "Western"; not in the dataset
  depotId: text()
    .notNull()
    .references(() => depots.id),
  roadClass: roadClassEnum().notNull(),
  freeFlowKmh: measure().notNull(),
  depotToDistrictKm: measure().notNull(),
  depotToDistrictMin: measure().notNull(), // depot_to_district_freeflow_min
  interStopKm: measure().notNull(),
  interStopMin: measure().notNull(), // inter_stop_freeflow_min
  centroidLat: doublePrecision(), // for the map only; not in the dataset
  centroidLng: doublePrecision(),
});

export const serviceAllowances = pgTable(
  'service_allowances',
  {
    brand: brandEnum().notNull(),
    dockType: dockTypeEnum().notNull(),
    minutes: measure().notNull(), // service_allowance_min
  },
  (t) => [
    primaryKey({ columns: [t.brand, t.dockType] }),
    check('service_allowances_minutes_chk', sql`${t.minutes} > 0`),
  ],
);

export const trafficSpeeds = pgTable(
  'traffic_speeds',
  {
    districtId: text()
      .notNull()
      .references(() => districts.id),
    hour: integer().notNull(),
    monsoon: boolean().notNull(),
    speedIndex: measure().notNull(), // 100 = free flow
  },
  (t) => [primaryKey({ columns: [t.districtId, t.hour, t.monsoon] })],
);

export const roadConditions = pgTable(
  'road_conditions',
  {
    date: businessDate().notNull(),
    districtId: text()
      .notNull()
      .references(() => districts.id),
    disruptionIndex: measure().notNull(), // 100 = clear
  },
  (t) => [primaryKey({ columns: [t.date, t.districtId] })],
);

export const calendarDays = pgTable(
  'calendar_days',
  {
    date: businessDate().primaryKey(),
    dow: integer().notNull(), // 0 = Monday
    isWeekend: boolean().notNull(),
    isoYear: integer().notNull(),
    isoWeek: integer().notNull(),
    isPayday: boolean().notNull(),
    festival: text(),
    festivalRamp: measure().notNull(),
    isHoliday: boolean().notNull(),
    monsoon: boolean().notNull(),
    isOperating: boolean().notNull(),
  },
  (t) => [
    index('calendar_days_iso_week_idx').on(t.isoYear, t.isoWeek),
    check('calendar_days_dow_chk', sql`${t.dow} BETWEEN 0 AND 6`),
  ],
);

export const outlets = pgTable(
  'outlets',
  {
    id: text().primaryKey(), // "OUT001"
    name: text().notNull(), // generated: "Fresh Kadawatha"
    brand: brandEnum().notNull(),
    districtId: text()
      .notNull()
      .references(() => districts.id),
    depotId: text()
      .notNull()
      .references(() => depots.id),
    dockType: dockTypeEnum().notNull(),
    parkingConstraint: parkingEnum().notNull(),
    mallWindowOpenMin: minutes(),
    mallWindowCloseMin: minutes(),
    windowOpenMin: minutes().notNull(),
    windowCloseMin: minutes().notNull(),
    styleDeliveryDow: integer(), // Style's weekly delivery day, 0 = Monday
    address: text(),
    lat: doublePrecision(),
    lng: doublePrecision(),
    receivingContactName: text(), // D9 Dock and access
    receivingContactPhone: text(),
    accessNotes: text(),
    accessNotesUpdatedAt: instant(),
    accessNotesUpdatedById: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // Target of the composite keys on orders and stops.
    unique('outlets_scope_uq').on(t.id, t.depotId, t.brand, t.districtId),
    index('outlets_depot_brand_district_idx').on(
      t.depotId,
      t.brand,
      t.districtId,
    ),
    check('outlets_window_chk', sql`${t.windowCloseMin} > ${t.windowOpenMin}`),
    check(
      'outlets_mall_window_chk',
      sql`(${t.mallWindowOpenMin} IS NULL) = (${t.mallWindowCloseMin} IS NULL)
    AND (${t.mallWindowOpenMin} IS NULL OR ${t.mallWindowCloseMin} > ${t.mallWindowOpenMin})`,
    ),
    check(
      'outlets_style_dow_chk',
      sql`${t.styleDeliveryDow} IS NULL OR ${t.styleDeliveryDow} BETWEEN 0 AND 6`,
    ),
  ],
);

export const items = pgTable(
  'items',
  {
    id: pk(),
    sku: text().notNull().unique(),
    name: text().notNull(),
    brand: brandEnum().notNull(),
    category: text().notNull(),
    tempClass: tempClassEnum().notNull(),
    packLabel: text().notNull(), // "Tray of 30"
    unitWeightKg: measure().notNull(),
    unitVolumeM3: measure().notNull(),
    unitValueLkr: integer(), // Tech high-value check
    barcode: text().unique(),
    fragile: boolean().notNull().default(false),
    isAdjustment: boolean().notNull().default(false), // "mixed cases" line holding a seeded order's remainder
    active: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('items_brand_class_idx').on(t.brand, t.tempClass, t.active),
    check(
      'items_size_chk',
      sql`${t.unitWeightKg} > 0 AND ${t.unitVolumeM3} > 0`,
    ),
  ],
);

// apps/backend/src/db/schema/ordering.ts · owner: ordering
// Orders keep the dataset's totals as the source of truth for planning. The composite key
// to outlets keeps depotId, brand and districtId honest, and they are what the plan's
// composite keys check against.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgSequence,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import {
  appRole,
  orderVisible,
  readAll,
  readonlyRole,
  viaVisibleOrder,
} from '../rls';
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
import { brandEnum, orderStatusEnum, tempClassEnum } from './enums';
import { users } from './identity';
import { items, outlets } from './master-data';
import { stops } from './planning';

export const orderNoFresh = pgSequence('order_no_fresh_seq'); // WF-0001
export const orderNoStyle = pgSequence('order_no_style_seq'); // WS-0001
export const orderNoTech = pgSequence('order_no_tech_seq'); // WT-0001

export const orderTemplates = pgTable(
  'order_templates',
  {
    id: pk(),
    outletId: text()
      .notNull()
      .references(() => outlets.id),
    name: text().notNull(),
    tempClass: tempClassEnum().notNull(),
    createdById: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique('order_templates_name_uq').on(t.outletId, t.name)],
);

export const orders = pgTable(
  'orders',
  {
    id: pk(),
    orderNo: text().notNull().unique(), // "WF-0171"
    outletId: text().notNull(),
    depotId: text().notNull(), // copied from the outlet and kept honest
    brand: brandEnum().notNull(), //   by the composite key below
    districtId: text().notNull(),
    tempClass: tempClassEnum().notNull(),
    requestedDate: businessDate().notNull(), // the day the store asked for
    deliveryDate: businessDate().notNull(), // the run it is on now; moves on late roll or deferral
    status: orderStatusEnum().notNull().default('DRAFT'),
    afterCutoff: boolean().notNull().default(false), // M2: sent after the cutoff, moved to the next run
    urgent: boolean().notNull().default(false),
    units: integer().notNull().default(0),
    weightKg: measure().notNull().default(0),
    volumeM3: measure().notNull().default(0),
    valueLkr: integer(),
    source: text().notNull().default('web'), // web | seed | reorder | backorder
    externalRef: text().unique(), // dataset key, e.g. "S1-000" (Task 2B parity)
    note: text(),
    templateId: uuid().references(() => orderTemplates.id, {
      onDelete: 'set null',
    }),
    placedById: text().references(() => users.id),
    submittedAt: instant(), // null while DRAFT
    confirmedAt: instant(),
    cancelledAt: instant(),
    cancelReason: text(),
    deferredCount: integer().notNull().default(0),
    lastDeferredAt: instant(),
    activeStopId: uuid()
      .unique()
      .references((): AnyPgColumn => stops.id), // at most one live stop per order
    parentOrderId: uuid().references((): AnyPgColumn => orders.id), // backorder from a partial deferral
    version: version(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: 'orders_outlet_scope_fk',
      columns: [t.outletId, t.depotId, t.brand, t.districtId],
      foreignColumns: [
        outlets.id,
        outlets.depotId,
        outlets.brand,
        outlets.districtId,
      ],
    }),
    index('orders_depot_date_status_idx').on(
      t.depotId,
      t.deliveryDate,
      t.status,
    ),
    index('orders_outlet_date_class_idx').on(
      t.outletId,
      t.requestedDate,
      t.tempClass,
    ),
    index('orders_parent_idx').on(t.parentOrderId),
    check(
      'orders_totals_chk',
      sql`${t.weightKg} >= 0 AND ${t.volumeM3} >= 0 AND ${t.units} >= 0`,
    ),
    pgPolicy('orders_app_scope', {
      for: 'all',
      to: appRole,
      using: orderVisible(t),
      withCheck: orderVisible(t),
    }),
    pgPolicy('orders_readonly', {
      for: 'select',
      to: readonlyRole,
      using: readAll,
    }),
  ],
);

export const orderLines = pgTable(
  'order_lines',
  {
    id: pk(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    itemId: uuid()
      .notNull()
      .references(() => items.id),
    qty: integer().notNull(), // packs
    unitWeightKg: measure().notNull(), // snapshot at submit
    unitVolumeM3: measure().notNull(),
    unitValueLkr: integer(),
    available: boolean().notNull().default(true), // false when the line can't be supplied (open question in the spec)
  },
  (t) => [
    unique('order_lines_item_uq').on(t.orderId, t.itemId),
    check('order_lines_qty_chk', sql`${t.qty} > 0`),
    pgPolicy('order_lines_app_scope', {
      for: 'all',
      to: appRole,
      using: viaVisibleOrder(t.orderId),
      withCheck: viaVisibleOrder(t.orderId),
    }),
    pgPolicy('order_lines_readonly', {
      for: 'select',
      to: readonlyRole,
      using: readAll,
    }),
  ],
);

export const orderTemplateLines = pgTable(
  'order_template_lines',
  {
    templateId: uuid()
      .notNull()
      .references(() => orderTemplates.id, { onDelete: 'cascade' }),
    itemId: uuid()
      .notNull()
      .references(() => items.id),
    qty: integer().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.templateId, t.itemId] }),
    check('order_template_lines_qty_chk', sql`${t.qty} > 0`),
  ],
);

/** M3: who receives deliveries at an outlet, and when. */
export const receivingRosterEntries = pgTable(
  'receiving_roster_entries',
  {
    id: pk(),
    outletId: text()
      .notNull()
      .references(() => outlets.id),
    date: businessDate().notNull(),
    staffName: text().notNull(),
    fromMin: minutes().notNull(),
    toMin: minutes().notNull(),
  },
  (t) => [
    index('roster_outlet_date_idx').on(t.outletId, t.date),
    check('roster_band_chk', sql`${t.toMin} > ${t.fromMin}`),
  ],
);

/**
 * The once-a-day acts ordering must not repeat, whatever retries a worker
 * makes: closing a depot's cutoff for a delivery date, and the 15:30 reminder
 * to one outlet about that date. The primary key is the guarantee: an
 * ON CONFLICT DO NOTHING insert lets exactly one caller win, so the cutoff
 * emits `order.cutoff_closed` once even when the demo close and the ticker
 * both reach the same day (AC-ORD-25, AC-ORD-26).
 */
export const orderDayMarks = pgTable(
  'order_day_marks',
  {
    kind: text().notNull(), // 'cutoff_closed' | 'cutoff_reminder'
    scopeId: text().notNull(), // depotId for a close, outletId for a reminder
    deliveryDate: businessDate().notNull(),
    at: instant().notNull(),
    detail: jsonb().$type<Record<string, unknown>>(),
  },
  (t) => [
    primaryKey({ columns: [t.kind, t.scopeId, t.deliveryDate] }),
    index('order_day_marks_date_idx').on(t.kind, t.deliveryDate),
  ],
);

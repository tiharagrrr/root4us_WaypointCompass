// apps/backend/src/db/schema/receipt.ts · owner: receipt
// The store confirms what actually arrived; discrepancies become issues for the dispatcher.
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgPolicy,
  pgTable,
  primaryKey,
  text,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  appRole,
  issueVisible,
  readAll,
  readonlyRole,
  viaVisibleOrder,
} from '../rls';
import { createdAt, instant, pk } from '../columns';
import {
  issueResolutionEnum,
  issueStatusEnum,
  issueTypeEnum,
  receiptStatusEnum,
} from './enums';
import { users } from './identity';
import { outlets } from './master-data';
import { orderLines, orders } from './ordering';
import { stops } from './planning';

export const receipts = pgTable(
  'receipts',
  {
    id: pk(),
    orderId: uuid()
      .notNull()
      .unique()
      .references(() => orders.id), // one receipt per order
    stopId: uuid().references(() => stops.id),
    status: receiptStatusEnum().notNull(),
    note: text(),
    confirmedById: text()
      .notNull()
      .references(() => users.id),
    confirmedAt: instant().notNull().defaultNow(),
    awaitingDriverSync: boolean().notNull().default(false), // the store confirmed before the driver's record arrived
  },
  (t) => [
    pgPolicy('receipts_app_scope', {
      for: 'all',
      to: appRole,
      using: viaVisibleOrder(t.orderId),
      withCheck: viaVisibleOrder(t.orderId),
    }),
    pgPolicy('receipts_readonly', {
      for: 'select',
      to: readonlyRole,
      using: readAll,
    }),
  ],
);

export const receiptLines = pgTable(
  'receipt_lines',
  {
    receiptId: uuid()
      .notNull()
      .references(() => receipts.id, { onDelete: 'cascade' }),
    orderLineId: uuid()
      .notNull()
      .references(() => orderLines.id),
    qtyReceived: integer().notNull(),
    condition: text().notNull(), // ok | damaged | short | missing | temperature
  },
  (t) => [
    primaryKey({ columns: [t.receiptId, t.orderLineId] }),
    check('receipt_lines_qty_chk', sql`${t.qtyReceived} >= 0`),
  ],
);

export const issues = pgTable(
  'issues',
  {
    id: pk(),
    outletId: text()
      .notNull()
      .references(() => outlets.id),
    orderId: uuid().references(() => orders.id),
    stopId: uuid().references(() => stops.id),
    receiptId: uuid().references(() => receipts.id), // raised while confirming receipt (M5)
    orderLineId: uuid().references(() => orderLines.id), // the line it is about, if one
    type: issueTypeEnum().notNull(),
    qtyAffected: integer(),
    description: text().notNull(),
    status: issueStatusEnum().notNull().default('OPEN'),
    resolution: issueResolutionEnum(),
    resolutionNote: text(),
    raisedById: text().notNull(),
    raisedByRole: text().notNull(),
    resolvedById: text(),
    createdAt: createdAt(),
    resolvedAt: instant(),
  },
  (t) => [
    index('issues_outlet_status_idx').on(t.outletId, t.status),
    index('issues_order_idx').on(t.orderId),
    index('issues_receipt_idx').on(t.receiptId),
    pgPolicy('issues_app_scope', {
      for: 'all',
      to: appRole,
      using: issueVisible(t),
      withCheck: issueVisible(t),
    }),
    pgPolicy('issues_readonly', {
      for: 'select',
      to: readonlyRole,
      using: readAll,
    }),
  ],
);

// apps/backend/src/db/schema/loading.ts · owner: loading
// A published trip becomes a last-stop-first checklist; release is blocked while any flag is open.
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  uuid,
} from 'drizzle-orm/pg-core';
import { instant, pk } from '../columns';
import {
  loadFlagDecisionEnum,
  loadFlagReasonEnum,
  loadFlagStatusEnum,
  loadLineStatusEnum,
} from './enums';
import { orderLines, orders } from './ordering';
import { trips } from './planning';

export const loadCheckLines = pgTable(
  'load_check_lines',
  {
    id: pk(),
    tripId: uuid()
      .notNull()
      .references(() => trips.id),
    orderId: uuid()
      .notNull()
      .references(() => orders.id),
    orderLineId: uuid().references(() => orderLines.id), // null for an order with no lines
    stopSeq: integer().notNull(), // snapshot, for last-stop-first order
    status: loadLineStatusEnum().notNull().default('PENDING'),
    qtyExpected: integer().notNull(),
    qtyLoaded: integer(),
    planRevision: integer().notNull(), // the list version this line belongs to
    checkedByUserId: text(),
    checkedByName: text(), // who actually checked, on a shared tablet
    deviceId: text(),
    clientUuid: uuid().unique(), // offline idempotency
    checkedAt: instant(),
  },
  (t) => [
    index('load_lines_trip_seq_idx').on(t.tripId, t.stopSeq),
    check(
      'load_lines_qty_chk',
      sql`${t.qtyExpected} >= 0 AND (${t.qtyLoaded} IS NULL OR ${t.qtyLoaded} >= 0)`,
    ),
  ],
);

export const loadFlags = pgTable(
  'load_flags',
  {
    id: pk(),
    tripId: uuid()
      .notNull()
      .references(() => trips.id),
    loadLineId: uuid()
      .notNull()
      .references(() => loadCheckLines.id),
    reason: loadFlagReasonEnum().notNull(),
    qtyAffected: integer().notNull(),
    note: text(),
    status: loadFlagStatusEnum().notNull().default('OPEN'),
    decision: loadFlagDecisionEnum(),
    decisionNote: text(),
    decidedById: text(),
    decidedAt: instant(),
    raisedByName: text().notNull(),
    raisedByUserId: text(),
    clientUuid: uuid().unique(),
    raisedAt: instant().notNull().defaultNow(),
    resolvedAt: instant(),
  },
  (t) => [
    index('load_flags_trip_status_idx').on(t.tripId, t.status),
    check('load_flags_qty_chk', sql`${t.qtyAffected} > 0`),
  ],
);

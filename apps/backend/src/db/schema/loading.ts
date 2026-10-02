// apps/backend/src/db/schema/loading.ts · owner: loading
// A published trip becomes a last-stop-first checklist; release is blocked while any flag is open.
import { sql } from 'drizzle-orm';
import {
  check,
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, instant, pk } from '../columns';
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

/**
 * What one release recorded, which `trips` has no room for: the name the
 * loader typed on the shared tablet, the plan revision they released
 * against, and the `clientUuid` that makes a replayed release a duplicate
 * rather than a second release (specs/loading/spec.md, Open questions).
 *
 * One row per trip: a trip reassigned to another vehicle goes back to
 * LOADING and must pass its checks again, which deletes this row and writes
 * a new one (AC-LOD-19). The trip itself keeps `releasedAt`, `releasedById`
 * and `releaseTempC`, moved by planning's TripLifecycleService.
 */
export const loadReleases = pgTable(
  'load_releases',
  {
    id: pk(),
    tripId: uuid()
      .notNull()
      .unique()
      .references(() => trips.id),
    /** The name typed on the dock tablet, not the signed-in account's. */
    checkedByName: text().notNull(),
    releasedById: text(),
    deviceId: text(),
    /** Null on an ambient trip, which needs no reading. */
    releaseTempC: doublePrecision(),
    /** The plan revision the list was at when it was released. */
    planRevision: integer().notNull(),
    clientUuid: uuid().notNull().unique(), // offline idempotency
    releasedAt: instant().notNull().defaultNow(),
  },
  (t) => [
    check(
      'load_releases_temp_chk',
      sql`${t.releaseTempC} IS NULL OR ${t.releaseTempC} BETWEEN -40 AND 60`,
    ),
  ],
);

/**
 * Which delivered events LoadListBuilder has already handled. Delivery is at
 * least once, so the same `plan.published` can arrive twice; without this the
 * second delivery would re-announce `load.list_updated` and put the Plan
 * updated banner on a tablet for a plan that did not change (AC-LOD-01).
 *
 * The outbox id has no foreign key: the relay may prune its own rows.
 */
export const loadEventReceipts = pgTable('load_event_receipts', {
  eventId: uuid().primaryKey(),
  /** The event type, so a stuck listener can be read off the table. */
  type: text().notNull(),
  handledAt: createdAt(),
});

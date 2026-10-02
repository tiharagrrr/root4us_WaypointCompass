// apps/backend/src/db/schema/alerts.ts · owner: alerts
// The dispatcher's action queue on 01 and 19. Alerts point at entities by id rather than
// foreign keys, so any module can raise one; each points at the fix and closes itself.
import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, instant, pk } from '../columns';
import { alertStatusEnum, alertTypeEnum } from './enums';

export const alerts = pgTable(
  'alerts',
  {
    id: pk(),
    type: alertTypeEnum().notNull(),
    status: alertStatusEnum().notNull().default('OPEN'),
    severity: integer().notNull().default(2), // 1 critical, 2 warning, 3 info
    depotId: text().notNull(),
    planId: uuid(),
    tripId: uuid(),
    stopId: uuid(),
    orderId: uuid(),
    outletId: text(),
    title: text().notNull(),
    detail: jsonb(),
    dedupeKey: text().notNull(), // "LATE_RISK:stop:<id>"
    raisedById: text(), // the person who reported it (driver, loader, store); null when a rule raised it
    raisedAt: instant().notNull().defaultNow(),
    acknowledgedById: text(),
    acknowledgedAt: instant(),
    resolvedById: text(),
    resolvedAt: instant(),
    resolution: text(),
  },
  (t) => [
    index('alerts_depot_status_idx').on(t.depotId, t.status, t.raisedAt),
    // One unresolved alert per key: raising it again is an upsert on this index.
    uniqueIndex('alerts_open_dedupe_uq')
      .on(t.dedupeKey)
      .where(sql`status <> 'RESOLVED'`),
  ],
);

/**
 * Which outbox events the alert listeners have already handled. The relay
 * delivers at least once, so a replay must not raise a second alert or emit a
 * second event (AC-ALR-10). The alerts table's own partial unique index
 * already collapses a replay that arrives while the alert is open; this table
 * is what stops a replay that arrives *after* it resolved from opening a
 * fresh one, which no index can tell from a genuine new episode.
 *
 * One row per outbox event, written in the same transaction as the raise or
 * resolve it covers, so the two cannot disagree. Rows are bookkeeping, not
 * business data: nothing reads them but the listener.
 */
export const alertEventReceipts = pgTable('alert_event_receipts', {
  /** The outbox_events id, with no foreign key: the relay may prune its rows. */
  eventId: uuid().primaryKey(),
  /** The event type, so a stuck listener can be read off the table. */
  type: text().notNull(),
  handledAt: createdAt(),
});

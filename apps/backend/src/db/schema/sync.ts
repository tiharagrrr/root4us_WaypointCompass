// apps/backend/src/db/schema/sync.ts · owner: sync
// POST /sync replays a device's outbox once; anything contradictory becomes a conflict for 19c.
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, instant, pk } from '../columns';
import { syncConflictStatusEnum, syncResolutionEnum } from './enums';
import { stopEvents } from './execution';

export const syncBatches = pgTable(
  'sync_batches',
  {
    id: pk(),
    deviceId: text().notNull(),
    userId: text().notNull(),
    received: integer().notNull(),
    applied: integer().notNull(),
    duplicates: integer().notNull(),
    conflicts: integer().notNull(),
    rejected: integer().notNull(),
    receivedAt: instant().notNull().defaultNow(),
  },
  (t) => [index('sync_batches_device_idx').on(t.deviceId, t.receivedAt)],
);

export const syncConflicts = pgTable(
  'sync_conflicts',
  {
    id: pk(),
    kind: text().notNull(), // DELIVERED_AFTER_DEFERRAL | STOP_REASSIGNED | STOP_CANCELLED
    tripId: uuid().notNull(),
    stopId: uuid(),
    stopEventId: uuid()
      .notNull()
      .unique()
      .references(() => stopEvents.id),
    deviceRecord: jsonb().notNull(), // what the phone recorded, with device time
    serverRecord: jsonb().notNull(), // what the server had, with who and when
    status: syncConflictStatusEnum().notNull().default('OPEN'),
    resolution: syncResolutionEnum(),
    resolvedById: text(),
    resolvedAt: instant(),
    note: text(),
    createdAt: createdAt(),
  },
  (t) => [index('sync_conflicts_status_idx').on(t.status, t.createdAt)],
);

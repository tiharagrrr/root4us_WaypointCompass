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
import { instant, pk } from '../columns';
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

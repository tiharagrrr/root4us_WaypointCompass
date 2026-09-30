// apps/backend/src/db/schema/audit.ts · owner: audit
// Append-only and hash-chained: hash = sha256(prevHash + canonical row). Written in the same
// transaction as the change it records. Triggers block UPDATE, DELETE and TRUNCATE (migration
// *_platform_integrity), and compass_app holds INSERT and SELECT only.
import {
  bigserial,
  index,
  jsonb,
  pgTable,
  text,
  uuid,
} from 'drizzle-orm/pg-core';
import { instant, pk } from '../columns';
import { auditSourceEnum } from './enums';

export const auditEvents = pgTable(
  'audit_events',
  {
    id: pk(),
    seq: bigserial({ mode: 'number' }).notNull().unique(),
    actorId: text(),
    actorRole: text(),
    actorName: text(), // e.g. the name typed on a shared dock tablet
    deviceId: text(),
    source: auditSourceEnum().notNull(),
    action: text().notNull(), // "ordering.order.submitted"
    entityType: text().notNull(),
    entityId: text().notNull(),
    before: jsonb(),
    after: jsonb(),
    reasonCode: text(),
    reasonNote: text(),
    occurredAt: instant().notNull(), // device or business time
    recordedAt: instant().notNull(), // set by the app, so the hash can be recomputed
    correlationId: text(),
    clientUuid: uuid(),
    prevHash: text().notNull(),
    hash: text().notNull().unique(),
  },
  (t) => [
    index('audit_entity_idx').on(t.entityType, t.entityId, t.seq),
    index('audit_action_idx').on(t.action, t.recordedAt),
    index('audit_actor_idx').on(t.actorId, t.recordedAt),
  ],
);

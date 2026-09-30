// apps/backend/src/db/schema/platform.ts · owner: core
// Shared plumbing: an outbox that feeds SSE, jobs and webhooks, and the stores for
// idempotency keys, files, settings and comments. Attachments and comments point at their
// owner by (type, id), so any entity can carry them.
import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, instant, pk, updatedAt } from '../columns';
import { attachmentKindEnum } from './enums';

/** Transactional outbox, written with the change and relayed by the worker. */
export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: pk(), // becomes the SSE id and the webhook-id
    type: text().notNull(), // "plan.published"
    aggregateType: text().notNull(),
    aggregateId: text().notNull(),
    depotId: text(), // routing for SSE channels
    outletIds: text().array().notNull().default([]),
    payload: jsonb().notNull(),
    correlationId: text(),
    occurredAt: instant().notNull().defaultNow(),
    publishedAt: instant(),
    attempts: integer().notNull().default(0),
    lastError: text(),
  },
  (t) => [
    index('outbox_unpublished_idx').on(t.publishedAt, t.occurredAt),
    index('outbox_aggregate_idx').on(t.aggregateType, t.aggregateId),
  ],
);

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    key: text().primaryKey(), // the Idempotency-Key header value
    userId: text().notNull(),
    method: text().notNull(),
    path: text().notNull(),
    requestHash: text().notNull(),
    status: integer().notNull(),
    responseBody: jsonb().notNull(),
    createdAt: createdAt(),
    expiresAt: instant().notNull(),
  },
  (t) => [index('idempotency_expiry_idx').on(t.expiresAt)],
);

export const attachments = pgTable(
  'attachments',
  {
    id: pk(),
    kind: attachmentKindEnum().notNull(),
    ownerType: text().notNull(), // stop | load_flag | issue | trip
    ownerId: text().notNull(),
    storageKey: text().notNull().unique(),
    contentType: text().notNull(),
    bytes: integer(),
    sha256: text(),
    clientUuid: uuid().unique(),
    capturedAt: instant(),
    uploadedAt: instant(), // null until the object exists in storage
    createdById: text(),
    createdAt: createdAt(),
  },
  (t) => [index('attachments_owner_idx').on(t.ownerType, t.ownerId)],
);

/** A6 settings; scope is "global" or a depot id for an override. */
export const settings = pgTable(
  'settings',
  {
    key: text().notNull(),
    scope: text().notNull().default('global'),
    value: jsonb().notNull(),
    updatedById: text(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.key, t.scope] })],
);

/** Record threads on deferrals, issues and load flags (Step 6). */
export const comments = pgTable(
  'comments',
  {
    id: pk(),
    entityType: text().notNull(), // deferral | issue | load_flag
    entityId: text().notNull(),
    authorId: text().notNull(),
    authorRole: text().notNull(),
    authorName: text(), // the typed name on a shared dock tablet
    body: text().notNull(), // plain text, up to 1,000 characters
    clientUuid: uuid().unique(), // written offline on the tablet
    readBy: text().array().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [
    index('comments_entity_idx').on(t.entityType, t.entityId, t.createdAt),
  ],
);

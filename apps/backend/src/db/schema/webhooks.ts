// apps/backend/src/db/schema/webhooks.ts · owner: webhooks
// Inbound provider callbacks (deduped by the provider's event id) and signed outbound
// Standard Webhooks fed by the outbox.
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, instant, pk, updatedAt } from '../columns';
import { webhookDeliveryStatusEnum } from './enums';

export const inboundWebhookEvents = pgTable(
  'inbound_webhook_events',
  {
    id: pk(),
    provider: text().notNull(), // resend | twilio | traccar | notifylk
    externalId: text().notNull(), // the provider's event id
    eventType: text(),
    signatureOk: boolean().notNull(),
    headers: jsonb().notNull(),
    payload: jsonb().notNull(),
    status: text().notNull().default('received'), // received | processed | ignored | failed
    error: text(),
    receivedAt: instant().notNull().defaultNow(),
    processedAt: instant(),
  },
  (t) => [unique('inbound_webhook_uq').on(t.provider, t.externalId)],
);

export const webhookEndpoints = pgTable('webhook_endpoints', {
  id: pk(),
  url: text().notNull(),
  description: text(),
  secretEnc: text().notNull(), // AES-GCM with APP_ENCRYPTION_KEY; shown once at creation
  eventTypes: text().array().notNull(),
  active: boolean().notNull().default(true),
  createdById: text().notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: pk(),
    endpointId: uuid()
      .notNull()
      .references(() => webhookEndpoints.id),
    eventId: uuid().notNull(), // outbox event id, sent as webhook-id
    eventType: text().notNull(),
    payload: jsonb().notNull(),
    status: webhookDeliveryStatusEnum().notNull().default('PENDING'),
    attempt: integer().notNull().default(0),
    nextAttemptAt: instant(),
    responseStatus: integer(),
    responseBody: text(), // first 2 KB
    durationMs: integer(),
    lastError: text(),
    createdAt: createdAt(),
    deliveredAt: instant(),
  },
  (t) => [
    unique('webhook_deliveries_uq').on(t.endpointId, t.eventId),
    index('webhook_deliveries_due_idx').on(t.status, t.nextAttemptAt),
  ],
);

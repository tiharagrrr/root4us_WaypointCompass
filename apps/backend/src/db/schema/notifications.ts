// apps/backend/src/db/schema/notifications.ts · owner: notifications
import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
} from 'drizzle-orm/pg-core';
import { createdAt, instant, pk } from '../columns';
import { notificationChannelEnum, notificationStatusEnum } from './enums';
import { users } from './identity';

/** One row per user and channel; the in-app feed reads the IN_APP rows. */
export const notifications = pgTable(
  'notifications',
  {
    id: pk(),
    userId: text()
      .notNull()
      .references(() => users.id),
    eventType: text().notNull(), // "deferral.confirmed"
    channel: notificationChannelEnum().notNull(),
    status: notificationStatusEnum().notNull().default('QUEUED'),
    title: text().notNull(),
    body: text().notNull(),
    data: jsonb(), // deep link and entity refs
    dedupeKey: text().notNull().unique(), // "<eventId>:<userId>:<channel>"
    provider: text(),
    providerMessageId: text().unique(),
    error: text(),
    attempts: integer().notNull().default(0),
    sentAt: instant(),
    deliveredAt: instant(),
    readAt: instant(),
    archivedAt: instant(),
    createdAt: createdAt(),
  },
  (t) => [index('notifications_user_idx').on(t.userId, t.channel, t.readAt)],
);

export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    eventType: text().notNull(),
    channels: notificationChannelEnum().array().notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.eventType] })],
);

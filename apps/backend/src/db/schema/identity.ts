// apps/backend/src/db/schema/identity.ts · owner: identity
// BetterAuth core plus admin, username and phoneNumber plugin fields (print them with
// @better-auth/cli generate), then Waypoint's scope columns. Users are never deleted,
// because audit rows point at them.
import {
  boolean,
  index,
  pgTable,
  primaryKey,
  text,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { createdAt, instant, pk, updatedAt } from '../columns';
import { devicePlatformEnum, invitationStatusEnum } from './enums';
import { vehicles } from './fleet';
import { depots, outlets } from './master-data';

export const users = pgTable(
  'users',
  {
    id: text().primaryKey(),
    name: text().notNull(),
    email: text().notNull().unique(), // drivers get <id>@drivers.waypoint.local
    emailVerified: boolean().notNull().default(false),
    image: text(),
    role: text().notNull().default('store_manager'), // admin | dispatcher | loader | driver | store_manager
    banned: boolean().default(false),
    banReason: text(),
    banExpires: instant(),
    username: text().unique(),
    displayUsername: text(),
    phoneNumber: text().unique(), // driver OTP sign-in
    phoneNumberVerified: boolean(),
    depotId: text().references((): AnyPgColumn => depots.id), // dispatcher (null = all depots), loader, driver
    outletId: text().references((): AnyPgColumn => outlets.id), // store manager
    defaultVehicleId: text().references((): AnyPgColumn => vehicles.id),
    pinHash: text(), // loader dock PIN, hashed, never returned
    demoPin: text(), // the same PIN in clear, kept only while DEMO_MODE=true so A1 can show it
    locale: text().notNull().default('en'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('users_role_depot_idx').on(t.role, t.depotId)],
);

/** Depots a loader may sign in at on L1; users.depotId stays the home depot. */
export const loaderDepots = pgTable(
  'loader_depots',
  {
    userId: text()
      .notNull()
      .references(() => users.id),
    depotId: text()
      .notNull()
      .references((): AnyPgColumn => depots.id),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.depotId] }),
    index('loader_depots_depot_idx').on(t.depotId),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: text().primaryKey(),
    token: text().notNull().unique(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: instant().notNull(),
    ipAddress: text(),
    userAgent: text(),
    impersonatedBy: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const accounts = pgTable(
  'accounts',
  {
    id: text().primaryKey(),
    accountId: text().notNull(),
    providerId: text().notNull(), // "credential" for email and password
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    password: text(),
    accessToken: text(),
    refreshToken: text(),
    idToken: text(),
    accessTokenExpiresAt: instant(),
    refreshTokenExpiresAt: instant(),
    scope: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('accounts_user_idx').on(t.userId)],
);

export const verifications = pgTable(
  'verifications',
  {
    id: text().primaryKey(),
    identifier: text().notNull(), // phone number for OTP, email for resets
    value: text().notNull(),
    expiresAt: instant().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('verifications_identifier_idx').on(t.identifier)],
);

export const invitations = pgTable(
  'invitations',
  {
    id: pk(),
    name: text().notNull(),
    email: text(),
    phoneNumber: text(),
    role: text().notNull(),
    depotId: text(),
    outletId: text(),
    vehicleId: text(),
    tokenHash: text().notNull().unique(), // sha256 of the link token; single-use, 72 hours
    status: invitationStatusEnum().notNull().default('PENDING'),
    expiresAt: instant().notNull(),
    sentAt: instant(),
    acceptedAt: instant(),
    userId: text().unique(), // set on accept
    invitedById: text()
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index('invitations_status_expiry_idx').on(t.status, t.expiresAt)],
);

export const devices = pgTable(
  'devices',
  {
    id: text().primaryKey(), // generated on the device, kept in IndexedDB
    userId: text().references(() => users.id),
    platform: devicePlatformEnum().notNull(),
    label: text(), // "Peliyagoda dock tablet 2"
    isDockDevice: boolean().notNull().default(false), // only dock devices may use PIN sign-in
    depotId: text(),
    userAgent: text(),
    appVersion: text(),
    pushEndpoint: text().unique(), // Web Push subscription
    pushP256dh: text(),
    pushAuth: text(),
    fcmToken: text().unique(), // Flutter, later
    lastSeenAt: instant(),
    lastSyncAt: instant(),
    createdAt: createdAt(),
  },
  (t) => [index('devices_user_idx').on(t.userId)],
);

/**
 * BetterAuth for the five roles, mounted at /api/auth by AuthModule.
 *
 * - Admin, dispatcher, store manager: email or username and password (A0).
 * - Driver: phone and a 6-digit SMS code (D0a, D0b).
 * - Loader: depot and 4-digit PIN on a dock device (L1, L1m; loader-pin.plugin.ts).
 *
 * Sessions live in Postgres behind an HttpOnly, Secure, SameSite=Lax cookie on
 * one origin; bearer tokens only when ENABLE_BEARER=true (Flutter, later).
 * Nobody signs themselves up: accounts come from invitations and the seed.
 * Settings: specs/identity/spec.md, "BetterAuth configuration".
 */
import { ac, roles } from '@waypoint/shared';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { admin, bearer, phoneNumber, username } from 'better-auth/plugins';
import { uuidv7 } from 'uuidv7';
import type { Database } from '../../../db/client';
import { accounts, sessions, users, verifications } from '../../../db/schema';
import { invitationSession } from './invitation-session.plugin';
import { loaderPin } from './loader-pin.plugin';

export const AUTH_BASE_PATH = '/api/auth';
const DAY_S = 86_400;

export interface AuthDeps {
  db: Database;
  secret: string;
  /** Public origin of the web app, which Caddy serves together with /api. */
  appUrl: string;
  trustedOrigins?: string[];
  enableBearer?: boolean;
  sendOtp: (phoneNumber: string, code: string) => Promise<void>;
}

export function createAuth(deps: AuthDeps) {
  return betterAuth({
    appName: 'Waypoint Compass',
    baseURL: deps.appUrl,
    basePath: AUTH_BASE_PATH,
    secret: deps.secret,
    trustedOrigins: deps.trustedOrigins,
    telemetry: { enabled: false },
    database: drizzleAdapter(deps.db, {
      provider: 'pg',
      usePlural: true,
      schema: { users, sessions, accounts, verifications },
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 10,
    },
    session: {
      expiresIn: 7 * DAY_S,
      updateAge: DAY_S,
      // No cookie cache: a cached session outlives its deleted row by up to
      // its maxAge, and a role or scope change must sign the user out at once
      // (AC-IDN-04). Every request reads the session row instead.
      cookieCache: { enabled: false },
    },
    user: {
      additionalFields: {
        depotId: { type: 'string', required: false, input: false },
        outletId: { type: 'string', required: false, input: false },
        defaultVehicleId: { type: 'string', required: false, input: false },
        pinHash: {
          type: 'string',
          required: false,
          input: false,
          returned: false,
        },
        locale: { type: 'string', required: false, defaultValue: 'en' },
      },
    },
    rateLimit: {
      // BetterAuth only limits in production by default; the limits are part
      // of the spec, so they apply everywhere (tests included).
      enabled: true,
      storage: 'memory',
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 60, max: 10 },
        '/sign-in/username': { window: 60, max: 10 },
        '/sign-in/pin': { window: 60, max: 5 },
        '/phone-number/send-otp': { window: 300, max: 3 },
      },
    },
    advanced: {
      useSecureCookies: true,
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax' },
      database: { generateId: () => uuidv7() },
    },
    // Users are never deleted, and nobody acts as someone else.
    disabledPaths: [
      '/admin/remove-user',
      '/admin/impersonate-user',
      '/admin/stop-impersonating',
    ],
    plugins: [
      username(),
      admin({ ac, roles, defaultRole: 'store_manager', adminRoles: ['admin'] }),
      phoneNumber({
        otpLength: 6,
        expiresIn: 300,
        allowedAttempts: 5,
        sendOTP: ({ phoneNumber: phone, code }) => deps.sendOtp(phone, code),
      }),
      loaderPin(deps.db),
      invitationSession(),
      ...(deps.enableBearer ? [bearer()] : []),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

import { randomBytes, randomInt } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { UserRole } from '@waypoint/shared';
import request, { type Response } from 'supertest';
import { uuidv7 } from 'uuidv7';
import type { Database } from '../src/db/client';
import { accounts, users } from '../src/db/schema';
import type { Auth } from '../src/modules/identity/auth/auth';
import { AUTH } from '../src/modules/identity/auth/auth.module';

export const TEST_PASSWORD = 'correct-horse-battery';

/** Error bodies: problem+json from /api/v1, BetterAuth's { code, message } from /api/auth. */
export interface Problem {
  code: string;
  message?: string;
  [member: string]: unknown;
}

/** A response body with the shape the test expects (supertest types it as any). */
export const bodyOf = <T = Record<string, unknown>>(res: Response): T =>
  res.body as T;

/**
 * A fresh client IP for each caller. BetterAuth rate-limits per IP and path,
 * so tests that are not about rate limits must not share a bucket.
 */
export const clientIp = () =>
  `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;

/** The request headers a browser on the web app's origin sends. */
export const browser = (ip = clientIp()) => ({
  'x-forwarded-for': ip,
  origin: process.env.APP_URL ?? 'http://localhost:8080',
});

/** The session cookie from a response, ready for a Cookie header ('' if none was set). */
export function sessionCookie(res: Response): string {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  return (raw ?? [])
    .map((c) => c.split(';')[0])
    .filter((c) => c.includes('session_token=') && !c.endsWith('='))
    .join('; ');
}

/** BetterAuth's password hasher, which also hashes loader PINs. */
export async function hashSecret(
  app: NestExpressApplication,
  secret: string,
): Promise<string> {
  const ctx = await app.get<Auth>(AUTH).$context;
  return ctx.password.hash(secret);
}

export interface TestUserInput {
  role: UserRole;
  name?: string;
  depotId?: string | null;
  outletId?: string | null;
  defaultVehicleId?: string | null;
  phoneNumber?: string | null;
  pin?: string;
}

export interface TestUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

/**
 * A user with a password account, shaped like BetterAuth's own rows. Inserted
 * as compass_owner because the scope columns are not client input.
 */
export async function createTestUser(
  app: NestExpressApplication,
  db: Database,
  input: TestUserInput,
): Promise<TestUser> {
  const id = uuidv7();
  const email = `${input.role}-${randomBytes(4).toString('hex')}@test.waypoint.local`;
  const name = input.name ?? `Test ${input.role}`;
  await db.insert(users).values({
    id,
    name,
    email,
    emailVerified: true,
    role: input.role,
    depotId: input.depotId ?? null,
    outletId: input.outletId ?? null,
    defaultVehicleId: input.defaultVehicleId ?? null,
    phoneNumber: input.phoneNumber ?? null,
    phoneNumberVerified: input.phoneNumber ? true : null,
    pinHash: input.pin ? await hashSecret(app, input.pin) : null,
  });
  await db.insert(accounts).values({
    id: uuidv7(),
    accountId: id,
    providerId: 'credential',
    userId: id,
    password: await hashSecret(app, TEST_PASSWORD),
  });
  return { id, name, email, role: input.role };
}

/** Signs in with email and password and returns the session cookie. */
export async function signIn(
  app: NestExpressApplication,
  email: string,
): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/auth/sign-in/email')
    .set(browser())
    .send({ email, password: TEST_PASSWORD })
    .expect(200);
  return sessionCookie(res);
}

/** A signed-in user of that role and scope: the user and their session cookie. */
export async function signedInAs(
  app: NestExpressApplication,
  db: Database,
  input: TestUserInput,
): Promise<TestUser & { cookie: string }> {
  const user = await createTestUser(app, db, input);
  return { ...user, cookie: await signIn(app, user.email) };
}

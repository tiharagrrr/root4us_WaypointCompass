/**
 * Dock sign-in (L1, L1m): POST /api/auth/sign-in/pin { depotId, pin, deviceId }.
 *
 * Only a registered dock device of that depot may use it (403
 * NOT_A_DOCK_DEVICE otherwise). The PIN is checked against every active
 * loader of the depot, home or extra (loader_depots), with the password
 * hasher; a match gets a normal session and cookie, anything else 401
 * WRONG_PIN. The route's rate limit (5 per 60 s) is set in auth.ts.
 */
import type { BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthEndpoint } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import { and, eq, exists, isNotNull, not, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../../../db/client';
import { devices, loaderDepots, users } from '../../../db/schema';

export const LOADER_PIN_ERRORS = {
  NOT_A_DOCK_DEVICE: 'This device is not a dock device for this depot.',
  WRONG_PIN: 'Wrong PIN',
} as const;

const body = z.object({
  depotId: z.string().min(1),
  pin: z.string().regex(/^\d{4}$/, 'The PIN is 4 digits'),
  deviceId: z.string().min(1),
});

export const loaderPin = (db: Database) =>
  ({
    id: 'loader-pin',
    endpoints: {
      signInPin: createAuthEndpoint(
        '/sign-in/pin',
        { method: 'POST', body },
        async (ctx) => {
          const { depotId, pin, deviceId } = ctx.body;

          const [device] = await db
            .select({ isDock: devices.isDockDevice, depotId: devices.depotId })
            .from(devices)
            .where(eq(devices.id, deviceId));
          if (!device?.isDock || device.depotId !== depotId) {
            throw new APIError('FORBIDDEN', {
              code: 'NOT_A_DOCK_DEVICE',
              message: LOADER_PIN_ERRORS.NOT_A_DOCK_DEVICE,
            });
          }

          const loaders = await db
            .select({ id: users.id, pinHash: users.pinHash })
            .from(users)
            .where(
              and(
                eq(users.role, 'loader'),
                isNotNull(users.pinHash),
                not(sql`coalesce(${users.banned}, false)`),
                or(
                  eq(users.depotId, depotId),
                  exists(
                    db
                      .select({ one: sql`1` })
                      .from(loaderDepots)
                      .where(
                        and(
                          eq(loaderDepots.userId, users.id),
                          eq(loaderDepots.depotId, depotId),
                        ),
                      ),
                  ),
                ),
              ),
            );
          let loaderId: string | undefined;
          for (const loader of loaders) {
            const ok = await ctx.context.password.verify({
              hash: loader.pinHash!,
              password: pin,
            });
            if (ok) {
              loaderId = loader.id;
              break;
            }
          }
          if (!loaderId) {
            throw new APIError('UNAUTHORIZED', {
              code: 'WRONG_PIN',
              message: LOADER_PIN_ERRORS.WRONG_PIN,
            });
          }

          const session =
            await ctx.context.internalAdapter.createSession(loaderId);
          const user = await ctx.context.internalAdapter.findUserById(loaderId);
          if (!session || !user) {
            throw new APIError('INTERNAL_SERVER_ERROR', {
              message: 'Could not create a session',
            });
          }
          await setSessionCookie(ctx, { session, user });
          return ctx.json({ user: { id: user.id, name: user.name } });
        },
      ),
    },
  }) satisfies BetterAuthPlugin;

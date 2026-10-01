/**
 * Demo user switch (the account menu): POST /api/auth/sign-in/demo { userId }.
 *
 * It signs the caller in **as** that user: the old session is replaced by a real session of the
 * chosen user, with their own role and scope. That is not impersonation — nobody acts on someone
 * else's behalf, and BetterAuth's impersonation routes stay disabled in auth.ts — it is the demo
 * equivalent of signing out and signing in again, without a password to type on stage.
 *
 * The plugin is registered only when DEMO_MODE=true, so outside demo mode the route does not
 * exist. It still needs a signed-in caller, and refuses deactivated users and accounts with no
 * Waypoint role. The switch is logged by the API's access log like any other sign-in.
 */
import type { BetterAuthPlugin } from 'better-auth';
import {
  APIError,
  createAuthEndpoint,
  sessionMiddleware,
} from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import { isUserRole } from '@waypoint/shared';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../../../db/client';
import { users } from '../../../db/schema';

export const DEMO_SWITCH_ERRORS = {
  NO_SUCH_USER: 'That demo user does not exist.',
  DEACTIVATED: 'That user is deactivated and cannot be signed in as.',
} as const;

const body = z.object({ userId: z.string().min(1) });

export const demoSwitch = (db: Database) =>
  ({
    id: 'demo-switch',
    endpoints: {
      signInDemo: createAuthEndpoint(
        '/sign-in/demo',
        { method: 'POST', body, use: [sessionMiddleware] },
        async (ctx) => {
          const [target] = await db
            .select({
              id: users.id,
              name: users.name,
              role: users.role,
              banned: users.banned,
            })
            .from(users)
            .where(eq(users.id, ctx.body.userId));

          if (!target || !isUserRole(target.role)) {
            throw new APIError('NOT_FOUND', {
              code: 'NO_SUCH_USER',
              message: DEMO_SWITCH_ERRORS.NO_SUCH_USER,
            });
          }
          if (target.banned) {
            throw new APIError('FORBIDDEN', {
              code: 'DEACTIVATED',
              message: DEMO_SWITCH_ERRORS.DEACTIVATED,
            });
          }

          const session = await ctx.context.internalAdapter.createSession(
            target.id,
          );
          const user = await ctx.context.internalAdapter.findUserById(
            target.id,
          );
          if (!session || !user) {
            throw new APIError('INTERNAL_SERVER_ERROR', {
              message: 'Could not create a session',
            });
          }
          await setSessionCookie(ctx, { session, user });
          return ctx.json({
            user: { id: target.id, name: target.name, role: target.role },
          });
        },
      ),
    },
  }) satisfies BetterAuthPlugin;

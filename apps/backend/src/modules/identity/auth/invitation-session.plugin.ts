/**
 * Signs in someone who has just accepted an invitation (AC-IDN-43, 46).
 *
 * SERVER_ONLY: better-call leaves the endpoint out of the /api/auth router,
 * so it exists only as auth.api.createInvitationSession for
 * InvitationsService, which calls it after checking the token and the
 * invitee's email and password or phone code. Never expose it over HTTP: it
 * creates a session for any user id.
 */
import type { BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthEndpoint } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import { z } from 'zod';

export const invitationSession = () =>
  ({
    id: 'invitation-session',
    endpoints: {
      createInvitationSession: createAuthEndpoint(
        '/invitation/session',
        {
          method: 'POST',
          body: z.object({ userId: z.string().min(1) }),
          metadata: { SERVER_ONLY: true },
        },
        async (ctx) => {
          const user = await ctx.context.internalAdapter.findUserById(
            ctx.body.userId,
          );
          const session =
            user && (await ctx.context.internalAdapter.createSession(user.id));
          if (!user || !session) {
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

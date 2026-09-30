import {
  createParamDecorator,
  type ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import type { Actor as SignedInActor, Permission } from '@waypoint/shared';
import { UnauthenticatedError } from '../errors/domain-errors';

/** Public route: no session needed. BetterAuth's AuthGuard and PermissionGuard skip it. */
export { AllowAnonymous } from '@thallesp/nestjs-better-auth';

/** Metadata key @AllowAnonymous() sets (from @thallesp/nestjs-better-auth). */
export const PUBLIC_KEY = 'PUBLIC';
export const PERMISSION_KEY = 'waypoint:permission';
export const ANY_ROLE = 'any';

/** What a route declares: a permission, or any signed-in role. */
export type RouteAccess = Permission | typeof ANY_ROLE;

/**
 * The route needs this permission; PermissionGuard answers 403 FORBIDDEN
 * without it. Every route declares exactly one of @RequirePermission,
 * @AnyRole or @AllowAnonymous; a route with none is refused.
 */
export const RequirePermission = (permission: Permission) =>
  SetMetadata(PERMISSION_KEY, permission);

/** Any signed-in role may call the route; its queries still apply the actor's scope. */
export const AnyRole = () => SetMetadata(PERMISSION_KEY, ANY_ROLE);

/** The signed-in actor, built by ActorGuard. */
export type Actor = SignedInActor;
export const Actor = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): SignedInActor => {
    const actor = ctx
      .switchToHttp()
      .getRequest<{ actor?: SignedInActor }>().actor;
    if (!actor) throw new UnauthenticatedError();
    return actor;
  },
);

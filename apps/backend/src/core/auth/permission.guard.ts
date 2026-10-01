import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { can } from '@waypoint/shared';
import { ForbiddenError, UnauthenticatedError } from '../errors/domain-errors';
import {
  ANY_ROLE,
  PERMISSION_KEY,
  PUBLIC_KEY,
  type RouteAccess,
} from '../http/decorators';
import type { ActorRequest } from './actor.guard';

/**
 * Step 5 of the request lifecycle: checks the route's @RequirePermission
 * against the shared matrix and answers 403 before the controller runs.
 * Scope is not checked here: out-of-scope rows are the ScopePolicy's 404.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    if (ctx.getType() !== 'http') return true;
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets))
      return true;

    const actor = ctx.switchToHttp().getRequest<ActorRequest>().actor;
    if (!actor) throw new UnauthenticatedError();

    const access = this.reflector.getAllAndOverride<RouteAccess | undefined>(
      PERMISSION_KEY,
      targets,
    );
    if (access === ANY_ROLE) return true;
    // Fail closed: a route that forgot to declare its permission is refused.
    if (!access) throw new ForbiddenError('This route declares no permission.');
    if (!can(actor, access)) throw new ForbiddenError();
    return true;
  }
}

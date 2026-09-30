import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { type Actor, isUserRole } from '@waypoint/shared';
import type { Request } from 'express';
import { ForbiddenError } from '../errors/domain-errors';

/** The session user BetterAuth's AuthGuard puts on the request, with Waypoint's fields. */
export interface SessionUser {
  id: string;
  name: string;
  role?: string | null;
  depotId?: string | null;
  outletId?: string | null;
  defaultVehicleId?: string | null;
}

export type ActorRequest = Request & {
  user?: SessionUser | null;
  actor?: Actor;
};

/**
 * Step 4 of the request lifecycle: turns the session BetterAuth resolved into
 * the Actor (id, role, scope, device) that PermissionGuard, @Actor() and the
 * scope policies read. Public routes with no session pass through with no
 * actor. ROO-7 also puts the actor into CLS and the logger context.
 */
@Injectable()
export class ActorGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    if (ctx.getType() !== 'http') return true;
    const req = ctx.switchToHttp().getRequest<ActorRequest>();
    if (req.user) req.actor = toActor(req.user, req.header('x-device-id'));
    return true;
  }
}

export function toActor(user: SessionUser, deviceId?: string): Actor {
  if (!isUserRole(user.role))
    throw new ForbiddenError('This account has no Waypoint role.');
  return {
    id: user.id,
    name: user.name,
    role: user.role,
    depotId: user.depotId ?? null,
    outletId: user.outletId ?? null,
    vehicleId: user.defaultVehicleId ?? null,
    deviceId: deviceId || null,
  };
}

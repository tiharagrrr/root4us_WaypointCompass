import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { type Actor, isUserRole } from '@waypoint/shared';
import type { Request } from 'express';
import { ClsService } from 'nestjs-cls';
import { PinoLogger } from 'nestjs-pino';
import { type AppClsStore, deviceIdOf } from '../context/request-context';
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
 * scope policies read, and puts it into CLS (which stamps the request's
 * transaction for row-level security) and into the request's log lines.
 * Public routes with no session pass through with no actor.
 */
@Injectable()
export class ActorGuard implements CanActivate {
  constructor(
    private readonly cls: ClsService<AppClsStore>,
    private readonly log: PinoLogger,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    if (ctx.getType() !== 'http') return true;
    const req = ctx.switchToHttp().getRequest<ActorRequest>();
    if (!req.user) return true;
    const actor = toActor(req.user, deviceIdOf(req) ?? undefined);
    req.actor = actor;
    if (this.cls.isActive()) this.cls.set('actor', actor);
    try {
      // No names: the log carries ids and the role only.
      this.log.assign({
        actor: { id: actor.id, role: actor.role, depotId: actor.depotId },
      });
    } catch {
      // Outside pino-http's request scope (a route it excludes): nothing to tag.
    }
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

import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Actor } from '@waypoint/shared';
import {
  AllowAnonymous,
  AnyRole,
  RequirePermission,
} from '../../http/decorators';
import {
  ForbiddenError,
  UnauthenticatedError,
} from '../../errors/domain-errors';
import { PermissionGuard } from '../permission.guard';

class Routes {
  @RequirePermission('plan:publish')
  publish() {}

  @AnyRole()
  me() {}

  @AllowAnonymous()
  health() {}

  undeclared() {}
}

const actor = (role: Actor['role']): Actor => ({
  id: 'u1',
  name: 'Test',
  role,
  depotId: null,
  outletId: null,
  vehicleId: null,
  deviceId: null,
});

function context(route: keyof Routes, who?: Actor): ExecutionContext {
  return {
    getType: () => 'http',
    getHandler: () =>
      (Routes.prototype as unknown as Record<string, unknown>)[route],
    getClass: () => Routes,
    switchToHttp: () => ({ getRequest: () => ({ actor: who }) }),
  } as unknown as ExecutionContext;
}

describe('PermissionGuard', () => {
  const guard = new PermissionGuard(new Reflector());

  it('lets a role through that holds the permission', () => {
    expect(guard.canActivate(context('publish', actor('dispatcher')))).toBe(
      true,
    );
  });

  it('answers 403 when the role lacks the permission', () => {
    expect(() =>
      guard.canActivate(context('publish', actor('store_manager'))),
    ).toThrow(ForbiddenError);
  });

  it('lets every signed-in role call an @AnyRole route', () => {
    expect(guard.canActivate(context('me', actor('driver')))).toBe(true);
  });

  it('answers 401 with no actor on a signed-in route', () => {
    expect(() => guard.canActivate(context('me'))).toThrow(
      UnauthenticatedError,
    );
  });

  it('lets anyone call a public route', () => {
    expect(guard.canActivate(context('health'))).toBe(true);
  });

  it('refuses a route that declares no permission', () => {
    expect(() =>
      guard.canActivate(context('undeclared', actor('admin'))),
    ).toThrow(ForbiddenError);
  });
});

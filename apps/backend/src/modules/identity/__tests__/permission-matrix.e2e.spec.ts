import {
  Injectable,
  type NestInterceptor,
  RequestMethod,
  type Type,
} from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { APP_INTERCEPTOR, ModulesContainer, Reflector } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { can, USER_ROLES, type UserRole } from '@waypoint/shared';
import { of } from 'rxjs';
import request from 'supertest';
import {
  bodyOf,
  browser,
  signedInAs,
  type Problem,
} from '../../../../test/auth';
import {
  createTestApp,
  describeWithDb,
  ownerDatabase,
} from '../../../../test/create-test-app';
import { API_PREFIX, UNPREFIXED_ROUTES } from '../../../app.setup';
import {
  ANY_ROLE,
  PERMISSION_KEY,
  PUBLIC_KEY,
  type RouteAccess,
} from '../../../core/http/decorators';

/**
 * Ends every request the guards let through with 200 before pipes or the
 * handler run, so calling every route as every role changes nothing.
 */
@Injectable()
class StopBeforeHandler implements NestInterceptor {
  intercept() {
    return of({ reachedHandler: true });
  }
}

interface Route {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  path: string;
  access: RouteAccess | 'public' | undefined;
  declarations: number;
}

const VERBS: Partial<Record<RequestMethod, Route['method']>> = {
  [RequestMethod.GET]: 'get',
  [RequestMethod.POST]: 'post',
  [RequestMethod.PUT]: 'put',
  [RequestMethod.PATCH]: 'patch',
  [RequestMethod.DELETE]: 'delete',
};

const PLACEHOLDER_ID = '0192a3f4-0000-7000-8000-000000000001';

const asList = (value: unknown): string[] =>
  (Array.isArray(value) ? value : [value ?? '']).map(String);

/** Every controller route in the app, with what it declares, from the decorator metadata. */
function routesOf(app: NestExpressApplication): Route[] {
  const reflector = app.get(Reflector);
  const controllers = [...app.get(ModulesContainer).values()].flatMap((m) =>
    [...m.controllers.values()].map((w) => w.metatype as Type),
  );
  return controllers.flatMap((controller) => {
    const proto = controller.prototype as Record<string, unknown>;
    return Object.getOwnPropertyNames(proto).flatMap((name) => {
      const handler = proto[name];
      if (typeof handler !== 'function' || name === 'constructor') return [];
      const methodPaths: unknown = Reflect.getMetadata(PATH_METADATA, handler);
      const verb =
        VERBS[Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod];
      if (methodPaths === undefined || !verb) return [];

      const targets = [handler, controller];
      const isPublic = reflector.getAllAndOverride<boolean>(
        PUBLIC_KEY,
        targets,
      );
      const permission = reflector.getAllAndOverride<RouteAccess>(
        PERMISSION_KEY,
        targets,
      );
      const access = isPublic ? 'public' : permission;
      const declarations =
        Number(Boolean(isPublic)) + Number(Boolean(permission));

      return asList(Reflect.getMetadata(PATH_METADATA, controller)).flatMap(
        (base) =>
          asList(methodPaths).map((own) => {
            const local = [base, own]
              .join('/')
              .split('/')
              .filter(Boolean)
              .join('/');
            const prefixed = UNPREFIXED_ROUTES.includes(local)
              ? local
              : `${API_PREFIX}/${local}`;
            const path = `/${prefixed}`
              .replace(/\/$/, '')
              .replace(/:\w+/g, PLACEHOLDER_ID);
            return { method: verb, path: path || '/', access, declarations };
          }),
      );
    });
  });
}

const allowed = (role: UserRole, access: Route['access']) =>
  access === 'public' ||
  access === ANY_ROLE ||
  (!!access && can({ role }, access));

describeWithDb('permission matrix on the routes', () => {
  jest.setTimeout(60_000);

  let app: NestExpressApplication;
  let close: () => Promise<void>;
  const cookies = {} as Record<UserRole, string>;

  beforeAll(async () => {
    app = await createTestApp({
      providers: [{ provide: APP_INTERCEPTOR, useClass: StopBeforeHandler }],
    });
    const owner = ownerDatabase();
    close = owner.close;
    for (const role of USER_ROLES) {
      cookies[role] = (await signedInAs(app, owner.db, { role })).cookie;
    }
  });

  afterAll(async () => {
    await close();
    await app.close();
  });

  it('AC-IDN-60 routes match the permission matrix', async () => {
    const routes = routesOf(app);
    expect(routes.length).toBeGreaterThan(0);

    // Every route says who may call it, exactly once.
    const undeclared = routes.filter((r) => r.declarations !== 1);
    expect(
      undeclared.map((r) => `${r.method.toUpperCase()} ${r.path}`),
    ).toEqual([]);

    const mismatches: string[] = [];
    for (const route of routes) {
      for (const role of USER_ROLES) {
        const res = await request(app.getHttpServer())
          [route.method](route.path)
          .set(browser())
          .set('Cookie', cookies[role])
          .send({});
        const expected = allowed(role, route.access) ? '2xx' : '403';
        const actual =
          res.status >= 200 && res.status < 300
            ? '2xx'
            : res.status === 403 && bodyOf<Problem>(res).code === 'FORBIDDEN'
              ? '403'
              : String(res.status);
        if (actual !== expected) {
          mismatches.push(
            `${route.method.toUpperCase()} ${route.path} as ${role}: expected ${expected}, got ${res.status}`,
          );
        }
      }
    }
    expect(mismatches).toEqual([]);
  });
});

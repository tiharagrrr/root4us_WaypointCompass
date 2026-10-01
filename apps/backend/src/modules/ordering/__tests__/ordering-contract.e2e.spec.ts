import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import {
  bodyOf,
  browser,
  type Problem,
  signedInAs,
} from '../../../../test/auth';
import {
  createTestApp,
  describeWithDb,
  ownerDatabase,
} from '../../../../test/create-test-app';
import { depotFixture, outletFixture, suffix } from '../../../../test/fixtures';
import type { Database } from '../../../db/client';

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

interface RouteCase {
  method: Method;
  path: string;
  body?: Record<string, unknown>;
}

interface RefusedCase extends RouteCase {
  role: 'driver' | 'dispatcher';
  permission: string;
}

const ORDER_ID = '0192a3f4-7c1e-7a2b-9d3e-5f6a7b8c9d0e';
const LINE_ID = '0192a3f4-0000-7000-8000-00000000a001';
const ITEM_ID = '0192a3f4-0000-7000-8000-00000000b001';
const LINE = { itemId: ITEM_ID, qty: 12 };

/** Every route M1, M1a, M1b and M2 call (specs/ordering/spec.md, Endpoints). */
const SLICE: RouteCase[] = [
  { method: 'get', path: '/orders' },
  { method: 'get', path: `/orders/${ORDER_ID}` },
  {
    method: 'post',
    path: '/orders',
    body: { tempClass: 'AMBIENT', requestedDate: '2026-10-02' },
  },
  { method: 'post', path: `/orders/${ORDER_ID}/submit`, body: {} },
  {
    method: 'post',
    path: `/orders/${ORDER_ID}/save-as-template`,
    body: { name: 'Weekday top-up' },
  },
  { method: 'get', path: `/orders/${ORDER_ID}/lines` },
  { method: 'put', path: `/orders/${ORDER_ID}/lines`, body: { lines: [LINE] } },
  { method: 'post', path: `/orders/${ORDER_ID}/lines`, body: LINE },
  {
    method: 'patch',
    path: `/orders/${ORDER_ID}/lines/${LINE_ID}`,
    body: { qty: 14 },
  },
  { method: 'delete', path: `/orders/${ORDER_ID}/lines/${LINE_ID}` },
  { method: 'get', path: '/order-templates' },
  {
    method: 'post',
    path: '/order-templates',
    body: { name: 'Weekday top-up', tempClass: 'AMBIENT', lines: [LINE] },
  },
];

const REFUSED: RefusedCase[] = [
  { role: 'driver', permission: 'order:read', method: 'get', path: '/orders' },
  {
    role: 'dispatcher',
    permission: 'order:create',
    method: 'post',
    path: '/orders',
  },
  {
    role: 'dispatcher',
    permission: 'order:submit',
    method: 'post',
    path: `/orders/${ORDER_ID}/submit`,
  },
  {
    role: 'dispatcher',
    permission: 'order:update',
    method: 'put',
    path: `/orders/${ORDER_ID}/lines`,
  },
  {
    role: 'dispatcher',
    permission: 'order:create',
    method: 'get',
    path: '/order-templates',
  },
];

/**
 * The ordering contract, before its services exist: every route of the M1 slice is mounted with
 * its permission, its If-Match rule and its DTO, and answers an allowed caller 501 (the
 * contract-first skill). The behaviour tests arrive with the services, named AC-ORD-nn.
 */
describeWithDb('ordering contract', () => {
  jest.setTimeout(30_000);

  const sfx = suffix();
  let app: NestExpressApplication;
  let db: Database;
  let close: () => Promise<void>;
  const cookies: Record<string, string> = {};

  beforeAll(async () => {
    app = await createTestApp();
    ({ db, close } = ownerDatabase());
    const depot = await depotFixture(db, sfx);
    const outlet = await outletFixture(db, `OUT${sfx}`, {
      depotId: depot.plg,
      districtId: depot.plgDistrict,
    });
    cookies.store_manager = (
      await signedInAs(app, db, { role: 'store_manager', outletId: outlet })
    ).cookie;
    cookies.driver = (await signedInAs(app, db, { role: 'driver' })).cookie;
    cookies.dispatcher = (
      await signedInAs(app, db, { role: 'dispatcher', depotId: depot.plg })
    ).cookie;
  });

  afterAll(async () => {
    await close();
    await app.close();
  });

  const call = (route: RouteCase, cookie: string) =>
    request(app.getHttpServer())
      [route.method](`/api/v1${route.path}`)
      .set(browser())
      .set('Cookie', cookie)
      .set('If-Match', 'W/"1"')
      .send(route.body ?? {});

  it.each(SLICE)('$method $path is mounted and answers 501', async (route) => {
    const res = await call(route, cookies.store_manager);

    expect(res.status).toBe(501);
  });

  it.each(REFUSED)(
    'a $role has no $permission, so $method $path answers 403',
    async (route) => {
      const res = await call(route, cookies[route.role]);

      expect(res.status).toBe(403);
      expect(bodyOf<Problem>(res).code).toBe('FORBIDDEN');
    },
  );

  it('a versioned write without If-Match answers 428', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/orders/${ORDER_ID}/submit`)
      .set(browser())
      .set('Cookie', cookies.store_manager)
      .send({});

    expect(res.status).toBe(428);
    expect(bodyOf<Problem>(res).code).toBe('PRECONDITION_REQUIRED');
  });

  it('an outletId in the body is refused, as AC-ORD-10 asks', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/orders')
      .set(browser())
      .set('Cookie', cookies.store_manager)
      .send({
        tempClass: 'AMBIENT',
        requestedDate: '2026-10-02',
        outletId: 'OUT014',
      });

    expect(res.status).toBe(400);
    expect(bodyOf<Problem>(res).code).toBe('VALIDATION_FAILED');
  });
});

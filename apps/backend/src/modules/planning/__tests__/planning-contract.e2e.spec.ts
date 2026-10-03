import type { NestExpressApplication } from '@nestjs/platform-express';
import type { UserRole } from '@waypoint/shared';
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

type Method = 'get' | 'post';

interface Route {
  method: Method;
  path: string;
  body?: Record<string, unknown>;
  /** A role the permission matrix lets through, and one it refuses. */
  allowed: UserRole;
  refused: UserRole;
}

const PLAN = '0192a3f4-7c1e-7a2b-9d3e-5f6a7b8c9d0e';
const RUN = '0192a3f4-0000-7000-8000-00000000e001';
const ORDER = '0192a3f4-0000-7000-8000-00000000a001';
const DEFERRAL = '0192a3f4-0000-7000-8000-00000000a101';
const VIOLATION = {
  rule: 'CAP_VOLUME',
  severity: 'HARD',
  scope: 'trip',
  tripKey: 'REF-07#1',
  message: 'Over volume by 0.42 m³',
};

/** Every route of the planning contract (specs/planning/spec.md, Endpoints), ROO-29. */
const ROUTES: Route[] = [
  {
    method: 'get',
    path: '/depots/PLG/plans/2026-10-02',
    allowed: 'dispatcher',
    refused: 'store_manager',
  },
  {
    method: 'get',
    path: `/plans/${PLAN}`,
    allowed: 'admin',
    refused: 'store_manager',
  },
  {
    method: 'get',
    path: `/plans/${PLAN}/trips`,
    allowed: 'dispatcher',
    refused: 'loader',
  },
  {
    method: 'get',
    path: `/plans/${PLAN}/context`,
    allowed: 'dispatcher',
    refused: 'driver',
  },
  {
    method: 'get',
    path: `/plans/${PLAN}/unplanned`,
    allowed: 'dispatcher',
    refused: 'store_manager',
  },
  {
    method: 'get',
    path: `/plans/${PLAN}/revisions`,
    allowed: 'admin',
    refused: 'loader',
  },
  {
    method: 'post',
    path: `/plans/${PLAN}/engine-runs`,
    body: { mode: 'AUTO_SUGGEST', keepLocked: true },
    allowed: 'dispatcher',
    refused: 'loader',
  },
  {
    method: 'get',
    path: `/plans/${PLAN}/engine-runs/${RUN}`,
    allowed: 'admin',
    refused: 'driver',
  },
  {
    method: 'get',
    path: `/plans/${PLAN}/vehicle-options`,
    allowed: 'dispatcher',
    refused: 'admin',
  },
  {
    method: 'get',
    path: `/plans/${PLAN}/order-options?vehicleId=VEH014&tripNo=1`,
    allowed: 'dispatcher',
    refused: 'admin',
  },
  {
    method: 'post',
    path: `/plans/${PLAN}/validate`,
    body: { ops: [{ op: 'UNASSIGN_ORDER', orderId: ORDER }] },
    allowed: 'admin',
    refused: 'store_manager',
  },
  {
    method: 'post',
    path: `/plans/${PLAN}/edits`,
    body: { ops: [{ op: 'REMOVE_TRIP', tripKey: 'REF-07#2' }] },
    allowed: 'dispatcher',
    refused: 'admin',
  },
  {
    method: 'post',
    path: `/plans/${PLAN}/suggest-fixes`,
    body: { violation: VIOLATION },
    allowed: 'dispatcher',
    refused: 'admin',
  },
  {
    method: 'post',
    path: `/plans/${PLAN}/deferrals/decisions`,
    body: {
      decisions: [
        {
          orderId: ORDER,
          action: 'DEFER',
          reasonCode: 'OVER_CAPACITY',
          note: 'Tomorrow',
        },
      ],
    },
    allowed: 'dispatcher',
    refused: 'driver',
  },
  {
    method: 'get',
    path: `/plans/${PLAN}/publish-preview`,
    allowed: 'dispatcher',
    refused: 'admin',
  },
  {
    method: 'post',
    path: `/plans/${PLAN}/publish`,
    allowed: 'dispatcher',
    refused: 'admin',
  },
  {
    method: 'get',
    path: '/deferrals',
    allowed: 'store_manager',
    refused: 'driver',
  },
  {
    method: 'get',
    path: `/deferrals/${DEFERRAL}`,
    allowed: 'dispatcher',
    refused: 'loader',
  },
  {
    method: 'post',
    path: `/deferrals/${DEFERRAL}/response`,
    body: { response: 'ACKNOWLEDGED' },
    allowed: 'store_manager',
    refused: 'dispatcher',
  },
  {
    method: 'post',
    path: `/deferrals/${DEFERRAL}/reverse`,
    body: { reason: 'Delivered while offline' },
    allowed: 'dispatcher',
    refused: 'store_manager',
  },
];

/**
 * The planning contract: every route is mounted with its permission, its
 * If-Match rule and its request DTO. What each plan route does with a real
 * plan is the AC-PLN-nn suites; the deferral routes answer 501 until theirs
 * land.
 */
describeWithDb('planning contract', () => {
  jest.setTimeout(60_000);

  const sfx = suffix();
  let app: NestExpressApplication;
  let db: Database;
  let close: () => Promise<void>;
  const cookies = {} as Record<UserRole, string>;

  beforeAll(async () => {
    app = await createTestApp();
    ({ db, close } = ownerDatabase());
    const depot = await depotFixture(db, sfx);
    const outlet = await outletFixture(db, `OUT${sfx}`, {
      depotId: depot.plg,
      districtId: depot.plgDistrict,
    });
    const scope: Record<UserRole, { depotId?: string; outletId?: string }> = {
      admin: {},
      dispatcher: { depotId: depot.plg },
      loader: { depotId: depot.plg },
      driver: { depotId: depot.plg },
      store_manager: { outletId: outlet },
    };
    for (const role of Object.keys(scope) as UserRole[])
      cookies[role] = (
        await signedInAs(app, db, { role, ...scope[role] })
      ).cookie;
  });

  afterAll(async () => {
    await close();
    await app.close();
  });

  const call = (
    route: Route,
    role: UserRole,
    headers: Record<string, string> = {},
  ) =>
    request(app.getHttpServer())
      [route.method](`/api/v1${route.path}`)
      .set(browser())
      .set('Cookie', cookies[role])
      .set('If-Match', 'W/"7"')
      .set(headers)
      .send(route.body ?? {});

  // The plan routes are implemented (ROO-29); the deferral routes for 23, M4
  // and M7 still answer 501 until their services land.
  const stillContract = (route: Route) => route.path.startsWith('/deferrals');

  it.each(ROUTES)('$method $path is mounted for a $allowed', async (route) => {
    const res = await call(route, route.allowed);
    // The plan id above belongs to nothing, so a plan route answers 404;
    // what none may answer any more is 501.
    if (stillContract(route)) expect(res.status).toBe(501);
    else expect([200, 404]).toContain(res.status);
  });

  it.each(ROUTES)(
    '$method $path refuses a $refused with 403',
    async (route) => {
      const res = await call(route, route.refused);
      expect(res.status).toBe(403);
      expect(bodyOf<Problem>(res).code).toBe('FORBIDDEN');
    },
  );

  it('a plan write without If-Match answers 428', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/plans/${PLAN}/publish`)
      .set(browser())
      .set('Cookie', cookies.dispatcher);
    expect(res.status).toBe(428);
    expect(bodyOf<Problem>(res).code).toBe('PRECONDITION_REQUIRED');
  });

  it('refuses a request body the contract does not accept with 400', async () => {
    const bad: Route[] = [
      { ...ROUTES[6], body: { mode: 'SOMETIMES', keepLocked: true } },
      { ...ROUTES[11], body: { ops: [] } },
      {
        ...ROUTES[13],
        body: {
          decisions: [{ orderId: ORDER, action: 'MAYBE', reasonCode: 'X' }],
        },
      },
      { ...ROUTES[0], path: '/depots/PLG/plans/02-10-2026' },
      {
        ...ROUTES[9],
        path: `/plans/${PLAN}/order-options?vehicleId=VEH014&tripNo=3`,
      },
    ];
    for (const route of bad) {
      const res = await call(route, route.allowed);
      expect({ path: route.path, status: res.status }).toEqual({
        path: route.path,
        status: 400,
      });
    }
  });
});

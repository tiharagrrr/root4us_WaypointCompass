import type { NestExpressApplication } from '@nestjs/platform-express';
import type { UserRole } from '@waypoint/shared';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { browser, createTestUser, signedInAs } from '../../../../test/auth';
import {
  createTestApp,
  describeWithDb,
  ownerDatabase,
} from '../../../../test/create-test-app';
import {
  depotFixture,
  deviceFixture,
  outletFixture,
  suffix,
} from '../../../../test/fixtures';
import { expectProblem } from '../../../../test/kernel';
import type { Database } from '../../../db/client';
import {
  auditEvents,
  devices,
  invitations,
  outboxEvents,
  users,
} from '../../../db/schema';

describeWithDb('admin routes', () => {
  jest.setTimeout(60_000);

  const sfx = suffix();
  let app: NestExpressApplication;
  let db: Database;
  let close: () => Promise<void>;
  let depot: Awaited<ReturnType<typeof depotFixture>>;
  let outlet: string;

  beforeAll(async () => {
    app = await createTestApp();
    ({ db, close } = ownerDatabase());
    depot = await depotFixture(db, sfx);
    outlet = await outletFixture(db, `OUT-${sfx}`, {
      depotId: depot.plg,
      districtId: depot.plgDistrict,
    });
  });

  afterAll(async () => {
    await close();
    await app.close();
  });

  it('AC-IDN-29 non-admins are refused admin routes', async () => {
    const target = await createTestUser(app, db, {
      role: 'loader',
      depotId: depot.plg,
    });
    const tablet = await deviceFixture(db, `T-${sfx}`);
    const correlationId = `ac-idn-29-${sfx}`;
    const before = {
      user: (await db.select().from(users).where(eq(users.id, target.id)))[0],
      device: (
        await db.select().from(devices).where(eq(devices.id, tablet))
      )[0],
    };
    const inviteEmail = `refused-${sfx}@waypoint.lk`;

    const callers: { role: UserRole; scope: object }[] = [
      { role: 'dispatcher', scope: {} },
      { role: 'store_manager', scope: { outletId: outlet } },
      { role: 'loader', scope: { depotId: depot.plg } },
      { role: 'driver', scope: { depotId: depot.plg } },
    ];
    for (const { role, scope } of callers) {
      const caller = await signedInAs(app, db, { role, ...scope });
      const server = app.getHttpServer();
      const call = (method: 'get' | 'post' | 'put' | 'patch', path: string) =>
        request(server)
          [method](path)
          .set(browser())
          .set('Cookie', caller.cookie)
          .set('x-correlation-id', correlationId);

      const refused = [
        await call('get', '/api/v1/users'),
        await call('patch', `/api/v1/users/${target.id}`).send({
          role: 'dispatcher',
          reasonCode: 'PROMOTION',
        }),
        await call('post', `/api/v1/users/${target.id}/deactivate`).send({}),
        await call('put', `/api/v1/users/${target.id}/pin`).send({
          pin: '1234',
        }),
        await call('post', '/api/v1/invitations').send({
          name: 'Refused',
          role: 'dispatcher',
          email: inviteEmail,
        }),
        await call('put', `/api/v1/devices/${tablet}/dock`).send({
          depotId: depot.plg,
        }),
        await call('put', '/api/v1/settings/ordering.cutoffReminderMin').send({
          value: 945,
        }),
        await call('put', '/api/v1/clock').send({ mode: 'real' }),
        await call('post', '/api/v1/demo/reset').send({}),
      ];
      const routes = [
        'GET /users',
        'PATCH /users/{id}',
        'POST /users/{id}/deactivate',
        'PUT /users/{id}/pin',
        'POST /invitations',
        'PUT /devices/{id}/dock',
        'PUT /settings/{key}',
        'PUT /clock',
        'POST /demo/reset',
      ];
      refused.forEach((res, i) => {
        expect({ role, route: routes[i], status: res.status }).toEqual({
          role,
          route: routes[i],
          status: 403,
        });
        expectProblem(res, 'FORBIDDEN');
      });

      const settingsRes = await call('get', '/api/v1/settings');
      expect({ role, status: settingsRes.status }).toEqual({
        role,
        status: role === 'dispatcher' ? 200 : 403,
      });
    }

    expect(
      (await db.select().from(users).where(eq(users.id, target.id)))[0],
    ).toEqual(before.user);
    expect(
      (await db.select().from(devices).where(eq(devices.id, tablet)))[0],
    ).toEqual(before.device);
    expect(
      await db.$count(invitations, eq(invitations.email, inviteEmail)),
    ).toBe(0);
    expect(
      await db.$count(
        auditEvents,
        eq(auditEvents.correlationId, correlationId),
      ),
    ).toBe(0);
    expect(
      await db.$count(
        outboxEvents,
        eq(outboxEvents.correlationId, correlationId),
      ),
    ).toBe(0);
  });

  it('AC-IDN-30 no session gets 401', async () => {
    for (const path of ['/api/v1/users', '/api/v1/me']) {
      const res = await request(app.getHttpServer()).get(path).set(browser());
      expect(res.status).toBe(401);
      expectProblem(res, 'UNAUTHENTICATED');
    }
  });
});

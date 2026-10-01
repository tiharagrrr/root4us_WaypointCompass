import type { NestExpressApplication } from '@nestjs/platform-express';
import { permissionsOf } from '@waypoint/shared';
import { eq } from 'drizzle-orm';
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
import { depotFixture, outletFixture, suffix } from '../../../../test/fixtures';
import type { Database } from '../../../db/client';
import { users } from '../../../db/schema';
import type { DeviceDto } from '../dto/device.dto';
import type { MeDto } from '../dto/me.dto';

describeWithDb('/me', () => {
  jest.setTimeout(30_000);

  const sfx = suffix();
  let app: NestExpressApplication;
  let db: Database;
  let close: () => Promise<void>;
  let nimesha: Awaited<ReturnType<typeof signedInAs>>;
  let aniqa: Awaited<ReturnType<typeof signedInAs>>;
  let kadawatha: string;
  let otherOutlet: string;

  const api = (cookie: string) => {
    const server = app.getHttpServer();
    const withAuth = <T extends request.Test>(r: T) =>
      r.set(browser()).set('Cookie', cookie);
    return {
      get: (path: string) => withAuth(request(server).get(path)),
      patch: (path: string, body: object) =>
        withAuth(request(server).patch(path)).send(body),
      post: (path: string, body: object) =>
        withAuth(request(server).post(path)).send(body),
    };
  };

  beforeAll(async () => {
    app = await createTestApp();
    ({ db, close } = ownerDatabase());
    const depot = await depotFixture(db, sfx);
    const inPlg = { depotId: depot.plg, districtId: depot.plgDistrict };
    kadawatha = await outletFixture(db, `OUT014-${sfx}`, inPlg);
    otherOutlet = await outletFixture(db, `OUT015-${sfx}`, inPlg);
    nimesha = await signedInAs(app, db, {
      role: 'store_manager',
      name: 'Nimesha Periyapperuma',
      outletId: kadawatha,
    });
    aniqa = await signedInAs(app, db, {
      role: 'driver',
      name: 'Aniqa Razick',
      depotId: depot.plg,
    });
  });

  afterAll(async () => {
    await close();
    await app.close();
  });

  it('AC-IDN-22 /me shows role, scope and permissions', async () => {
    const res = await api(nimesha.cookie).get('/api/v1/me').expect(200);
    const me = bodyOf<{ data: MeDto }>(res).data;

    expect(me).toMatchObject({
      name: 'Nimesha Periyapperuma',
      role: 'store_manager',
      outletId: kadawatha,
      locale: 'en',
    });
    expect(me.permissions).toEqual(permissionsOf('store_manager'));
    expect(me.permissions).toContain('order:submit');
    expect(me.permissions).not.toContain('plan:publish');
    expect(me).not.toHaveProperty('pinHash');
  });

  it('AC-IDN-23 a user changes their own locale', async () => {
    const res = await api(aniqa.cookie)
      .patch('/api/v1/me', { locale: 'si' })
      .expect(200);
    expect(bodyOf<{ data: MeDto }>(res).data.locale).toBe('si');
  });

  it('AC-IDN-24 /me refuses role and scope edits', async () => {
    for (const [field, value] of [
      ['role', 'admin'],
      ['outletId', otherOutlet],
    ] as const) {
      const res = await api(nimesha.cookie).patch('/api/v1/me', {
        [field]: value,
      });
      expect(res.status).toBe(400);
      const problem = bodyOf<Problem & { errors: { field: string }[] }>(res);
      expect(problem.code).toBe('VALIDATION_FAILED');
      expect(problem.errors.map((e) => e.field)).toEqual([field]);
    }

    const [row] = await db
      .select({ role: users.role, outletId: users.outletId })
      .from(users)
      .where(eq(users.id, nimesha.id));
    expect(row).toEqual({ role: 'store_manager', outletId: kadawatha });
  });

  it('AC-IDN-25 a device registers itself', async () => {
    const P2 = `P2-${sfx}`;
    await api(aniqa.cookie)
      .post('/api/v1/me/devices', {
        id: P2,
        platform: 'PWA',
        appVersion: '0.1.0',
      })
      .expect(201);

    const res = await api(aniqa.cookie).get('/api/v1/me/devices').expect(200);
    const devices = bodyOf<{ data: DeviceDto[] }>(res).data;
    expect(devices).toEqual([
      expect.objectContaining({
        id: P2,
        platform: 'PWA',
        appVersion: '0.1.0',
        isDockDevice: false,
      }),
    ]);
  });
});

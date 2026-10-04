import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Link } from '@waypoint/shared';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import {
  bodyOf,
  browser,
  createTestUser,
  signedInAs,
  signIn,
  signInAsBrowser,
} from '../../../../test/auth';
import {
  createTestApp,
  describeWithDb,
  ownerDatabase,
} from '../../../../test/create-test-app';
import {
  depotFixture,
  deviceFixture,
  suffix,
  tripFixture,
} from '../../../../test/fixtures';
import { expectProblem, freezeClock } from '../../../../test/kernel';
import { ClockService } from '../../../core/clock/clock.service';
import type { Database } from '../../../db/client';
import { auditEvents, outboxEvents, sessions, users } from '../../../db/schema';
import { AUTH } from '../auth/auth.module';
import type { Auth } from '../auth/auth';

interface UserBody {
  id: string;
  role: string;
  depotId: string | null;
  banned: boolean;
  _links: Record<string, Link>;
}

interface FieldErrors {
  errors: { field: string; code: string; message: string }[];
}

describeWithDb('/users', () => {
  jest.setTimeout(30_000);

  const sfx = suffix();
  let app: NestExpressApplication;
  let db: Database;
  let close: () => Promise<void>;
  let depot: Awaited<ReturnType<typeof depotFixture>>;
  let rusiru: Awaited<ReturnType<typeof signedInAs>>;

  const api = (cookie: string) => {
    const server = app.getHttpServer();
    const withAuth = <T extends request.Test>(r: T) =>
      r.set(browser()).set('Cookie', cookie);
    return {
      get: (path: string) => withAuth(request(server).get(path)),
      patch: (path: string, body: object) =>
        withAuth(request(server).patch(path)).send(body),
      post: (path: string, body: object = {}) =>
        withAuth(request(server).post(path)).send(body),
      put: (path: string, body: object) =>
        withAuth(request(server).put(path)).send(body),
    };
  };

  const sessionCount = (userId: string) =>
    db.$count(sessions, eq(sessions.userId, userId));
  const auditsFor = (userId: string) =>
    db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.entityType, 'user'),
          eq(auditEvents.entityId, userId),
        ),
      );
  const eventsFor = (userId: string) =>
    db
      .select()
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.aggregateType, 'user'),
          eq(outboxEvents.aggregateId, userId),
        ),
      );
  const userRow = async (id: string) =>
    (await db.select().from(users).where(eq(users.id, id)))[0];

  beforeAll(async () => {
    app = await createTestApp();
    ({ db, close } = ownerDatabase());
    depot = await depotFixture(db, sfx);
    rusiru = await signedInAs(app, db, {
      role: 'admin',
      name: 'Rusiru Withanage',
    });
  });

  afterEach(() => app.get(ClockService).reset());

  afterAll(async () => {
    await close();
    await app.close();
  });

  it('AC-IDN-04 a role change revokes sessions', async () => {
    const loader = await createTestUser(app, db, {
      role: 'loader',
      depotId: depot.plg,
    });
    // Two browsers with every cookie they hold, so no cached session can outlive the change.
    const cookies = [
      await signInAsBrowser(app, loader.email),
      await signInAsBrowser(app, loader.email),
    ];
    for (const cookie of cookies)
      await api(cookie).get('/api/v1/me').expect(200);
    expect(await sessionCount(loader.id)).toBe(2);

    const res = await api(rusiru.cookie)
      .patch(`/api/v1/users/${loader.id}`, {
        role: 'dispatcher',
        reasonCode: 'PROMOTION',
      })
      .expect(200);
    expect(bodyOf<{ data: UserBody }>(res).data).toMatchObject({
      id: loader.id,
      role: 'dispatcher',
      depotId: depot.plg,
    });

    expect(await sessionCount(loader.id)).toBe(0);
    for (const cookie of cookies) {
      const old = await api(cookie).get('/api/v1/me');
      expect(old.status).toBe(401);
      expectProblem(old, 'UNAUTHENTICATED');
    }

    const audits = await auditsFor(loader.id);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: 'identity.user.role_changed',
      actorId: rusiru.id,
      reasonCode: 'PROMOTION',
      before: { role: 'loader', depotId: depot.plg },
      after: { role: 'dispatcher', depotId: depot.plg },
    });
    expect((await eventsFor(loader.id)).map((e) => e.type)).toEqual([
      'identity.user.role_changed',
    ]);
  });

  it('AC-IDN-28 admin lists and searches users', async () => {
    const aniqa = await createTestUser(app, db, {
      role: 'driver',
      name: 'Aniqa Razick',
      depotId: depot.plg,
      pin: '1357',
    });
    await createTestUser(app, db, {
      role: 'loader',
      name: 'Aniqa Perera',
      depotId: depot.plg,
    });

    const res = await api(rusiru.cookie)
      .get(
        `/api/v1/users?filter[role]=driver&filter[depotId]=${depot.plg}&q=aniqa&limit=10`,
      )
      .expect(200);
    const body = bodyOf<{
      data: UserBody[];
      meta: { page: { limit: number; offset: number; total: number } };
    }>(res);
    expect(body.data.map((u) => u.id)).toEqual([aniqa.id]);
    expect(body.meta.page).toEqual({ limit: 10, offset: 0, total: 1 });
    for (const user of body.data) expect(user).not.toHaveProperty('pinHash');
  });

  it('AC-IDN-31 role change needs a reason', async () => {
    const loader = await createTestUser(app, db, {
      role: 'loader',
      depotId: depot.plg,
    });
    await signIn(app, loader.email);

    const res = await api(rusiru.cookie).patch(`/api/v1/users/${loader.id}`, {
      role: 'dispatcher',
    });
    expect(res.status).toBe(400);
    const problem = expectProblem(res, 'VALIDATION_FAILED');
    expect((problem as unknown as FieldErrors).errors).toEqual([
      {
        field: 'reasonCode',
        code: 'required',
        message: 'A reason is required',
      },
    ]);

    expect(await userRow(loader.id)).toMatchObject({
      role: 'loader',
      depotId: depot.plg,
    });
    expect(await sessionCount(loader.id)).toBe(1);
    expect(await auditsFor(loader.id)).toHaveLength(0);
    expect(await eventsFor(loader.id)).toHaveLength(0);
  });

  it('AC-IDN-32 scope change revokes sessions', async () => {
    const loader = await createTestUser(app, db, {
      role: 'loader',
      depotId: depot.plg,
    });
    await signIn(app, loader.email);

    const res = await api(rusiru.cookie)
      .patch(`/api/v1/users/${loader.id}`, {
        depotId: depot.kdy,
        reasonCode: 'TRANSFER',
      })
      .expect(200);
    expect(bodyOf<{ data: UserBody }>(res).data.depotId).toBe(depot.kdy);
    expect(await sessionCount(loader.id)).toBe(0);

    const audits = await auditsFor(loader.id);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: 'identity.user.scope_changed',
      reasonCode: 'TRANSFER',
      before: { depotId: depot.plg },
      after: { depotId: depot.kdy },
    });
  });

  it('AC-IDN-33 driver with trips today stays active', async () => {
    freezeClock(app, '2026-10-02T05:00:00+05:30');
    const dinushi = await createTestUser(app, db, {
      role: 'driver',
      name: 'Dinushi Rathnayake',
      depotId: depot.plg,
    });
    const { tripId } = await tripFixture(db, {
      depotId: depot.plg,
      districtId: depot.plgDistrict,
      driverId: dinushi.id,
      date: '2026-10-02',
    });

    const res = await api(rusiru.cookie).post(
      `/api/v1/users/${dinushi.id}/deactivate`,
    );
    expect(res.status).toBe(409);
    const problem = expectProblem(res, 'CONFLICT_STATE');
    expect(problem._links).toMatchObject({
      reassign: { href: `/api/v1/trips/${tripId}/reassign`, method: 'POST' },
    });

    expect((await userRow(dinushi.id)).banned).toBe(false);
    expect(await auditsFor(dinushi.id)).toHaveLength(0);
    expect(await eventsFor(dinushi.id)).toHaveLength(0);
  });

  it('AC-IDN-34 deactivation keeps the user row', async () => {
    freezeClock(app, '2026-10-02T05:00:00+05:30');
    const driver = await createTestUser(app, db, {
      role: 'driver',
      depotId: depot.plg,
    });
    // A trip on another day doesn't hold the driver back.
    await tripFixture(db, {
      depotId: depot.plg,
      districtId: depot.plgDistrict,
      driverId: driver.id,
      date: '2026-10-03',
    });
    await signIn(app, driver.email);

    const res = await api(rusiru.cookie)
      .post(`/api/v1/users/${driver.id}/deactivate`)
      .expect(200);
    const body = bodyOf<{ data: UserBody }>(res).data;
    expect(body.banned).toBe(true);
    expect(body._links.reactivate).toMatchObject({ method: 'POST' });
    expect(body._links).not.toHaveProperty('deactivate');

    expect(await userRow(driver.id)).toMatchObject({ banned: true });
    expect(await sessionCount(driver.id)).toBe(0);
    expect((await eventsFor(driver.id)).map((e) => e.type)).toEqual([
      'identity.user.deactivated',
    ]);

    const openapi = JSON.parse(
      readFileSync(join(__dirname, '../../../../openapi.json'), 'utf8'),
    ) as { paths: Record<string, Record<string, unknown>> };
    const deletesUsers = Object.entries(openapi.paths).filter(
      ([path, methods]) => path.includes('/users') && 'delete' in methods,
    );
    expect(deletesUsers).toEqual([]);
  });

  it('AC-IDN-35 reactivation restores the user', async () => {
    const driver = await createTestUser(app, db, {
      role: 'driver',
      depotId: depot.plg,
    });
    await db.update(users).set({ banned: true }).where(eq(users.id, driver.id));

    const res = await api(rusiru.cookie)
      .post(`/api/v1/users/${driver.id}/reactivate`)
      .expect(200);
    expect(bodyOf<{ data: UserBody }>(res).data.banned).toBe(false);
    expect((await userRow(driver.id)).banned).toBe(false);
  });

  it('AC-IDN-36 PIN is unique per depot', async () => {
    await createTestUser(app, db, {
      role: 'loader',
      name: 'Harini De Mel',
      depotId: depot.plg,
      pin: '2468',
    });
    const second = await createTestUser(app, db, {
      role: 'loader',
      depotId: depot.plg,
    });

    const res = await api(rusiru.cookie).put(`/api/v1/users/${second.id}/pin`, {
      pin: '2468',
    });
    expect(res.status).toBe(409);
    expectProblem(res, 'CONFLICT_STATE');
    expect((await userRow(second.id)).pinHash).toBeNull();
  });

  it('AC-IDN-37 PIN must be four digits', async () => {
    const loader = await createTestUser(app, db, {
      role: 'loader',
      depotId: depot.plg,
    });

    const res = await api(rusiru.cookie).put(`/api/v1/users/${loader.id}/pin`, {
      pin: '24a8',
    });
    expect(res.status).toBe(400);
    const problem = expectProblem(
      res,
      'VALIDATION_FAILED',
    ) as unknown as FieldErrors;
    expect(problem.errors.map((e) => e.field)).toEqual(['pin']);
    expect((await userRow(loader.id)).pinHash).toBeNull();
  });

  it('AC-IDN-38 admin sets a loader PIN', async () => {
    const kdyDepot = await depotFixture(db, suffix());
    await createTestUser(app, db, {
      role: 'loader',
      name: 'Harini De Mel',
      depotId: kdyDepot.plg,
      pin: '2468',
    });
    const kandyLoader = await createTestUser(app, db, {
      role: 'loader',
      depotId: kdyDepot.kdy,
    });

    const res = await api(rusiru.cookie)
      .put(`/api/v1/users/${kandyLoader.id}/pin`, { pin: '2468' })
      .expect(200);
    const body = bodyOf<{ data: Record<string, unknown> }>(res).data;
    expect(body).not.toHaveProperty('pinHash');
    expect(body).not.toHaveProperty('pin');
    expect(JSON.stringify(res.body)).not.toContain('2468');

    const { pinHash } = await userRow(kandyLoader.id);
    expect(pinHash).not.toBeNull();
    expect(pinHash).not.toBe('2468');
    const ctx = await app.get<Auth>(AUTH).$context;
    expect(
      await ctx.password.verify({ hash: pinHash!, password: '2468' }),
    ).toBe(true);

    const tablet = await deviceFixture(db, `T-kdy-${suffix()}`, {
      depotId: kdyDepot.kdy,
    });
    const signedIn = await request(app.getHttpServer())
      .post('/api/auth/sign-in/pin')
      .set(browser())
      .send({ depotId: kdyDepot.kdy, pin: '2468', deviceId: tablet })
      .expect(200);
    expect(bodyOf<{ user: { id: string } }>(signedIn).user.id).toBe(
      kandyLoader.id,
    );
  });

  it('AC-IDN-67 outside demo mode no response carries a PIN', async () => {
    const loader = await createTestUser(app, db, {
      role: 'loader',
      depotId: depot.plg,
    });

    const res = await api(rusiru.cookie)
      .put(`/api/v1/users/${loader.id}/pin`, { pin: '8642' })
      .expect(200);
    expect(
      bodyOf<{ data: Record<string, unknown> }>(res).data.demoPin,
    ).toBeNull();
    expect(JSON.stringify(res.body)).not.toContain('8642');
    expect((await userRow(loader.id)).demoPin).toBeNull();
  });
});

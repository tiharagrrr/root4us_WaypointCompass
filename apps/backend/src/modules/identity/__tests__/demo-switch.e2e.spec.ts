import '../../../../test/demo-mode';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { UserRole } from '@waypoint/shared';
import request from 'supertest';
import {
  bodyOf,
  browser,
  createTestUser,
  type Problem,
  sessionCookie,
  signedInAs,
} from '../../../../test/auth';
import {
  createTestApp,
  describeWithDb,
  ownerDatabase,
} from '../../../../test/create-test-app';
import { depotFixture, outletFixture, suffix } from '../../../../test/fixtures';
import { eq } from 'drizzle-orm';
import type { Database } from '../../../db/client';
import { users as schemaUsers } from '../../../db/schema';

interface CastMember {
  id: string;
  name: string;
  role: UserRole;
  scopeNames: { depot: string | null; outlet: string | null };
}

/**
 * The account menu's user switch, in demo mode: who it may become, and that becoming them really
 * changes the session. Outside demo mode neither route exists, which demo-off.e2e.spec.ts checks
 * (this suite turns DEMO_MODE on for the whole file).
 */
describeWithDb('demo user switch', () => {
  jest.setTimeout(30_000);

  const sfx = suffix();
  let app: NestExpressApplication;
  let db: Database;
  let close: () => Promise<void>;
  let store: { id: string; name: string; cookie: string };
  let dispatcher: { id: string; name: string };

  beforeAll(async () => {
    app = await createTestApp();
    ({ db, close } = ownerDatabase());
    const depot = await depotFixture(db, sfx);
    const outlet = await outletFixture(db, `OUT${sfx}`, {
      depotId: depot.plg,
      districtId: depot.plgDistrict,
    });
    store = await signedInAs(app, db, {
      role: 'store_manager',
      name: `Nimesha ${sfx}`,
      outletId: outlet,
    });
    dispatcher = await signedInAs(app, db, {
      role: 'dispatcher',
      name: `Tihara ${sfx}`,
      depotId: depot.plg,
    });
  });

  afterAll(async () => {
    await close();
    await app.close();
  });

  const cast = async (cookie: string) =>
    bodyOf<{ data: { users: CastMember[] } }>(
      await request(app.getHttpServer())
        .get('/api/v1/demo/users')
        .set(browser())
        .set('Cookie', cookie)
        .expect(200),
    ).data.users;

  it('lists the users a demo can switch between, with their scope named', async () => {
    const users = await cast(store.cookie);

    const tihara = users.find((u) => u.id === dispatcher.id);
    expect(tihara).toMatchObject({ role: 'dispatcher', name: dispatcher.name });
    expect(tihara?.scopeNames.depot).toContain('Peliyagoda');
    // The store manager comes first: the cast is in the order a demo walks the day.
    expect(users.findIndex((u) => u.role === 'store_manager')).toBeLessThan(
      users.findIndex((u) => u.role === 'dispatcher'),
    );
  });

  it('AC-IDN-63 the demo account menu leaves out the seeded staff', async () => {
    const driver = await createTestUser(app, db, {
      role: 'driver',
      name: `Seeded driver ${sfx}`,
    });
    await db
      .update(schemaUsers)
      .set({ username: `drv.tst63${sfx}`.toLowerCase() })
      .where(eq(schemaUsers.id, driver.id));

    const ids = (await cast(store.cookie)).map((u) => u.id);
    expect(ids).toContain(dispatcher.id);
    expect(ids).not.toContain(driver.id);
  });

  it('refuses an unsigned caller', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/demo/users')
      .set(browser())
      .expect(401);
  });

  it('signs the caller in as the other user, with that user’s own role', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/sign-in/demo')
      .set(browser())
      .set('Cookie', store.cookie)
      .send({ userId: dispatcher.id })
      .expect(200);

    const cookie = sessionCookie(res);
    expect(cookie).not.toBe('');

    const me = bodyOf<{ data: { id: string; role: UserRole } }>(
      await request(app.getHttpServer())
        .get('/api/v1/me')
        .set(browser())
        .set('Cookie', cookie)
        .expect(200),
    );
    expect(me.data).toMatchObject({ id: dispatcher.id, role: 'dispatcher' });
  });

  it('refuses a user who does not exist', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/sign-in/demo')
      .set(browser())
      .set('Cookie', store.cookie)
      .send({ userId: '0192a3f4-0000-7000-8000-0000000000ff' });

    expect(res.status).toBe(404);
    expect(bodyOf<Problem>(res).code).toBe('NO_SUCH_USER');
  });

  it('refuses an unsigned caller, so a switch always starts from a session', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/sign-in/demo')
      .set(browser())
      .send({ userId: dispatcher.id });

    expect(res.status).toBe(401);
  });
});

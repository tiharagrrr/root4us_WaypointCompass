import '../../../../test/demo-mode';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import {
  bodyOf,
  browser,
  createTestUser,
  type Problem,
  signedInAs,
} from '../../../../test/auth';
import {
  createTestApp,
  describeWithDb,
  ownerDatabase,
} from '../../../../test/create-test-app';
import { depotFixture, suffix } from '../../../../test/fixtures';
import type { Database } from '../../../db/client';
import { users } from '../../../db/schema';

/**
 * Loader PINs in demo mode: any device may sign in with one, and A1 shows the admin the PIN.
 * Outside demo mode the dock-device rule (loader-pin.e2e.spec.ts, AC-IDN-02) and the hidden PIN
 * (users.e2e.spec.ts, AC-IDN-67) hold; this suite turns DEMO_MODE on for the whole file.
 */
describeWithDb('loader PINs in demo mode', () => {
  jest.setTimeout(30_000);

  const sfx = suffix();
  let app: NestExpressApplication;
  let db: Database;
  let close: () => Promise<void>;
  let depot: Awaited<ReturnType<typeof depotFixture>>;
  let rusiru: Awaited<ReturnType<typeof signedInAs>>;

  const signInPin = (body: object) =>
    request(app.getHttpServer())
      .post('/api/auth/sign-in/pin')
      .set(browser())
      .send(body);

  const setPin = (userId: string, pin: string) =>
    request(app.getHttpServer())
      .put(`/api/v1/users/${userId}/pin`)
      .set(browser())
      .set('Cookie', rusiru.cookie)
      .send({ pin });

  beforeAll(async () => {
    app = await createTestApp();
    ({ db, close } = ownerDatabase());
    depot = await depotFixture(db, sfx);
    rusiru = await signedInAs(app, db, {
      role: 'admin',
      name: 'Rusiru Withanage',
    });
  });

  afterAll(async () => {
    await close();
    await app.close();
  });

  it('AC-IDN-65 in demo mode a PIN signs in from any device', async () => {
    const harini = await createTestUser(app, db, {
      role: 'loader',
      name: 'Harini De Mel',
      depotId: depot.plg,
      pin: '2468',
    });
    const unknownDevice = `P9-${sfx}`;

    const signedIn = await signInPin({
      depotId: depot.plg,
      pin: '2468',
      deviceId: unknownDevice,
    });
    expect(signedIn.status).toBe(200);
    expect(bodyOf<{ user: { id: string } }>(signedIn).user.id).toBe(harini.id);

    const otherDepot = await signInPin({
      depotId: depot.kdy,
      pin: '2468',
      deviceId: unknownDevice,
    });
    expect(otherDepot.status).toBe(401);
    expect(bodyOf<Problem>(otherDepot).code).toBe('WRONG_PIN');
  });

  it("AC-IDN-66 in demo mode the admin sees a loader's PIN", async () => {
    const loader = await createTestUser(app, db, {
      role: 'loader',
      depotId: depot.kdy,
    });

    const res = await setPin(loader.id, '9753').expect(200);
    const body = bodyOf<{ data: Record<string, unknown> }>(res).data;
    expect(body.demoPin).toBe('9753');
    expect(body).not.toHaveProperty('pinHash');

    const list = await request(app.getHttpServer())
      .get(`/api/v1/users?filter[depotId]=${depot.kdy}`)
      .set(browser())
      .set('Cookie', rusiru.cookie)
      .expect(200);
    const listed = bodyOf<{ data: { id: string; demoPin: string | null }[] }>(
      list,
    ).data.find((u) => u.id === loader.id);
    expect(listed?.demoPin).toBe('9753');

    const [row] = await db.select().from(users).where(eq(users.id, loader.id));
    expect(row.pinHash).not.toBe('9753');
  });
});

import type { NestExpressApplication } from '@nestjs/platform-express';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import {
  bodyOf,
  browser,
  clientIp,
  createTestUser,
  sessionCookie,
  type Problem,
} from '../../../../test/auth';
import {
  createTestApp,
  describeWithDb,
  ownerDatabase,
} from '../../../../test/create-test-app';
import { depotFixture, deviceFixture, suffix } from '../../../../test/fixtures';
import type { Database } from '../../../db/client';
import { sessions } from '../../../db/schema';

describeWithDb('loader PIN sign-in (L1)', () => {
  jest.setTimeout(30_000);

  const sfx = suffix();
  let app: NestExpressApplication;
  let db: Database;
  let close: () => Promise<void>;
  let depot: Awaited<ReturnType<typeof depotFixture>>;
  let harini: { id: string };
  const T1 = `T1-${sfx}`; // Peliyagoda dock tablet
  const T2 = `T2-${sfx}`; // Kandy dock tablet
  const P1 = `P1-${sfx}`; // a phone, not a dock device

  const signInPin = (body: object, ip = clientIp()) =>
    request(app.getHttpServer())
      .post('/api/auth/sign-in/pin')
      .set(browser(ip))
      .send(body);

  const sessionsOf = (userId: string) =>
    db.select().from(sessions).where(eq(sessions.userId, userId));

  beforeAll(async () => {
    app = await createTestApp();
    ({ db, close } = ownerDatabase());
    depot = await depotFixture(db, sfx);
    await deviceFixture(db, T1, { depotId: depot.plg });
    await deviceFixture(db, T2, { depotId: depot.kdy });
    await deviceFixture(db, P1);
    harini = await createTestUser(app, db, {
      role: 'loader',
      name: 'Harini De Mel',
      depotId: depot.plg,
      pin: '2468',
    });
  });

  afterAll(async () => {
    await close();
    await app.close();
  });

  it("AC-IDN-02 PIN needs this depot's dock device", async () => {
    for (const deviceId of [T2, P1]) {
      const res = await signInPin({
        depotId: depot.plg,
        pin: '2468',
        deviceId,
      });
      expect(res.status).toBe(403);
      expect(bodyOf<Problem>(res).code).toBe('NOT_A_DOCK_DEVICE');
      expect(sessionCookie(res)).toBe('');
    }
    expect(await sessionsOf(harini.id)).toHaveLength(0);

    // The same PIN on Peliyagoda's own dock tablet signs her in, so the 403s
    // above come from the device check and not from a broken sign-in.
    const ok = await signInPin({
      depotId: depot.plg,
      pin: '2468',
      deviceId: T1,
    });
    expect(ok.status).toBe(200);
    expect(bodyOf<{ user: object }>(ok).user).toEqual({
      id: harini.id,
      name: 'Harini De Mel',
    });
    const session = await request(app.getHttpServer())
      .get('/api/auth/get-session')
      .set(browser())
      .set('Cookie', sessionCookie(ok))
      .expect(200);
    expect(bodyOf<{ user: { id: string } }>(session).user.id).toBe(harini.id);
    expect(await sessionsOf(harini.id)).toHaveLength(1);
    await db.delete(sessions).where(eq(sessions.userId, harini.id));
  });

  it('AC-IDN-05 sixth PIN attempt gets 429', async () => {
    const t1 = clientIp();
    for (let attempt = 1; attempt <= 5; attempt++) {
      const res = await signInPin(
        { depotId: depot.plg, pin: '1357', deviceId: T1 },
        t1,
      );
      expect(res.status).toBe(401);
      expect(bodyOf<Problem>(res).code).toBe('WRONG_PIN');
    }

    // Even the right PIN is refused once the limit is reached.
    const sixth = await signInPin(
      { depotId: depot.plg, pin: '2468', deviceId: T1 },
      t1,
    );
    expect(sixth.status).toBe(429);
    expect(sessionCookie(sixth)).toBe('');
    expect(await sessionsOf(harini.id)).toHaveLength(0);
  });
});

import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { bodyOf, browser, signedInAs } from '../../../../test/auth';
import {
  createTestApp,
  describeWithDb,
  ownerDatabase,
} from '../../../../test/create-test-app';
import { depotFixture, suffix } from '../../../../test/fixtures';
import type { Database } from '../../../db/client';
import { auditEvents, devices } from '../../../db/schema';

describeWithDb('/devices', () => {
  jest.setTimeout(30_000);

  const sfx = suffix();
  let app: NestExpressApplication;
  let db: Database;
  let close: () => Promise<void>;
  let plg: string;

  beforeAll(async () => {
    app = await createTestApp();
    ({ db, close } = ownerDatabase());
    ({ plg } = await depotFixture(db, sfx));
  });

  afterAll(async () => {
    await close();
    await app.close();
  });

  it('AC-IDN-27 admin marks a dock device', async () => {
    const server = app.getHttpServer();
    const harini = await signedInAs(app, db, {
      role: 'loader',
      name: 'Harini De Mel',
      depotId: plg,
      pin: '2468',
    });
    const rusiru = await signedInAs(app, db, {
      role: 'admin',
      name: 'Rusiru Withanage',
    });
    const T3 = `T3-${sfx}`;
    await request(server)
      .post('/api/v1/me/devices')
      .set(browser())
      .set('Cookie', harini.cookie)
      .send({ id: T3, platform: 'PWA' })
      .expect(201);
    const pinSignIn = () =>
      request(server)
        .post('/api/auth/sign-in/pin')
        .set(browser())
        .send({ depotId: plg, pin: '2468', deviceId: T3 });
    expect((await pinSignIn()).status).toBe(403);

    const res = await request(server)
      .put(`/api/v1/devices/${T3}/dock`)
      .set(browser())
      .set('Cookie', rusiru.cookie)
      .send({ depotId: plg })
      .expect(200);
    expect(
      bodyOf<{ data: { isDockDevice: boolean; depotId: string } }>(res).data,
    ).toMatchObject({ isDockDevice: true, depotId: plg });

    const [row] = await db.select().from(devices).where(eq(devices.id, T3));
    expect(row).toMatchObject({ isDockDevice: true, depotId: plg });
    const signedIn = await pinSignIn().expect(200);
    expect(bodyOf<{ user: { id: string } }>(signedIn).user.id).toBe(harini.id);
    expect(
      await db.$count(
        auditEvents,
        and(
          eq(auditEvents.action, 'identity.device.dock_changed'),
          eq(auditEvents.entityId, T3),
        ),
      ),
    ).toBe(1);
  });
});

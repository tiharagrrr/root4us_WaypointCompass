// DEMO_MODE off, whatever an earlier suite in this worker set: the demo tools must not exist.
process.env.DEMO_MODE = 'false';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { browser, signedInAs } from '../../../../test/auth';
import {
  createTestApp,
  describeWithDb,
  ownerDatabase,
} from '../../../../test/create-test-app';
import type { Database } from '../../../db/client';

/** Without DEMO_MODE the account menu offers no user switch, because neither route is there. */
describeWithDb('demo tools outside demo mode', () => {
  jest.setTimeout(30_000);

  let app: NestExpressApplication;
  let db: Database;
  let close: () => Promise<void>;
  let cookie: string;

  beforeAll(async () => {
    app = await createTestApp();
    ({ db, close } = ownerDatabase());
    cookie = (await signedInAs(app, db, { role: 'admin' })).cookie;
  });

  afterAll(async () => {
    await close();
    await app.close();
  });

  it('answers 404 for the demo cast', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/demo/users')
      .set(browser())
      .set('Cookie', cookie)
      .expect(404);
  });

  it('has no demo sign-in route at all', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/sign-in/demo')
      .set(browser())
      .set('Cookie', cookie)
      .send({ userId: '0192a3f4-0000-7000-8000-000000000001' });

    expect(res.status).toBe(404);
  });
});

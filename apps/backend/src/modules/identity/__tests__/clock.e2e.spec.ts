import '../../../../test/demo-mode';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { bodyOf, browser, signedInAs } from '../../../../test/auth';
import {
  createTestApp,
  describeWithDb,
  ownerDatabase,
} from '../../../../test/create-test-app';
import { ClockService } from '../../../core/clock/clock.service';
import type { Database } from '../../../db/client';
import { outboxEvents, settings } from '../../../db/schema';

interface Envelope<T> {
  data: T;
  meta: { serverTime: string };
}

/** Time travel in demo mode. demo.clock is a shared global row: restored afterwards. */
describeWithDb('/clock (demo mode)', () => {
  jest.setTimeout(30_000);

  let app: NestExpressApplication;
  let db: Database;
  let close: () => Promise<void>;
  let rusiru: Awaited<ReturnType<typeof signedInAs>>;
  let tihara: Awaited<ReturnType<typeof signedInAs>>;
  let saved: (typeof settings.$inferSelect)[] = [];

  const clockRow = () =>
    db
      .select()
      .from(settings)
      .where(and(eq(settings.key, 'demo.clock'), eq(settings.scope, 'global')));
  const clockEvents = () =>
    db.$count(outboxEvents, eq(outboxEvents.type, 'clock.changed'));
  const as = (cookie: string) => {
    const server = app.getHttpServer();
    return {
      get: (path: string) =>
        request(server).get(path).set(browser()).set('Cookie', cookie),
      put: (path: string, body: object) =>
        request(server)
          .put(path)
          .set(browser())
          .set('Cookie', cookie)
          .send(body),
      post: (path: string) =>
        request(server)
          .post(path)
          .set(browser())
          .set('Cookie', cookie)
          .send({}),
    };
  };
  const serverTime = async (cookie: string) =>
    bodyOf<Envelope<unknown>>(await as(cookie).get('/api/v1/me').expect(200))
      .meta.serverTime;

  beforeAll(async () => {
    app = await createTestApp();
    ({ db, close } = ownerDatabase());
    rusiru = await signedInAs(app, db, { role: 'admin' });
    tihara = await signedInAs(app, db, {
      role: 'dispatcher',
      name: 'Tihara Egodage',
    });
    saved = await clockRow();
  });

  afterAll(async () => {
    await db
      .delete(settings)
      .where(and(eq(settings.key, 'demo.clock'), eq(settings.scope, 'global')));
    if (saved.length) await db.insert(settings).values(saved);
    app.get(ClockService).reset();
    await close();
    await app.close();
  });

  it('AC-IDN-53 admin freezes the demo clock', async () => {
    const events = await clockEvents();
    await as(rusiru.cookie)
      .put('/api/v1/clock', {
        mode: 'frozen',
        at: '2026-10-01T15:55:00+05:30',
      })
      .expect(200);

    const [row] = await clockRow();
    expect(row.value).toEqual({
      mode: 'frozen',
      at: '2026-10-01T15:55:00+05:30',
    });
    expect(await clockEvents()).toBe(events + 1);
    expect(await serverTime(tihara.cookie)).toBe('2026-10-01T15:55:00+05:30');

    const clock = await as(tihara.cookie).get('/api/v1/clock').expect(200);
    expect(
      bodyOf<Envelope<{ mode: string; shifted: boolean }>>(clock).data,
    ).toMatchObject({ mode: 'frozen', shifted: true });
  });

  it('AC-IDN-54 admin shifts the demo clock', async () => {
    const events = await clockEvents();
    await as(rusiru.cookie)
      .put('/api/v1/clock', { mode: 'offset', offsetMs: 3_600_000 })
      .expect(200);

    const shifted = Date.parse(await serverTime(tihara.cookie));
    expect(Math.abs(shifted - (Date.now() + 3_600_000))).toBeLessThan(5_000);
    expect(await clockEvents()).toBe(events + 1);
  });

  it('AC-IDN-55 admin returns the clock to real', async () => {
    await as(rusiru.cookie)
      .put('/api/v1/clock', {
        mode: 'frozen',
        at: '2026-10-01T15:55:00+05:30',
      })
      .expect(200);
    const res = await as(rusiru.cookie)
      .put('/api/v1/clock', { mode: 'real' })
      .expect(200);
    expect(
      bodyOf<Envelope<{ mode: string; shifted: boolean }>>(res).data,
    ).toMatchObject({ mode: 'real', shifted: false });

    const now = Date.parse(await serverTime(tihara.cookie));
    expect(Math.abs(now - Date.now())).toBeLessThan(5_000);
  });
});

import type { NestExpressApplication } from '@nestjs/platform-express';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { bodyOf, browser, signedInAs } from '../../../../test/auth';
import {
  createTestApp,
  describeWithDb,
  ownerDatabase,
} from '../../../../test/create-test-app';
import { suffix } from '../../../../test/fixtures';
import { expectProblem } from '../../../../test/kernel';
import type { Database } from '../../../db/client';
import { deferralReasons } from '../../../db/schema';

interface ReasonBody {
  code: string;
  label: string;
  fromEngine: boolean;
  active: boolean;
}

/** A6 deferral reasons (specs/identity/spec.md, AC-IDN-57 and 58). */
describeWithDb('/deferral-reasons', () => {
  jest.setTimeout(30_000);

  const sfx = suffix().toUpperCase();
  let app: NestExpressApplication;
  let db: Database;
  let close: () => Promise<void>;
  let rusiru: Awaited<ReturnType<typeof signedInAs>>;
  let tihara: Awaited<ReturnType<typeof signedInAs>>;

  const as = (cookie: string) => {
    const server = app.getHttpServer();
    const signed = <T extends request.Test>(r: T) =>
      r.set(browser()).set('Cookie', cookie);
    return {
      get: (path: string) => signed(request(server).get(path)),
      post: (path: string, body: object) =>
        signed(request(server).post(path)).send(body),
      patch: (path: string, body: object) =>
        signed(request(server).patch(path)).send(body),
    };
  };
  const listed = async (cookie: string) =>
    bodyOf<{ data: ReasonBody[] }>(
      await as(cookie).get('/api/v1/deferral-reasons').expect(200),
    ).data;

  beforeAll(async () => {
    app = await createTestApp();
    ({ db, close } = ownerDatabase());
    rusiru = await signedInAs(app, db, { role: 'admin' });
    tihara = await signedInAs(app, db, {
      role: 'dispatcher',
      name: 'Tihara Egodage',
    });
  });

  afterAll(async () => {
    await close();
    await app.close();
  });

  it('AC-IDN-57 engine deferral reasons stay active', async () => {
    const code = `NO_REEFER_CAPACITY_${sfx}`;
    await db.insert(deferralReasons).values({
      code,
      label: 'No reefer capacity',
      fromEngine: true,
    });

    const res = await as(rusiru.cookie).patch(
      `/api/v1/deferral-reasons/${code}`,
      { active: false },
    );
    expect(res.status).toBe(409);
    expectProblem(res, 'CONFLICT_STATE');

    const [row] = await db
      .select()
      .from(deferralReasons)
      .where(eq(deferralReasons.code, code));
    expect(row.active).toBe(true);
    expect(await listed(rusiru.cookie)).toEqual(
      expect.arrayContaining([expect.objectContaining({ code, active: true })]),
    );
  });

  it('AC-IDN-58 admin adds a deferral reason', async () => {
    const code = `STORE_CLOSED_${sfx}`;
    const res = await as(rusiru.cookie)
      .post('/api/v1/deferral-reasons', {
        code,
        label: 'Store closed for a holiday',
      })
      .expect(201);
    expect(res.headers.location).toBe(`/api/v1/deferral-reasons/${code}`);

    expect(await listed(tihara.cookie)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code, fromEngine: false, active: true }),
      ]),
    );
  });
});

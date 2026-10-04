import type { NestExpressApplication } from '@nestjs/platform-express';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { browser, signedInAs } from '../../../../test/auth';
import {
  createTestApp,
  describeWithDb,
  ownerDatabase,
} from '../../../../test/create-test-app';
import { depotFixture, suffix } from '../../../../test/fixtures';
import { expectProblem, freezeClock } from '../../../../test/kernel';
import type { Database } from '../../../db/client';
import { depotWaves } from '../../../db/schema';

const AT_0900 = '2026-10-01T09:00:00+05:30';

interface WaveBody {
  id: string;
  depotId: string;
  label: string;
  departFromMin: number;
  departFrom: string;
  departToMin: number;
  departTo: string;
  brands: string[];
  _links: Record<string, { href: string; method?: string }>;
}

const body = <T>(res: { body: unknown }) => (res.body as { data: T }).data;
const items = <T>(res: { body: unknown }) => (res.body as { data: T[] }).data;

/**
 * Run 1 and Run 2, the departure bands A4 edits (AC-MD-07). One label per
 * depot, a band that ends after it starts, and a wave a trip is planned in
 * stays.
 */
describeWithDb('master data: depot waves', () => {
  jest.setTimeout(90_000);

  const sfx = suffix();
  let app: NestExpressApplication;
  let db: Database;
  let close: () => Promise<void>;
  let depot: Awaited<ReturnType<typeof depotFixture>>;
  const cookies: Record<string, string> = {};

  beforeAll(async () => {
    app = await createTestApp();
    ({ db, close } = ownerDatabase());
    depot = await depotFixture(db, sfx);
    for (const [key, input] of [
      ['admin', { role: 'admin' as const }],
      ['dispatcher', { role: 'dispatcher' as const, depotId: depot.plg }],
    ] as const) {
      cookies[key] = (await signedInAs(app, db, input)).cookie;
    }
  });

  afterAll(async () => {
    freezeClock(app, AT_0900).reset();
    await close();
    await app.close();
  });

  beforeEach(async () => {
    freezeClock(app, AT_0900);
    await db.delete(depotWaves).where(eq(depotWaves.depotId, depot.plg));
  });

  const call = (
    role: string,
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
  ) =>
    request(app.getHttpServer())
      [method](`/api/v1${path}`)
      .set(browser())
      .set('Cookie', cookies[role]);

  it('AC-MD-07 depot waves have unique labels', async () => {
    const created = await call(
      'admin',
      'post',
      `/depots/${depot.plg}/waves`,
    ).send({
      label: 'Run 1',
      departFromMin: 315,
      departToMin: 390,
      brands: ['FRESH'],
    });

    expect(created.status).toBe(201);
    expect(created.headers.location).toBe(
      `/api/v1/depots/${depot.plg}/waves/${body<WaveBody>(created).id}`,
    );
    expect(body<WaveBody>(created)).toMatchObject({
      label: 'Run 1',
      departFromMin: 315,
      departFrom: '05:15',
      departToMin: 390,
      departTo: '06:30',
      brands: ['FRESH'],
    });

    const list = await call('admin', 'get', `/depots/${depot.plg}/waves`);
    expect(list.status).toBe(200);
    expect(items<WaveBody>(list)).toEqual([
      expect.objectContaining({
        label: 'Run 1',
        departFromMin: 315,
        departToMin: 390,
      }),
    ]);

    const again = await call(
      'admin',
      'post',
      `/depots/${depot.plg}/waves`,
    ).send({
      label: 'Run 1',
      departFromMin: 400,
      departToMin: 450,
      brands: ['FRESH'],
    });

    expect(again.status).toBe(409);
    expectProblem(again, 'CONFLICT_STATE');
    expect(
      items<WaveBody>(await call('admin', 'get', `/depots/${depot.plg}/waves`)),
    ).toHaveLength(1);
  });

  it('AC-MD-07 a band ends after it starts', async () => {
    const res = await call('admin', 'post', `/depots/${depot.plg}/waves`).send({
      label: 'Run 2',
      departFromMin: 660,
      departToMin: 600,
      brands: ['FRESH'],
    });

    expect(res.status).toBe(400);
    expect(expectProblem(res, 'VALIDATION_FAILED').errors).toEqual([
      expect.objectContaining({ field: 'departToMin' }),
    ]);
    expect(
      items(await call('admin', 'get', `/depots/${depot.plg}/waves`)),
    ).toHaveLength(0);
  });

  it('AC-MD-07 a wave is edited and removed', async () => {
    const created = await call(
      'admin',
      'post',
      `/depots/${depot.plg}/waves`,
    ).send({
      label: 'Run 2',
      departFromMin: 660,
      departToMin: 750,
      brands: ['FRESH', 'STYLE'],
    });
    const { id } = body<WaveBody>(created);

    const edited = await call(
      'admin',
      'patch',
      `/depots/${depot.plg}/waves/${id}`,
    ).send({ departToMin: 780, brands: ['FRESH'] });

    expect(edited.status).toBe(200);
    expect(body<WaveBody>(edited)).toMatchObject({
      label: 'Run 2',
      departToMin: 780,
      departTo: '13:00',
      brands: ['FRESH'],
    });

    const removed = await call(
      'admin',
      'delete',
      `/depots/${depot.plg}/waves/${id}`,
    );
    expect(removed.status).toBe(204);
    expect(
      items(await call('admin', 'get', `/depots/${depot.plg}/waves`)),
    ).toHaveLength(0);

    const missing = await call(
      'admin',
      'patch',
      `/depots/${depot.plg}/waves/${id}`,
    ).send({ departToMin: 800 });
    expect(missing.status).toBe(404);
    expectProblem(missing, 'NOT_FOUND');
  });

  it('AC-MD-12 waves need masterData:manage', async () => {
    for (const [method, path] of [
      ['get', `/depots/${depot.plg}/waves`],
      ['post', `/depots/${depot.plg}/waves`],
    ] as const) {
      const res = await call('dispatcher', method, path).send({
        label: 'Run 3',
        departFromMin: 300,
        departToMin: 360,
        brands: ['FRESH'],
      });
      expect([method, res.status]).toEqual([method, 403]);
      expectProblem(res, 'FORBIDDEN');
    }
  });
});
